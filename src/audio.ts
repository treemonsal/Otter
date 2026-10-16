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
