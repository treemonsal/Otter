import { afterEach, expect, it, vi } from 'vitest';
import {
  cloudError,
  encodeWav,
  readCloudResult,
  transcribeCloud,
} from '../src/cloud-transcription';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('überträgt kompaktes Mono-WAV mit korrektem Format und begrenzten Samples', async () => {
  const blob = encodeWav(new Float32Array([-2, -1, 0, 1, 2, NaN]));
  const bytes = await blob.arrayBuffer();
  const view = new DataView(bytes);
  expect(blob.type).toBe('audio/wav');
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF');
  expect(view.getUint16(22, true)).toBe(1);
  expect(view.getUint32(24, true)).toBe(16000);
  expect(view.getUint32(40, true)).toBe(12);
  expect(Array.from({ length: 6 }, (_, i) => view.getInt16(44 + i * 2, true))).toEqual([
    -32768, -32768, 0, 32767, 32767, 0,
  ]);
});

it('liest echte SSE-Grenzen auch über Netzwerkstücke und UTF-8-Zeichen hinweg', async () => {
  const bytes = new TextEncoder().encode(
    'event: heartbeat\r\ndata: null\r\n\r\nevent: complete\r\ndata: ["Gespräch in Zürich."]\r\n\r\n',
  );
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i++) controller.enqueue(bytes.slice(i, i + 1));
      controller.close();
    },
  });
  expect(await readCloudResult(new Response(stream))).toBe('Gespräch in Zürich.');
});

it('verwirft leere, beschädigte und vorzeitig beendete Serverantworten', async () => {
  for (const body of [
    'event: complete\ndata: [""]\n\n',
    'event: complete\ndata: {"text":"falsch"}\n\n',
    'event: heartbeat\ndata: null\n\n',
    'event: complete\ndata: null\n\n',
  ])
    await expect(readCloudResult(new Response(body))).rejects.toThrow();
  await expect(
    readCloudResult(new Response('event: error\ndata: "GPU quota exceeded"\n\n')),
  ).rejects.toThrow('Nutzungslimit');
});

it('startet für überlange Aufnahmen keine Übertragung', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(
    transcribeCloud(new Float32Array(300 * 16000 + 1), new AbortController().signal, () => {}),
  ).rejects.toThrow('5 Minuten');
  expect(fetch).not.toHaveBeenCalled();
});

it('behandelt Zugriff und Limits mit verständlichen Alternativen', async () => {
  expect(cloudError('429')).toContain('Nutzungslimit');
  expect(cloudError('401')).toContain('anonymen Zugriff');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('private provider error', { status: 429 })),
  );
  await expect(
    transcribeCloud(new Float32Array(16000), new AbortController().signal, () => {}),
  ).rejects.toThrow('Nutzungslimit');
});

it('beendet eine laufende Übertragung bei Abbruch', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    ),
  );
  const controller = new AbortController();
  const result = transcribeCloud(new Float32Array(16000), controller.signal, () => {});
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
});

it('begrenzt die gesamte Online-Wartezeit und beendet dabei den Netzwerkanruf', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    ),
  );
  const result = transcribeCloud(new Float32Array(16000), new AbortController().signal, () => {});
  const failure = expect(result).rejects.toThrow('3 Minuten');
  await vi.advanceTimersByTimeAsync(180000);
  await failure;
});
