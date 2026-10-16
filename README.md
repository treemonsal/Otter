# Murmur · Gesprächsnotizen mit Online-Option

Murmur ist eine kostenlose, installierbare Web-App für persönliche Gesprächsnotizen. Eigene Gestaltung, inspiriert von der Funktionskategorie von Otter.ai; keine Verbindung zu Otter.ai.

## Benutzen

Nach der Veröffentlichung: **https://treemonsal.github.io/Otter/**

Auf dem iPhone in Safari öffnen → Teilen → **Zum Home-Bildschirm** → Hinzufügen. Erst nach erfolgreichem Pages-Deployment ist die Adresse verfügbar. Es ist keine Anmeldung nötig.

- Audio mit tatsächlichem Mikrofonpegel aufnehmen, pausieren und speichern oder Audio importieren (50 MB / 60 Minuten).
- Originalaudio abspielen; Zeitmarken im Transkript springen zur Aufnahme.
- Lokal: Whisper tiny transkribiert nach Freigabe direkt im Browser, ohne Audio-Upload. Deutsch, Englisch, Französisch, Italienisch und automatische Spracherkennung.
- Neu in 1.2: **Online transkribieren** sendet die ausgewählte Aufnahme an den kostenlosen öffentlichen Hugging-Face-Dienst mit Whisper large v3. Ohne Konto oder API-Schlüssel. Bis 5 Minuten, automatische Sprachwahl, Text ohne einzelne Zeitmarken. Nur der gewählte Start löst eine Übertragung aus; bestehende Aufnahmen werden nicht automatisch hochgeladen.
- Transkripte korrigieren und Sprecher manuell benennen. Korrekturen während einer laufenden Transkription werden nicht überschrieben.
- Zentrale Originalstellen, lokale Aufgabenvorschläge und eine belegte Stichwortsuche. Das sind transparente Textverfahren, **kein generativer KI-Chat**.
- Eigene Notizen, Aufgaben, Favoriten, Ordnerverwaltung, Suche nach mehreren Begriffen und Papierkorb. Browser-Zurück/Vorwärts und Neuladen behalten Gespräch und Register bei.
- Export als Text, Markdown, SRT, Originalaudio oder vollständige Sicherung: normal als ZIP oder optional passwortgeschützt als `.murmur`. ZIP-Wiederherstellung ergänzt fehlende IDs; vorhandene Gespräche bleiben unverändert.

## Privatsphäre und Grenzen

Gespräche werden in IndexedDB auf dem jeweiligen Gerät und Browserprofil gespeichert. Keine Konten, Tracker, eigenen Server oder geräteübergreifende Synchronisierung. Die optionale Online-Erkennung überträgt die ausgewählte Aufnahme an einen externen Anbieter; die lokale Erkennung bleibt verfügbar. Andere Personen mit Zugriff auf dasselbe entsperrte Browserprofil können die Daten sehen. Die lokale Datenbank ist nicht zusätzlich verschlüsselt. Vollständige Sicherungen lassen sich optional mit einem Passwort verschlüsseln (AES-256-GCM, PBKDF2-SHA-256 mit 600.000 Iterationen). Das Passwort wird nicht gespeichert und kann nicht zurückgesetzt werden. Normale ZIP-/Text-/Audioexporte sind unverschlüsselt.

Die App-Dateien kommen von GitHub Pages; der Hoster sieht übliche Verbindungsdaten wie die IP-Adresse. Erst nach Freigabe lädt Transformers.js das Modell von Hugging Face und dessen CDN (Modellabruf und IP sichtbar, kein Audio/Text). Der Modelldownload ist auf den Commit `5332fcc35e32a33b86612b9a57a89be7906102b1` von `Xenova/whisper-tiny` festgelegt. Anbieterzugang und kostenloser Betrieb externer Dienste können sich ändern.

