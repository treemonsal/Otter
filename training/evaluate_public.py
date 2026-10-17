"""Reproduce a limited current-model check on two public SwissDial ZH clips.

Requires backend/requirements.lock, not training/requirements.txt.
The cited source texts and recordings are SwissDial CC BY-NC 4.0, not repository MIT.
"""

import argparse
import hashlib
import json
from pathlib import Path
import sys
import urllib.request

from training.corpus import error_rates

SOURCE = "https://gitlab.inf.ethz.ch/ou-mtc-public/swiss-dial-samples"
SAMPLES = [
    (
        "ch_zh_1682.wav",
        "2f4f30f60b2c5057d77aae9659aba0f5bfaef325f416543bee6f7d71fe2a75e4",
        "Die Schweizer treffen im Final auf Russland, das die Slowakei im anderen Halbfinal mit drei zu zwei nach Penaltyschiessen niederrang.",
    ),
    (
        "ch_zh_2547.wav",
        "8cd1280e620141e25362d88b8ed191fd7ea79ed057890ed1d380be151747ac5a",
        "Blair hatte sich unbemerkt in seinen Rücken geschlichen.",
    ),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="New external output directory")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
    from faster_whisper.audio import decode_audio
    from models import Models, WHISPER_REV

    model = Models().speech()
    examples = []
    for name, checksum, reference in SAMPLES:
        url = f"{SOURCE}/-/wikis/samples/{name}"
        with urllib.request.urlopen(url, timeout=60) as response:
            data = response.read(2 * 1024 * 1024 + 1)
        if hashlib.sha256(data).hexdigest() != checksum:
            raise RuntimeError("Public fixture checksum mismatch")
        path = args.output / name
        path.write_bytes(data)
        audio = decode_audio(str(path), sampling_rate=16000)
        segments, _ = model.transcribe(
            audio,
            language="de",
            beam_size=5,
            condition_on_previous_text=False,
            vad_filter=True,
        )
        hypothesis = " ".join(s.text.strip() for s in segments)
        examples.append(
            {
                "id": name,
                "sha256": checksum,
                "seconds": len(audio) / 16000,
                "reference": reference,
                "hypothesis": hypothesis,
            }
        )
    report = {
        "schema": 1,
        "purpose": "two-public-samples-not-a-benchmark",
        "trained": False,
        "model": "Systran/faster-whisper-small",
        "revision": WHISPER_REV,
        "source": SOURCE,
        "license": "CC-BY-NC-4.0",
        "attribution": "Pelin Dogan-Schonberger, Julian Mader, Thomas Hofmann: SwissDial (2021), arXiv:2103.11401",
        "target": "standard-de",
        "scores": error_rates([(e["reference"], e["hypothesis"]) for e in examples]),
        "examples": examples,
        "limitations": [
            "Only two read examples; no generalization claim",
            "Not a training set or a speaker-independent benchmark",
            "Reference translations penalize legitimate wording alternatives",
        ],
    }
    (args.output / "report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    )
    print(
        json.dumps(
            {
                "scores": report["scores"],
                "trained": False,
                "report": str(args.output / "report.json"),
            }
        )
    )


if __name__ == "__main__":
    main()
