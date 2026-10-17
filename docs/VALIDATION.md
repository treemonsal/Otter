# Geprüfter Stand

Stand: 16. Oktober 2026. Cloud-Linux, Node.js 24.19.0, Chromium 154.

- Produktionsbuild mit TypeScript und Vite erfolgreich; PWA-Manifest, Icons und Service Worker erstellt.
- 20 Datentests (13 bestehende sowie 7 neue Online-Protokollprüfungen): unveränderte Quellenzitate, Aufgabenvorschläge, Treffer ohne erfundene Antworten, SRT-Rundungsgrenzen, Audio-/Metadaten-Roundtrip, Einstellungen ohne Modellfreigabe, Ablehnung fremder oder beschädigter ZIP-Dateien, doppelte IDs, Suchnormalisierung, Audioformate sowie Verschlüsselung, falsche Passwörter und manipulierte Sicherungen.
- 34 Browserprüfungen auf Desktop und in iPhone-13-Emulation: Eingaben und Persistenz, Originalaudioimport, ZIP-Wiederherstellung und wiederholte Wiederherstellung ohne Duplikate, Spracheinstellungen, Aufnahme/Pause/Wiedergabe mit Testmikrofon, Offline-Neustart, Offline-Suche und -Export, Schutz ungespeicherter Änderungen, beschädigte Dateien und reduzierte Bewegung. Zusätzlich: Ordner umbenennen/entfernen, Browser-Verlauf und Tastaturregister, echte Mikrofonpegelmessung mit einer festgelegten Testtondatei, parallele Fenster mit und ohne Änderungsbenachrichtigung, Quota-Fehler mit Rücknahme optimistischer Änderungen sowie passwortgeschützte Sicherung und Wiederherstellung in einem neuen Browserprofil. Neu: Online-Upload erst nach der Aktion, neutraler Dateiname ohne Titel, unverändertes Originalaudio und Herkunft im Backup, Wiederherstellung im neuen Profil, 429-Fehler, Offline-Verfügbarkeit der lokalen Alternative, Abbruch und Schutz manueller Änderungen vor späten Online-Antworten. Die regulären Cloud-Fehlerfälle verwenden bewusst kontrollierte Testantworten.
- Ansichten mit 320, 375, 390 und 430 Pixeln Breite auf horizontalen Überlauf geprüft.
- Axe-Prüfungen nach WCAG 2 A/AA und 2.1 AA auf Startseite, Importdialog, Transkript sowie neuer Online-Option und Übertragungsdialog ohne gemeldete Verstösse. Das ist keine vollständige manuelle Barrierefreiheitszertifizierung.
- Echte Whisper-tiny-Inferenz mit einer öffentlichen elfsekündigen JFK-Sprachaufnahme: „ask not what your country can do for you …“ erkannt. Neuer Worker verarbeitet dieselbe Aufnahme auch offline aus dem Modellcache und erhält währenddessen manuell bearbeitete Texte. Dies wurde erneut nach der Umstellung auf bedarfsweises Laden und versionierte Sprachlaufzeit-Dateien geprüft. Im lokalen Modus werden ausschliesslich Modell-Dateien angefordert; kein Audio-/Text-Upload.
- Online-Inferenz mit Whisper large v3 über den öffentlichen Hugging-Face-Dienst und eine öffentliche JFK-Sprachprobe erfolgreich: vollständige mobile UI vom Import über den sichtbaren Uploadstart bis zum serverseitigen Transkript, Neuladen und gespeicherter Quellenangabe. Keine persönlichen Daten verwendet. Echte Upload-/Call-/SSE-Antworten jeweils HTTP 200; CORS einschliesslich Preflight überprüft. Kein Ergebnis vorgetäuscht.
- Neue Protokolltests prüfen Mono-WAV/PCM-Grenzwerte, fragmentierte SSE/UTF-8-Daten, ungültige/leere Antworten, Nutzungslimits, Abbruch, Zeitlimit sowie Ablehnung überlanger Audios vor einem Upload.
- Abhängigkeiten mit `npm audit` geprüft: keine bekannten gemeldeten Schwachstellen zum Prüfzeitpunkt.

Die vorab gespeicherten App-Dateien wurden von rund 14,5 MiB auf rund 0,92 MiB reduziert. Die grosse WASM-Datei wird erst bei der freigegebenen Transkription geladen und von Transformers.js für spätere Offline-Nutzung gespeichert.

## Besonderheiten des Modelltests

Der Cloud-Browser vertraut dem für die Umgebung eingerichteten Netzwerk-Proxy-Zertifikat nicht. Eine Erweiterung seines dauerhaften Zertifikatsspeichers wurde von der automatischen Freigabeprüfung abgelehnt und **nicht durchgeführt**. TLS-Prüfungen bleiben eingeschaltet.