**Online-Verarbeitung:** Die Aktion „Online transkribieren“ und anschliessend „Audio senden & starten“ übermittelt nur die ausgewählte Aufnahme als Mono-WAV mit 16 kHz an `https://hf-audio-whisper-large-v3.hf.space`, den öffentlichen Space [hf-audio/whisper-large-v3](https://huggingface.co/spaces/hf-audio/whisper-large-v3). Der Dateiname lautet neutral `audio.wav`. Gesprächstitel, Notizen, Aufgaben und andere Gespräche werden nicht übertragen. Der Anbieter erhält Audio, IP-Adresse und übliche Verbindungsdaten. Wir können weder eine konkrete Speicherfrist noch sofortige Löschung zusichern. Abbrechen beendet die Verbindung und verhindert die Ergebnisübernahme; bereits gesendete Daten können beim Anbieter verbleiben oder weiterverarbeitet werden.

Whisper large v3 ist grösser als Whisper tiny und bietet die Möglichkeit besserer Erkennung; der kurze Integrationstest belegt keine allgemeine oder vergleichende Qualitätssteigerung. Der kostenlose Demo-Dienst hat keine Verfügbarkeitsgarantie, kann Nutzungslimits anwenden oder eingestellt werden. Keine automatische Anmeldung, keine Zahlungsdaten und keine kostenpflichtigen Ausweichdienste. Die App begrenzt Online-Aufnahmen auf 5 Minuten, um Übertragungsgrösse, Wartezeit und kostenlose Rechenbudgets zu begrenzen. Nach 3 Minuten ohne vollständiges Ergebnis bricht sie die Verbindung ab. Der Dienst erkennt die Sprache selbst; die Spracheinstellung gilt für das lokale Modell. Er liefert nur Text: keine automatischen Sprecher und keine einzelnen Zeitmarken. Das Ergebnis wird als ein Textblock über die gesamte Aufnahme gespeichert. Vor dem Ersetzen bestehender Transkripte gibt es einen ausdrücklichen Hinweis zum Verlust ihrer Zeitmarken. Originalaudio, Notizen und Aufgaben bleiben erhalten; manuelle Änderungen während der Verarbeitung werden geschützt.

Nach vollständigem Laden ist die App-Oberfläche mit den gespeicherten Inhalten offline verfügbar. Offline-Transkription setzt zusätzlich den vollständigen lokalen Modellcache voraus; Online-Erkennung benötigt Internet. Browser können Website-Daten und Modelle entfernen. Regelmässig **Einstellungen → Passwortgeschützte Sicherung** oder **Vollständige Sicherung exportieren** verwenden. ZIP-Dateien sind unverschlüsselt; `.murmur`-Dateien benötigen das zugehörige Passwort. Die Sicherung enthält auch den Papierkorb. Die vollständige Sicherung enthält auch Sprache und Ordnerlisten. Eine Wiederherstellung führt die Ordner zusammen, übernimmt die Sprache und lässt vorhandene Gespräche unverändert. Modellfreigaben bleiben gerätespezifisch. Die Herkunft des Transkripts (lokal/online) bleibt im Gespräch und in der Sicherung erhalten. Ältere ZIP-v1-Sicherungen ohne dieses Feld bleiben kompatibel.

Whisper tiny ist ein kleines Modell: Erkennungsfehler, insbesondere bei Schweizer Dialekt, Hintergrundgeräuschen oder Fachbegriffen, sind möglich. Kein Versprechen einer Qualität wie bei Otter.ai. Keine automatische Sprechertrennung, Meeting-Bots, Teamkonten oder Kalenderintegration. Längere Aufnahmen benötigen viel Arbeitsspeicher und können auf älteren iPhones scheitern. Die App versucht den Bildschirm während der Aufnahme wach zu halten, soweit der Browser Screen Wake Lock unterstützt. App während Aufnahme und Transkription geöffnet und Bildschirm an lassen; Hintergrundaufzeichnung ist durch mobile Browser begrenzt. Aufnahme-Zwischenstände werden etwa alle vier Sekunden gesichert. Parallele Fenster prüfen vor dem Speichern die Datensatzversion; Konflikte überschreiben keine neueren Gesprächsdaten. Bei Änderungen an Ordnern werden alle Zuordnungen atomar aktualisiert. Ein unerwarteter Abbruch kann den letzten Abschnitt verlieren.

Hole die erforderliche Einwilligung aller Beteiligten ein, bevor du aufnimmst. Browser-Emulation ersetzt keine Abnahme auf einem echten iPhone mit Safari.

## Entwicklung

Node.js **24** und npm verwenden. Kein Backend, keine Secrets und keine Datenbankinstallation erforderlich.

```sh
cd /workspace/Otter
ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci
npm run dev
```

Die CUDA-Option lässt ausschliesslich den optionalen GPU-Download von ONNX Runtime Node aus. Die Anwendung verwendet die Browser-WASM-Laufzeit. TLS, Paketintegrität und Modellvalidierung werden nicht ausgeschaltet. `npm run dev` und `npm run build` kopieren die zur installierten ONNX-Version passenden WASM-Dateien aus `node_modules` nach `public/ort`.

Die App liegt wegen GitHub Pages unter `/Otter/`. `npm run preview -- --port 4173` startet nach dem Build eine lokale Produktionsvorschau.

```sh
npm run build
npm test
npx playwright install --with-deps chromium
npm run test:e2e
# Mit laufender Produktionsvorschau und Internet:
npm run test:cloud
npm run test:model
```

Falls im Cloud-Image `/usr/bin/chromium` existiert, verwenden die Browserprüfungen diesen Browser. Tests umfassen echte UI-Eingaben, Aufnahme mit Chromiums Testmikrofon, Wiedergabe, Audiodateiimport, Audioerhalt im ZIP, Wiederherstellung, Persistenz, Offline-Neustart, Schutz ungespeicherter Eingaben, reduzierte Bewegung und Breiten von 320–430 Pixeln. Das iPhone-Projekt verwendet Chromium-Emulation, kein echtes Safari.

Der separate Test `npm run test:model` lädt eine öffentliche JFK-Sprachprobe von Hugging Face und führt echte Whisper-Inferenz im Browser durch; keine simulierten Modellantworten. Er verwendet unveränderte Originalmodelle mit Prüfung der von Hugging Face angegebenen SHA-256-/Git-Blob-Prüfsummen. Wegen des Cloud-Proxy-Zertifikats werden die Modelldateien im Test per TLS-geprüftem `curl` an den Browser weitergereicht; dessen Zertifikatsspeicher bleibt unverändert. Die Offline-Wiederholung entfernt diese Weiterleitung vollständig. Direkte Browser-Verbindungen zum öffentlichen Modellanbieter werden damit nicht geprüft. Er benötigt ein laufendes `npm run preview -- --port 4173` sowie Internetzugriff auf `huggingface.co` und dessen `*.hf.co`-CDN. Siehe `docs/VALIDATION.md` für den tatsächlich geprüften Stand und `docs/PRODUCT_REVIEW.md` für die kritische Produktbewertung mit Begründung und umgesetzten Verbesserungen.

Der zusätzliche Test `npm run test:cloud` prüft die tatsächliche Online-Inferenz mit derselben öffentlichen Sprachprobe, den vollständigen UI-Ablauf, mobile Darstellung, Speicherung und die echten CORS-Antworten des Anbieters einschliesslich Preflight. Er reicht unveränderte Live-Antworten per TLS-geprüftem `curl` weiter, ohne den Browser-Zertifikatsspeicher zu ändern. Er überträgt keine privaten Daten und benötigt keine Zugangsdaten. Er läuft bewusst getrennt von CI, da der kostenlose Dienst externe Nutzungslimits hat. Fehler-, Abbruch-, Konflikt- und Sicherungsfälle werden in den regulären deterministischen Tests geprüft.

## GitHub und Veröffentlichung

`.github/workflows/ci.yml` führt Build, Datentests und Browserprüfungen aus. `.github/workflows/pages.yml` baut und veröffentlicht nach erfolgreichen Prüfungen über den kostenlosen GitHub-Pages-Weg. GitHub Pages muss einmalig auf **GitHub Actions** als Quelle eingestellt sein. Ein Push nach `main` löst die Veröffentlichung aus. Keine Repository-Secrets nötig; der Workflow nutzt den kurzlebigen GitHub-Token mit minimalen Berechtigungen.

App-Updates verändern oder leeren IndexedDB nicht. Eine neue Service-Worker-Version wird erst nach Bestätigung in Einstellungen aktiviert; laufende Aufnahmen und Transkriptionen werden dabei geschützt. Vor grösseren Änderungen trotzdem eine ZIP-Sicherung erstellen.

## Lizenz

MIT, siehe `LICENSE`. Bibliotheken und das Whisper-Modell behalten ihre jeweiligen Lizenzen. Modell und ONNX-Laufzeit werden nicht als eigene Arbeit ausgegeben.
