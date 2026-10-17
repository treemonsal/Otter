import array
import copy
import json
import shutil
import wave

import pytest

from training.corpus import error_rates, load_corpus, normalize, review_gate, sha256


@pytest.fixture
def dataset(tmp_path):
    rows = []
    for i, split in enumerate(["train", "train", "validation", "test"]):
        audio = tmp_path / f"{i}.wav"
        with wave.open(str(audio), "wb") as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(16000)
            out.writeframes(array.array("h", [i + 1] * 16000).tobytes())
        rows.append(
            {
                "id": f"clip-{i}",
                "audio": audio.name,
                "sha256": sha256(audio),
                "text": f"Prüfsatz Nummer {i}",
                "speaker": f"person-{i}",
                "recording": f"session-{i}",
                "split": split,
                "dialect": "ZH",
                "target": "standard-de",
                "source": "unit-test-fixture",
                "permission": "synthetic fixture, no real speech",
                "human_verified": True,
            }
        )
    manifest = tmp_path / "corpus.jsonl"

    def save():
        manifest.write_text("".join(json.dumps(r) + "\n" for r in rows))
        return manifest

    save()
    return rows, save


def test_normalization_and_corpus_weighted_metrics():
    assert normalize("STRASSE, Straße! Grüezi.") == "strasse strasse grüezi"
    # Insertions may produce WER > 100%; averaging clip scores would be wrong.
    assert error_rates([("a", "a b c d"), ("d e f", "d e f")])["wer"] == 0.75
    assert error_rates([("a", "a b c d")])["wer"] == 3
    with pytest.raises(ValueError, match="Empty reference"):
        error_rates([("!", "text")])


def test_fingerprint_is_portable_and_order_independent(dataset, tmp_path):
    rows, save = dataset
    manifest = save()
    _, first = load_corpus(manifest)
    rows.reverse()
    _, reordered = load_corpus(save())
    assert first == reordered
    moved = tmp_path / "relocated"
    moved.mkdir()
    for path in list(tmp_path.glob("*.wav")) + [manifest]:
        shutil.copy(path, moved)
    assert load_corpus(moved / manifest.name)[1] == first
    assert first["splits"]["train"]["speakers"] == 2


@pytest.mark.parametrize("key", ["speaker", "recording", "text", "sha256", "id"])
def test_cross_split_leakage_is_rejected(dataset, key):
    rows, save = dataset
    rows[-1][key] = rows[0][key]
    if key == "sha256":
        rows[-1]["audio"] = rows[0]["audio"]
    with pytest.raises(ValueError, match="leakage"):
        load_corpus(save())


@pytest.mark.parametrize(
    "changes, message",
    [
        ({"human_verified": False}, "human review"),
        ({"permission": ""}, "human review"),
        ({"dialect": "BE"}, "labelled ZH"),
        ({"target": "invented"}, "labelled ZH"),
        ({"sha256": "0" * 64}, "checksum"),
        ({"audio": "../outside.wav"}, "inside"),
        ({"text": "!!!"}, "reference"),
        ({"split": "eval"}, "split"),
    ],
)
def test_invalid_or_unreviewed_data_is_rejected(dataset, changes, message):
    rows, save = dataset
    rows[0].update(changes)
    with pytest.raises(ValueError, match=message):
        load_corpus(save())


def test_wrong_audio_format_and_mixed_targets_are_rejected(dataset):
    rows, save = dataset
    rows[0]["target"] = "dialect"
    with pytest.raises(ValueError, match="one output target"):
        load_corpus(save())
    rows[0]["target"] = "standard-de"
    manifest = save()
    path = manifest.parent / rows[0]["audio"]
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(8000)
        out.writeframes(b"\0\0" * 8000)
    rows[0]["sha256"] = sha256(path)
    with pytest.raises(ValueError, match="16 kHz"):
        load_corpus(save())


def test_review_gate_never_promotes_smoke_small_or_regressing_runs():
    corpus = {
        "splits": {
            split: {"speakers": 6, "clips": 300, "minutes": 60}
            for split in ["train", "validation", "test"]
        }
    }
    baseline = {"wer": 0.5, "cer": 0.3}
    candidate = {"wer": 0.45, "cer": 0.28}
    assert review_gate(corpus, baseline, candidate, False)["eligible_for_review"]
    assert not review_gate(corpus, baseline, candidate, False)["auto_deployed"]
    assert not review_gate(corpus, baseline, candidate, True)["eligible_for_review"]
    corpus["synthetic"] = True
    assert not review_gate(corpus, baseline, candidate, False)["eligible_for_review"]
    corpus["synthetic"] = False
    small = copy.deepcopy(corpus)
    small["splits"]["test"]["speakers"] = 1
    assert not review_gate(small, baseline, candidate, False)["eligible_for_review"]
    assert not review_gate(corpus, baseline, {"wer": 0.49, "cer": 0.28}, False)[
        "eligible_for_review"
    ]
    assert not review_gate(corpus, baseline, {"wer": 0.4, "cer": 0.31}, False)[
        "eligible_for_review"
    ]


def test_synthetic_corpus_cannot_run_as_dialect_training(
    dataset, monkeypatch, tmp_path
):
    from training.run import main

    rows, save = dataset
    for row in rows:
        row["synthetic"] = True
    manifest = save()
    assert load_corpus(manifest)[1]["synthetic"]
    monkeypatch.setattr(
        "sys.argv", ["training.run", str(manifest), "--output", str(tmp_path / "run")]
    )
    with pytest.raises(SystemExit) as error:
        main()
    assert error.value.code == 2
    assert not (tmp_path / "run").exists()
