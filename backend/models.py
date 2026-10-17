"""CPU-only, real inference. Fixed model revisions; no paid inference API."""

import hashlib
import json
import os
import threading
import urllib.request
from pathlib import Path

ROOT = Path(os.environ.get("MURMUR_MODEL_DIR", "/tmp/murmur-models"))
THREADS = max(1, min(4, int(os.environ.get("MURMUR_THREADS", "2"))))
WHISPER_REV = "536b0662742c02347bc0e980a01041f333bce120"
QWEN_REV = "bb5d59e06d9551d752d08b292a50eb208b07ab1f"
FILES = [
    (
        "whisper/config.json",
        f"https://huggingface.co/Systran/faster-whisper-small/resolve/{WHISPER_REV}/config.json",
        "git:e5047537059bd8f182d9ca64c470201585015187",
    ),
    (
        "whisper/model.bin",
        f"https://huggingface.co/Systran/faster-whisper-small/resolve/{WHISPER_REV}/model.bin",
        "3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671",
    ),
    (
        "whisper/tokenizer.json",
        f"https://huggingface.co/Systran/faster-whisper-small/resolve/{WHISPER_REV}/tokenizer.json",
        "git:7818adb6de9fa3064d3ff81226fdd675be1f6344",
    ),
    (
        "whisper/vocabulary.txt",
        f"https://huggingface.co/Systran/faster-whisper-small/resolve/{WHISPER_REV}/vocabulary.txt",
        "git:c9074644d9d1205686f16d411564729461324b75",
    ),
    (
        "qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf",
        f"https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/{QWEN_REV}/qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf",
        "dfce12e3862a5283ccfb88221b48480e58745165de856439950d0f22590580db",
    ),
    (
        "qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf",
        f"https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/{QWEN_REV}/qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf",
        "539cf93f78e887edea1c04e2d7d8cdaca9d01dae9c9025bcb8accbe29df3d72a",
    ),
]


def file_hash(path, expected):
    if expected.startswith("git:"):
        data = path.read_bytes()
        return (
            hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()
            == expected[4:]
        )
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for part in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(part)
    return digest.hexdigest() == expected


def download(name, url, checksum):
    target = ROOT / name
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and file_hash(target, checksum):
        return target
    pending = target.with_name(
        target.name + f".{os.getpid()}.{threading.get_ident()}.partial"
    )
    try:
        with (
            urllib.request.urlopen(url, timeout=180) as response,
            pending.open("wb") as output,
        ):
            while block := response.read(1024 * 1024):
                output.write(block)
        if not file_hash(pending, checksum):
            raise RuntimeError(f"Model checksum mismatch: {name}")
        pending.replace(target)
    finally:
        pending.unlink(missing_ok=True)
    return target


def prepare():
    manifest = json.loads((Path(__file__).with_name("speaker-model.json")).read_text())
    for entry in FILES + [(manifest["name"], manifest["url"], manifest["sha256"])]:
        print("Preparing model:", entry[0], flush=True)
        download(*entry)


class Models:
    def __init__(self):
        self.asr = None
        self.speaker = None
        self.llm = None
        self.diarizer = None

    def speech(self):
        if self.asr is None:
            for entry in FILES[:4]:
                download(*entry)
            from faster_whisper import WhisperModel

            self.asr = WhisperModel(
                str(ROOT / "whisper"),
                device="cpu",
                compute_type="int8",
                cpu_threads=THREADS,
            )
        return self.asr

    def embedding(self, samples):
        import numpy as np

        if self.speaker is None:
            import sherpa_onnx

            entry = json.loads(
                Path(__file__).with_name("speaker-model.json").read_text()
            )
            path = download(entry["name"], entry["url"], entry["sha256"])
            self.speaker = sherpa_onnx.SpeakerEmbeddingExtractor(
                sherpa_onnx.SpeakerEmbeddingExtractorConfig(
                    model=str(path), num_threads=THREADS, provider="cpu"
                )
            )
        stream = self.speaker.create_stream()
        stream.accept_waveform(
            sample_rate=16000, waveform=np.ascontiguousarray(samples)
        )
        stream.input_finished()
        if not self.speaker.is_ready(stream):
            return None
        return np.asarray(self.speaker.compute(stream), dtype=np.float32)

    def diarize(self, samples):
        import sherpa_onnx
        import tarfile

        if self.diarizer is None:
            entry = json.loads(
                Path(__file__).with_name("segmentation-model.json").read_text()
            )
            path = ROOT / "segmentation.onnx"
            if not path.exists() or not file_hash(path, entry["sha256"]):
                archive = download(
                    "segmentation.tar.bz2", entry["url"], entry["archiveSha256"]
                )
                with tarfile.open(archive, "r:bz2") as source:
                    data = source.extractfile(entry["member"]).read()
                if hashlib.sha256(data).hexdigest() != entry["sha256"]:
                    raise RuntimeError("Segmentation model checksum mismatch")
                pending = path.with_suffix(".partial")
                pending.write_bytes(data)
                pending.replace(path)
            voice = json.loads(
                Path(__file__).with_name("speaker-model.json").read_text()
            )
            speaker = download(voice["name"], voice["url"], voice["sha256"])
            config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
                segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
                    pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(
                        model=str(path), window_shift_ratio=0.1
                    ),
                    num_threads=THREADS,
                ),
                embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(
                    model=str(speaker), num_threads=THREADS
                ),
                clustering=sherpa_onnx.FastClusteringConfig(
                    num_clusters=-1, threshold=0.65
                ),
                min_duration_on=0.3,
                min_duration_off=0.5,
            )
            if not config.validate():
                raise RuntimeError("Invalid diarization model config")
            self.diarizer = sherpa_onnx.OfflineSpeakerDiarization(config)
        return self.diarizer.process(samples).sort_by_start_time()

    def text_model(self):
        if self.llm is None:
            from llama_cpp import Llama

            for entry in FILES[4:]:
                download(*entry)
            path = ROOT / FILES[4][0]
            self.llm = Llama(
                model_path=str(path),
                n_ctx=8192,
                n_threads=THREADS,
                n_batch=256,
                verbose=False,
            )
        return self.llm

    def token_count(self, text):
        return len(self.text_model().tokenize(text.encode("utf-8")))

    def generate(self, messages, schema):
        return self.text_model().create_chat_completion(
            messages=messages,
            temperature=0,
            max_tokens=2000,
            response_format={"type": "json_object", "schema": schema},
        )["choices"][0]["message"]["content"]


models = Models()
if __name__ == "__main__":
    prepare()
