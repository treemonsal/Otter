# Meeting-KI: Betrieb und Grenzen

Version 1.3 implementiert alle sechs vorgeschlagenen Bereiche. Die Serverfunktionen benötigen einen verbundenen Dienst; GitHub Pages kann diesen Python-Prozess nicht betreiben. `public/service.json` enthält deshalb bis zur erfolgreichen Bereitstellung eine leere Adresse. Die App bietet weiterhin lokale Erkennung, öffentliche Online-Demo, Live-Text soweit vom Browser unterstützt und manuelle Gesprächsverwaltung.

## Bereitstellen

Der vorbereitete Weg ist ein **kostenloser öffentlicher Hugging-Face-Docker-Space mit CPU-Basis**. App-Nutzer brauchen kein Konto. Der Entwickler benötigt ein Hugging-Face-Konto und einen Token mit Schreibrecht für den Space. Der Token gehört ausschliesslich in die sichere Umgebungsvariable `MURMUR_HF_TOKEN`, niemals in Chat, Repository oder Frontend. Die Anforderung ist im Cloud-Umgebungsentwurf gespeichert; beim letzten Check gab es weder eine gespeicherte Bindung noch vorhandene HF-Anmeldung.

```sh
cd /workspace/Otter
/workspace/murmur-ai-venv/bin/python scripts/deploy-ai-space.py
```

Das Skript erstellt nur `cpu-basic`, lädt den getesteten Servercode hoch, wartet auf `/health` und schreibt erst nach erfolgreicher Gesundheitsprüfung die öffentliche URL in `public/service.json`. Es bricht bei bereits angeforderter kostenpflichtiger Hardware ab und speichert keine Zugangsdaten. Danach `npm run build`, die relevanten Prüfungen und die GitHub-Pages-Veröffentlichung durchführen. Die veröffentlichte Adresse sollte zusätzlich mit einer öffentlichen Sprachprobe geprüft werden. Ein vorhandener eigener HTTPS-Dienst lässt sich alternativ unter **Einstellungen → Meeting-KI verbinden** anschliessen.

Bei kostenlosem Hosting sind Schlafzeiten, Warteschlangen, langsame CPU-Inferenz und Verlust des flüchtigen Serverspeichers möglich. Modell-Downloads benötigen rund 5,3 GB und mehrere GB RAM. Es gibt keine Verfügbarkeitsgarantie; ein dauerhaft zuverlässiger Dienst für viele gleichzeitige Nutzer kann Infrastrukturkosten erfordern. Es wird keine zahlungspflichtige Ressource automatisch angelegt.

## Was umgesetzt ist

| Bereich            | Verhalten                                                                                                                                                                                                                                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lange Aufnahmen    | Originaldatei bis 50 MiB / 60 Minuten; Upload in 2-MiB-Teilen, bereits bestätigte Teile werden übersprungen. Der Import liest vorrangig Audio-Metadaten statt eine Stunde PCM auf dem Handy zu decodieren. Nur kleine Dateien ohne brauchbare Metadaten erhalten einen Decoder-Fallback.                                                                        |
| Fortsetzung        | Server speichert vollständige 60-Sekunden-Blöcke, Text und Stimmenprototypen in SQLite. Browser speichert Auftrags- und Ergebnisstände in einem zusätzlichen IndexedDB-Store. Bei Verbindungsabbruch oder Neuladen lässt sich fortsetzen. Nach Verlust des Serverspeichers werden Originalaudio, gespeicherte Position und Stimmenprototypen erneut übertragen. |
| Sprecher           | Neuronale pyannote-Segmentierung und WeSpeaker-VoxCeleb-Embeddings bilden anonyme Gruppen. Whisper liefert Wortzeitmarken. Gruppen lassen sich gesammelt umbenennen oder durch denselben Namen zusammenführen; einzelne Textstellen bleiben editierbar. Unsichere Zuordnungen sind markiert.                                                                    |
| Zusammenfassungen  | Qwen2.5-7B-Instruct erzeugt neue Texte zu Ergebnissen, ausdrücklichen Entscheidungen und offenen Fragen. Jeder übernommene Punkt hat eine echte Textstelle und ein wörtliches Zitat. Kurz-IDs für das Modell werden auf unveränderte Original-IDs zurückgeführt. Unbelegte Quellen, falsche Zahlen und bestimmte unpassende Kategorien werden verworfen.        |
| Aufgaben           | KI-Vorschläge enthalten Text, Beleg, Verantwortlichen und Termin, soweit genannt. Vor der Übernahme gibt es eine bearbeitbare Vorschau mit Auswahl und optionalem bestätigtem Kalenderdatum. Relative Angaben werden nicht stillschweigend in Daten umgerechnet. Auch lokale Aufgabenvorschläge benötigen eine Bestätigung. Aufgaben bleiben später editierbar. |
| Live-Text          | Optionaler Browser-Sprachdienst während der Aufnahme, mit vorläufigem Text und ungefähren Zeitmarken. Je nach Browser geht Audio an Apple oder Google. Pause/Stop beendet Live-Verarbeitung; gespeicherte Mitschrift kann anschliessend übernommen werden. Nicht in allen Browsern verfügbar.                                                                   |
| Aufnahme und Handy | Zeitmarkierungen wichtiger Stellen, wiederholte Zwischensicherung von Audio/Live-Text/Markierungen, Bildschirm-Wachhaltung soweit verfügbar, Warnung beim Hintergrundwechsel und Schutz nicht exportierter Audio-Reste. Kein Versprechen einer Hintergrundaufnahme.                                                                                             |
| Bedienung          | Ein Einstieg „Transkription starten“, dann lokale Erkennung, öffentliche Demo oder Meeting-KI wählen. Die Aufnahmesprache ist direkt im Wähler einstellbar. Gespeicherte Aufträge zeigen Fortschritt, Empfänger und Fortsetzung.                                                                                                                                |

