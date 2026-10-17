import { useEffect, useRef, useState, useId, type ReactNode } from 'react';
import { X, Pause, Play, Square, Mic, Download, BookmarkPlus } from 'lucide-react';
import { clock } from './analysis';
import { recorderType, MAX_AUDIO_BYTES, audioExtension } from './audio';
import { newMeeting, type Meeting } from './types';
import { saveRecording } from './db';
import { liveSupported, startLive } from './live-transcription';
import { download } from './backup';
export function Wave({ small = false }: { small?: boolean }) {
  return (
    <span className={`wave ${small ? 'small' : ''}`} aria-hidden="true">
      {[14, 27, 19, 34, 14].map((h, i) => (
        <i key={i} style={{ height: h }} />
      ))}
    </span>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    dialog.current?.showModal();
    const el = dialog.current;
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-inner">
        <header>
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" aria-label="Schliessen" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
export function Recorder({
  onComplete,
  onCancel,
  language = 'de-CH',
}: {
  language?: string;
  onComplete: (m: Meeting, reason?: string) => void;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState<'starting' | 'recording' | 'paused' | 'saving' | 'error'>(
    'starting',
  );
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [level, setLevel] = useState<number | null>(null);
  const [bars, setBars] = useState<number[]>(Array(35).fill(3));
  const [awake, setAwake] = useState(false);
  const [live, setLive] = useState(false);
  const [liveText, setLiveText] = useState('');
  const [liveCount, setLiveCount] = useState(0);
  const [liveError, setLiveError] = useState('');
  const [markers, setMarkers] = useState(0);
  const liveEngine = useRef<{ stop: () => void } | null>(null);
  const liveWanted = useRef(false);
  const liveStart = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const audioRef = useRef<Blob | null>(null);
  const stopped = useRef(false);
  const cancelled = useRef(false);
  const running = useRef(false);
  const reason = useRef('');
  const started = useRef(false);
  const active = useRef(0);
  const since = useRef(0);
  const meter = useRef<AudioContext | null>(null);
  const frame = useRef(0);
  const meeting = useRef(
    newMeeting(
      `Gespräch · ${new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date())}`,
    ),
  );
  const latest = useRef({ onComplete, onCancel });
  latest.current = { onComplete, onCancel };
  const elapsed = () =>
    active.current + (running.current ? (Date.now() - since.current) / 1000 : 0);
  function beginLive() {
    liveEngine.current?.stop();
    setLiveError('');
    liveWanted.current = true;
    setLive(true);
    liveStart.current = elapsed();
    try {
      liveEngine.current = startLive(
        language,
        (text) => {
          const end = elapsed();
          const segments = meeting.current.liveSegments || [];
          meeting.current = {
            ...meeting.current,
            liveSegments: [
              ...segments,
              {
                id: crypto.randomUUID(),
                text,
                speaker: '',
                start: Math.min(liveStart.current, end),
                end,
              },
            ],
          };
          liveStart.current = end;
          setLiveCount(meeting.current.liveSegments!.length);
          recorder.current?.requestData();
        },
        setLiveText,
        (message) => {
          setLiveError(message);
          setLive(false);
          liveWanted.current = false;
        },
      );
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : 'Live-Text nicht verfügbar.');
      setLive(false);
      liveWanted.current = false;
    }
  }
  function stopLive() {
    liveEngine.current?.stop();
    liveEngine.current = null;
    setLive(false);
  }
  function addMarker() {
    const bookmarks = meeting.current.bookmarks || [];
    meeting.current = {
      ...meeting.current,
      bookmarks: [
        ...bookmarks,
        { id: crypto.randomUUID(), start: elapsed(), label: `Markierung ${bookmarks.length + 1}` },
      ],
    };
    setMarkers(meeting.current.bookmarks!.length);
    recorder.current?.requestData();
  }
  function freeze() {
    active.current = elapsed();
    running.current = false;
  }
  function releaseMeter() {
    cancelAnimationFrame(frame.current);
    if (meter.current?.state !== 'closed') void meter.current?.close().catch(() => {});
  }
  function stop(message = '') {
    const rec = recorder.current;
    if (!rec || rec.state === 'inactive') return;
    reason.current = message;
    liveWanted.current = false;
    stopLive();
    freeze();
    stopped.current = true;
    setStatus('saving');
    rec.stop();
  }
  async function startMeter(input: MediaStream) {
    try {
      const context = new AudioContext();
      meter.current = context;
      const source = context.createMediaStreamSource(input);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const silentOutput = context.createGain();
      silentOutput.gain.value = 0;
      analyser.connect(silentOutput);
      silentOutput.connect(context.destination);
      await context.resume();
      if (context.state !== 'running') return;
      const samples = new Float32Array(analyser.fftSize);
      let last = 0;
      const sample = (now: number) => {
        if (context.state === 'closed') return;
        if (now - last > 100) {
          last = now;
          analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(
            samples.reduce((sum, value) => sum + value * value, 0) / samples.length,
          );
          setLevel(rms);
          setBars(
            Array.from({ length: 35 }, (_, i) => {
              const part = samples.subarray(i * 29, (i + 1) * 29);
              const power = Math.sqrt(
                part.reduce((sum, value) => sum + value * value, 0) / part.length,
              );
              return Math.max(3, Math.min(45, power * 220));
            }),
          );
        }
        frame.current = requestAnimationFrame(sample);
      };
      frame.current = requestAnimationFrame(sample);
    } catch {
      setLevel(null);
    }
  }
  useEffect(() => {
    let disposed = false;
    queueMicrotask(async () => {
      if (disposed || started.current) return;
      started.current = true;
      try {
        if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
          throw new Error(
            'Aufnahme wird in diesem Browser nicht unterstützt. Verwende Safari oder Chrome über HTTPS, oder importiere Audio.',
          );
        const input = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        if (disposed || cancelled.current) {
          input.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = input;
        const mimeType = recorderType();
        const rec = new MediaRecorder(input, {
          ...(mimeType ? { mimeType } : {}),
          audioBitsPerSecond: 96000,
        });
        recorder.current = rec;
        const chunks: Blob[] = [];
        let pending = Promise.resolve();
        rec.ondataavailable = (event) => {
          if (!event.data.size) return;
          chunks.push(event.data);
          const blob = new Blob(chunks, { type: rec.mimeType });
          audioRef.current = blob;
          const snapshot = {
            ...meeting.current,
            audio: blob,
            duration: elapsed(),
            updatedAt: Date.now(),
          };
          pending = pending
            .then(async () => {
              meeting.current = {
                ...(await saveRecording(snapshot)),
                liveSegments: meeting.current.liveSegments,
                bookmarks: meeting.current.bookmarks,
              };
            })
            .catch(() => {
              setError(
                'Zwischenspeichern fehlgeschlagen. Die Aufnahme wird gestoppt; bei Bedarf kannst du das Audio direkt herunterladen.',
              );
              stop('Aufnahme wegen eines Speicherfehlers gestoppt.');
            });
          if (blob.size >= MAX_AUDIO_BYTES)
            stop('Dateigrössenlimit erreicht. Die Aufnahme wurde gespeichert.');
        };
        rec.onstop = async () => {
          // A browser/device interruption can stop MediaRecorder without calling our stop().
          if (running.current) {
            freeze();
            reason.current ||= 'Aufnahme unterbrochen. Vorhandenes Audio wurde gespeichert.';
          }
          stopped.current = true;
          setStatus('saving');
          input.getTracks().forEach((t) => t.stop());
          releaseMeter();
          liveWanted.current = false;
          stopLive();
          await pending;
          if (!audioRef.current?.size) {
            setError('Es wurde kein Audio aufgenommen. Bitte prüfe die Mikrofonfreigabe.');
            setStatus('error');
            return;
          }
          try {
            const complete = await saveRecording({
              ...meeting.current,
              audio: audioRef.current,
              duration: active.current,
              updatedAt: Date.now(),
            });
            latest.current.onComplete(complete, reason.current);
          } catch {
            setError(
              'Der Gerätespeicher ist voll oder gesperrt. Deine Aufnahme ist noch hier. Lade sie jetzt herunter.',
            );
            setStatus('error');
          }
        };
        rec.onerror = () =>
          stop('Die Aufnahme wurde vom Browser unterbrochen. Vorhandenes Audio wurde gespeichert.');
        input.getAudioTracks().forEach((track) =>
          track.addEventListener('ended', () => {
            if (!stopped.current)
              stop('Das Mikrofon wurde getrennt. Vorhandenes Audio wurde gespeichert.');
          }),
        );
        since.current = Date.now();
        running.current = true;
        rec.start(4000);
        setStatus('recording');
        void startMeter(input);
      } catch (e) {
        stream.current?.getTracks().forEach((t) => t.stop());
        releaseMeter();
        setError(
          (e as DOMException).name === 'NotAllowedError'
            ? 'Kein Mikrofonzugriff. Erlaube das Mikrofon in den Website-Einstellungen und versuche es erneut.'
            : e instanceof Error
              ? e.message
              : 'Aufnahme konnte nicht gestartet werden.',
        );
        setStatus('error');
      }
    });
    return () => {
      disposed = true;
      liveWanted.current = false;
      liveEngine.current?.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      releaseMeter();
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      const time = elapsed();
      setSeconds(time);
      if (time >= 3600 && running.current)
        stop('60-Minuten-Limit erreicht. Die Aufnahme wurde gespeichert.');
    }, 250);
    const warn = (event: BeforeUnloadEvent) => {
      if (
        (!stopped.current && recorder.current) ||
        status === 'saving' ||
        (status === 'error' && audioRef.current)
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden' && running.current) {
        setError(
          'Die App ist im Hintergrund. Mobile Browser können die Aufnahme unterbrechen. Prüfe sie nach deiner Rückkehr.',
        );
        liveEngine.current?.stop();
        if (liveWanted.current) {
          setLive(false);
          setLiveError('Live-Text nach Rückkehr erneut starten.');
          liveWanted.current = false;
        }
      }
    };
    document.addEventListener('visibilitychange', visibility);
    addEventListener('beforeunload', warn);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      clearInterval(timer);
      removeEventListener('beforeunload', warn);
    };
  }, [status]);
  useEffect(() => {
    if (status !== 'recording') {
      setAwake(false);
      return;
    }
    let disposed = false;
    let lock: WakeLockSentinel | undefined;
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || disposed || (lock && !lock.released)) return;
      try {
        const requested = await navigator.wakeLock?.request('screen');
        if (disposed) {
          await requested?.release();
          return;
        }
        lock = requested;
        setAwake(!!lock);
        lock?.addEventListener('release', () => setAwake(false));
      } catch {
        setAwake(false);
      }
    };
    void acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release().catch(() => {});
    };
  }, [status]);
  function pause() {
    const rec = recorder.current;
    if (!rec) return;
    if (rec.state === 'recording') {
      freeze();
      stopLive();
      rec.pause();
      setStatus('paused');
    } else if (rec.state === 'paused') {
      since.current = Date.now();
      running.current = true;
      rec.resume();
      if (liveWanted.current) beginLive();
      setStatus('recording');
    }
  }
  const close = () => {
    if (status === 'saving') return;
    if (status === 'recording' || status === 'paused') {
      if (confirm('Aufnahme beenden und speichern?')) stop();
    } else if (status === 'starting') {
      cancelled.current = true;
      latest.current.onCancel();
    } else if (
      !audioRef.current ||
      confirm(
        'Hast du die Aufnahme heruntergeladen? Beim Schliessen geht das noch nicht gespeicherte Audio verloren.',
      )
    )
      latest.current.onCancel();
  };
  return (
    <Modal title="Neue Aufnahme" onClose={close}>
      <div className="recording-view">
        <span className={`recording-orb ${status === 'recording' ? 'pulsing' : ''}`}>
          <Mic size={34} />
        </span>
        <div className="recording-clock">{clock(seconds)}</div>
        <p role="status">
          {status === 'recording'
            ? 'Aufnahme läuft'
            : status === 'paused'
              ? 'Aufnahme pausiert'
              : status === 'starting'
                ? 'Mikrofon wird angefragt …'
                : status === 'saving'
                  ? 'Wird sicher gespeichert …'
                  : 'Aufnahme nicht verfügbar'}
        </p>
        <div
          className="live-wave measured"
          role="meter"
          aria-label="Mikrofonpegel"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={
            status === 'recording' && level !== null ? Math.min(100, Math.round(level * 300)) : 0
          }
          aria-valuetext={
            level === null
              ? 'Pegelmessung nicht verfügbar'
              : status === 'paused'
                ? 'Pausiert'
                : level < 0.002
                  ? 'Sehr leises Signal'
                  : 'Signal empfangen'
          }
        >
          {bars.map((height, i) => (
            <i key={i} style={{ height: status === 'recording' ? height : 3, animation: 'none' }} />
          ))}
        </div>
        <p className="meter-caption">
          {status === 'recording'
            ? level === null
              ? 'Pegelmessung nicht verfügbar'
              : level < 0.002
                ? 'Sehr leises Signal · bitte Mikrofon prüfen'
                : 'Mikrofonsignal empfangen'
            : status === 'paused'
              ? 'Mikrofonaufnahme pausiert'
              : 'Gemessener Mikrofonpegel'}
        </p>
        <p className="muted small-text">
          Bitte hole das Einverständnis aller Beteiligten ein.{' '}
          {awake
            ? 'Der Bildschirm wird während der Aufnahme wach gehalten.'
            : 'Lass den Bildschirm eingeschaltet.'}{' '}
          Lass die App im Vordergrund; mobile Browser können Hintergrundaufnahmen unterbrechen.
        </p>
        {(status === 'recording' || status === 'paused') && (
          <section className="live-controls">
            <div className="button-row">
              <button
                className="secondary"
                disabled={status !== 'recording' || !liveSupported()}
                onClick={() => {
                  if (live) {
                    liveWanted.current = false;
                    stopLive();
                  } else beginLive();
                }}
              >
                {live ? 'Live-Text stoppen' : 'Live-Text starten'}
              </button>
              <button className="secondary" disabled={status !== 'recording'} onClick={addMarker}>
                <BookmarkPlus size={17} />
                Stelle markieren{markers ? ` (${markers})` : ''}
              </button>
            </div>
            <p className="small-text muted">
              {liveSupported()
                ? 'Optionaler Browser-Sprachdienst: Audio kann an Apple oder Google gehen. Live-Text ist vorläufig; Zeitmarken sind ungefähr.'
                : 'Live-Text ist in diesem Browser nicht verfügbar. Du kannst aufnehmen und danach transkribieren.'}
            </p>
            {liveCount > 0 && (
              <div className="live-draft" aria-label="Vorläufige Live-Mitschrift">
                {meeting.current.liveSegments?.slice(-4).map((segment) => (
                  <p key={segment.id}>{segment.text}</p>
                ))}
              </div>
            )}
            {liveText && <p className="live-interim">{liveText}</p>}
            {liveError && (
              <p className="small-text" role="status">
                {liveError}
              </p>
            )}
          </section>
        )}
        {error && (
          <p role="alert" className="error-box">
            {error}
          </p>
        )}
        {(status === 'recording' || status === 'paused') && (
          <div className="button-row">
            <button className="secondary" onClick={pause}>
              {status === 'paused' ? <Play size={18} /> : <Pause size={18} />}
              {status === 'paused' ? 'Fortsetzen' : 'Pause'}
            </button>
            <button className="primary" onClick={() => stop()}>
              <Square size={16} fill="currentColor" />
              Speichern
            </button>
          </div>
        )}
        {status === 'error' && (
          <div className="button-row">
            {audioRef.current && (
              <button
                className="primary"
                onClick={() =>
                  download(audioRef.current!, `Aufnahme.${audioExtension(audioRef.current!.type)}`)
                }
              >
                <Download size={18} />
                Audio retten
              </button>
            )}
            <button className="secondary" onClick={close}>
              Schliessen
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
