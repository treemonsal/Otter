import math
import os
import threading
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from insights import create_insights
from models import models
from speakers import Speakers, transcribe_block
from store import Store

CHUNK = 2 * 1024 * 1024
MAX_BYTES = 50 * 1024 * 1024
LANGUAGES = {"auto", "de", "en", "fr", "it"}


class Source(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=100)
    text: str = Field(max_length=100000)
    speaker: str = Field(default="", max_length=100)
    start: float = Field(ge=0, le=3600)
    end: float = Field(ge=0, le=3600)


class JobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    kind: str
    bytes: int = Field(default=0, ge=0, le=MAX_BYTES)
    language: str = "auto"
    startAt: float = Field(default=0, ge=0, lt=3600)
    prototypes: list[list[float]] = Field(default_factory=list, max_length=20)
    segments: list[Source] = Field(default_factory=list, max_length=10000)


class Paused(Exception):
    pass


class Service:
    def __init__(self, root, inference=models):
        self.store = Store(root)
        self.models = inference
        self.stopped = threading.Event()

    def active(self, token):
        current = self.store.get(token)
        if not current or current["status"] != "processing":
            raise Paused()
        return current

    def run(self, job):
        token = job["id"]
        try:
            if job["kind"] == "analysis":

                def progress(message):
                    self.active(token)
                    self.store.patch(token, message=message)

                result = create_insights(
                    job["payload"]["segments"], self.models, progress
                )
                self.active(token)
                self.store.patch(
                    token,
                    status="complete",
                    insights=result,
                    message="KI-Auswertung abgeschlossen",
                )
                return
            from faster_whisper.audio import decode_audio

            audio = decode_audio(
                str(self.store.root / token / "audio"), sampling_rate=16000
            )
            duration = len(audio) / 16000
            if not 0.25 <= duration <= 3600.05:
                raise ValueError(
                    "Die Aufnahme muss zwischen 0,25 Sekunden und 60 Minuten lang sein."
                )
            speakers = Speakers(job["prototypes"])
            position = min(duration, job["completedSeconds"])
            while position < duration:
                self.active(token)
                end = min(duration, position + 60)
                self.store.patch(
                    token,
                    message=f"Sprache und Sprecher · {int(position)} / {int(duration)} Sekunden",
                    duration=duration,
                )
                segments = transcribe_block(
                    audio[int(position * 16000) : int(end * 16000)],
                    position,
                    job["payload"]["language"],
                    speakers,
                    self.models,
                )
                for segment in segments:
                    segment["id"] = uuid.uuid4().hex
                # Persist a complete block before moving forward; pauses retain completed work.
                latest = self.store.get(token)
                if not latest:
                    return
                self.store.patch(
                    token,
                    segments=latest["segments"] + segments,
                    completedSeconds=end,
                    prototypes=speakers.state(),
                )
                position = end
            self.active(token)
            self.store.patch(
                token,
                status="complete",
                duration=duration,
                message="Transkript und Sprecher gespeichert",
            )
        except Paused:
            return
        except Exception as error:
            # Never log transcript, audio, bearer IDs or model prompts.
            message = (
                str(error)
                if isinstance(error, ValueError)
                else "Die Verarbeitung ist fehlgeschlagen. Du kannst den Auftrag fortsetzen."
            )
            self.store.patch(token, status="error", error=message, message=message)

    def loop(self):
        while not self.stopped.is_set():
            self.store.cleanup()
            job = self.store.claim()
            if job:
                self.run(job)
            else:
                self.stopped.wait(1)


async def body(request, limit):
    chunks = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise HTTPException(413, "Die Anfrage ist zu gross.")
        chunks.append(chunk)
    return b"".join(chunks)


