"""API smoke tests for speech endpoints (no Whisper download)."""

from fastapi.testclient import TestClient

import server


client = TestClient(server.app)


def test_speech_questions():
    res = client.get("/api/speech/questions")
    assert res.status_code == 200
    data = res.json()
    ids = {q["id"] for q in data["questions"]}
    assert "Q1" in ids
    assert "Q2" in ids


def test_speech_match_text_pass():
    res = client.post(
        "/api/speech/match-text",
        json={"question_id": "Q1", "transcript": "北京"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["passed"] is True
    assert body["score"] >= 0.9


def test_speech_match_text_unknown():
    res = client.post(
        "/api/speech/match-text",
        json={"question_id": "NOPE", "transcript": "x"},
    )
    assert res.status_code == 404
