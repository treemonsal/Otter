# Murmur · private Gesprächsnotizen

Murmur ist eine kostenlose, installierbare Web-App für persönliche Gesprächsnotizen. Eigene Gestaltung, inspiriert von der Funktionskategorie von Otter.ai; keine Verbindung zu Otter.ai.

## Benutzen

Nach der Veröffentlichung: **https://treemonsal.github.io/Otter/**

Auf dem iPhone in Safari öffnen → Teilen → **Zum Home-Bildschirm** → Hinzufügen. Erst nach erfolgreichem Pages-Deployment ist die Adresse verfügbar. Es ist keine Anmeldung nötig.

- Audio aufnehmen, pausieren und speichern oder Audio importieren (50 MB / 60 Minuten).
- Originalaudio abspielen; Zeitmarken im Transkript springen zur Aufnahme.
- Whisper tiny transkribiert nach ausdrücklicher Freigabe direkt im Browser. Kein Audio-Upload, kein API-Schlüssel. Deutsch, Englisch, Französisch, Italienisch und automatische Spracherkennung.
- Transkripte korrigieren und Sprecher manuell benennen. Korrekturen während einer laufenden Transkription werden nicht überschrieben.
- Zentrale Originalstellen, lokale Aufgabenvorschläge und eine belegte Stichwortsuche. Das sind transparente Textverfahren, **kein generativer KI-Chat**.
- Eigene Notizen, Aufgaben, Favoriten, Ordner, Volltextsuche und Papierkorb.
- Export als Text, Markdown, SRT, Originalaudio oder vollständige ZIP-Sicherung. ZIP-Wiederherstellung ergänzt fehlende IDs; vorhandene Gespräche bleiben unverändert.

## Privatsphäre und Grenzen

Gespräche liegen in IndexedDB ausschliesslich auf dem jeweiligen Gerät und Browserprofil. Keine Konten, Tracker, eigene Server oder geräteübergreifende Synchronisierung. Andere Personen mit Zugriff auf dasselbe entsperrte Browserprofil können die Daten sehen. Die lokale Datenbank und Exporte sind nicht zusätzlich verschlüsselt.

Die App-Dateien kommen von GitHub Pages; der Hoster sieht übliche Verbindungsdaten wie die IP-Adresse. Erst nach Freigabe lädt Transformers.js das Modell von Hugging Face und dessen CDN (Modellabruf und IP sichtbar, kein Audio/Text). Der Modelldownload ist auf den Commit `5332fcc35e32a33b86612b9a57a89be7906102b1` von `Xenova/whisper-tiny` festgelegt. Anbieterzugang und kostenloser Betrieb externer Dienste können sich ändern.

Nach vollständigem Laden ist die App-Oberfläche mit den gespeicherten Inhalten offline verfügbar. Offline-Transkription setzt zusätzlich den vollständigen Modellcache voraus. Browser können Website-Daten und Modelle entfernen. Regelmässig **Einstellungen → Vollständige Sicherung exportieren** verwenden und ZIP-Dateien geschützt ablegen. Die Sicherung enthält auch den Papierkorb. Die vollständige Sicherung enthält auch Sprache und Ordnerlisten. Eine Wiederherstellung führt die Ordner zusammen, übernimmt die Sprache und lässt vorhandene Gespräche unverändert. Modellfreigaben bleiben gerätespezifisch.

Whisper tiny ist ein kleines Modell: Erkennungsfehler, insbesondere bei Schweizer Dialekt, Hintergrundgeräuschen oder Fachbegriffen, sind möglich. Kein Versprechen einer Qualität wie bei Otter.ai. Keine automatische Sprechertrennung, Meeting-Bots, Teamkonten oder Kalenderintegration. Längere Aufnahmen benötigen viel Arbeitsspeicher und können auf älteren iPhones scheitern. App während Aufnahme und Transkription geöffnet und Bildschirm an lassen; Hintergrundaufzeichnung ist durch mobile Browser begrenzt. Aufnahme-Zwischenstände werden etwa alle vier Sekunden gesichert; ein unerwarteter Abbruch kann den letzten Abschnitt verlieren.

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
```

Falls im Cloud-Image `/usr/bin/chromium` existiert, verwenden die Browserprüfungen diesen Browser. Tests umfassen echte UI-Eingaben, Aufnahme mit Chromiums Testmikrofon, Wiedergabe, Audiodateiimport, Audioerhalt im ZIP, Wiederherstellung, Persistenz, Offline-Neustart, Schutz ungespeicherter Eingaben, reduzierte Bewegung und Breiten von 320–430 Pixeln. Das iPhone-Projekt verwendet Chromium-Emulation, kein echtes Safari.

Der separate Test `npm run test:model` lädt eine öffentliche JFK-Sprachprobe von Hugging Face und führt echte Whisper-Inferenz im Browser durch; keine simulierten Modellantworten. Er verwendet unveränderte Originalmodelle mit Prüfung der von Hugging Face angegebenen SHA-256-/Git-Blob-Prüfsummen. Wegen des Cloud-Proxy-Zertifikats werden die Modelldateien im Test per TLS-geprüftem `curl` an den Browser weitergereicht; dessen Zertifikatsspeicher bleibt unverändert. Die Offline-Wiederholung entfernt diese Weiterleitung vollständig. Direkte Browser-Verbindungen zum öffentlichen Modellanbieter werden damit nicht geprüft. Er benötigt ein laufendes `npm run preview -- --port 4173` sowie Internetzugriff auf `huggingface.co` und dessen `*.hf.co`-CDN. Siehe `docs/VALIDATION.md` für den tatsächlich geprüften Stand.

## GitHub und Veröffentlichung

`.github/workflows/ci.yml` führt Build, Datentests und Browserprüfungen aus. `.github/workflows/pages.yml` baut und veröffentlicht nach erfolgreichen Prüfungen über den kostenlosen GitHub-Pages-Weg. GitHub Pages muss einmalig auf **GitHub Actions** als Quelle eingestellt sein. Ein Push nach `main` löst die Veröffentlichung aus. Keine Repository-Secrets nötig; der Workflow nutzt den kurzlebigen GitHub-Token mit minimalen Berechtigungen.

App-Updates verändern oder leeren IndexedDB nicht. Eine neue Service-Worker-Version wird erst nach Bestätigung in Einstellungen aktiviert; laufende Aufnahmen und Transkriptionen werden dabei geschützt. Vor grösseren Änderungen trotzdem eine ZIP-Sicherung erstellen.

## Lizenz

MIT, siehe `LICENSE`. Bibliotheken und das Whisper-Modell behalten ihre jeweiligen Lizenzen. Modell und ONNX-Laufzeit werden nicht als eigene Arbeit ausgegeben.
