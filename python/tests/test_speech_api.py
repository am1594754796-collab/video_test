"""API smoke tests for question bank (default answers.json)."""

from fastapi.testclient import TestClient

import server


def _default_client(monkeypatch):
    monkeypatch.delenv("SPEECH_ANSWERS_PATH", raising=False)
    server._bank = None
    server._active_path = None
    return TestClient(server.app)


def test_speech_questions(monkeypatch):
    client = _default_client(monkeypatch)
    res = client.get("/api/speech/questions")
    assert res.status_code == 200
    data = res.json()
    ids = {q["id"] for q in data["questions"]}
    assert "Q1" in ids
    assert "Q2" in ids
    assert "has_audio" in data["questions"][0]


def test_health_prebuilt_mode(monkeypatch):
    client = _default_client(monkeypatch)
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["tts_mode"] == "prebuilt"
