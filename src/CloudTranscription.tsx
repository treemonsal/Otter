import { Cloud, Upload, AudioLines, Clock3, ArrowUpRight } from 'lucide-react';
import { Modal } from './components';
import { CLOUD_INFO, CLOUD_MAX_SECONDS } from './cloud-transcription';

export function CloudOption({
  duration,
  busy,
  online,
  onStart,
}: {
  duration: number;
  busy: boolean;
  online: boolean;
  onStart: () => void;
}) {
  return (
    <div className="cloud-option">
      <Cloud size={23} aria-hidden="true" />
      <div>
        <strong>Mehr Modell. Weniger Arbeit fürs Handy.</strong>
        <p>Whisper large v3 bei Hugging Face · kostenlos, ohne Konto · bis 5 Minuten.</p>
        <small>
          {!online
            ? 'Offline: Nutze die lokale Erkennung unten.'
            : duration > CLOUD_MAX_SECONDS
              ? 'Diese Aufnahme ist länger als 5 Minuten. Nutze die lokale Erkennung unten.'
              : 'Sendet nur diese Aufnahme. Automatische Sprachwahl, Fliesstext ohne einzelne Zeitmarken. Öffentlicher Dienst mit Nutzungslimits.'}
        </small>
      </div>
      <button
        className="secondary"
        disabled={busy || !online || duration > CLOUD_MAX_SECONDS}
        onClick={onStart}
      >
        <Cloud size={17} />
        Online transkribieren
      </button>
    </div>
  );
}

export function CloudSettings() {
  return (
    <section className="settings-card">
      <div className="settings-card-title">
        <Cloud />
        <h2>Stärkeres Online-Modell</h2>
      </div>
      <p>
        Öffne ein Gespräch mit Audio und wähle „Online transkribieren“. Whisper large v3 ist
        deutlich grösser als das lokale Modell und kann anspruchsvolle Aufnahmen besser erkennen.
        Ein fehlerfreies Ergebnis ist nicht garantiert.
      </p>
      <p>
        Die gewählte Aufnahme wird als WAV an den öffentlichen Hugging-Face-Dienst{' '}
        <strong>hf-audio/whisper-large-v3</strong> gesendet. Titel, Notizen und andere Gespräche
        werden nicht mitgesendet. Der Anbieter erhält das Audio und deine IP-Adresse; eine sofortige
        Löschung können wir nicht zusichern.
      </p>
      <p className="small-text muted">
        Kostenloser Demo-Dienst mit möglichen Wartezeiten, Ausfällen und Nutzungslimits. Maximal 5
        Minuten je Aufnahme. Sprache automatisch, Text ohne einzelne Zeitmarken und ohne
        automatische Sprechertrennung. Zusammenfassung und Suche bleiben lokale Textverfahren. Kein
        eigener Server und kein Abo.
      </p>
      <a className="text-button" href={CLOUD_INFO} target="_blank" rel="noreferrer">
        Dienst und Betreiber ansehen
        <ArrowUpRight size={15} />
      </a>
    </section>
  );
}

export function CloudConsent({
  disabled,
  onClose,
  onStart,
}: {
  disabled: boolean;
  onClose: () => void;
  onStart: () => void;
}) {
  return (
    <Modal title="Mit Whisper large v3 erkennen" onClose={onClose}>
      <div className="consent-icon">
        <Cloud size={38} />
      </div>
      <p>
        Die ausgewählte Aufnahme wird an den öffentlichen Dienst{' '}
        <strong>hf-audio/whisper-large-v3</strong> auf Hugging Face gesendet. Das grosse Modell
        verarbeitet sie auf einem Server und liefert den Text zurück.
      </p>
      <div className="consent-facts">
        <p>
          <Upload size={18} />
          <span>
            Nur dieses Audio, als WAV ohne deinen Gesprächstitel. Keine Notizen, Aufgaben oder
            anderen Aufnahmen.
          </span>
        </p>
        <p>
          <AudioLines size={18} />
          <span>
            Bis 5 Minuten. Sprache automatisch. Ein Textblock ohne einzelne Zeitmarken; Sprecher
            werden nicht automatisch getrennt.
          </span>
        </p>
        <p>
          <Clock3 size={18} />
          <span>
            Kostenlos und ohne Konto. Der öffentliche Demo-Dienst kann ausgelastet sein oder ein
            Nutzungslimit erreichen.
          </span>
        </p>
      </div>
      <p className="muted small-text">
        Der Anbieter erhält Audio und IP-Adresse. Wir können keine bestimmte Speicherfrist oder
        sofortige Löschung zusichern. Abbrechen beendet die Verbindung; bereits übertragene Daten
        lassen sich dadurch nicht zurückholen.
      </p>
      <a className="text-button" href={CLOUD_INFO} target="_blank" rel="noreferrer">
        Dienst ansehen
        <ArrowUpRight size={15} />
      </a>
      <div className="button-row">
        <button className="secondary" onClick={onClose}>
          Zurück
        </button>
        <button className="primary" disabled={disabled} onClick={onStart}>
          <Upload size={17} />
          Audio senden & starten
        </button>
      </div>
    </Modal>
  );
}
