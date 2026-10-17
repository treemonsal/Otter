"""Real Whisper fine-tuning with speaker-disjoint evaluation; no implicit uploads.

Run from the repository root: python -m training.run --help
"""

import argparse
import copy
import hashlib
import json
import os
import random
from pathlib import Path

from training.corpus import error_rates, load_corpus, pcm, review_gate

BASES = {
    "tiny": "169d4a4341b33bc18d8881c4b69c2e104e1cc0af",
    "small": "973afd24965f72e36ca33b3055d56a652f456b4d",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--base", choices=BASES, default="small")
    parser.add_argument("--steps", type=int, default=500)
    parser.add_argument("--evaluate-every", type=int, default=100)
    parser.add_argument("--accumulate", type=int, default=4)
    parser.add_argument("--learning-rate", type=float, default=1e-5)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    parser.add_argument(
        "--smoke",
        action="store_true",
        help="Technical check only; never eligible for use",
    )
    args = parser.parse_args()
    if (
        not 1 <= args.steps <= 100000
        or not 1 <= args.accumulate <= 64
        or args.evaluate_every < 1
    ):
        parser.error("Invalid step/accumulation/evaluation limits")
    if not 0 < args.learning_rate <= 1e-3:
        parser.error("Invalid learning rate")
    records, corpus = load_corpus(args.manifest)
    if corpus["synthetic"] and not args.smoke:
        parser.error(
            "Synthetic fixtures require --smoke and cannot train a Zurich specialist"
        )
    if not args.smoke and any(
        corpus["splits"][split]["speakers"] < count
        for split, count in [("train", 2), ("validation", 1), ("test", 1)]
    ):
        parser.error("At least four independent speakers required even for a pilot")
    if args.output.exists():
        parser.error("Output already exists; use a new run directory")
    # Imports intentionally follow corpus/access checks; no model download for invalid data.
    import numpy as np
    import torch
    from transformers import WhisperForConditionalGeneration, WhisperProcessor

    torch.set_num_threads(min(4, os.cpu_count() or 1))
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    random.seed(args.seed)
    if args.device == "cuda" and not torch.cuda.is_available():
        parser.error("CUDA requested but unavailable; no remote GPU is provisioned")
    identity = f"openai/whisper-{args.base}"
    revision = BASES[args.base]
    processor = WhisperProcessor.from_pretrained(
        identity, revision=revision, language="german", task="transcribe"
    )
    start_id = processor.tokenizer.convert_tokens_to_ids("<|startoftranscript|>")
    for row in records:
        ids = processor.tokenizer(row["text"]).input_ids
        if len(ids) - int(ids[0] == start_id) > 220:
            raise ValueError(
                "Every split must fit the shared 220-token evaluation budget"
            )
    model = WhisperForConditionalGeneration.from_pretrained(
        identity, revision=revision, use_safetensors=True
    ).to(args.device)
    model.config.use_cache = False
    model.generation_config.language = "de"
    model.generation_config.task = "transcribe"
    model.generation_config.forced_decoder_ids = None
    args.output.mkdir(parents=True)
    groups = {
        split: [r for r in records if r["split"] == split]
        for split in ["train", "validation", "test"]
    }

    def features(row):
        raw, _ = pcm(row["path"])
        samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768
        return processor.feature_extractor(
            samples,
            sampling_rate=16000,
            return_tensors="pt",
            return_attention_mask=True,
        )

    def evaluate(rows):
        model.eval()
        outputs = []
        with torch.inference_mode():
            for row in rows:
                batch = features(row)
                ids = model.generate(
                    batch.input_features.to(args.device),
                    attention_mask=batch.attention_mask.to(args.device),
                    max_new_tokens=220,
                    num_beams=5,
                    do_sample=False,
                )
                outputs.append(
                    processor.tokenizer.decode(ids[0], skip_special_tokens=True).strip()
                )
        return error_rates(
            [(r["text"], text) for r, text in zip(rows, outputs, strict=True)]
        ), outputs

    # The untouched baseline and final chosen checkpoint see the same test set.
    # Test results never select a checkpoint, step count or learning rate.
    baseline, base_outputs = evaluate(groups["test"])
    parameter = model.model.decoder.layers[-1].fc2.weight
    before = hashlib.sha256(parameter.detach().cpu().numpy().tobytes()).hexdigest()
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate)
    validation_history = []
    losses = []
    best = float("inf")
    order = list(range(len(groups["train"])))
    cursor = len(order)
    for step in range(1, args.steps + 1):
        model.train()
        optimizer.zero_grad(set_to_none=True)
        total_loss = 0
        for _ in range(args.accumulate):
            if cursor == len(order):
                random.shuffle(order)
                cursor = 0
            row = groups["train"][order[cursor]]
            cursor += 1
            batch = features(row)
            labels = processor.tokenizer(row["text"], return_tensors="pt").input_ids.to(
                args.device
            )
            if labels[0, 0] == model.config.decoder_start_token_id:
                labels = labels[:, 1:]
            if labels.shape[-1] > 220:
                raise ValueError(
                    "Reference exceeds the shared 220-token evaluation budget"
                )
            loss = (
                model(
                    input_features=batch.input_features.to(args.device), labels=labels
                ).loss
                / args.accumulate
            )
            if not torch.isfinite(loss):
                raise RuntimeError("Nonfinite training loss")
            loss.backward()
            total_loss += float(loss.detach())
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0, error_if_nonfinite=True)
        optimizer.step()
        losses.append(total_loss)
        print(json.dumps({"step": step, "loss": total_loss}), flush=True)
        if step % args.evaluate_every == 0 or step == args.steps:
            score, _ = evaluate(groups["validation"])
            validation_history.append({"step": step, **score})
            if score["wer"] < best:
                best = score["wer"]
                model.save_pretrained(
                    args.output / "checkpoint", safe_serialization=True
                )
                processor.save_pretrained(args.output / "checkpoint")
    del optimizer, model
    if args.device == "cuda":
        torch.cuda.empty_cache()
    model = WhisperForConditionalGeneration.from_pretrained(
        args.output / "checkpoint", use_safetensors=True
    ).to(args.device)
    candidate, outputs = evaluate(groups["test"])
    after = hashlib.sha256(
        model.model.decoder.layers[-1].fc2.weight.detach().cpu().numpy().tobytes()
    ).hexdigest()
    if before == after:
        raise RuntimeError("Training did not change the inspected weights")
    configuration = copy.deepcopy(vars(args))
    configuration["manifest"] = args.manifest.name
    configuration["output"] = args.output.name
    report = {
        "schema": 1,
        "purpose": "technical-smoke-only" if args.smoke else "zurich-asr-pilot",
        "base": identity,
        "revision": revision,
        "configuration": configuration,
        "corpus": corpus,
        "baseline_test": baseline,
        "candidate_test": candidate,
        "validation": validation_history,
        "losses": losses,
        "weights_changed": before != after,
        "weight_sha256_before": before,
        "weight_sha256_after": after,
        "gate": review_gate(corpus, baseline, candidate, args.smoke),
        "examples": [
            {"id": r["id"], "baseline": b, "candidate": c}
            for r, b, c in zip(groups["test"], base_outputs, outputs, strict=True)
        ],
        "limitations": [
            "Human provenance labels cannot be verified automatically",
            "Exact duplicate checks do not detect every paraphrase or re-encoding",
            "Minimum coverage and WER/CER gates do not replace listening tests on real Zurich meetings",
        ],
    }
    (args.output / "report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    )
    print(
        json.dumps(
            {"report": str(args.output / "report.json"), "gate": report["gate"]}
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