## Daten und Fehlerfälle

- IndexedDB-Version 2 ergänzt ausschliesslich den Auftragsspeicher. Bestehende Gespräche und IDs werden nicht zurückgesetzt. Atomare Versionsprüfungen und Ordneränderungen bleiben bestehen.
- Web Locks verhindern doppelte Verarbeitung desselben Auftrags in parallelen Fenstern. Ein atomarer Auftrag-Lease dient als Rückfall für Browser ohne Web Locks; nach einem abrupt geschlossenen Fenster kann dort bis zu 20 Sekunden Wartezeit nötig sein.
- KI-Transkription überschreibt keine währenddessen korrigierten Texte. Das neue Ergebnis bleibt separat verfügbar. Auswertungen speichern die Transkriptrevision; nach Änderungen erscheinen sie als veraltet, und Vorschläge/Belegaktionen sind bis zur Neubewertung gesperrt.
- Der Server erhält nur das jeweils freigegebene Originalaudio oder Transkript mit Sprecherbezeichnungen. Titel, Notizen, Aufgaben und andere Gespräche werden nicht mitgesendet. Beim Browser-Sprachdienst gelten dessen eigene Übertragungs- und Speicherbedingungen.
- Eigene Serveraufträge laufen auch ohne offene Browser-Verbindung weiter. Pausieren stoppt nach dem laufenden Modellabschnitt; dieser kann noch abgeschlossen und gespeichert werden. Der Browser behält seinen Zwischenstand.
- Erfolgreich übernommene/verworfene Serveraufträge werden nach Möglichkeit gelöscht. Ohne Verbindung gilt serverseitig eine Ablauffrist von 24 Stunden. Bereits laufende Inferenz kann noch ihren aktuellen Speicherabschnitt beenden. Hosting-Betreiber können Zugriff auf Laufzeitdaten haben.
- ZIP-/Passwortsicherungen bewahren bestätigte Sprecher, Live-Mitschriften, Markierungen, Auswertungen und strukturierte Aufgaben. Laufende Auftragstoken, Uploadstände und Serveradressen sind gerätespezifisch und nicht Teil der Sicherung; das gesicherte Originalaudio erlaubt einen neuen Auftrag.

## Ehrliche Qualitätsgrenzen

Die Einsprecher-Sprachprobe blieb nach der Modellüberarbeitung bei einer Stimme; die offizielle Vier-Sprecher-Aufnahme ergab vier Gruppen. Eine künstlich auf 66 Sekunden wiederholte historische JFK-Aufnahme wurde trotzdem in zwei Gruppen derselben Stimme aufgeteilt. Dies ist ein bekannter Qualitätsfehler und wird nicht als bestandene Einsprecherprüfung ausgegeben. Sprechergruppen können manuell zusammengeführt werden. Für reale Schweizer Gespräche, Überlappungen, ähnliche Stimmen und Hintergrundlärm fehlen belastbare Vergleichsdaten.

Gültige Zitate belegen die Herkunft, nicht automatisch die Richtigkeit der KI-Interpretation. Die zusätzlichen Prüfungen sind konservativ und können richtige Vorschläge verwerfen oder Aufgaben übersehen. Weder Sprecherzuordnung noch Zusammenfassung oder Aufgaben sind fehlerfrei. Whisper small im eigenen CPU-Dienst ist ein anderes, kleineres Modell als Whisper large v3 in der öffentlichen Demo.

Die Langverarbeitung wurde real über zwei Blöcke mit 66 Sekunden Audio geprüft; ein vollständiger 60-Minuten-Lauf auf einem iPhone wurde nicht durchgeführt. Die Längen- und Uploadgrenzen sind separat geprüft. Echte iPhone-/Safari-Hardware, Apple-/Google-Live-Erkennung, Anrufe und Sperrbildschirm standen hier nicht für eine praktische Abnahme bereit. Die simulierten Live-Rückmeldungen in den Browsertests prüfen nur die App-Integration.

## Entwicklung und Tests

```sh
# Frontend und bisherige Offline-Erkennung
npm run build
npm test
npm run test:e2e

# Server: Python 3.12, CPU, keine kostenpflichtige API
python -m venv /workspace/murmur-ai-venv
/workspace/murmur-ai-venv/bin/pip install -r backend/requirements-dev.lock
/workspace/murmur-ai-venv/bin/python -m pytest backend/tests -q
/workspace/murmur-ai-venv/bin/ruff check backend scripts/deploy-ai-space.py scripts/test-ai-long.py --select F
```

Für echte Modelle zuerst den Preview-Server auf Port 4173 und den KI-Server aus `backend/README.md` auf Port 7860 starten. `npm run test:ai` prüft den kompletten Browserablauf mit öffentlicher Sprachprobe und synthetischem deutschen Gespräch. `python scripts/test-ai-long.py` prüft echten Upload, Mehrblockverarbeitung, Zwischenstand und Stimmenprototypen. Erkannte Qualitätsgrenzen werden ausdrücklich ausgegeben. Für die alte lokale Erkennung bleibt `npm run test:model` zuständig; `npm run test:cloud` prüft die öffentliche Online-Demo. Diese Modelltests laufen getrennt von CI, da sie grosse Downloads und externe Dienste benötigen.
