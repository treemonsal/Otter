import json, urllib.request, time, wave, tempfile
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import numpy as np
from faster_whisper.audio import decode_audio

host = "http://127.0.0.1:7860"


def request(path, data=None, method=None, raw=False):
    req = urllib.request.Request(
        host + path,
        data=data if raw else json.dumps(data).encode() if data is not None else None,
        method=method,
        headers={
            "Content-Type": "application/octet-stream" if raw else "application/json"
        },
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r) if r.status != 204 else None


fixture = Path(tempfile.gettempdir()) / "murmur-jfk.wav"
if not fixture.exists():
    with urllib.request.urlopen(
        "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav",
        timeout=30,
    ) as response:
        fixture.write_bytes(response.read())
x = decode_audio(str(fixture), sampling_rate=16000)
value = np.tile(x, 6)
with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as file:
    path = Path(file.name)
try:
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(16000)
        out.writeframes((np.clip(value, -1, 1) * 32767).astype("<i2").tobytes())
    body = path.read_bytes()
    job = request(
        "/v1/jobs", {"kind": "transcription", "bytes": len(body), "language": "en"}
    )["id"]
    base = "/v1/jobs/" + job
    count = (len(body) + 2 * 1024 * 1024 - 1) // (2 * 1024 * 1024)
    for i in range(count):
        request(
            base + f"/audio/{i}",
            body[i * 2 * 1024 * 1024 : (i + 1) * 2 * 1024 * 1024],
            method="PUT",
            raw=True,
        )
        assert request(base)["uploaded"] == list(range(i + 1))
    request(base + "/start", {}, method="POST")
    deadline = time.time() + 300
    seen = 0
    paused = False
    while time.time() < deadline:
        state = request(base)
        if state["completedSeconds"] != seen:
            seen = state["completedSeconds"]
            print("ACTUAL_LONG_CHECKPOINT", seen, flush=True)
        if state["status"] == "error":
            raise RuntimeError(state["error"])
        if (
            state["completedSeconds"] >= 60
            and not paused
            and state["status"] != "complete"
        ):
            request(base + "/pause", {}, method="POST")
            request(base + "/start", {}, method="POST")
            paused = True
        if state["status"] == "complete":
            assert state["completedSeconds"] > 60
            assert len({s["id"] for s in state["segments"]}) == len(state["segments"])
            assert any("country" in s["text"].lower() for s in state["segments"])
            assert state["prototypes"] and all(
                len(p) == 512 for p in state["prototypes"]
            )
            if len(state["prototypes"]) != 1:
                print(
                    "QUALITY_LIMIT: repeated historical JFK clip produced",
                    len(state["prototypes"]),
                    "anonymous groups for one voice; review/merge required",
                    flush=True,
                )
            print(
                "ACTUAL_LONG_JOB_PASSED",
                round(state["completedSeconds"], 2),
                "seconds,",
                len(state["segments"]),
                "segments,",
                len(state["prototypes"]),
                "persisted anonymous voice prototypes",
                flush=True,
            )
            request(base, method="DELETE")
            break
        time.sleep(2)
    else:
        raise RuntimeError("Long job timed out")
finally:
    path.unlink(missing_ok=True)
