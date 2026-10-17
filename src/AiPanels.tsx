import { useEffect, useState } from 'react';
import { AudioLines, Cloud, Smartphone, ArrowUpRight, Play, Trash2, Sparkles } from 'lucide-react';
import { Modal } from './components';
import { checkService, serviceUrl, type AiJob } from './ai-service';
import type { Meeting, Settings, InsightItem, Insights, Task } from './types';
import { clock } from './analysis';

export function ProcessingChoice({
  meeting,
  busy,
  online,
  service,
  onLocal,
  onDemo,
  onServer,
  onSettings,
  onClose,
  language,
  onLanguage,
}: {
  language: Settings['language'];
  onLanguage: (value: Settings['language']) => void;
  meeting: Meeting;
  busy: boolean;
  online: boolean;
  service: string;
  onLocal: () => void;
  onDemo: () => void;
  onServer: () => void;
  onSettings: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Verarbeitung wählen" onClose={onClose}>
      <p className="muted">
        Eine Aufnahme, drei Möglichkeiten. Originalaudio und Notizen bleiben erhalten.
      </p>
      <label className="service-address">
        Sprache der Aufnahme
        <select
          value={language}
          onChange={(event) => onLanguage(event.target.value as Settings['language'])}
        >
          <option value="german">Deutsch</option>
          <option value="english">Englisch</option>
          <option value="french">Französisch</option>
          <option value="italian">Italienisch</option>
          <option value="auto">Automatisch erkennen</option>
        </select>
      </label>
      <p className="small-text muted">
        Die Online-Demo erkennt die Sprache automatisch. Für die anderen Modi gilt deine Auswahl.
      </p>
      <button
        className="import-option"
        aria-label="Auf diesem Gerät"
        aria-describedby="local-mode-description"
        disabled={busy}
        onClick={onLocal}
      >
        <span>
          <Smartphone />
        </span>
        <div>
          <strong>Auf diesem Gerät</strong>
          <small id="local-mode-description">
            Whisper tiny · bis 60 Minuten · ohne Upload · nach Modelldownload offline
          </small>
        </div>
        <ArrowUpRight size={18} />
      </button>
      <button
        className="import-option"
        aria-label="Online transkribieren"
        aria-describedby="demo-mode-description"
        disabled={busy || !online || meeting.duration > 300}
        onClick={onDemo}
      >
        <span>
          <Cloud />
        </span>
        <div>
          <strong>Online transkribieren</strong>
          <small id="demo-mode-description">
            Whisper large v3 bei Hugging Face · Demo bis 5 Minuten · ohne einzelne Zeitmarken
          </small>
        </div>
        <ArrowUpRight size={18} />
      </button>
      <button
        className="import-option"
        aria-label="Mit Meeting-KI verarbeiten"
        aria-describedby="meeting-mode-description"
        disabled={busy || !online || !service}
        onClick={onServer}
      >
        <span>
          <AudioLines />
        </span>
        <div>
          <strong>Mit Meeting-KI verarbeiten</strong>
          <small id="meeting-mode-description">
            Whisper small · Sprache und Sprecher · bis 60 Minuten · Upload mit Fortsetzung
          </small>
        </div>
        <ArrowUpRight size={18} />
      </button>
      {!online && (
        <p role="status" className="small-text">
          Du bist offline. Die lokale Erkennung bleibt verfügbar.
        </p>
      )}
      {meeting.duration > 300 && (
        <p className="small-text muted">
          Die öffentliche Demo ist auf 5 Minuten begrenzt. Für längere Gespräche nutze die lokale
          Erkennung oder den Meeting-KI-Dienst.
        </p>
      )}
      {!service && (
        <p className="small-text">
          Der Meeting-KI-Server ist noch nicht verbunden.{' '}
          <button className="text-button" onClick={onSettings}>
            KI-Dienst einrichten
          </button>
        </p>
      )}
      <p className="small-text muted">
        Online-Modi übertragen die gewählte Aufnahme zum genannten Dienst. Ein grösseres Modell
        garantiert kein fehlerfreies Ergebnis.
      </p>
    </Modal>
  );
}
export function ServiceSettings({
  settings,
  onSave,
}: {
  settings: Settings;
  onSave: (next: Settings) => Promise<void>;
}) {
  const [url, setUrl] = useState(settings.serviceUrl);
  useEffect(() => setUrl(settings.serviceUrl), [settings.serviceUrl]);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  async function connect() {
    setChecking(true);
    setMessage('');
    try {
      const next = serviceUrl(url);
      const health = await checkService(next);
      await onSave({ ...settings, serviceUrl: next });
      setMessage(`Verbunden: ${health.models.speech}, Sprecher und KI-Auswertung.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Verbindung fehlgeschlagen.');
    } finally {
      setChecking(false);
    }
  }
  return (
    <section className="settings-card">
      <div className="settings-card-title">
        <Sparkles />
        <h2>Meeting-KI verbinden</h2>
      </div>
      <p>
        Der eigene KI-Dienst ergänzt lange Gespräche, automatische Sprechergruppen und generative
        Auswertungen mit Belegen. Eine Serveradresse ist erforderlich. Für App-Nutzer gibt es keine
        Anmeldung oder Zahlungsdaten.
      </p>
      <label className="service-address">
        KI-Serveradresse
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://dein-space.hf.space"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </label>
      <div className="button-row">
        <button
          className="secondary"
          disabled={checking || !url.trim()}
          onClick={() => void connect()}
        >
          {checking ? 'Verbindung prüfen …' : 'Prüfen & verbinden'}
        </button>
        {settings.serviceUrl && (
          <button
            className="text-button"
            onClick={() => {
              void onSave({ ...settings, serviceUrl: '' });
              setUrl('');
              setMessage('Verbindung entfernt.');
            }}
          >
            Verbindung entfernen
          </button>
        )}
      </div>
      <p role="status" className="small-text">
        {message}
      </p>
      <p className="small-text muted">
        Vor jeder Übertragung siehst du den Empfänger. Originalaudio und Zwischenstände bleiben auf
        deinem Gerät. Der Server löscht Aufträge nach 24 Stunden; kostenloses Hosting kann schlafen
        oder ausfallen. Nur einen Server verbinden, dessen Betreiber du kennst.
      </p>
    </section>
  );
}
export function JobPanel({
  job,
  busy,
  onResume,
  onApply,
  onDiscard,
}: {
  job: AiJob;
  busy: boolean;
  onResume: () => void;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const percent =
    job.kind === 'analysis'
      ? undefined
      : Math.min(100, Math.round((job.completedSeconds / Math.max(1, job.duration)) * 100));
  return (
    <section className="ai-job" aria-label="Gespeicherter KI-Auftrag">
      <strong>
        {job.kind === 'analysis' ? 'KI-Auswertung' : 'Gesprächsverarbeitung'} ·{' '}
        {job.status === 'complete' ? 'Ergebnis bereit' : 'Zwischenstand gespeichert'}
      </strong>
      <p role="status">{job.message}</p>
      {percent !== undefined && (
        <>
          <progress value={percent} max={100} aria-label="Verarbeitungsfortschritt" />
          <small>
            {clock(job.completedSeconds)} / {clock(job.duration)} · {percent} % abgeschlossen
          </small>
        </>
      )}
      <small>Empfänger: {new URL(job.endpoint).host}</small>
      <div className="button-row">
        {job.status === 'complete' ? (
          <button className="primary" disabled={busy} onClick={onApply}>
            Ergebnis übernehmen
          </button>
        ) : (
          <button className="secondary" disabled={busy} onClick={onResume}>
            <Play size={16} />
            Fortsetzen
          </button>
        )}
        <button className="text-button danger" disabled={busy} onClick={onDiscard}>
          <Trash2 size={15} />
          Auftrag verwerfen
        </button>
      </div>
    </section>
  );
}
export function InsightsPanel({
  insights,
  revision,
  onSource,
  onTasks,
}: {
  insights: Insights;
  revision: number;
  onSource: (id: string) => void;
  onTasks: (items: InsightItem[]) => void;
}) {
  const stale = insights.revision !== revision;
  return (
    <section className="ai-insights">
      <p className={`disclosure ${stale ? 'stale' : ''}`}>
        {stale
          ? 'Das Transkript wurde geändert. Diese Auswertung ist veraltet; bitte neu erstellen.'
          : `KI-Auswertung · ${insights.model} · bitte Inhalt und Belege prüfen.`}
      </p>
      {(
        [
          ['highlights', 'Zusammenfassung'],
          ['decisions', 'Entscheidungen'],
          ['questions', 'Offene Fragen'],
        ] as const
      ).map(([key, label]) => (
        <div key={key}>
          <h3>{label}</h3>
          {insights[key].length ? (
            insights[key].map((item) => (
              <article className="insight-item" key={item.id}>
                <p>{item.text}</p>
                <blockquote>{item.quote}</blockquote>
                <button
                  className="text-button"
                  disabled={stale}
                  onClick={() => onSource(item.segmentId)}
                >
                  Beleg im Transkript
                  <ArrowUpRight size={15} />
                </button>
              </article>
            ))
          ) : (
            <p className="muted small-text">Keine belegten Punkte vorgeschlagen.</p>
          )}
        </div>
      ))}
      {insights.tasks.length > 0 && (
        <button className="secondary" disabled={stale} onClick={() => onTasks(insights.tasks)}>
          Aufgabenvorschläge prüfen ({insights.tasks.length})
        </button>
      )}
      {insights.rejected > 0 && (
        <p className="small-text muted">
          {insights.rejected} Vorschläge ohne gültigen Beleg wurden verworfen.
        </p>
      )}
    </section>
  );
}
export function TaskReview({
  items,
  revision,
  onClose,
  onSave,
}: {
  items: InsightItem[];
  revision: number;
  onClose: () => void;
  onSave: (tasks: Task[]) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState(
    items.map((item) => ({ ...item, selected: true, dueDate: '' })),
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const change = (id: string, values: Partial<(typeof drafts)[number]>) =>
    setDrafts((old) => old.map((item) => (item.id === id ? { ...item, ...values } : item)));
  async function save() {
    setError('');
    const selected = drafts.filter((item) => item.selected);
    if (!selected.length) {
      setError('Bitte wähle mindestens einen Vorschlag.');
      return;
    }
    if (selected.some((item) => !item.text.trim())) {
      setError('Jede Aufgabe braucht einen Text.');
      return;
    }
    setSaving(true);
    try {
      await onSave(
        selected.map((item) => ({
          id: crypto.randomUUID(),
          text: item.text.trim(),
          done: false,
          assignee: item.assignee?.trim() || '',
          dueText: item.dueText?.trim() || '',
          dueDate: item.dueDate,
          segmentId: item.segmentId,
          quote: item.quote,
          sourceRevision: revision,
        })),
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Aufgaben konnten nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title="Aufgabenvorschläge prüfen"
      onClose={() => {
        if (!saving) onClose();
      }}
      wide
    >
      <p className="muted">
        Vorschläge werden erst mit deiner Bestätigung zu Aufgaben. Fehlende Verantwortliche und
        Termine bleiben leer.
      </p>
      <div className="task-review-list">
        {drafts.map((item, index) => (
          <fieldset className="task-review-item" key={item.id}>
            <legend>
              <label>
                <input
                  type="checkbox"
                  checked={item.selected}
                  onChange={(e) => change(item.id, { selected: e.target.checked })}
                />{' '}
                Vorschlag {index + 1}
              </label>
            </legend>
            <label>
              Aufgabe
              <textarea
                value={item.text}
                maxLength={10000}
                onChange={(e) => change(item.id, { text: e.target.value })}
              />
            </label>
            <div className="review-fields">
              <label>
                Verantwortlich
                <input
                  value={item.assignee || ''}
                  maxLength={120}
                  onChange={(e) => change(item.id, { assignee: e.target.value })}
                />
              </label>
              <label>
                Termin laut Gespräch
                <input
                  value={item.dueText || ''}
                  maxLength={120}
                  onChange={(e) => change(item.id, { dueText: e.target.value })}
                />
              </label>
              <label>
                Datum (optional bestätigen)
                <input
                  type="date"
                  value={item.dueDate}
                  onChange={(e) => change(item.id, { dueDate: e.target.value })}
                />
              </label>
            </div>
            <blockquote>{item.quote}</blockquote>
          </fieldset>
        ))}
      </div>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      <div className="button-row">
        <button className="secondary" disabled={saving} onClick={onClose}>
          Abbrechen
        </button>
        <button className="primary" disabled={saving} onClick={() => void save()}>
          Ausgewählte Aufgaben übernehmen
        </button>
      </div>
    </Modal>
  );
}
