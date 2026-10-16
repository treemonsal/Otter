# Geprüfter Stand

Stand: 16. Oktober 2026. Cloud-Linux, Node.js 24.19.0, Chromium 154.

- Produktionsbuild mit TypeScript und Vite erfolgreich; PWA-Manifest, Icons und Service Worker erstellt.
- Acht Datentests: unveränderte Quellenzitate, Aufgabenvorschläge, Treffer ohne erfundene Antworten, SRT-Rundungsgrenzen, Audio-/Metadaten-Roundtrip, Einstellungen ohne Modellfreigabe sowie Ablehnung fremder oder beschädigter ZIP-Dateien.
- 16 Browserprüfungen auf Desktop und in iPhone-13-Emulation: Eingaben und Persistenz, Originalaudioimport, ZIP-Wiederherstellung und wiederholte Wiederherstellung ohne Duplikate, Spracheinstellungen, Aufnahme/Pause/Wiedergabe mit Testmikrofon, Offline-Neustart, Offline-Suche und -Export, Schutz ungespeicherter Änderungen, beschädigte Dateien und reduzierte Bewegung.
- Ansichten mit 320, 375, 390 und 430 Pixeln Breite auf horizontalen Überlauf geprüft.
- Axe-Prüfungen nach WCAG 2 A/AA und 2.1 AA auf Startseite, Importdialog und Transkript ohne gemeldete Verstösse. Das ist keine vollständige manuelle Barrierefreiheitszertifizierung.
- Echte Whisper-tiny-Inferenz mit einer öffentlichen elfsekündigen JFK-Sprachaufnahme: „ask not what your country can do for you …“ erkannt. Neuer Worker verarbeitet dieselbe Aufnahme auch offline aus dem Modellcache. Es werden ausschliesslich Modell-Dateien angefordert; kein Audio-/Text-Upload.
- Abhängigkeiten mit `npm audit` geprüft: keine bekannten gemeldeten Schwachstellen zum Prüfzeitpunkt.

## Besonderheiten des Modelltests

Der Cloud-Browser vertraut dem für die Umgebung eingerichteten Netzwerk-Proxy-Zertifikat nicht. Eine Erweiterung seines dauerhaften Zertifikatsspeichers wurde von der automatischen Freigabeprüfung abgelehnt und **nicht durchgeführt**. TLS-Prüfungen bleiben eingeschaltet.

Der Test verwendet daher `curl` mit dem vorhandenen vertrauenswürdigen Cloud-Zertifikatssatz als Transport für die offiziellen Modelldateien. Jede Datei wird gegen die zum festgelegten Hugging-Face-Commit veröffentlichten SHA-256- bzw. Git-Blob-Prüfsummen geprüft und unverändert an den Browser weitergegeben. Die Spracherkennung selbst läuft vollständig mit der echten App, Transformers.js, ONNX-WASM und Whisper. Für den Offline-Durchlauf wird diese Transportweiterleitung entfernt.

Direkte Browser-Verbindungen vom Cloud-Browser zum öffentlichen Modellanbieter wurden damit nicht bestätigt. Die veröffentlichte App nutzt normale HTTPS-Verbindungen zu Hugging Face und dessen CDN.

## Noch auf echter Hardware prüfen

Kein physisches iPhone und kein echter iOS-Safari-Test standen zur Verfügung. Mikrofonberechtigungen, M4A-Codec, Homescreen-Installation, Arbeitsspeicher bei langen Aufnahmen und Verhalten beim Sperren/Wechseln der App müssen auf den Zielgeräten geprüft werden. Chromium-Emulation bestätigt diese Betriebssystem-Funktionen nicht.

Keine Garantie für Hintergrundaufnahme oder unbegrenzte Offline-Speicherung. Der Browser kann Cache und Website-Daten entfernen. Automatische Sprechertrennung und generativer KI-Chat gehören nicht zu dieser Version. Zusammenfassungen sind ausgewählte Originalstellen und Aufgaben sind lokale Vorschläge, die geprüft werden müssen.
