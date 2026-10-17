export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export async function decodeAudio(
  blob: Blob,
): Promise<{ samples: Float32Array; duration: number }> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (decoded.duration > 3600)
      throw new Error('Bitte verwende Audio mit höchstens 60 Minuten Länge.');
    if (decoded.duration < 0.25) throw new Error('Die Aufnahme ist zu kurz.');
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const resampled = await offline.startRendering();
    return { samples: resampled.getChannelData(0), duration: decoded.duration };
  } finally {
    await context.close();
  }
}
export function recorderType() {
  return ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find((t) =>
    MediaRecorder.isTypeSupported(t),
  );
}

export function audioExtension(type: string) {
  if (/mp4|m4a/i.test(type)) return 'm4a';
  if (/mpeg|mp3/i.test(type)) return 'mp3';
  if (/wav/i.test(type)) return 'wav';
  if (/ogg/i.test(type)) return 'ogg';
  if (/flac/i.test(type)) return 'flac';
  if (/aac/i.test(type)) return 'aac';
  return 'webm';
}

export function audioMimeType(type: string, name: string) {
  if (type.startsWith('audio/') || type === 'video/mp4') return type;
  const extension = name.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    mp4: 'audio/mp4',
    aac: 'audio/aac',
    flac: 'audio/flac',
    ogg: 'audio/ogg',
    webm: 'audio/webm',
  };
  return types[extension || ''] || type || 'application/octet-stream';
}

// Metadata avoids decoding an hour of PCM into a phone's memory merely to import it.
export async function inspectAudio(blob: Blob): Promise<number> {
  try {
    return await new Promise<number>((resolve, reject) => {
      const player = new Audio();
      const url = URL.createObjectURL(blob);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        player.onloadedmetadata = null;
        player.onerror = null;
        const duration = player.duration;
        player.removeAttribute('src');
        player.load();
        URL.revokeObjectURL(url);
        if (error) reject(error);
        else if (!Number.isFinite(duration))
          reject(new Error('Keine lesbare Dauer in den Audio-Metadaten.'));
        else if (duration > 3600)
          reject(new Error('Bitte verwende Audio mit höchstens 60 Minuten Länge.'));
        else if (duration < 0.25) reject(new Error('Die Aufnahme ist zu kurz.'));
        else resolve(duration);
      };
      const timer = setTimeout(
        () => finish(new Error('Audio-Metadaten konnten nicht rechtzeitig gelesen werden.')),
        10000,
      );
      player.preload = 'metadata';
      player.onloadedmetadata = () => finish();
      player.onerror = () =>
        finish(new DOMException('Audioformat konnte nicht gelesen werden.', 'EncodingError'));
      player.src = url;
    });
  } catch (error) {
    // Some small WebM recordings omit duration metadata. Keep their existing import support.
    if (error instanceof Error && /60 Minuten|zu kurz/.test(error.message)) throw error;
    if (blob.size <= 5 * 1024 * 1024) return (await decodeAudio(blob)).duration;
    throw new Error(
      'Die Dauer dieser grossen Audiodatei ist nicht lesbar. Verwende MP3, M4A oder WAV mit gültigen Metadaten.',
    );
  }
}
