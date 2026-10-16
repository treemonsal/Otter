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
