import { useEffect, useRef, useState, useId, type ReactNode } from 'react';
import { X, Pause, Play, Square, Mic, Download } from 'lucide-react';
import { clock } from './analysis';
import { recorderType, MAX_AUDIO_BYTES } from './audio';
import { newMeeting, type Meeting } from './types';
import { saveMeeting } from './db';
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
}: {
  onComplete: (m: Meeting) => void;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState<'starting' | 'recording' | 'paused' | 'saving' | 'error'>(
    'starting',
  );
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const audioRef = useRef<Blob | null>(null);
  const stopped = useRef(false);
  const cancelled = useRef(false);
  const meeting = useRef(
    newMeeting(
      `Gespräch · ${new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date())}`,
    ),
  );
  const active = useRef(0);
  const since = useRef(Date.now());
  const started = useRef(false);
  const latest = useRef({ onComplete, onCancel });
  latest.current = { onComplete, onCancel };
  const elapsed = () =>
    active.current +
    (recorder.current?.state === 'recording' ? (Date.now() - since.current) / 1000 : 0);
  useEffect(() => {
    let disposed = false;
    // Delay one microtask so React StrictMode's test mount never requests a second microphone.
    queueMicrotask(async () => {
      if (disposed || started.current) return;
      started.current = true;
      try {
        if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
          throw new Error(
            'Aufnahme wird in diesem Browser nicht unterstützt. Öffne die App über HTTPS in Safari oder Chrome, oder importiere Audio.',
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
            duration: Math.max(active.current, elapsed()),
            updatedAt: Date.now(),
          };
          meeting.current = snapshot;
          pending = pending
            .then(async () => {
              await saveMeeting(snapshot);
            })
            .catch(() => {
              setError(
                'Zwischenspeichern fehlgeschlagen. Stoppe die Aufnahme und lade sie direkt herunter.',
              );
            });
          if (blob.size >= MAX_AUDIO_BYTES && rec.state !== 'inactive') stop();
        };
        rec.onstop = async () => {
          input.getTracks().forEach((t) => t.stop());
          await pending;
          if (!audioRef.current?.size) {
            setError('Es wurde kein Audio aufgenommen. Bitte prüfe die Mikrofonfreigabe.');
            setStatus('error');
            return;
          }
          const complete = {
            ...meeting.current,
            audio: audioRef.current,
            duration: active.current,
            updatedAt: Date.now(),
          };
          try {
            await saveMeeting(complete);
            latest.current.onComplete(complete);
          } catch {
            setError(
              'Der Gerätespeicher ist voll oder gesperrt. Deine Aufnahme ist noch hier. Lade sie jetzt herunter.',
            );
            setStatus('error');
          }
        };
        rec.onerror = () => {
          setError(
            'Die Aufnahme wurde vom Browser unterbrochen. Vorhandenes Audio wird gesichert.',
          );
          if (rec.state !== 'inactive') stop();
        };
        since.current = Date.now();
        rec.start(4000);
        setStatus('recording');
      } catch (e) {
        const name = (e as DOMException).name;
        setError(
          name === 'NotAllowedError'
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
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      const time = elapsed();
      setSeconds(time);
      if (time >= 3600 && recorder.current?.state === 'recording') stop();
    }, 250);
    const warn = (e: BeforeUnloadEvent) => {
      if (!stopped.current && recorder.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      clearInterval(timer);
      window.removeEventListener('beforeunload', warn);
    };
  }, []);
  function stop() {
    const rec = recorder.current;
    if (!rec || rec.state === 'inactive') return;
    active.current = elapsed();
    stopped.current = true;
    setStatus('saving');
    rec.stop();
  }
  function pause() {
    const rec = recorder.current;
    if (!rec) return;
    if (rec.state === 'recording') {
      active.current = elapsed();
      rec.pause();
      setStatus('paused');
    } else if (rec.state === 'paused') {
      since.current = Date.now();
      rec.resume();
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
    } else latest.current.onCancel();
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
        <div className="live-wave" aria-hidden="true">
          {Array.from({ length: 35 }, (_, i) => (
            <i
              key={i}
              style={{
                height: `${10 + Math.sin(i * 3.1) ** 2 * 34}px`,
                animationDelay: `${i * 0.07}s`,
                animationPlayState: status === 'recording' ? 'running' : 'paused',
              }}
            />
          ))}
        </div>
        <p className="muted small-text">
          Bitte hole vor der Aufnahme das Einverständnis aller Beteiligten ein. Lass die App
          geöffnet und den Bildschirm an. Die Wellen zeigen den Aufnahmestatus, keinen gemessenen
          Pegel.
        </p>
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
            <button className="primary" onClick={stop}>
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
                  download(
                    audioRef.current!,
                    `Aufnahme.${audioRef.current!.type.includes('mp4') ? 'm4a' : 'webm'}`,
                  )
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
