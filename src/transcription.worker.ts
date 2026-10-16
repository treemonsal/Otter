/// <reference lib="webworker" />
import { env, pipeline } from '@huggingface/transformers';
env.allowLocalModels = false;
env.useBrowserCache = true;
// Also pin the registry preflight requests, which otherwise default to main.
env.remotePathTemplate = '{model}/resolve/5332fcc35e32a33b86612b9a57a89be7906102b1/';
// Only single-threaded WASM: works on GitHub Pages without isolation headers.
env.backends.onnx.wasm!.numThreads = 1;
let transcriber: any;
self.onmessage = async (event) => {
  try {
    const { samples, language, assets } = event.data;
    env.backends.onnx.wasm!.wasmPaths = assets;
    if (!transcriber) {
      self.postMessage({ type: 'status', text: 'Sprachmodell laden …' });
      transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
        device: 'wasm',
        dtype: 'q8',
        revision: '5332fcc35e32a33b86612b9a57a89be7906102b1',
        progress_callback: (p: any) => {
          if (p.status === 'progress')
            self.postMessage({
              type: 'status',
              text: `Sprachmodell: ${p.file.split('/').pop()} · ${Math.round(p.progress)} %`,
            });
        },
      });
    }
    self.postMessage({ type: 'status', text: 'Transkription läuft auf deinem Gerät …' });
    const result = await transcriber(samples, {
      ...(language === 'auto' ? {} : { language }),
      task: 'transcribe',
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      chunk_callback: () =>
        self.postMessage({ type: 'status', text: 'Abschnitt verarbeitet · Transkription läuft …' }),
    });
    self.postMessage({ type: 'result', result });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
