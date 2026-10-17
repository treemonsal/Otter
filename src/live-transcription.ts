interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognizer {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognitionConstructor = new () => Recognizer;
function constructor(): RecognitionConstructor | undefined {
  const browser = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return browser.SpeechRecognition || browser.webkitSpeechRecognition;
}
export const liveSupported = () => !!constructor();
export function startLive(
  language: string,
  onFinal: (text: string) => void,
  onInterim: (text: string) => void,
  onError: (message: string) => void,
) {
  const Constructor = constructor();
  if (!Constructor)
    throw new Error(
      'Live-Text wird in diesem Browser nicht unterstützt. Die Audioaufnahme funktioniert weiterhin.',
    );
  let stopped = false;
  let restarts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let recognizer: Recognizer | undefined;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    if (recognizer) {
      recognizer.onend = null;
      recognizer.onresult = null;
      recognizer.abort();
    }
    onInterim('');
  };
  function start() {
    if (stopped) return;
    const current = new Constructor!();
    recognizer = current;
    current.continuous = true;
    current.interimResults = true;
    current.lang = language;
    current.onresult = (event) => {
      if (stopped || recognizer !== current) return;
      restarts = 0;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (!text) continue;
        if (result.isFinal) onFinal(text);
        else interim += (interim ? ' ' : '') + text;
      }
      onInterim(interim);
    };
    current.onerror = (event) => {
      if (stopped) return;
      if (event.error === 'aborted') return;
      if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error)) {
        stop();
        onError(
          'Live-Text wurde vom Browser beendet. Prüfe die Sprach- und Mikrofonberechtigung. Deine Audioaufnahme bleibt erhalten.',
        );
      }
    };
    current.onend = () => {
      if (stopped) return;
      if (document.visibilityState === 'hidden' || ++restarts > 3) {
        stop();
        onError(
          'Live-Text ist unterbrochen. Du kannst ihn erneut starten; die Audioaufnahme läuft unabhängig weiter.',
        );
        return;
      }
      timer = setTimeout(start, 500);
    };
    try {
      current.start();
    } catch {
      stop();
      onError('Live-Text konnte nicht gestartet werden. Die Audioaufnahme bleibt verfügbar.');
    }
  }
  start();
  return { stop };
}
