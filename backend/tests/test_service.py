import json
import sys
import time
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parents[1]))
from service import create_app, CHUNK
from insights import validate_result, create_insights
from speakers import Speakers
from store import Store


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path, workers=False)) as client:
        yield client


def make(client, **values):
    response = client.post(
        "/v1/jobs", json={"kind": "transcription", "bytes": CHUNK + 3, **values}
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_upload_resume_integrity_pause_and_delete(client):
    token = make(client)
    assert (
        client.put(f"/v1/jobs/{token}/audio/0", content=b"a" * CHUNK).status_code == 200
    )
    assert client.get(f"/v1/jobs/{token}").json()["uploaded"] == [0]
    assert client.post(f"/v1/jobs/{token}/start").status_code == 409
    assert (
        client.put(f"/v1/jobs/{token}/audio/0", content=b"a" * CHUNK).status_code == 200
    )
    assert (
        client.put(f"/v1/jobs/{token}/audio/0", content=b"b" * CHUNK).status_code == 409
    )
    assert client.put(f"/v1/jobs/{token}/audio/1", content=b"end").status_code == 200
    assert client.post(f"/v1/jobs/{token}/start").json()["status"] == "queued"
    assert client.post(f"/v1/jobs/{token}/start").json()["status"] == "queued"
    path = client.app.state.service.store.root / token / "audio"
    assert path.read_bytes() == b"a" * CHUNK + b"end"
    assert client.post(f"/v1/jobs/{token}/pause").json()["status"] == "paused"
    assert client.post(f"/v1/jobs/{token}/start").json()["status"] == "queued"
    assert client.delete(f"/v1/jobs/{token}").status_code == 204
    assert client.get(f"/v1/jobs/{token}").status_code == 404
    assert not path.exists()


def test_validation_blocks_partial_oversized_and_invalid_jobs(client):
    assert (
        client.post(
            "/v1/jobs", json={"kind": "transcription", "bytes": 51 * 1024 * 1024}
        ).status_code
        == 400
    )
    assert (
        client.post("/v1/jobs", json={"kind": "transcription", "bytes": 0}).status_code
        == 400
    )
    assert (
        client.post("/v1/jobs", json={"kind": "analysis", "segments": []}).status_code
        == 400
    )
    assert (
        client.post(
            "/v1/jobs",
            json={"kind": "transcription", "bytes": 1, "prototypes": [[1, 2]]},
        ).status_code
        == 400
    )
    token = make(client, bytes=3)
    assert client.put(f"/v1/jobs/{token}/audio/0", content=b"ab").status_code == 400
    assert client.put(f"/v1/jobs/{token}/audio/1", content=b"abc").status_code == 400
    assert (
        client.put(f"/v1/jobs/{token}/audio/0", content=b"a" * (CHUNK + 1)).status_code
        == 413
    )
    assert client.get("/v1/jobs/not-a-token").status_code == 404
    assert (
        client.get(
            "/health", headers={"Origin": "https://treemonsal.github.io"}
        ).headers["access-control-allow-origin"]
        == "https://treemonsal.github.io"
    )
    assert (
        "access-control-allow-origin"
        not in client.get(
            "/health", headers={"Origin": "https://other.example"}
        ).headers
    )


def test_restart_preserves_completed_blocks_and_expires_files(tmp_path):
    store = Store(tmp_path)
    job = store.create({"kind": "transcription", "bytes": 1})
    store.patch(
        job["id"],
        status="processing",
        completedSeconds=60,
        segments=[{"text": "saved"}],
        prototypes=[[1, 0]],
    )
    recovered = Store(tmp_path).get(job["id"])
    assert recovered["status"] == "queued" and recovered["completedSeconds"] == 60
    assert recovered["segments"] == [{"text": "saved"}]
    store.patch(job["id"], expiresAt=time.time() - 1)
    store.cleanup()
    assert store.get(job["id"]) is None
    assert not (tmp_path / job["id"]).exists()


def test_speaker_labels_come_from_real_embeddings_not_text():
    speakers = Speakers()
    first, _ = speakers.identify(np.array([1, 0, 0]), 2)
    same, uncertain = speakers.identify(np.array([0.99, 0.01, 0]), 2)
    second, _ = speakers.identify(np.array([0, 1, 0]), 2)
    assert first == same == "Sprecher 1" and second == "Sprecher 2" and not uncertain
    assert speakers.identify(None, 0.5) == ("", True)
    restored = Speakers(speakers.state())
    assert restored.identify(np.array([0, 1, 0]), 2)[0] == "Sprecher 2"


def test_unsupported_claims_owners_and_dates_are_rejected():
    sources = [
        {"id": "s1", "text": "Timo schickt das Angebot bis Freitag.", "speaker": "Timo"}
    ]
    item = {
        "text": "Angebot senden",
        "segmentId": "s1",
        "quote": sources[0]["text"],
        "assignee": "Erfundene Person",
        "dueText": "2027-01-01",
    }
    result, rejected = validate_result(
        {
            "tasks": [
                item,
                {**item, "segmentId": "missing"},
                {**item, "quote": "erfundener Beleg"},
            ]
        },
        sources,
    )
    assert rejected == 2
    assert result["tasks"][0]["assignee"] == result["tasks"][0]["dueText"] == ""
    valid = {**item, "assignee": "Timo", "dueText": "Freitag"}
    assert (
        validate_result({"tasks": [valid]}, sources)[0]["tasks"][0]["dueText"]
        == "Freitag"
    )


def test_long_transcript_analysis_includes_the_last_part():
    sources = [
        {
            "id": f"s{i}",
            "text": f"Teil {i}. " + "Beleg aus diesem Gespräch. " * 220,
            "speaker": "",
        }
        for i in range(5)
    ]

    class TestModel:
        def generate(self, messages, schema):
            part = json.loads(messages[-1]["content"])["transcript"]
            item = part[-1]
            return json.dumps(
                {
                    "highlights": [
                        {
                            "text": "Belegter Punkt",
                            "segmentId": item["id"],
                            "quote": "Beleg aus diesem Gespräch.",
                            "assignee": "",
                            "dueText": "",
                        }
                    ],
                    "decisions": [],
                    "questions": [],
                    "tasks": [],
                }
            )

    result = create_insights(sources, TestModel())
    assert any(item["segmentId"] == "s4" for item in result["highlights"])
    assert len(result["highlights"]) >= 3


def test_queue_has_a_finite_capacity(client):
    for _ in range(12):
        make(client, bytes=1)
    assert (
        client.post("/v1/jobs", json={"kind": "transcription", "bytes": 1}).status_code
        == 429
    )


def test_single_paragraph_passages_preserve_canonical_source_and_constrain_ids():
    source = {
        "id": "one-source",
        "text": "Wir haben beschlossen, das Budget auf 3000 Franken zu begrenzen. Timo schickt das Angebot bis Freitag. Offen bleibt, ob der Kunde zustimmt.",
        "speaker": "",
    }

    class CheckedModel:
        def generate(self, messages, schema):
            passages = json.loads(messages[-1]["content"])["transcript"]
            assert len(passages) == 3
            assert schema["properties"]["tasks"]["items"]["properties"]["segmentId"][
                "enum"
            ] == ["s1", "s2", "s3"]
            return json.dumps(
                {
                    "highlights": [],
                    "decisions": [],
                    "questions": [],
                    "tasks": [
                        {
                            "text": "Das Angebot schicken.",
                            "segmentId": passages[1]["id"],
                            "quote": passages[1]["text"],
                            "assignee": "Timo",
                            "dueText": "Freitag",
                        }
                    ],
                }
            )

    result = create_insights([source], CheckedModel())
    assert result["tasks"][0]["assignee"] == "Timo"
    assert result["tasks"][0]["quote"] in source["text"]
