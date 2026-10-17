# Zürcher Schweizerdeutsch: Training und tatsächlicher Stand

**Es gibt noch kein eigens trainiertes Zürcher Modell in der App.** Die getrennte CPU-Trainingsumgebung und der vollständige technische Trainingsablauf sind eingerichtet. Für die fachliche Anpassung fehlt ein zugänglicher, freigegebener Bestand echter Zürcher Sprachaufnahmen mit von Menschen korrigierten Transkripten.

## Datenprüfung

| Quelle | Festgestellter Zugriff | Konsequenz |
| --- | --- | --- |
| [ETH SwissDial](https://mtc.ethz.ch/publications/open-source/swiss-dial.html) | Der verlinkte vollständige Download liefert HTTP 404. | Vollständiges Archiv derzeit nicht verfügbar. |
| [Öffentliche SwissDial-Beispiele](https://gitlab.inf.ethz.ch/ou-mtc-public/swiss-dial-samples) | Zwei originale ZH-Aufnahmen mit Referenztext sind abrufbar. Weitere Beispiele auf der Seite sind ausdrücklich Sprachsynthese. | Die zwei Originale dienen nur dem Basismodell-Check, nicht dem Training. |
| Bekanntes HF-Mirror `notebotIE/swiss_german_dialects_raw` | HTTP 401 ohne berechtigten Zugriff. | Nicht als vorhandene Datenquelle voraussetzen. |
| [STT4SG-350 / SDS-200](https://swissnlp.org/home/activities/datasets/) | Anbieter verlangt für Forschung eine unterschriebene META-SHARE ResearchUsageOnly NoRedistribution-Lizenz; kommerzielle Nutzung separat. | Zugang und konkreten Nutzungszweck mit dem Anbieter klären. Es wurde keine Vereinbarung im Namen des Nutzers unterschrieben. |

SwissDial: Pelin Dogan-Schonberger, Julian Mader und Thomas Hofmann, *SwissDial: Parallel Multidialectal Corpus of Spoken Swiss German* (2021), [arXiv:2103.11401](https://arxiv.org/abs/2103.11401). Die verwendeten Referenzausschnitte und die Ergebnisse mit diesen Texten sind separat als CC BY-NC 4.0 gekennzeichnet; die MIT-Lizenz des Repositorys ersetzt keine Datenlizenz. Vor einem produktiven Training müssen die Bedingungen des tatsächlich bereitgestellten Datensatzes vorliegen. Die Skripte können Herkunfts- und Freigabeangaben verlangen, deren Richtigkeit aber nicht automatisch feststellen.

## Was wirklich geprüft wurde

- **18 Daten-/Qualitätsprüfungen**: unabhängige Personen und Aufnahmequellen pro Teilmenge, exakte Audio-/Textduplikate, Prüfsummen, Audioformat, Pfadgrenzen, menschliche Textprüfung und Freigabemetadaten. Zusammen mit den neun bestehenden Serverprüfungen: **27 Prüfungen**.
- **Echte Gewichtsanpassung auf CPU**: offizielles Whisper tiny, zwei Optimierungsschritte, veränderte Modellgewichte, Speicherung und erneutes Laden des gewählten Checkpoints, getrennte Auswertung. Die Eingaben sind synthetisches Rauschen für einen technischen Funktionstest. **Das ist kein Training auf Zürcher Sprache und kein Qualitätsnachweis.** Synthetische Testläufe sind für eine Freigabe gesperrt, auch wenn ihre Fehlerquote zufällig sinkt.
- **Aktuelles Whisper small an zwei originalen ZH-Beispielen**: normalisierte Wortfehlerrate 57,1 %, Zeichenfehlerrate 25,8 % auf insgesamt 28 Referenzwörtern. Unter anderem wurden „Slowakei“ und „Blair“ falsch erkannt. Nur zwei vorgelesene Beispiele; keine repräsentative Messung und kein Vorher-/Nachher-Vergleich einer Anpassung. Abweichende gültige Hochdeutsch-Formulierungen werden durch den Textvergleich ebenfalls als Fehler gezählt.

Die maschinenlesbaren Ergebnisse stehen unter [training-evidence/](training-evidence/). Audio und Modellgewichte wurden nicht ins Repository übernommen. Die App verwendet weiterhin ihre bisherigen Modelle. Ein Zürcher Modell wird weder durch einen Prompt noch durch die Auswahl „Deutsch“ vorgetäuscht.

## Echte Trainingsdaten bereitstellen

Für einen ersten Pilotlauf eignen sich eigene, zum Training freigegebene Aufnahmen verschiedener Zürcher Personen mit sorgfältig korrigierten Texten. Als praktisches Startziel: mehrere Stunden von mindestens elf verschiedenen Personen. Gespräche aus der späteren Nutzung sollten vertreten sein: unterschiedliche Mikrofone, Hintergrundgeräusche, Namen, Zahlen, Sprachwechsel und überlappende Stimmen. Mehr Aufnahmen allein ersetzen keine guten Transkripte.

Das Ausgabetextziel muss einheitlich sein: `standard-de` für lesbares Hochdeutsch oder `dialect` für geschriebenes Züritüütsch. Beim Dialekt sollten die Referenztexte eine konsistente Schreibweise verwenden. Beide Ziele erkennen gesprochenes Zürcher Schweizerdeutsch; die Referenztexte bestimmen, was das Modell schreiben lernt. Whisper verwendet dabei seinen vorhandenen deutschen Sprach-Token, keinen erfundenen `gsw-ZH`-Token.

Die Daten liegen lokal ausserhalb des Repositorys. Jede Zeile einer UTF-8-JSONL-Datei beschreibt **einen vollständig transkribierten Ausschnitt von 0,5–30 Sekunden**, mono PCM16-WAV mit 16 kHz. Keine vollständige einstündige Aufnahme unter einem kurzen Satzlabel ablegen.

```json
{"id":"zh-0001","audio":"clips/zh-0001.wav","sha256":"SHA256_DER_WAV_DATEI","text":"Der Termin ist am Freitag.","speaker":"person-01","recording":"session-01","split":"train","dialect":"ZH","target":"standard-de","source":"eigene freigegebene Zürcher Aufnahme","permission":"dokumentierte Trainingsfreigabe, Referenz der Vereinbarung","human_verified":true,"synthetic":false}
```

`speaker` muss eine von Menschen überprüfte, im gesamten Bestand stabile Personenkennung sein. Eine automatisch erzeugte Sprechergruppe aus der App belegt keine unabhängige Person. `recording` kennzeichnet die ursprüngliche Aufnahme; alle Ausschnitte derselben Aufnahme bleiben zusammen. Eine Person oder Aufnahme darf nicht in mehreren Teilmengen erscheinen. Training, Validierung und Test brauchen jeweils eigene Personen und Aufnahmen. Die ersten beiden Teilmengen dürfen keine normalisierten wortgleichen Referenzsätze des Tests enthalten. Exakte Prüfungen finden nicht jede Paraphrase oder neu kodierte Audiodatei; solche Überschneidungen zusätzlich prüfen.

## Reproduzierbare Befehle

Python 3.12, CPU; getrennt vom produktiven Inferenzdienst:

```sh
cd /workspace/Otter
python3 -m venv /workspace/murmur-training-venv
/workspace/murmur-training-venv/bin/pip install --cache-dir /workspace/.pip-cache -r training/requirements.lock
/workspace/murmur-training-venv/bin/pip check

# Echter technischer Trainingscheck, KEINE Dialekt-Trainingsdaten.
# Ein neues Verzeichnis verwenden; vorhandene Ergebnisse werden nicht überschrieben.
HF_HOME=/workspace/.hf-training-cache HF_HUB_DISABLE_XET=1 /workspace/murmur-training-venv/bin/python -m training.smoke /tmp/zh-technical-check

# Erst mit eigenen/geprüften echten Daten ausführen:
HF_HOME=/workspace/.hf-training-cache HF_HUB_DISABLE_XET=1 /workspace/murmur-training-venv/bin/python -m training.run /workspace/zh-corpus/corpus.jsonl --output /workspace/zh-runs/pilot-01 --base small --steps 500

# Öffentliche Hörprobe mit dem bestehenden Inferenzmodell reproduzieren:
/workspace/murmur-ai-venv/bin/python -m training.evaluate_public /tmp/zh-public-check

# Ohne Modelldownload laufende Prüfungen:
/workspace/murmur-ai-venv/bin/python -m pytest backend/tests training/tests -q
```

Das Training aktualisiert echte Whisper-Gewichte. Modell und Prozessor kommen aus unveränderlich gepinnten offiziellen Revisionen. Ein Lauf ist ein neuer Versuch mit dokumentiertem Seed, Parametern und Korpus-Fingerabdruck; er lädt keine eigenen Aufnahmen oder Ergebnisse hoch. Die festen CPU-Pakete provisionieren keine GPU und keine kostenpflichtige Infrastruktur. Für ein kleines technisches Beispiel genügt diese Maschine; umfangreiches Training auf CPU braucht erheblich mehr Zeit. Der Tiny-Funktionstest beweist noch keine erfolgreiche Optimierung des grösseren Small-Modells auf echten Daten.

Das bisher untrainierte Basismodell wird auf dem Testbestand gemessen, Zwischenstände ausschliesslich anhand der Validierungs-Wortfehlerrate ausgewählt und das gewählte Modell einmal auf dem Testbestand ausgewertet. Die Testergebnisse steuern keine Hyperparameter oder Checkpoint-Auswahl. Bei weiteren Experimenten denselben Testbestand nicht fortlaufend zur Optimierung verwenden; vor der endgültigen Entscheidung eine weitere unangetastete Sammlung reservieren.

`report.json` enthält normalisierte, über den gesamten Bestand gezählte WER/CER, den gewählten Checkpoint-Verlauf und tatsächliche Gewichtsänderungen. WER wird nicht bei 100 % abgeschnitten. Die konservative erste Prüfschwelle verlangt mindestens sechs Trainingspersonen/300 Ausschnitte/60 Minuten, zwei Validierungspersonen/50 Ausschnitte/10 Minuten und drei Testpersonen/100 Ausschnitte/10 Minuten. Dazu mindestens 5 % relative WER-Verbesserung und keine CER-Verschlechterung. Kleine echte Piloten mit vier unabhängigen Personen sind möglich, erfüllen diese Schwelle aber nicht. Die Schwelle ist keine statistische oder produktive Qualitätsgarantie.

## Vor dem Einsatz in der App

Ein technisch erfolgreicher Lauf wird **nicht automatisch veröffentlicht**. Erst bei messbarer Verbesserung mit echten ZH-Daten folgen Prüfung einzelner Hörproben, Namen/Zahlen, Sprechergruppen, Stille, Störgeräusche und Vergleich mit den bisherigen App-Modellen. Danach den gewählten Checkpoint für CTranslate2/int8 konvertieren und auch die quantisierte Fassung neu messen. Die unquantisierte PyTorch-Baseline ersetzt diesen Inferenzvergleich nicht. Die CTranslate2-Bibliothek ist installiert; ein fachlich geeignetes Modell für diesen Schritt liegt noch nicht vor.

Browserlokales Whisper und die fremde öffentliche HF-Demo lassen sich nicht durch dieses Serverskript nachtrainieren. Ein angepasstes Modell braucht eine bewusst getestete Integration in den eigenen Dienst oder einen separaten getesteten Browserexport. Die öffentliche Bereitstellung des eigenen Dienstes hat ausserdem weiterhin den bereits dokumentierten, separaten Entwicklerzugang als Voraussetzung; `MURMUR_HF_TOKEN` ist momentan nicht gebunden. Ein Token allein ersetzt keine Trainingsdaten oder deren Nutzungsfreigabe.
