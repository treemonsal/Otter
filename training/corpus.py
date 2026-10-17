"""Validate explicitly supplied, human-reviewed ZH recordings before training."""

import hashlib
import json
import re
import unicodedata
import wave
from collections import Counter
from pathlib import Path


def normalize(text):
    text = unicodedata.normalize("NFC", text).casefold().replace("ß", "ss")
    return " ".join(re.findall(r"[^\W_]+", text, re.UNICODE))


def distance(reference, hypothesis):
    previous = list(range(len(hypothesis) + 1))
    for i, a in enumerate(reference, 1):
        current = [i]
        for j, b in enumerate(hypothesis, 1):
            current.append(
                min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (a != b))
            )
        previous = current
    return previous[-1]


def error_rates(pairs):
    words = chars = word_errors = char_errors = 0
    for reference, hypothesis in pairs:
        ref, hyp = normalize(reference), normalize(hypothesis)
        word_errors += distance(ref.split(), hyp.split())
        char_errors += distance(ref, hyp)
        words += len(ref.split())
        chars += len(ref)
    if not words or not chars:
        raise ValueError("Empty reference text cannot be scored")
    # Corpus-level rates, deliberately NOT clipped to 100%.
    return {"wer": word_errors / words, "cer": char_errors / chars, "words": words}


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def pcm(path):
    with wave.open(str(path), "rb") as audio:
        if (
            audio.getframerate() != 16000
            or audio.getnchannels() != 1
            or audio.getsampwidth() != 2
            or audio.getcomptype() != "NONE"
        ):
            raise ValueError("Audio must be mono 16 kHz PCM16 WAV")
        duration = audio.getnframes() / 16000
        if not 0.5 <= duration <= 30:
            raise ValueError("Each utterance must be between 0.5 and 30 seconds")
        raw = audio.readframes(audio.getnframes())
        if len(raw) != audio.getnframes() * 2:
            raise ValueError("Truncated WAV recording")
        return raw, duration


def load_corpus(manifest):
    manifest = Path(manifest).resolve()
    root = manifest.parent
    records = []
    seen = {key: {} for key in ["id", "sha256", "speaker", "recording", "text"]}
    for line in manifest.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        required = [
            "id",
            "audio",
            "sha256",
            "text",
            "speaker",
            "recording",
            "split",
            "dialect",
            "target",
            "source",
            "permission",
            "human_verified",
        ]
        if not isinstance(row, dict) or any(key not in row for key in required):
            raise ValueError("Missing corpus fields")
        if row["human_verified"] is not True or any(
            not isinstance(row[key], str) or not row[key].strip()
            for key in required
            if key != "human_verified"
        ):
            raise ValueError(
                "Every recording needs human review, provenance and permission"
            )
        if not isinstance(row.get("synthetic", False), bool):
            raise ValueError("Synthetic marker must be a boolean")
        if row["dialect"] != "ZH" or row["target"] not in ["dialect", "standard-de"]:
            raise ValueError(
                "Only explicitly labelled ZH with a consistent output target"
            )
        if row["split"] not in ["train", "validation", "test"]:
            raise ValueError("Unknown split")
        if not normalize(row["text"]) or len(row["text"]) > 2000:
            raise ValueError("Empty or oversized reference")
        path = (root / row["audio"]).resolve()
        if Path(row["audio"]).is_absolute() or not path.is_relative_to(root):
            raise ValueError("Audio must stay inside the dataset directory")
        actual = sha256(path)
        if actual != row["sha256"]:
            raise ValueError("Audio checksum mismatch")
        _, seconds = pcm(path)
        for key in seen:
            value = normalize(row[key]) if key == "text" else row[key]
            prior = seen[key].get(value)
            if prior is not None and (key in ["id", "sha256"] or prior != row["split"]):
                raise ValueError(f"Duplicate or cross-split leakage: {key}")
            seen[key][value] = row["split"]
        records.append({**row, "path": str(path), "seconds": seconds})
    if not records or len({r["target"] for r in records}) != 1:
        raise ValueError("A nonempty corpus with one output target is required")
    counts = Counter(r["split"] for r in records)
    if set(counts) != {"train", "validation", "test"}:
        raise ValueError("Separate train, validation and test recordings are required")
    canonical = [{k: v for k, v in r.items() if k != "path"} for r in records]
    fingerprint = hashlib.sha256(
        json.dumps(
            sorted(canonical, key=lambda r: r["id"]), sort_keys=True, ensure_ascii=False
        ).encode()
    ).hexdigest()
    stats = {
        split: {
            "clips": counts[split],
            "speakers": len({r["speaker"] for r in records if r["split"] == split}),
            "minutes": sum(r["seconds"] for r in records if r["split"] == split) / 60,
        }
        for split in counts
    }
    return records, {
        "sha256": fingerprint,
        "target": records[0]["target"],
        "synthetic": any(r.get("synthetic", False) for r in records),
        "splits": stats,
    }


def review_gate(corpus, baseline, candidate, smoke):
    reasons = []
    if smoke:
        reasons.append("Technical smoke test is never a dialect quality result")
    if corpus.get("synthetic"):
        reasons.append("Synthetic fixtures cannot qualify as Zurich speech")
    for split, min_speakers, min_clips, min_minutes in [
        ("train", 6, 300, 60),
        ("validation", 2, 50, 10),
        ("test", 3, 100, 10),
    ]:
        stats = corpus["splits"][split]
        if any(
            stats[key] < minimum
            for key, minimum in [
                ("speakers", min_speakers),
                ("clips", min_clips),
                ("minutes", min_minutes),
            ]
        ):
            reasons.append(f"Insufficient independent {split} coverage")
    if baseline["wer"] <= 0 or candidate["wer"] > baseline["wer"] * 0.95:
        reasons.append("Less than 5% relative held-out WER improvement")
    if candidate["cer"] > baseline["cer"]:
        reasons.append("Held-out CER regression")
    return {
        "eligible_for_review": not reasons,
        "reasons": reasons,
        "auto_deployed": False,
    }