Der Test verwendet daher `curl` mit dem vorhandenen vertrauenswürdigen Cloud-Zertifikatssatz als Transport für die offiziellen Modelldateien. Jede Datei wird gegen die zum festgelegten Hugging-Face-Commit veröffentlichten SHA-256- bzw. Git-Blob-Prüfsummen geprüft und unverändert an den Browser weitergegeben. Die Spracherkennung selbst läuft vollständig mit der echten App, Transformers.js, ONNX-WASM und Whisper. Für den Offline-Durchlauf wird diese Transportweiterleitung entfernt.

`npm run test:cloud` verwendet aus demselben Grund `curl` als TLS-geprüften Transport der unveränderten Live-API-Antworten. Die tatsächliche Inferenz läuft beim Hugging-Face-Anbieter. Seine originalen CORS-Header werden geprüft und weitergegeben; auch das echte OPTIONS-Preflight wird separat geprüft. Der Browser-Zertifikatsspeicher bleibt unverändert.

Direkte Browser-Verbindungen vom Cloud-Browser zum öffentlichen Modellanbieter wurden damit nicht bestätigt. Die veröffentlichte App nutzt normale HTTPS-Verbindungen zu Hugging Face und dessen CDN.

## Noch auf echter Hardware prüfen

Kein physisches iPhone und kein echter iOS-Safari-Test standen zur Verfügung. Mikrofonberechtigungen, M4A-Codec, Homescreen-Installation, Arbeitsspeicher bei langen Aufnahmen und Verhalten beim Sperren/Wechseln der App müssen auf den Zielgeräten geprüft werden. Chromium-Emulation bestätigt diese Betriebssystem-Funktionen nicht.

Keine Garantie für Hintergrundaufnahme oder unbegrenzte Offline-Speicherung. Der Browser kann Cache und Website-Daten entfernen. Automatische Sprechertrennung und generativer KI-Chat gehören nicht zu dieser Version. Zusammenfassungen sind ausgewählte Originalstellen und Aufgaben sind lokale Vorschläge, die geprüft werden müssen.

## Ergänzung Version 1.3

- Produktionsbuild und TypeScript: erfolgreich. 26 Daten-/Protokolltests sowie 9 Python-Serverprüfungen. Gepinnte Python-Abhängigkeiten und `pip check` ohne gebrochene Anforderungen.
- Browserumfang erweitert um Upload-Fortsetzung nach Neuladen ohne doppelte Teile, gesammelte Sprecherkorrektur, kontrollierte belegte KI-Aufgaben mit Verantwortlichen/Datum, veraltete Auswertungen, Live-Rückmeldungen/Markierungen, gegenseitigen Ausschluss paralleler Aufträge, echte Migration von IndexedDB v1 nach v2 sowie Metadatenimport ohne AudioContext-Decodierung und endgültiges Löschen inklusive pausierter Auftragstoken. Vollständiger Umfang: 48 Prüfungen in Desktop- und iPhone-Chromium-Projekten.
- Echte serverseitige Whisper-small-Erkennung mit der öffentlichen JFK-Probe, neuronale pyannote-/WeSpeaker-Einsprecher- und Vier-Sprecher-Stichproben. Kein vorgegebenes Sprecheranzahl-Argument verwendet.
- Echte 66-Sekunden-Verarbeitung über mehrere persistierte Blöcke, fortsetzbare Uploadteile und gespeicherte 512-dimensionale Stimmenprototypen erfolgreich. Bekannte Qualitätsabweichung: dieselbe wiederholte historische Stimme wird in zwei Gruppen geteilt. Dies wird im Test ausdrücklich als Qualitätsgrenze gemeldet.
- Echte deutsche Qwen-7B-Auswertung mit Zusammenfassung, Budgetentscheidung, offener Kundenfrage sowie Aufgabe für Timo bis Freitag mit gültigen Originalbelegen. Der vollständige Handy-Browser-Ablauf gegen den echten lokalen KI-Server bestand inklusive Originalaudio-Upload, Sprechergruppen, generierter Auswertung, bestätigter Aufgabe, Neuladen und Überlaufprüfung. Kein Nachweis fehlerfreier allgemeiner Interpretation oder zuverlässiger Erkennung sämtlicher Aufgaben.
- Der frühere lokale Whisper-tiny-Test wurde nach dem neuen Wähler erneut erfolgreich durchgeführt: echte Erkennung, neuer Worker offline und Schutz manueller Korrekturen.

Die Live-Browserprüfungen verwenden gezielt simulierte SpeechRecognition-Rückmeldungen, um App-Persistenz und Steuerung zu prüfen. Echte Apple-/Google-Spracherkennung, physisches iPhone/Safari, Sperren und Anrufe wurden nicht praktisch abgenommen. Der vollständige 60-Minuten-Lauf auf einem Handy und der öffentlich erreichbare neue KI-Dienst sind noch nicht bestätigt. Siehe [MEETING_AI.md](MEETING_AI.md).
