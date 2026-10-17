import json
import secrets
import sqlite3
import threading
import time
from pathlib import Path


class Store:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.connection = sqlite3.connect(
            self.root / "jobs.sqlite", check_same_thread=False
        )
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute(
            "CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, data TEXT NOT NULL)"
        )
        self.connection.commit()
        for job in self.all():
            if job["status"] == "processing":
                self.patch(
                    job["id"], status="queued", message="Nach Neustart fortsetzen"
                )

    def all(self):
        with self.lock:
            return [
                json.loads(row[0])
                for row in self.connection.execute("SELECT data FROM jobs")
            ]

    def get(self, token):
        if (
            not isinstance(token, str)
            or not 32 <= len(token) <= 64
            or any(
                c
                not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"
                for c in token
            )
        ):
            return None
        with self.lock:
            row = self.connection.execute(
                "SELECT data FROM jobs WHERE id=?", (token,)
            ).fetchone()
            return json.loads(row[0]) if row else None

    def create(self, payload):
        with self.lock:
            if len(self.all()) >= 12:
                raise ValueError(
                    "Der Dienst ist ausgelastet. Bitte versuche es später."
                )
            token = secrets.token_urlsafe(32)
            job = {
                "id": token,
                "kind": payload["kind"],
                "payload": payload,
                "status": "uploading"
                if payload["kind"] == "transcription"
                else "queued",
                "completedSeconds": payload.get("startAt", 0),
                "segments": [],
                "prototypes": payload.get("prototypes", []),
                "message": "Bereit für Upload"
                if payload["kind"] == "transcription"
                else "In der Warteschlange",
                "createdAt": time.time(),
                "expiresAt": time.time() + 86400,
                "error": "",
                "insights": None,
            }
            self.connection.execute(
                "INSERT INTO jobs VALUES (?,?)", (token, json.dumps(job))
            )
            self.connection.commit()
            (self.root / token).mkdir()
            return job

    def patch(self, token, **values):
        with self.lock:
            job = self.get(token)
            if not job:
                return None
            job.update(values)
            self.connection.execute(
                "UPDATE jobs SET data=? WHERE id=?", (json.dumps(job), token)
            )
            self.connection.commit()
            return job

    def claim(self):
        with self.lock:
            for job in self.all():
                if job["status"] == "queued":
                    return self.patch(
                        job["id"],
                        status="processing",
                        error="",
                        message="Modelle vorbereiten",
                    )
        return None

    def remove(self, token):
        import shutil

        with self.lock:
            if not self.get(token):
                return
            self.connection.execute("DELETE FROM jobs WHERE id=?", (token,))
            self.connection.commit()
            shutil.rmtree(self.root / token, ignore_errors=True)

    def cleanup(self):
        for job in self.all():
            if job["expiresAt"] < time.time():
                self.remove(job["id"])
