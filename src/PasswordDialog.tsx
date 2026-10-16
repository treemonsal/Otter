import { useEffect, useState } from 'react';
import { LockKeyhole, LoaderCircle } from 'lucide-react';
import { Modal } from './components';
export function PasswordDialog({
  mode,
  onClose,
  onSubmit,
}: {
  mode: 'export' | 'import';
  onClose: () => void;
  onSubmit: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (busy) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [busy]);
  return (
    <Modal
      title={mode === 'export' ? 'Sicherung mit Passwort schützen' : 'Sicherung entsperren'}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="muted modal-intro">
        {mode === 'export'
          ? 'Audio, Transkripte und Notizen werden auf diesem Gerät mit AES-256 verschlüsselt. Das Passwort wird nicht gespeichert und kann nicht zurückgesetzt werden.'
          : 'Gib das Passwort dieser Sicherung ein. Die Entschlüsselung findet ausschliesslich auf deinem Gerät statt.'}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          if (mode === 'export' && password !== confirmation) {
            setError('Die Passwörter stimmen nicht überein.');
            return;
          }
          setBusy(true);
          try {
            await onSubmit(password);
          } catch (e) {
            setError(
              e instanceof Error ? e.message : 'Die Sicherung konnte nicht verarbeitet werden.',
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="edit-fields">
          <label>
            Passwort
            <input
              type="password"
              autoComplete={mode === 'export' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={mode === 'export' ? 12 : 1}
              maxLength={1024}
              required
              disabled={busy}
            />
          </label>
          {mode === 'export' && (
            <label>
              Passwort wiederholen
              <input
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                minLength={12}
                maxLength={1024}
                required
                disabled={busy}
              />
            </label>
          )}
        </div>
        {mode === 'export' && (
          <p className="small-text muted password-help">
            Mindestens 12 Zeichen. Bewahre dein Passwort getrennt von der Sicherung sicher auf. Die
            lokale App-Datenbank bleibt durch diese Exportfunktion unverändert.
          </p>
        )}
        {error && (
          <p role="alert" className="error-box">
            {error}
          </p>
        )}
        <div className="button-row">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button className="primary" disabled={busy}>
            {busy ? <LoaderCircle size={18} className="spin" /> : <LockKeyhole size={18} />}
            {mode === 'export' ? 'Verschlüsselt exportieren' : 'Entsperren'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
