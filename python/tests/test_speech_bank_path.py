"""API tests for answer-bank relative path switching."""

from fastapi.testclient import TestClient

import server


client = TestClient(server.app)


def test_speech_bank_default_relative():
    # Reset module cache between tests
    server._bank = None
    server._active_path = None
    res = client.get("/api/speech/bank")
    assert res.status_code == 200
    body = res.json()
    assert body["relative_path"].replace("\\", "/").endswith("data/answers.json")
    assert any(q["id"] == "Q1" for q in body["questions"])


def test_speech_set_bank_relative_sample():
    server._bank = None
    res = client.post(
        "/api/speech/bank",
        json={"path": "data/answers.sample.json", "persist": False},
    )
    assert res.status_code == 200
    body = res.json()
    assert "answers.sample.json" in body["relative_path"].replace("\\", "/")
    assert len(body["questions"]) >= 1


def test_speech_set_bank_missing():
    res = client.post(
        "/api/speech/bank",
        json={"path": "data/does-not-exist.json", "persist": False},
    )
    assert res.status_code == 404
