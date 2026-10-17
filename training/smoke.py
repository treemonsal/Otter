"""Exercise real gradients on synthetic noise. NOT Swiss German training data."""

import argparse
import array
import json
import math
from pathlib import Path
import random
import subprocess
import sys
import wave

from training.corpus import sha256


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "output", type=Path, help="New directory outside the repository"
    )
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    data = args.output / "input"
    data.mkdir()
    rows = []
    for i, split in enumerate(["train", "validation", "test"]):
        path = data / f"noise-{i}.wav"
        rng = random.Random(i)
        with wave.open(str(path), "wb") as out:
            out.setframerate(16000)
            out.setsampwidth(2)
            out.setnchannels(1)
            out.writeframes(
                array.array(
                    "h", [rng.randrange(-100, 100) for _ in range(16000)]
                ).tobytes()
            )
        rows.append(
            {
                "id": f"technical-{i}",
                "audio": path.name,
                "sha256": sha256(path),
                "text": f"Technischer Test Nummer {i}",
                "speaker": f"synthetic-{i}",
                "recording": f"synthetic-{i}",
                "split": split,
                "dialect": "ZH",
                "target": "standard-de",
                "source": "SYNTHETIC NOISE, NOT ZURICH SPEECH",
                "permission": "Generated technical fixture, never a dialect corpus",
                "human_verified": True,
                "synthetic": True,
            }
        )
    manifest = data / "corpus.jsonl"
    manifest.write_text("".join(json.dumps(r) + "\n" for r in rows))
    subprocess.run(
        [
            sys.executable,
            "-m",
            "training.run",
            str(manifest),
            "--output",
            str(args.output / "run"),
            "--base",
            "tiny",
            "--steps",
            "2",
            "--evaluate-every",
            "2",
            "--accumulate",
            "1",
            "--smoke",
        ],
        check=True,
    )
    report = json.loads((args.output / "run" / "report.json").read_text())
    if (
        report["purpose"] != "technical-smoke-only"
        or not report["weights_changed"]
        or report["gate"]["eligible_for_review"]
        or report["gate"]["auto_deployed"]
        or len(report["losses"]) != 2
        or not all(math.isfinite(x) for x in report["losses"])
    ):
        raise RuntimeError("Technical training smoke check failed")
    print(
        "PASS: real gradients, saved/reloaded checkpoint and held-out evaluation; NOT a trained Zurich specialist."
    )


if __name__ == "__main__":
    main()
