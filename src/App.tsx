import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Mic,
  Search,
  Plus,
  ArrowUpRight,
  ArrowLeft,
  Upload,
  Home,
  AudioLines,
  Star,
  Folder,
  Settings as SettingsIcon,
  ShieldCheck,
  ChevronRight,
  MoreHorizontal,
  Download,
  Trash2,
  Pencil,
  Check,
  X,
  FileText,
  ListTodo,
  MessageSquare,
  Pause,
  Square,
  Globe,
  HardDrive,
  Smartphone,
  CircleCheck,
  LoaderCircle,
  RotateCcw,
  Headphones,
  ArrowDownToLine,
  FolderPlus,
  Clock3,
  LockKeyhole,
  WifiOff,
  Copy,
} from 'lucide-react';
import {
  allMeetings,
  saveMeeting,
  removeMeeting,
  getSettings,
  saveSettings,
  restoreMeetings,
  requestPersistence,
} from './db';
import { newMeeting, defaultSettings, type Meeting, type Settings, type Segment } from './types';
import {
  clock,
  dateLabel,
  transcript,
  summary,
  proposedTasks,
  findEvidence,
  toMarkdown,
  toSrt,
} from './analysis';
import { backup, readBackup, download, safeName } from './backup';
import { decodeAudio, MAX_AUDIO_BYTES } from './audio';
import { Modal, Recorder, Wave } from './components';
type Page = 'home' | 'all' | 'starred' | 'folders' | 'tasks' | 'trash' | 'settings';
type Tab = 'transcript' | 'summary' | 'tasks' | 'notes' | 'ask';
type Edit = {
  title: string;
  fields: { key: string; label: string; value: string; multiline?: boolean; max?: number }[];
  save: (values: Record<string, string>) => Promise<void>;
};
const pageNames: Record<Page, string> = {
  home: 'Übersicht',
  all: 'Gespräche',
  starred: 'Favoriten',
  folders: 'Ordner',
  tasks: 'Aufgaben',
  trash: 'Papierkorb',
  settings: 'Einstellungen',
};
const icons: Record<Page, typeof Home> = {
  home: Home,
  all: AudioLines,
  starred: Star,
  folders: Folder,
  tasks: ListTodo,
  trash: Trash2,
  settings: SettingsIcon,
};
const sizeLabel = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export default function App() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const current = useRef<Meeting[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [loaded, setLoaded] = useState(false);
  const [fatal, setFatal] = useState('');
  const [page, setPage] = useState<Page>('home');
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('transcript');
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState(() => localStorage.getItem('murmur-folder') || '');
  const [order, setOrder] = useState(() => localStorage.getItem('murmur-order') || 'newest');
  const [toast, setToast] = useState('');
  const [recording, setRecording] = useState(false);
  const [importing, setImporting] = useState(false);
  const [consentFor, setConsentFor] = useState<string | null>(null);
  const [exportFor, setExportFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<Edit | null>(null);
  const [install, setInstall] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const [processMessage, setProcessMessage] = useState('');
  const [processError, setProcessError] = useState('');
  const [transcriptionConflict, setTranscriptionConflict] = useState<{
    id: string;
    segments: Segment[];
    duration: number;
  } | null>(null);
  const [working, setWorking] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [updateReady, setUpdateReady] = useState(false);
  const [storage, setStorage] = useState<{ usage?: number; quota?: number }>({});
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<Segment[] | null>(null);
  const worker = useRef<Worker | null>(null);
  const transcriptionJob = useRef(0);
  const audio = useRef<HTMLAudioElement>(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [playhead, setPlayhead] = useState(0);
  const restoreFile = useRef<HTMLInputElement>(null);
  const uploadFile = useRef<HTMLInputElement>(null);
  const queue = useRef(Promise.resolve());
  const savePending = useRef(0);
  const alive = useRef(true);
  function publish(list: Meeting[]) {
    current.current = list;
    setMeetings(list);
  }
  function notify(message: string) {
    setToast(message);
  }
  useEffect(() => {
    alive.current = true;
    Promise.all([allMeetings(), getSettings()])
      .then(([list, s]) => {
        if (alive.current) {
          publish(list);
          setSettings(s);
          setLoaded(true);
        }
      })
      .catch(() =>
        setFatal(
          'Der private Gerätespeicher ist nicht verfügbar. Öffne die App in einem normalen Browserfenster und erlaube Website-Daten.',
        ),
      );
    const connectivity = () => setOnline(navigator.onLine);
    const update = () => setUpdateReady(true);
    window.addEventListener('online', connectivity);
    window.addEventListener('offline', connectivity);
    window.addEventListener('murmur-update', update);
    return () => {
      alive.current = false;
      window.removeEventListener('online', connectivity);
      window.removeEventListener('offline', connectivity);
      window.removeEventListener('murmur-update', update);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    localStorage.setItem('murmur-folder', folder);
  }, [folder]);
  useEffect(() => {
    localStorage.setItem('murmur-order', order);
  }, [order]);
  useEffect(() => {
    navigator.storage
      ?.estimate()
      .then(setStorage)
      .catch(() => {});
  }, [meetings, page]);
  const meeting = meetings.find((m) => m.id === selected);
  useEffect(() => {
    if (!meeting?.audio) {
      setAudioUrl('');
      return;
    }
    const url = URL.createObjectURL(meeting.audio);
    setAudioUrl(url);
    setPlayhead(0);
    return () => URL.revokeObjectURL(url);
  }, [meeting?.id, meeting?.audio]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (processing || working || savePending.current > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [processing, working]);
  async function mutate(id: string, fn: (m: Meeting) => Meeting) {
    const old = current.current.find((m) => m.id === id);
    if (!old) return;
    const next = { ...fn(old), updatedAt: Date.now() };
    publish(current.current.map((m) => (m.id === id ? next : m)));
    savePending.current++;
    const operation = queue.current.then(async () => {
      await saveMeeting(next);
    });
    queue.current = operation.catch(() => {});
    try {
      await operation;
    } catch {
      if (current.current.find((m) => m.id === id) === next)
        publish(current.current.map((m) => (m.id === id ? old : m)));
      notify('Speichern fehlgeschlagen. Prüfe den freien Gerätespeicher.');
      throw new Error('Nicht gespeichert');
    } finally {
      savePending.current--;
    }
  }
  async function changeSettings(next: Settings) {
    try {
      await saveSettings(next);
      setSettings(next);
    } catch {
      notify('Einstellungen konnten nicht gespeichert werden.');
    }
  }
  async function add(m: Meeting) {
    await saveMeeting(m);
    publish([m, ...current.current]);
    await requestPersistence();
  }
  function navigate(next: Page) {
    setPage(next);
    setSelected(null);
    setQuery('');
    setProcessError('');
  }
  function open(m: Meeting) {
    setSelected(m.id);
    setTab('transcript');
    setQuestion('');
    setAnswer(null);
    setPlayhead(0);
    setProcessError('');
    window.scrollTo({ top: 0 });
  }
  async function addText() {
    const m = newMeeting('Neue Gesprächsnotiz');
    try {
      await add(m);
      setImporting(false);
      open(m);
      editTranscript(m);
    } catch {
      notify('Die Notiz konnte nicht gespeichert werden.');
    }
  }
  function editTitle(m: Meeting) {
    setEditing({
      title: 'Gespräch umbenennen',
      fields: [{ key: 'title', label: 'Titel', value: m.title, max: 300 }],
      save: async (values) => {
        if (!values.title.trim()) throw new Error('Bitte gib einen Titel ein.');
        await mutate(m.id, (old) => ({ ...old, title: values.title.trim() }));
        notify('Titel gespeichert');
      },
    });
  }
  function editTranscript(m: Meeting, segment?: Segment) {
    setEditing({
      title: segment ? 'Textstelle bearbeiten' : 'Transkript ergänzen',
      fields: [
        { key: 'text', label: 'Gesprochener Text', value: segment?.text || '', multiline: true },
        {
          key: 'speaker',
          label: 'Sprecher oder Sprecherin (optional)',
          value: segment?.speaker || '',
          max: 100,
        },
        {
          key: 'start',
          label: 'Startzeit in Sekunden',
          value: String(segment?.start || 0),
          max: 10,
        },
      ],
      save: async (values) => {
        const start = Number(values.start);
        if (!values.text.trim()) throw new Error('Bitte gib einen Text ein.');
        if (!Number.isFinite(start) || start < 0 || start > Math.max(m.duration, 3600))
          throw new Error('Bitte gib eine gültige Startzeit ein.');
        await mutate(m.id, (old) => ({
          ...old,
          revision: old.revision + 1,
          segments: (segment
            ? old.segments.map((s) =>
                s.id === segment.id
                  ? {
                      ...s,
                      text: values.text.trim(),
                      speaker: values.speaker.trim(),
                      start,
                      end: Math.max(start, s.end),
                    }
                  : s,
              )
            : [
                ...old.segments,
                {
                  id: crypto.randomUUID(),
                  start,
                  end: Math.max(start, old.duration),
                  text: values.text.trim(),
                  speaker: values.speaker.trim(),
                },
              ]
          ).sort((a, b) => a.start - b.start),
        }));
        setAnswer(null);
        notify('Transkript gespeichert');
      },
    });
  }
  function editNote(m: Meeting) {
    setEditing({
      title: 'Eigene Notizen',
      fields: [{ key: 'notes', label: 'Notizen', value: m.notes, multiline: true }],
      save: async (v) => {
        await mutate(m.id, (old) => ({ ...old, notes: v.notes }));
        notify('Notizen gespeichert');
      },
    });
  }
  function addTask(m: Meeting) {
    setEditing({
      title: 'Aufgabe hinzufügen',
      fields: [{ key: 'text', label: 'Was ist zu tun?', value: '', max: 10000 }],
      save: async (v) => {
        if (!v.text.trim()) throw new Error('Bitte beschreibe die Aufgabe.');
        await mutate(m.id, (old) => ({
          ...old,
          tasks: [...old.tasks, { id: crypto.randomUUID(), text: v.text.trim(), done: false }],
        }));
        notify('Aufgabe gespeichert');
      },
    });
  }
  function addFolder() {
    setEditing({
      title: 'Neuer Ordner',
      fields: [{ key: 'name', label: 'Ordnername', value: '', max: 100 }],
      save: async (v) => {
        const name = v.name.trim();
        if (!name || settings.folders.includes(name))
          throw new Error('Bitte wähle einen neuen, eindeutigen Namen.');
        const next = { ...settings, folders: [...settings.folders, name] };
        await saveSettings(next);
        setSettings(next);
        notify('Ordner angelegt');
      },
    });
  }
  async function importAudio(file: File) {
    setImporting(false);
    setWorking(true);
    try {
      if (!file.size) throw new Error('Die Datei ist leer.');
      if (file.size > MAX_AUDIO_BYTES)
        throw new Error('Bitte wähle eine Audiodatei mit höchstens 50 MB.');
      if (
        !file.type.startsWith('audio/') &&
        !/\.(mp3|m4a|mp4|wav|ogg|webm|aac|flac)$/i.test(file.name)
      )
        throw new Error('Bitte wähle eine unterstützte Audiodatei.');
      const decoded = await decodeAudio(file);
      const m = {
        ...newMeeting(file.name.replace(/\.[^.]+$/, '').slice(0, 300)),
        audio: new Blob([file], { type: file.type || 'audio/mp4' }),
        duration: decoded.duration,
      };
      await add(m);
      open(m);
      notify('Audio sicher importiert');
    } catch (error) {
      notify(
        error instanceof Error && error.name !== 'EncodingError'
          ? error.message
          : 'Dieses Audioformat konnte nicht gelesen werden. Bitte versuche MP3, M4A oder WAV.',
      );
    } finally {
      setWorking(false);
      if (uploadFile.current) uploadFile.current.value = '';
    }
  }
  async function startTranscription(id: string, consent = settings.consent) {
    const m = current.current.find((m) => m.id === id);
    if (!m?.audio) return;
    if (processing) {
      notify('Es wird bereits ein Gespräch verarbeitet.');
      return;
    }
    if (!consent) {
      setConsentFor(id);
      return;
    }
    if (
      m.segments.length &&
      !confirm(
        'Eine neue Transkription ersetzt das vorhandene Transkript. Deine Notizen und Aufgaben bleiben erhalten. Fortfahren?',
      )
    )
      return;
    const revision = m.revision;
    const job = ++transcriptionJob.current;
    setProcessing(id);
    setProcessError('');
    setProcessMessage('Audio vorbereiten …');
    try {
      const { samples, duration } = await decodeAudio(m.audio);
      if (!alive.current || job !== transcriptionJob.current) return;
      worker.current?.terminate();
      const w = new Worker(new URL('./transcription.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.current = w;
      w.onerror = () => {
        if (job !== transcriptionJob.current) return;
        setProcessError(
          'Die Spracherkennung konnte nicht gestartet werden. Aktualisiere den Browser oder versuche eine kürzere Aufnahme.',
        );
        setProcessing(null);
        w.terminate();
      };
      w.onmessage = async (event) => {
        if (job !== transcriptionJob.current) return;
        const message = event.data;
        if (message.type === 'status') setProcessMessage(message.text);
        if (message.type === 'error') {
          const text = String(message.message);
          setProcessError(
            /fetch|network|403|404|download/i.test(text)
              ? 'Das Sprachmodell konnte nicht geladen werden. Prüfe die Internetverbindung und den Zugriff auf huggingface.co. Bereits gespeicherte Aufnahmen bleiben erhalten.'
              : `Transkription nicht möglich: ${text.slice(0, 220)}. Versuche eine kürzere Aufnahme oder einen neueren Browser.`,
          );
          setProcessing(null);
          w.terminate();
        }
        if (message.type === 'result') {
          try {
            const chunks = message.result.chunks?.length
              ? message.result.chunks
              : [{ text: message.result.text, timestamp: [0, duration] }];
            const segments: Segment[] = chunks
              .filter((s: any) => s.text?.trim())
              .map((s: any) => ({
                id: crypto.randomUUID(),
                text: s.text.trim(),
                speaker: '',
                start: Math.min(duration, Math.max(0, s.timestamp?.[0] || 0)),
                end: Math.max(
                  Math.min(duration, Math.max(0, s.timestamp?.[0] || 0)),
                  Math.min(duration, s.timestamp?.[1] ?? duration),
                ),
              }));
            if (!segments.length)
              throw new Error(
                'Keine Sprache erkannt. Prüfe die Aufnahme und die eingestellte Sprache.',
              );
            const latest = current.current.find((item) => item.id === id);
            if (!latest) return;
            if (latest.revision !== revision) {
              setTranscriptionConflict({ id, segments, duration });
            } else {
              await mutate(id, (old) => ({
                ...old,
                duration,
                segments,
                revision: old.revision + 1,
              }));
              notify('Transkript gespeichert · bitte auf Fehler prüfen');
            }
          } catch (e) {
            setProcessError(
              e instanceof Error ? e.message : 'Transkript konnte nicht gespeichert werden.',
            );
          } finally {
            setProcessing(null);
            w.terminate();
          }
        }
      };
      w.postMessage(
        {
          samples,
          language: settings.language,
          assets: {
            mjs: new URL(
              `${import.meta.env.BASE_URL}ort/ort-wasm-simd-threaded.mjs`,
              location.origin,
            ).href,
            wasm: new URL(
              `${import.meta.env.BASE_URL}ort/ort-wasm-simd-threaded.wasm`,
              location.origin,
            ).href,
          },
        },
        [samples.buffer],
      );
    } catch (e) {
      setProcessError(e instanceof Error ? e.message : 'Audio konnte nicht verarbeitet werden.');
      setProcessing(null);
    }
  }
  function cancelTranscription() {
    transcriptionJob.current++;
    worker.current?.terminate();
    worker.current = null;
    setProcessing(null);
    notify('Transkription abgebrochen. Die Aufnahme bleibt gespeichert.');
  }
  async function doBackup() {
    if (working) return;
    setWorking(true);
    try {
      const blob = await backup(current.current, settings);
      download(blob, `Murmur-Sicherung-${new Date().toISOString().slice(0, 10)}.zip`);
      notify('Vollständige Sicherung zum Download bereit');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Sicherung fehlgeschlagen.');
    } finally {
      setWorking(false);
    }
  }
  async function restore(file: File) {
    setWorking(true);
    try {
      const { meetings: records, preferences } = await readBackup(file);
      if (
        !confirm(
          `${records.length} Gespräche aus der Sicherung ergänzen? Bestehende Einträge bleiben unverändert.`,
        )
      )
        return;
      const result = await restoreMeetings(records, preferences);
      publish(await allMeetings());
      setSettings(await getSettings());
      notify(`${result.added} wiederhergestellt · ${result.skipped} bereits vorhanden`);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Die Sicherung konnte nicht gelesen werden.');
    } finally {
      setWorking(false);
      if (restoreFile.current) restoreFile.current.value = '';
    }
  }
  function seek(start: number) {
    if (audio.current) {
      audio.current.currentTime = start;
      void audio.current
        .play()
        .catch(() => notify('Tippe auf Wiedergabe, um das Audio zu starten.'));
    }
  }
  async function trash(m: Meeting) {
    if (processing === m.id) {
      notify('Bitte beende zuerst die laufende Transkription.');
      return;
    }
    if (!confirm(`„${m.title}“ in den Papierkorb verschieben?`)) return;
    try {
      await mutate(m.id, (old) => ({ ...old, deletedAt: Date.now() }));
      setSelected(null);
      notify('Im Papierkorb · jederzeit wiederherstellbar');
    } catch {}
  }
  const activeMeetings = meetings.filter((m) => !m.deletedAt);
  const pendingTasks = activeMeetings.reduce(
    (n, m) => n + m.tasks.filter((t) => !t.done).length,
    0,
  );
  const list = meetings
    .filter((m) => (page === 'trash' ? !!m.deletedAt : !m.deletedAt))
    .filter((m) => page !== 'starred' || m.starred)
    .filter((m) => page !== 'folders' || !folder || m.folder === folder)
    .filter(
      (m) =>
        !query ||
        `${m.title} ${transcript(m)} ${m.notes} ${m.folder} ${m.tasks.map((t) => t.text).join(' ')}`
          .toLocaleLowerCase('de')
          .includes(query.toLocaleLowerCase('de')),
    )
    .sort((a, b) =>
      order === 'oldest'
        ? a.createdAt - b.createdAt
        : order === 'title'
          ? a.title.localeCompare(b.title, 'de')
          : b.createdAt - a.createdAt,
    );
  const filteredList = page === 'home' && !query ? list.slice(0, 5) : list;
  const evidence = meeting ? summary(meeting.segments) : [];
  function navButton(p: Page) {
    const Icon = icons[p];
    return (
      <button
        key={p}
        className={`nav-link ${page === p && !selected ? 'active' : ''}`}
        onClick={() => navigate(p)}
        aria-current={page === p && !selected ? 'page' : undefined}
      >
        <Icon size={19} />
        <span>{pageNames[p]}</span>
        {p === 'tasks' && pendingTasks > 0 && <b>{pendingTasks}</b>}
      </button>
    );
  }
  function taskList(m: Meeting) {
    return m.tasks.map((t) => (
      <div className={`task-row ${t.done ? 'done' : ''}`} key={t.id}>
        <label>
          <input
            type="checkbox"
            checked={t.done}
            onChange={() => {
              void mutate(m.id, (old) => ({
                ...old,
                tasks: old.tasks.map((item) =>
                  item.id === t.id ? { ...item, done: !item.done } : item,
                ),
              })).catch(() => {});
            }}
          />
          <span>{t.text}</span>
        </label>
        <button
          className="icon-button"
          aria-label={`Aufgabe löschen: ${t.text}`}
          onClick={() => {
            if (confirm('Diese Aufgabe löschen?'))
              void mutate(m.id, (old) => ({
                ...old,
                tasks: old.tasks.filter((item) => item.id !== t.id),
              })).catch(() => {});
          }}
        >
          <X size={16} />
        </button>
      </div>
    ));
  }
  function card(m: Meeting) {
    return (
      <article key={m.id} className="meeting-card">
        <button className="meeting-main" onClick={() => open(m)}>
          <span className="meeting-icon">
            {m.audio ? <AudioLines size={23} /> : <FileText size={23} />}
          </span>
          <span className="meeting-card-text">
            <strong>{m.title}</strong>
            <span className="card-meta">
              {dateLabel(m.createdAt)}
              <i>·</i>
              {m.duration ? clock(m.duration) : 'Textnotiz'}
              {m.folder && (
                <>
                  <i>·</i>
                  {m.folder}
                </>
              )}
            </span>
            <span className="card-preview">
              {transcript(m).slice(0, 140) ||
                (m.audio
                  ? 'Audio gespeichert · Transkript bereit zum Erstellen'
                  : m.notes || 'Noch kein Transkript')}
            </span>
          </span>
        </button>
        <div className="card-tail">
          <span className={`status-pill ${m.segments.length ? 'complete' : ''}`}>
            {m.segments.length ? 'Transkribiert' : m.audio ? 'Audio' : 'Notiz'}
          </span>
          <button
            className={`icon-button star-button ${m.starred ? 'is-starred' : ''}`}
            aria-label={m.starred ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
            aria-pressed={m.starred}
            onClick={() => {
              void mutate(m.id, (old) => ({ ...old, starred: !old.starred })).catch(() => {});
            }}
          >
            <Star size={18} fill={m.starred ? 'currentColor' : 'none'} />
          </button>
          <ChevronRight size={17} className="card-chevron" />
        </div>
      </article>
    );
  }
  if (fatal)
    return (
      <main className="fatal">
        <Wave />
        <h1>Dein Speicher braucht Aufmerksamkeit</h1>
        <p>{fatal}</p>
        <button className="primary" onClick={() => location.reload()}>
          Erneut versuchen
        </button>
      </main>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href={import.meta.env.BASE_URL}
          onClick={(e) => {
            e.preventDefault();
            navigate('home');
          }}
        >
          <Wave small />
          <span>
            murmur<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="sidebar-caption">DEIN GESPRÄCHSNOTIZBUCH</div>
        <nav aria-label="Hauptnavigation">
          {(['home', 'all', 'starred', 'tasks'] as Page[]).map(navButton)}
          <div className="nav-divider" />
          {navButton('folders')}
          {settings.folders.map((name) => (
            <button
              key={name}
              className={`folder-link ${page === 'folders' && folder === name ? 'chosen' : ''}`}
              onClick={() => {
                navigate('folders');
                setFolder(name);
              }}
            >
              <span className="folder-dot" />
              {name}
            </button>
          ))}
          <button className="folder-link add-folder" onClick={addFolder}>
            <Plus size={14} /> Neuer Ordner
          </button>
        </nav>
        <div className="sidebar-bottom">
          {navButton('trash')}
          {navButton('settings')}
          <div className="private-badge">
            <ShieldCheck size={20} />
            <div>
              <strong>Nur auf deinem Gerät</strong>
              <span>Privat. Ohne Konto.</span>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Murmur</span>
            <ChevronRight size={13} />
            <strong>{meeting ? 'Gespräch' : pageNames[page]}</strong>
          </div>
          <div className="topbar-right">
            {!online && (
              <span className="offline-tag">
                <WifiOff size={14} />
                Offline
              </span>
            )}
            <span className="privacy-label">
              <LockKeyhole size={13} />
              Privater Bereich
            </span>
            <button
              className="profile-button"
              aria-label="Einstellungen öffnen"
              onClick={() => navigate('settings')}
            >
              M<span />
            </button>
          </div>
        </header>
        <main className={`main-content ${meeting ? 'detail-content' : ''}`}>
          {!loaded ? (
            <div className="loading">
              <LoaderCircle className="spin" />
              Deine Gespräche werden geladen …
            </div>
          ) : meeting ? (
            <>
              <button className="text-button back" onClick={() => setSelected(null)}>
                <ArrowLeft size={17} />
                Alle Gespräche
              </button>
              <div className="detail-heading">
                <div>
                  <div className="eyebrow">
                    {dateLabel(meeting.createdAt)} · {clock(meeting.duration)}
                  </div>
                  <h1>{meeting.title}</h1>
                </div>
                <div className="heading-actions">
                  <button
                    className="icon-button"
                    aria-label="Gespräch umbenennen"
                    onClick={() => editTitle(meeting)}
                  >
                    <Pencil size={19} />
                  </button>
                  <button
                    className={`icon-button ${meeting.starred ? 'is-starred' : ''}`}
                    aria-label="Favorit umschalten"
                    aria-pressed={meeting.starred}
                    onClick={() => {
                      void mutate(meeting.id, (old) => ({ ...old, starred: !old.starred })).catch(
                        () => {},
                      );
                    }}
                  >
                    <Star size={19} fill={meeting.starred ? 'currentColor' : 'none'} />
                  </button>
                  <button className="secondary compact" onClick={() => setExportFor(meeting.id)}>
                    <ArrowUpRight size={17} />
                    <span>Exportieren</span>
                  </button>
                </div>
              </div>
              <div className="detail-meta">
                <label className="folder-select">
                  <Folder size={15} />
                  <select
                    aria-label="Gesprächsordner"
                    value={meeting.folder}
                    onChange={(e) => {
                      const value = e.target.value;
                      void mutate(meeting.id, (old) => ({ ...old, folder: value })).catch(() => {});
                    }}
                  >
                    <option value="">Ohne Ordner</option>
                    {[
                      ...new Set([
                        ...settings.folders,
                        ...(meeting.folder ? [meeting.folder] : []),
                      ]),
                    ].map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                </label>
                <span>{meeting.segments.length} Textstellen</span>
                <span>{transcript(meeting).split(/\s+/).filter(Boolean).length} Wörter</span>
              </div>
              {meeting.deletedAt ? (
                <div className="info-banner">
                  <Trash2 size={20} />
                  <span>Dieses Gespräch liegt im Papierkorb.</span>
                  <button
                    className="text-button"
                    onClick={() => {
                      void mutate(meeting.id, (old) => ({ ...old, deletedAt: undefined }))
                        .then(() => notify('Gespräch wiederhergestellt'))
                        .catch(() => {});
                    }}
                  >
                    Wiederherstellen
                  </button>
                  <button
                    className="text-button danger"
                    onClick={async () => {
                      if (
                        !confirm(
                          'Gespräch samt Audio endgültig löschen? Das kann nicht rückgängig gemacht werden.',
                        )
                      )
                        return;
                      try {
                        await removeMeeting(meeting.id);
                        publish(current.current.filter((m) => m.id !== meeting.id));
                        setSelected(null);
                        notify('Endgültig gelöscht');
                      } catch {
                        notify('Löschen fehlgeschlagen');
                      }
                    }}
                  >
                    Endgültig löschen
                  </button>
                </div>
              ) : null}
              {audioUrl && (
                <div className="audio-panel">
                  <div className="audio-label">
                    <Headphones size={17} />
                    <span>Originalaufnahme</span>
                    <strong>
                      {clock(playhead)} / {clock(meeting.duration)}
                    </strong>
                  </div>
                  <audio
                    ref={audio}
                    controls
                    preload="metadata"
                    src={audioUrl}
                    onTimeUpdate={() => setPlayhead(audio.current?.currentTime || 0)}
                    aria-label="Originalaufnahme abspielen"
                  />
                </div>
              )}
              {processing === meeting.id && (
                <div className="processing-banner" role="status">
                  <LoaderCircle size={19} className="spin" />
                  <div>
                    <strong>{processMessage}</strong>
                    <span>
                      Du kannst währenddessen Notizen bearbeiten. Bitte lass die App geöffnet.
                    </span>
                  </div>
                  <button className="text-button" onClick={cancelTranscription}>
                    Abbrechen
                  </button>
                </div>
              )}
              {processError && (
                <div className="error-box" role="alert">
                  {processError}
                  <button
                    className="icon-button"
                    aria-label="Fehlermeldung schliessen"
                    onClick={() => setProcessError('')}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
              <div className="detail-tabs" role="tablist" aria-label="Gesprächsansicht">
                {(
                  [
                    ['transcript', 'Transkript', FileText],
                    ['summary', 'Überblick', AudioLines],
                    ['tasks', 'Aufgaben', ListTodo],
                    ['notes', 'Notizen', Pencil],
                    ['ask', 'Nachschlagen', MessageSquare],
                  ] as const
                ).map(([key, label, Icon]) => (
                  <button
                    key={key}
                    id={`tab-${key}`}
                    role="tab"
                    aria-selected={tab === key}
                    aria-controls="detail-panel"
                    className={tab === key ? 'active' : ''}
                    onClick={() => setTab(key)}
                  >
                    <Icon size={16} />
                    {label}
                    {key === 'tasks' && meeting.tasks.length > 0 && (
                      <span>{meeting.tasks.length}</span>
                    )}
                  </button>
                ))}
              </div>
              <section
                className="detail-panel"
                role="tabpanel"
                id="detail-panel"
                aria-labelledby={`tab-${tab}`}
              >
                {tab === 'transcript' && (
                  <>
                    <div className="section-heading">
                      <div>
                        <h2>Transkript</h2>
                        <p>Text und Sprecher kannst du jederzeit korrigieren.</p>
                      </div>
                      <button className="text-button" onClick={() => editTranscript(meeting)}>
                        <Plus size={16} />
                        Text ergänzen
                      </button>
                    </div>
                    {!meeting.segments.length ? (
                      <div className="empty-state transcript-empty">
                        <span className="empty-icon">
                          <FileText size={28} />
                        </span>
                        <h3>
                          {meeting.audio ? 'Aus Audio wird Text.' : 'Platz für dein Gespräch.'}
                        </h3>
                        <p>
                          {meeting.audio
                            ? 'Whisper erstellt dein Transkript direkt auf diesem Gerät. Kein Upload, kein Abo. Je nach Gerät kann das einige Minuten dauern.'
                            : 'Ergänze ein Transkript oder deine Gesprächsnotizen. Alle Inhalte bleiben privat auf diesem Gerät.'}
                        </p>
                        {meeting.audio ? (
                          <button
                            className="primary"
                            disabled={!!processing}
                            onClick={() => void startTranscription(meeting.id)}
                          >
                            <AudioLines size={18} />
                            Transkription starten
                          </button>
                        ) : (
                          <button className="primary" onClick={() => editTranscript(meeting)}>
                            <Plus size={18} />
                            Text hinzufügen
                          </button>
                        )}
                        <span className="muted small-text">
                          {meeting.audio
                            ? 'Automatische Texte können Fehler enthalten. Sprecher werden manuell benannt.'
                            : 'Du kannst jederzeit weitere Textstellen ergänzen.'}
                        </span>
                      </div>
                    ) : (
                      <>
                        <div className="transcript-list">
                          {meeting.segments.map((s, i) => (
                            <article
                              id={`segment-${s.id}`}
                              className={`segment ${meeting.audio && playhead >= s.start && playhead < s.end ? 'playing' : ''}`}
                              key={s.id}
                            >
                              <div className="segment-gutter">
                                <span className="speaker-avatar">
                                  {(s.speaker || 'S').slice(0, 1).toUpperCase()}
                                </span>
                                <button
                                  disabled={!meeting.audio}
                                  className="timestamp"
                                  onClick={() => seek(s.start)}
                                  aria-label={`Audio ab ${clock(s.start)} abspielen`}
                                >
                                  {clock(s.start)}
                                </button>
                              </div>
                              <div className="segment-body">
                                <div>
                                  <strong>{s.speaker || 'Ohne Sprecherzuordnung'}</strong>
                                  <button
                                    className="icon-button"
                                    aria-label={`Textstelle ${i + 1} bearbeiten`}
                                    onClick={() => editTranscript(meeting, s)}
                                  >
                                    <Pencil size={15} />
                                  </button>
                                  <button
                                    className="icon-button"
                                    aria-label={`Textstelle ${i + 1} löschen`}
                                    onClick={() => {
                                      if (confirm('Diese Textstelle löschen?'))
                                        void mutate(meeting.id, (old) => ({
                                          ...old,
                                          revision: old.revision + 1,
                                          segments: old.segments.filter((item) => item.id !== s.id),
                                        })).catch(() => {});
                                    }}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                                <p>{s.text}</p>
                              </div>
                            </article>
                          ))}
                        </div>
                        {meeting.audio && (
                          <button
                            className="text-button muted"
                            disabled={!!processing}
                            onClick={() => void startTranscription(meeting.id)}
                          >
                            <RotateCcw size={15} />
                            Erneut transkribieren
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}
                {tab === 'summary' && (
                  <>
                    <div className="section-heading">
                      <div>
                        <h2>Die wichtigsten Stellen.</h2>
                        <p>Lokale Textanalyse · Originalzitate statt erfundener Inhalte.</p>
                      </div>
                    </div>
                    {!evidence.length ? (
                      <Empty
                        icon={<AudioLines />}
                        title="Zuerst braucht es Worte."
                        text="Erstelle oder ergänze ein Transkript. Danach erscheinen hier die zentralen Textstellen."
                      />
                    ) : (
                      <div className="summary-cards">
                        {evidence.map((s, i) => (
                          <button
                            key={s.id}
                            className="summary-card"
                            onClick={() => {
                              setTab('transcript');
                              seek(s.start);
                              setTimeout(
                                () =>
                                  document
                                    .getElementById(`segment-${s.id}`)
                                    ?.scrollIntoView({ block: 'start', behavior: 'instant' }),
                                0,
                              );
                            }}
                          >
                            <span>0{i + 1}</span>
                            <p>{s.text}</p>
                            <span className="summary-time">
                              {clock(s.start)}
                              <ArrowUpRight size={15} />
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    <p className="disclosure">
                      <ShieldCheck size={15} />
                      Automatisch ausgewählte Zitate. Keine generative KI, keine automatische
                      Sprechererkennung. Bitte prüfe Kontext und Vollständigkeit.
                    </p>
                  </>
                )}
                {tab === 'tasks' && (
                  <>
                    <div className="section-heading">
                      <div>
                        <h2>Aufgaben im Gespräch</h2>
                        <p>Vorschläge prüfen, ergänzen und abhaken.</p>
                      </div>
                      <button className="text-button" onClick={() => addTask(meeting)}>
                        <Plus size={16} />
                        Hinzufügen
                      </button>
                    </div>
                    {meeting.tasks.length ? (
                      <div className="tasks-list">{taskList(meeting)}</div>
                    ) : (
                      <Empty
                        icon={<ListTodo />}
                        title="Noch keine Aufgaben."
                        text="Ergänze eine Aufgabe oder suche im Transkript nach möglichen nächsten Schritten."
                      />
                    )}
                    <button
                      className="secondary"
                      disabled={!meeting.segments.length}
                      onClick={async () => {
                        const candidates = proposedTasks(meeting.segments);
                        const existing = new Set(meeting.tasks.map((t) => t.text));
                        const fresh = candidates.filter((t) => !existing.has(t));
                        if (!fresh.length) {
                          notify(
                            'Keine neuen Aufgabenhinweise gefunden. Du kannst Aufgaben selbst ergänzen.',
                          );
                          return;
                        }
                        try {
                          await mutate(meeting.id, (old) => ({
                            ...old,
                            tasks: [
                              ...old.tasks,
                              ...fresh.map((text) => ({
                                id: crypto.randomUUID(),
                                text,
                                done: false,
                              })),
                            ],
                          }));
                          notify(`${fresh.length} Vorschläge ergänzt · bitte prüfen`);
                        } catch {}
                      }}
                    >
                      <ListTodo size={16} />
                      Aufgabenvorschläge finden
                    </button>
                    <p className="disclosure">
                      Die lokale Suche erkennt Formulierungen wie „ich werde“ oder „bitte“. Sie kann
                      Aufgaben übersehen und Verbindlichkeit nicht beurteilen.
                    </p>
                  </>
                )}
                {tab === 'notes' && (
                  <>
                    <div className="section-heading">
                      <div>
                        <h2>Eigene Notizen</h2>
                        <p>Eigene Notizen werden von der Transkription nie verändert.</p>
                      </div>
                      <button className="text-button" onClick={() => editNote(meeting)}>
                        <Pencil size={16} />
                        Bearbeiten
                      </button>
                    </div>
                    {meeting.notes ? (
                      <div className="notes-text">{meeting.notes}</div>
                    ) : (
                      <Empty
                        icon={<Pencil />}
                        title="Raum für deine Gedanken."
                        text="Halte Entscheidungen, Beobachtungen und alles fest, was dir wichtig ist."
                        action={
                          <button className="secondary" onClick={() => editNote(meeting)}>
                            Notiz schreiben
                          </button>
                        }
                      />
                    )}
                  </>
                )}
                {tab === 'ask' && (
                  <>
                    <div className="section-heading">
                      <div>
                        <h2>Wo wurde das besprochen?</h2>
                        <p>Durchsuche dieses Gespräch und finde belegte Originalstellen.</p>
                      </div>
                    </div>
                    <form
                      className="evidence-search"
                      onSubmit={(e) => {
                        e.preventDefault();
                        setAnswer(findEvidence(meeting.segments, question));
                      }}
                    >
                      <Search size={18} />
                      <input
                        aria-label="Im Gespräch nachschlagen"
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        placeholder="Zum Beispiel: Zeitplan, Budget, nächste Schritte …"
                        required
                      />
                      <button className="primary compact" type="submit" disabled={!question.trim()}>
                        Suchen
                      </button>
                    </form>
                    {answer !== null && (
                      <div className="evidence-results" role="status">
                        {answer.length ? (
                          <>
                            <span className="eyebrow">PASSENDE ORIGINALSTELLEN</span>
                            {answer.map((s) => (
                              <button
                                className="evidence-card"
                                key={s.id}
                                onClick={() => {
                                  setTab('transcript');
                                  seek(s.start);
                                  setTimeout(
                                    () =>
                                      document
                                        .getElementById(`segment-${s.id}`)
                                        ?.scrollIntoView({ block: 'center' }),
                                    0,
                                  );
                                }}
                              >
                                <span>
                                  {clock(s.start)}
                                  <ArrowUpRight size={15} />
                                </span>
                                <p>„{s.text}“</p>
                              </button>
                            ))}
                          </>
                        ) : (
                          <Empty
                            icon={<Search />}
                            title="Keine passende Textstelle."
                            text="Probiere einen anderen Begriff aus dem Gespräch. Die Suche erfindet keine Antworten."
                          />
                        )}
                      </div>
                    )}
                    <p className="disclosure">
                      Stichwortsuche im Originaltranskript. Kein KI-Chat und keine unbelegten
                      Antworten.
                    </p>
                  </>
                )}
              </section>
              <div className="detail-footer">
                <span>
                  <ShieldCheck size={14} />
                  Privat auf diesem Gerät gespeichert
                </span>
                {!meeting.deletedAt && (
                  <button className="text-button danger" onClick={() => void trash(meeting)}>
                    <Trash2 size={15} />
                    In den Papierkorb
                  </button>
                )}
              </div>
            </>
          ) : page === 'settings' ? (
            <>
              <PageHeading
                eyebrow="DEIN RAUM"
                title="Einstellungen"
                text="Keine Anmeldung. Keine Cloud mit deinen Aufnahmen."
              />
              <div className="settings-grid">
                <section className="settings-card">
                  <div className="settings-card-title">
                    <ShieldCheck />
                    <h2>Privatsphäre & Spracherkennung</h2>
                  </div>
                  <p>
                    Audio, Transkripte und Notizen werden ausschliesslich im lokalen
                    Browser-Speicher abgelegt. Keine Analyse-Tracker und kein eigener Server.
                  </p>
                  <label className="toggle-row">
                    <span>
                      <strong>Lokales Whisper erlauben</strong>
                      <small>
                        Beim ersten Start lädt Hugging Face das Modell (rund 45 MB). Der Anbieter
                        sieht deine IP und den Modellabruf, aber erhält kein Audio und keinen Text.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.consent}
                      onChange={(e) => {
                        const consent = e.target.checked;
                        if (!consent && processing) cancelTranscription();
                        void changeSettings({ ...settings, consent });
                      }}
                    />
                  </label>
                  <label className="setting-select">
                    Sprache der Aufnahme
                    <select
                      value={settings.language}
                      onChange={(e) =>
                        void changeSettings({
                          ...settings,
                          language: e.target.value as Settings['language'],
                        })
                      }
                    >
                      <option value="german">Deutsch</option>
                      <option value="english">Englisch</option>
                      <option value="french">Französisch</option>
                      <option value="italian">Italienisch</option>
                      <option value="auto">Automatisch erkennen</option>
                    </select>
                  </label>
                  <p className="small-text muted">
                    Modell: OpenAI Whisper tiny, bereitgestellt von Xenova über Hugging Face. Die
                    Inferenz läuft mit Transformers.js auf deinem Gerät. Qualität und
                    Geschwindigkeit hängen von Aufnahme, Sprache und Gerät ab.
                  </p>
                  <button
                    className="text-button"
                    disabled={!!processing}
                    onClick={async () => {
                      if (
                        !confirm(
                          'Das heruntergeladene Sprachmodell entfernen? Für die nächste Transkription wird Internet benötigt.',
                        )
                      )
                        return;
                      try {
                        const keys = await caches.keys();
                        for (const key of keys.filter((k) => k.includes('transformers')))
                          await caches.delete(key);
                        notify('Modellcache entfernt. Aufnahmen bleiben erhalten.');
                      } catch {
                        notify('Der Modellcache konnte nicht entfernt werden.');
                      }
                    }}
                  >
                    <Trash2 size={15} />
                    Sprachmodell vom Gerät entfernen
                  </button>
                </section>
                <section className="settings-card">
                  <div className="settings-card-title">
                    <HardDrive />
                    <h2>Sicherung & Gerätespeicher</h2>
                  </div>
                  <p>
                    Website-Daten können beim Löschen des Browserverlaufs oder durch das
                    Betriebssystem verloren gehen. Sichere wichtige Gespräche regelmässig.
                  </p>
                  <div className="storage-meter">
                    <span
                      style={{
                        width: `${Math.min(100, ((storage.usage || 0) / (storage.quota || 1)) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="small-text muted">
                    {sizeLabel(storage.usage || 0)} belegt
                    {storage.quota
                      ? ` · ${sizeLabel(storage.quota)} verfügbarer Browserrahmen`
                      : ''}
                  </p>
                  <div className="stack-buttons">
                    <button
                      className="secondary"
                      disabled={working}
                      onClick={() => void doBackup()}
                    >
                      <Download size={18} />
                      Vollständige Sicherung exportieren
                    </button>
                    <button
                      className="secondary"
                      disabled={working}
                      onClick={() => restoreFile.current?.click()}
                    >
                      <RotateCcw size={18} />
                      Sicherung wiederherstellen
                    </button>
                    <button
                      className="text-button"
                      onClick={async () => {
                        const result = await requestPersistence();
                        notify(
                          result
                            ? 'Dauerhafte Speicherung wurde vom Browser zugesagt. Bitte trotzdem Sicherungen erstellen.'
                            : 'Der Browser entscheidet über die Speicherung. Eine regelmässige Sicherung bleibt wichtig.',
                        );
                      }}
                    >
                      Dauerhafte Speicherung anfragen
                      <ArrowUpRight size={15} />
                    </button>
                  </div>
                  <p className="small-text muted">
                    ZIP mit Originalaudio, Transkripten, Notizen, Aufgaben und Ordnerzuordnungen.
                    Sprache und Ordner werden mitgesichert. Die Modellfreigabe bleibt
                    gerätespezifisch. Sicherungen sind nicht verschlüsselt: bewahre sie geschützt
                    auf.
                  </p>
                </section>
                <section className="settings-card">
                  <div className="settings-card-title">
                    <Smartphone />
                    <h2>Auf deinem Homescreen</h2>
                  </div>
                  <p>
                    Installiere Murmur für ein eigenes App-Fenster. Nach dem ersten vollständigen
                    Laden sind gespeicherte Gespräche und Aufnahmen offline nutzbar. Transkription
                    benötigt zusätzlich das vollständig geladene Sprachmodell.
                  </p>
                  <button className="secondary" onClick={() => setInstall(true)}>
                    <Plus size={17} />
                    Installationsanleitung
                  </button>
                  {updateReady && (
                    <button
                      className="secondary"
                      disabled={recording || !!processing || working}
                      onClick={() => void (window as any).murmurUpdate(true)}
                    >
                      Neue Version laden
                    </button>
                  )}
                </section>
                <section className="settings-card">
                  <div className="settings-card-title">
                    <AudioLines />
                    <h2>Murmur 1.0</h2>
                  </div>
                  <p>
                    Ein unabhängiges Gesprächsnotizbuch, inspiriert von Transkriptions-Apps. Kein
                    Produkt von Otter.ai. Kostenlos und ohne Konto.
                  </p>
                  <p className="small-text muted">
                    Keine automatische Sprechertrennung, Meeting-Bots, Team-Konten oder
                    geräteübergreifende Synchronisierung. Du bestimmst, was du exportierst und
                    teilst.
                  </p>
                  <a
                    className="text-button"
                    href="https://github.com/treemonsal/Otter"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Quellcode auf GitHub
                    <ArrowUpRight size={15} />
                  </a>
                </section>
              </div>
            </>
          ) : page === 'tasks' ? (
            <>
              <PageHeading
                eyebrow="NÄCHSTE SCHRITTE"
                title="Deine Aufgaben"
                text={`${pendingTasks} offene ${pendingTasks === 1 ? 'Aufgabe' : 'Aufgaben'} aus deinen Gesprächen.`}
              />
              {activeMeetings.some((m) => m.tasks.length) ? (
                activeMeetings
                  .filter((m) => m.tasks.length)
                  .map((m) => (
                    <section className="task-group" key={m.id}>
                      <button
                        className="task-group-title"
                        onClick={() => {
                          open(m);
                          setTab('tasks');
                        }}
                      >
                        <AudioLines size={19} />
                        <h2>{m.title}</h2>
                        <ChevronRight size={17} />
                      </button>
                      {taskList(m)}
                    </section>
                  ))
              ) : (
                <Empty
                  icon={<ListTodo />}
                  title="Ein freier Kopf."
                  text="In deinen Gesprächen kannst du Aufgaben ergänzen oder aus dem Transkript vorschlagen lassen. Hier kommen sie zusammen."
                />
              )}
            </>
          ) : (
            <>
              {page === 'home' ? (
                <>
                  <PageHeading
                    eyebrow={new Intl.DateTimeFormat('de-CH', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    })
                      .format(new Date())
                      .toUpperCase()}
                    title="Deine Gespräche."
                    text="Aufnahmen, Transkripte und Aufgaben. Privat auf deinem Gerät."
                  />
                  <section className="record-hero">
                    <div className="hero-copy">
                      <div className="eyebrow">
                        <span className="tiny-dot" />
                        DEIN NÄCHSTES GESPRÄCH
                      </div>
                      <h2>
                        Gespräch
                        <br />
                        aufnehmen.
                      </h2>
                      <p>
                        Originalaudio und Transkript an einem Ort.
                        <br />
                        Kostenlos. Ohne Konto.
                      </p>
                      <div className="hero-actions">
                        <button className="primary" onClick={() => setRecording(true)}>
                          <Mic size={18} />
                          Aufnahme starten
                        </button>
                        <button className="text-button" onClick={() => setImporting(true)}>
                          <Upload size={16} />
                          Audio importieren
                        </button>
                      </div>
                    </div>
                    <div className="hero-art" aria-hidden="true">
                      <div className="orbit orbit-one" />
                      <div className="orbit orbit-two" />
                      <div className="orbit orbit-three" />
                      <div className="hero-mic">
                        <Wave />
                      </div>
                      <span className="art-label">JEDES WORT ZÄHLT</span>
                    </div>
                  </section>
                  <div className="stats-row">
                    <div>
                      <span className="stat-icon">
                        <AudioLines size={18} />
                      </span>
                      <strong>{activeMeetings.length}</strong>
                      <span>Gespräche</span>
                    </div>
                    <div>
                      <span className="stat-icon">
                        <Clock3 size={18} />
                      </span>
                      <strong>
                        {Math.round(activeMeetings.reduce((n, m) => n + m.duration, 0) / 60)}
                        <small> Min.</small>
                      </strong>
                      <span>festgehalten</span>
                    </div>
                    <button onClick={() => navigate('tasks')}>
                      <span className="stat-icon">
                        <ListTodo size={18} />
                      </span>
                      <strong>{pendingTasks}</strong>
                      <span>
                        offene Aufgaben
                        <ArrowUpRight size={14} />
                      </span>
                    </button>
                  </div>
                </>
              ) : (
                <PageHeading
                  eyebrow={page === 'trash' ? 'SICHER AUFBEWAHRT' : 'DEIN GESPRÄCHSARCHIV'}
                  title={
                    page === 'all'
                      ? 'Alle Gespräche'
                      : page === 'starred'
                        ? 'Favoriten'
                        : page === 'folders'
                          ? 'Deine Ordner'
                          : 'Papierkorb'
                  }
                  text={
                    page === 'trash'
                      ? 'Gelöschte Gespräche bleiben hier, bis du sie endgültig entfernst.'
                      : 'Deine Aufnahmen, Transkripte und Gedanken. An einem Ort.'
                  }
                  action={
                    <button className="secondary" onClick={() => setImporting(true)}>
                      <Plus size={18} />
                      Hinzufügen
                    </button>
                  }
                />
              )}
              <div className="mobile-library-links">
                {(['all', 'starred', 'folders', 'trash'] as Page[]).map((p) => {
                  const Icon = icons[p];
                  return (
                    <button
                      key={p}
                      className={page === p ? 'active' : ''}
                      onClick={() => {
                        navigate(p);
                        if (p === 'folders') setFolder('');
                      }}
                    >
                      <Icon size={14} />
                      {pageNames[p]}
                    </button>
                  );
                })}
              </div>
              <section className="archive-section">
                <div className="section-heading">
                  <h2>{page === 'home' ? 'Zuletzt festgehalten' : pageNames[page]}</h2>
                  {page === 'home' ? (
                    <button className="text-button" onClick={() => navigate('all')}>
                      Alle ansehen
                      <ArrowUpRight size={16} />
                    </button>
                  ) : page === 'folders' ? (
                    <button className="text-button" onClick={addFolder}>
                      <FolderPlus size={17} />
                      Neuer Ordner
                    </button>
                  ) : (
                    <span className="count-label">{list.length} Gespräche</span>
                  )}
                </div>
                <div className="list-toolbar">
                  <label className="search-field">
                    <Search size={18} />
                    <input
                      placeholder="Gespräche und Inhalte durchsuchen"
                      aria-label="Gespräche durchsuchen"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    {query && (
                      <button
                        className="icon-button"
                        aria-label="Suche leeren"
                        onClick={() => setQuery('')}
                      >
                        <X size={16} />
                      </button>
                    )}
                  </label>
                  <select
                    className="sort-select"
                    aria-label="Sortierung"
                    value={order}
                    onChange={(e) => setOrder(e.target.value)}
                  >
                    <option value="newest">Neueste zuerst</option>
                    <option value="oldest">Älteste zuerst</option>
                    <option value="title">Titel A–Z</option>
                  </select>
                </div>
                {page === 'folders' && (
                  <div className="folder-chips">
                    <button className={!folder ? 'active' : ''} onClick={() => setFolder('')}>
                      Alle Ordner
                    </button>
                    {[
                      ...new Set([
                        ...settings.folders,
                        ...activeMeetings.map((m) => m.folder).filter(Boolean),
                      ]),
                    ].map((f) => (
                      <button
                        key={f}
                        className={folder === f ? 'active' : ''}
                        onClick={() => setFolder(f)}
                      >
                        <Folder size={14} />
                        {f}
                      </button>
                    ))}
                  </div>
                )}
                <div className="meetings-list">
                  {filteredList.length ? (
                    filteredList.map(card)
                  ) : (
                    <Empty
                      icon={
                        query ? (
                          <Search />
                        ) : page === 'starred' ? (
                          <Star />
                        ) : page === 'trash' ? (
                          <Trash2 />
                        ) : (
                          <AudioLines />
                        )
                      }
                      title={
                        query
                          ? 'Hier ist es noch still.'
                          : page === 'starred'
                            ? 'Deine wichtigsten Gespräche.'
                            : page === 'trash'
                              ? 'Der Papierkorb ist leer.'
                              : 'Dein erstes Gespräch wartet.'
                      }
                      text={
                        query
                          ? 'Kein Treffer. Versuche einen anderen Suchbegriff.'
                          : page === 'starred'
                            ? 'Markiere ein Gespräch mit dem Stern, um es hier wiederzufinden.'
                            : page === 'trash'
                              ? 'Gelöschte Gespräche kannst du hier wiederherstellen.'
                              : 'Nimm ein Gespräch auf, importiere Audio oder beginne mit einer Textnotiz.'
                      }
                      action={
                        !query && !['starred', 'trash'].includes(page) ? (
                          <button className="secondary" onClick={() => setImporting(true)}>
                            <Plus size={17} />
                            Gespräch hinzufügen
                          </button>
                        ) : undefined
                      }
                    />
                  )}
                </div>
              </section>
              <div className="page-footer">
                <ShieldCheck size={14} />
                <span>Deine Gespräche gehören dir. Nur dir.</span>
                <button className="text-button" onClick={() => navigate('settings')}>
                  Datenschutz & Sicherung
                  <ArrowUpRight size={13} />
                </button>
              </div>
            </>
          )}
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Mobile Navigation">
        {navButton('home')}
        {navButton('all')}
        <button
          className="mobile-record"
          aria-label="Neue Aufnahme starten"
          onClick={() => setRecording(true)}
        >
          <Mic size={23} />
        </button>
        {navButton('tasks')}
        {navButton('settings')}
      </nav>
      {processing && selected !== processing && (
        <button
          className="background-progress"
          onClick={() => {
            const m = current.current.find((m) => m.id === processing);
            if (m) open(m);
          }}
        >
          <LoaderCircle size={17} className="spin" />
          Transkription läuft
          <ChevronRight size={16} />
        </button>
      )}
      {working && (
        <div className="busy-overlay" role="status">
          <LoaderCircle className="spin" />
          Datei wird verarbeitet …
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <CircleCheck size={18} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Hinweis schliessen"
            onClick={() => setToast('')}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <input
        hidden
        ref={uploadFile}
        type="file"
        accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.flac"
        onChange={(e) => {
          if (e.target.files?.[0]) void importAudio(e.target.files[0]);
        }}
      />
      <input
        hidden
        ref={restoreFile}
        type="file"
        accept=".zip,application/zip"
        onChange={(e) => {
          if (e.target.files?.[0]) void restore(e.target.files[0]);
        }}
      />
      {recording && (
        <Recorder
          onCancel={() => setRecording(false)}
          onComplete={(m) => {
            publish([m, ...current.current.filter((item) => item.id !== m.id)]);
            setRecording(false);
            open(m);
            notify('Aufnahme gespeichert');
            void requestPersistence();
          }}
        />
      )}
      {importing && (
        <Modal title="Gespräch hinzufügen" onClose={() => setImporting(false)}>
          <p className="muted modal-intro">
            Dein Audio bleibt auf diesem Gerät. Keine Anmeldung, kein Upload.
          </p>
          <button
            className="import-option"
            onClick={() => {
              setImporting(false);
              setRecording(true);
            }}
          >
            <span>
              <Mic size={24} />
            </span>
            <div>
              <strong>Gespräch aufnehmen</strong>
              <small>Direkt über das Mikrofon</small>
            </div>
            <ChevronRight size={19} />
          </button>
          <button className="import-option" onClick={() => uploadFile.current?.click()}>
            <span>
              <Upload size={24} />
            </span>
            <div>
              <strong>Audio importieren</strong>
              <small>MP3, M4A, WAV und mehr · max. 50 MB / 60 Min.</small>
            </div>
            <ChevronRight size={19} />
          </button>
          <button className="import-option" onClick={() => void addText()}>
            <span>
              <FileText size={24} />
            </span>
            <div>
              <strong>Mit Text beginnen</strong>
              <small>Transkript einfügen oder selbst schreiben</small>
            </div>
            <ChevronRight size={19} />
          </button>
        </Modal>
      )}
      {editing && <Editor key={editing.title} edit={editing} onClose={() => setEditing(null)} />}
      {consentFor && (
        <Modal title="Deine Stimme bleibt hier." onClose={() => setConsentFor(null)}>
          <div className="consent-icon">
            <ShieldCheck size={38} />
          </div>
          <p>
            Murmur nutzt das kostenlose Modell <strong>Whisper tiny</strong>. Die Spracherkennung
            läuft direkt auf deinem Gerät, ohne Audio oder Text hochzuladen.
          </p>
          <div className="consent-facts">
            <p>
              <Download size={18} />
              <span>
                Einmaliger Modelldownload von Hugging Face, rund 45 MB. Dabei sieht der Anbieter
                deine IP-Adresse.
              </span>
            </p>
            <p>
              <Smartphone size={18} />
              <span>
                Die Verarbeitung kann mehrere Minuten dauern. Lass die App geöffnet. Auf älteren
                iPhones kann der Arbeitsspeicher nicht ausreichen.
              </span>
            </p>
            <p>
              <FileText size={18} />
              <span>
                Transkripte können Fehler enthalten. Sprecher werden nicht automatisch
                unterschieden.
              </span>
            </p>
          </div>
          <p className="muted small-text">
            Deine Freigabe wird gespeichert und kann jederzeit in den Einstellungen widerrufen
            werden. Nach vollständigem Modelldownload ist die Erkennung grundsätzlich offline
            möglich, solange der Browsercache erhalten bleibt.
          </p>
          <div className="button-row">
            <button className="secondary" onClick={() => setConsentFor(null)}>
              Später
            </button>
            <button
              className="primary"
              onClick={async () => {
                const id = consentFor;
                try {
                  const next = { ...settings, consent: true };
                  await saveSettings(next);
                  setSettings(next);
                  setConsentFor(null);
                  await startTranscription(id, true);
                } catch {
                  notify('Freigabe konnte nicht gespeichert werden.');
                }
              }}
            >
              Erlauben & starten
            </button>
          </div>
        </Modal>
      )}
      {exportFor &&
        (() => {
          const m = meetings.find((item) => item.id === exportFor);
          if (!m) return null;
          const finish = (blob: Blob, ext: string) => {
            download(blob, `${safeName(m.title)}.${ext}`);
            setExportFor(null);
            notify('Export zum Download bereit');
          };
          return (
            <Modal title="Dein Gespräch mitnehmen" onClose={() => setExportFor(null)}>
              <p className="muted modal-intro">
                Nur du entscheidest, mit wem du Inhalte teilst. Exportierte Dateien sind nicht
                verschlüsselt.
              </p>
              <div className="stack-buttons">
                <button
                  className="secondary"
                  onClick={() =>
                    finish(new Blob([toMarkdown(m)], { type: 'text/markdown;charset=utf-8' }), 'md')
                  }
                >
                  <FileText size={18} />
                  Transkript, Aufgaben & Notizen (.md)
                </button>
                <button
                  className="secondary"
                  onClick={() =>
                    finish(new Blob([transcript(m)], { type: 'text/plain;charset=utf-8' }), 'txt')
                  }
                >
                  <FileText size={18} />
                  Nur Transkript (.txt)
                </button>
                <button
                  className="secondary"
                  onClick={() =>
                    finish(
                      new Blob([toSrt(m.segments)], { type: 'text/plain;charset=utf-8' }),
                      'srt',
                    )
                  }
                >
                  <Clock3 size={18} />
                  Untertitel mit Zeitmarken (.srt)
                </button>
                {m.audio && (
                  <button
                    className="secondary"
                    onClick={() =>
                      finish(
                        m.audio!,
                        m.audio!.type.includes('mp4')
                          ? 'm4a'
                          : m.audio!.type.includes('mpeg')
                            ? 'mp3'
                            : m.audio!.type.includes('wav')
                              ? 'wav'
                              : m.audio!.type.includes('ogg')
                                ? 'ogg'
                                : m.audio!.type.includes('flac')
                                  ? 'flac'
                                  : 'webm',
                      )
                    }
                  >
                    <Headphones size={18} />
                    Originalaudio herunterladen
                  </button>
                )}
                <button
                  className="secondary"
                  onClick={async () => {
                    try {
                      const blob = await backup([m]);
                      finish(blob, 'zip');
                    } catch (e) {
                      notify(e instanceof Error ? e.message : 'Export fehlgeschlagen');
                    }
                  }}
                >
                  <Download size={18} />
                  Komplettes Gespräch (.zip)
                </button>
                <button
                  className="text-button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(toMarkdown(m));
                      setExportFor(null);
                      notify('Gespräch in die Zwischenablage kopiert');
                    } catch {
                      notify('Kopieren nicht erlaubt. Verwende den Textexport.');
                    }
                  }}
                >
                  <Copy size={16} />
                  In die Zwischenablage kopieren
                </button>
              </div>
            </Modal>
          );
        })()}
      {transcriptionConflict && (
        <Modal
          title="Deine Korrekturen bleiben erhalten."
          onClose={() => setTranscriptionConflict(null)}
        >
          <p>
            Du hast das Transkript während der Verarbeitung bearbeitet. Das neue Ergebnis hat deine
            Änderungen nicht überschrieben.
          </p>
          <p className="muted">
            Du kannst es als separate Textdatei exportieren oder deine Änderungen ausdrücklich
            ersetzen.
          </p>
          <div className="stack-buttons">
            <button
              className="primary"
              onClick={() => {
                download(
                  new Blob([transcriptionConflict.segments.map((s) => s.text).join('\n')], {
                    type: 'text/plain',
                  }),
                  'Neues-Transkript.txt',
                );
                setTranscriptionConflict(null);
              }}
            >
              Neues Ergebnis exportieren
            </button>
            <button
              className="secondary"
              onClick={async () => {
                if (
                  !confirm('Deine manuellen Transkriptänderungen durch das neue Ergebnis ersetzen?')
                )
                  return;
                try {
                  await mutate(transcriptionConflict.id, (old) => ({
                    ...old,
                    segments: transcriptionConflict.segments,
                    revision: old.revision + 1,
                    duration: transcriptionConflict.duration,
                  }));
                  setTranscriptionConflict(null);
                  notify('Neues Transkript übernommen');
                } catch {}
              }}
            >
              Änderungen ersetzen
            </button>
          </div>
        </Modal>
      )}
      {install && (
        <Modal title="Murmur auf deinem iPhone" onClose={() => setInstall(false)}>
          <div className="install-illustration">
            <Wave />
            <span>Murmur</span>
          </div>
          <ol className="install-steps">
            <li>
              Öffne die veröffentlichte App in <strong>Safari</strong>.
            </li>
            <li>
              Tippe auf <strong>Teilen</strong> und anschliessend auf{' '}
              <strong>Zum Home-Bildschirm</strong>.
            </li>
            <li>
              Bestätige mit <strong>Hinzufügen</strong>. Starte Murmur künftig über das neue Icon.
            </li>
          </ol>
          <p className="muted small-text">
            In Chrome auf Android: Menü → „App installieren“. Installierte App und Browser können je
            nach Betriebssystem getrennte Speicher haben. Verwende die ZIP-Sicherung, um Gespräche
            sicher zu übertragen.
          </p>
          <button className="primary full-width" onClick={() => setInstall(false)}>
            Verstanden
          </button>
        </Modal>
      )}
    </div>
  );
}
function PageHeading({
  eyebrow,
  title,
  text,
  action,
}: {
  eyebrow: string;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {action}
    </div>
  );
}
function Empty({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function Editor({ edit, onClose }: { edit: Edit; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(edit.fields.map((f) => [f.key, f.value])),
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const dirty = edit.fields.some((f) => values[f.key] !== f.value);
  const close = () => {
    if (!saving && (!dirty || confirm('Ungespeicherte Änderungen verwerfen?'))) onClose();
  };
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  return (
    <Modal title={edit.title} onClose={close} wide={edit.fields.some((f) => f.multiline)}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError('');
          try {
            await edit.save(values);
            onClose();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen');
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="edit-fields">
          {edit.fields.map((f) => (
            <label key={f.key}>
              {f.label}
              {f.multiline ? (
                <textarea
                  value={values[f.key]}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  rows={9}
                  maxLength={f.max || 1000000}
                />
              ) : (
                <input
                  value={values[f.key]}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  maxLength={f.max || 300}
                  inputMode={f.key === 'start' ? 'decimal' : undefined}
                />
              )}
            </label>
          ))}
        </div>
        {error && (
          <p role="alert" className="error-box">
            {error}
          </p>
        )}
        <div className="button-row">
          <button type="button" className="secondary" onClick={close} disabled={saving}>
            Abbrechen
          </button>
          <button type="submit" className="primary" disabled={saving}>
            {saving ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}Speichern
          </button>
        </div>
      </form>
    </Modal>
  );
}