def create_app(root=None, inference=models, workers=True):
    service = Service(
        root or os.environ.get("MURMUR_DATA_DIR", "/tmp/murmur-data"), inference
    )

    @asynccontextmanager
    async def lifespan(app):
        thread = threading.Thread(target=service.loop, daemon=True)
        if workers:
            thread.start()
        yield
        service.stopped.set()

    app = FastAPI(title="Murmur AI", version="1.3.0", lifespan=lifespan)
    origins = os.environ.get("MURMUR_ORIGINS", "https://treemonsal.github.io").split(
        ","
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type"],
        allow_credentials=False,
    )
    app.state.service = service

    def get(token):
        job = service.store.get(token)
        if not job:
            raise HTTPException(
                404,
                "Dieser Auftrag ist abgelaufen. Die App kann ihn aus dem gespeicherten Audio neu beginnen.",
            )
        return job

    def public(job):
        token = job["id"]
        payload = job["payload"]
        result = {key: value for key, value in job.items() if key != "payload"}
        if job["kind"] == "transcription":
            count = math.ceil(payload["bytes"] / CHUNK)
            ready = (service.store.root / token / "audio").exists()
            result["uploaded"] = [
                i
                for i in range(count)
                if ready or (service.store.root / token / f"{i}.part").exists()
            ]
        return result

    @app.get("/health")
    def health():
        return {
            "service": "murmur-ai",
            "version": 1,
            "capabilities": ["transcription", "speakers", "insights"],
            "maxSeconds": 3600,
            "maxBytes": MAX_BYTES,
            "chunkBytes": CHUNK,
            "retentionHours": 24,
            "models": {
                "speech": "Whisper small int8",
                "speakers": "WeSpeaker VoxCeleb CAM++ LM",
                "insights": "Qwen2.5-7B-Instruct",
            },
        }

    @app.post("/v1/jobs", status_code=201)
    async def create(request: Request):
        try:
            payload = JobRequest.model_validate_json(
                await body(request, 1024 * 1024)
            ).model_dump()
        except ValidationError:
            raise HTTPException(400, "Ungültiger Auftrag.")
        if (
            payload["kind"] not in ["transcription", "analysis"]
            or payload["language"] not in LANGUAGES
        ):
            raise HTTPException(400, "Unbekannte Verarbeitung oder Sprache.")
        if payload["kind"] == "transcription" and payload["bytes"] < 1:
            raise HTTPException(400, "Keine Aufnahme vorhanden.")
        if any(
            len(p) != 512 or any(not math.isfinite(x) for x in p)
            for p in payload["prototypes"]
        ):
            raise HTTPException(400, "Ungültiger Sprecher-Zwischenstand.")
        if payload["kind"] == "analysis" and (
            not payload["segments"]
            or sum(len(s["text"]) for s in payload["segments"]) > 200000
            or len({s["id"] for s in payload["segments"]}) != len(payload["segments"])
            or any(s["end"] < s["start"] for s in payload["segments"])
        ):
            raise HTTPException(
                400, "Das Transkript fehlt oder überschreitet die sichere Grösse."
            )
        service.store.cleanup()
        try:
            return public(service.store.create(payload))
        except ValueError as error:
            raise HTTPException(429, str(error))

    @app.get("/v1/jobs/{token}")
    def status(token: str):
        return public(get(token))

    @app.put("/v1/jobs/{token}/audio/{index}")
    async def upload(token: str, index: int, request: Request):
        job = get(token)
        if job["kind"] != "transcription" or job["status"] != "uploading":
            raise HTTPException(409, "Der Auftrag verarbeitet bereits Audio.")
        size = job["payload"]["bytes"]
        count = math.ceil(size / CHUNK)
        if not 0 <= index < count:
            raise HTTPException(400, "Ungültiger Audioabschnitt.")
        value = await body(request, CHUNK)
        if len(value) != min(CHUNK, size - index * CHUNK):
            raise HTTPException(400, "Audioabschnitt unvollständig.")
        target = service.store.root / token / f"{index}.part"
        with service.store.lock:
            get(token)
            if target.exists() and target.read_bytes() != value:
                raise HTTPException(
                    409, "Der Audioabschnitt passt nicht zum bisherigen Upload."
                )
            pending = target.with_suffix(".pending")
            pending.write_bytes(value)
            pending.replace(target)
        return {"index": index, "received": len(value)}

    @app.post("/v1/jobs/{token}/start")
    def start(token: str):
        with service.store.lock:
            job = get(token)
            if job["status"] == "uploading":
                path = service.store.root / token
                count = math.ceil(job["payload"]["bytes"] / CHUNK)
                if any(not (path / f"{i}.part").exists() for i in range(count)):
                    raise HTTPException(
                        409, "Es fehlen Audioabschnitte. Setze den Upload fort."
                    )
                with (path / "audio.pending").open("wb") as output:
                    for index in range(count):
                        output.write((path / f"{index}.part").read_bytes())
                (path / "audio.pending").replace(path / "audio")
                for index in range(count):
                    (path / f"{index}.part").unlink()
            elif job["status"] in ["queued", "processing", "complete"]:
                return public(job)
            return public(
                service.store.patch(
                    token, status="queued", error="", message="In der Warteschlange"
                )
            )

    @app.post("/v1/jobs/{token}/pause")
    def pause(token: str):
        with service.store.lock:
            job = get(token)
            if job["status"] not in ["complete", "uploading"]:
                job = service.store.patch(
                    token,
                    status="paused",
                    message="Pausiert; abgeschlossene Abschnitte bleiben erhalten",
                )
            return public(job)

    @app.delete("/v1/jobs/{token}", status_code=204)
    def remove(token: str):
        service.store.remove(token)

    return app


app = create_app()
