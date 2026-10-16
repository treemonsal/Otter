// Public, free Hugging Face demo. No credentials are embedded or required.
export const CLOUD_PROVIDER = 'https://hf-audio-whisper-large-v3.hf.space';
export const CLOUD_INFO = 'https://huggingface.co/spaces/hf-audio/whisper-large-v3';
export const CLOUD_MAX_SECONDS = 300;
const API = `${CLOUD_PROVIDER}/gradio_api`;
const UNAVAILABLE =
  'Der kostenlose Online-Dienst ist momentan nicht verfügbar. Versuche es später oder nutze die lokale Transkription.';

export function cloudError(message: string) {
  if (/quota|429|rate.limit|exceeded|GPU.*limit/i.test(message))
    return 'Das kostenlose Nutzungslimit des Online-Dienstes ist erreicht. Warte oder nutze die lokale Transkription.';
  if (/401|403|unauthorized|forbidden|sign.in|log.in/i.test(message))
    return 'Der Online-Dienst erlaubt derzeit keinen anonymen Zugriff. Nutze die lokale Transkription.';
  return UNAVAILABLE;
}

// Sending normalized mono audio avoids codec incompatibilities and excludes original filenames.
export function encodeWav(samples: Float32Array): Blob {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const write = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  write(0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const value = Number.isFinite(samples[i]) ? Math.max(-1, Math.min(1, samples[i])) : 0;
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

// Gradio's documented call API streams SSE, including heartbeat/error/complete events.
export async function readCloudResult(response: Response): Promise<string> {
  if (!response.body) throw new Error(UNAVAILABLE);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      size += value?.byteLength || 0;
      if (size > 2 * 1024 * 1024) throw new Error(UNAVAILABLE);
      pending += decoder.decode(value, { stream: !done });
      // Normalize CRLF only after retaining whole event boundaries.
      const events = pending.split(/\r?\n\r?\n/);
      pending = events.pop() || '';
      if (done && pending.trim()) events.push(pending);
      for (const event of events) {
        const lines = event.split(/\r?\n/);
        const name = lines
          .find((line) => line.startsWith('event:'))
          ?.slice(6)
          .trim();
        const data = lines
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (name === 'error') throw new Error(cloudError(data));
        if (name === 'complete') {
          const output: unknown = JSON.parse(data);
          if (!Array.isArray(output) || typeof output[0] !== 'string' || output[0].length > 1000000)
            throw new Error(UNAVAILABLE);
          const text = output[0].trim();
          if (!text) throw new Error('Keine Sprache erkannt. Prüfe die Aufnahme.');
          return text;
        }
      }
      if (done) throw new Error(UNAVAILABLE);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function transcribeCloud(
  samples: Float32Array,
  signal: AbortSignal,
  onStatus: (text: string) => void,
): Promise<string> {
  if (!samples.length || samples.length > CLOUD_MAX_SECONDS * 16000)
    throw new Error(
      'Die kostenlose Online-Verarbeitung unterstützt Aufnahmen bis 5 Minuten. Für längere Gespräche nutze die lokale Transkription.',
    );
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 180000);
  const request = async (url: string, init?: RequestInit) => {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw new Error(cloudError(String(response.status)));
    return response;
  };
  try {
    onStatus('Audio an Hugging Face senden …');
    const form = new FormData();
    form.append('files', encodeWav(samples), 'audio.wav');
    const paths: unknown = await (
      await request(`${API}/upload`, { method: 'POST', body: form })
    ).json();
    if (
      !Array.isArray(paths) ||
      paths.length !== 1 ||
      typeof paths[0] !== 'string' ||
      paths[0].length > 4096
    )
      throw new Error(UNAVAILABLE);
    onStatus('Whisper large v3 · Warteschlange und Erkennung …');
    const job: unknown = await (
      await request(`${API}/call/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: [
            { path: paths[0], orig_name: 'audio.wav', meta: { _type: 'gradio.FileData' } },
            'transcribe',
          ],
        }),
      })
    ).json();
    const event = (job as { event_id?: unknown } | null)?.event_id;
    if (typeof event !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(event))
      throw new Error(UNAVAILABLE);
    return await readCloudResult(await request(`${API}/call/transcribe/${event}`));
  } catch (error) {
    if (signal.aborted) throw new DOMException('Abgebrochen', 'AbortError');
    if (timedOut)
      throw new Error(
        'Der Online-Dienst hat nach 3 Minuten nicht geantwortet. Nutze die lokale Transkription oder versuche es später.',
      );
    if (error instanceof TypeError) throw new Error(UNAVAILABLE);
    if (error instanceof SyntaxError) throw new Error(UNAVAILABLE);
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
