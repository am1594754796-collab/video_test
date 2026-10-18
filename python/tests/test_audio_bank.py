"""Prebuilt audio paths + serve endpoint (no CosyVoice network)."""

from pathlib import Path

from fastapi.testclient import TestClient

import server
from speech_answer.audio_bank import (
    audio_dir_for_bank,
    has_question_audio,
    question_audio_path,
    raise_countdown_audio_path,
)


def test_audio_paths_next_to_bank(tmp_path: Path):
    bank = tmp_path / "answers.json"
    bank.write_text('{"questions":[]}', encoding="utf-8")
    assert audio_dir_for_bank(bank) == tmp_path / "audio"
    assert question_audio_path(bank, "Q1") == tmp_path / "audio" / "Q1.mp3"
    assert raise_countdown_audio_path(bank) == tmp_path / "audio" / "raise-countdown.mp3"
    assert has_question_audio(bank, "Q1") is False


def _reset_bank(monkeypatch, bank: Path) -> None:
    monkeypatch.setenv("SPEECH_ANSWERS_PATH", str(bank))
    server._bank = None
    server._active_path = None
    server._active_relative = "data/answers.json"


def test_speech_audio_serves_prebuilt_mp3(tmp_path: Path, monkeypatch):
    bank = tmp_path / "answers.json"
    bank.write_text(
        '{"questions":[{"id":"Q1","answer":"北京","prompt":"首都？","options":{"A":"北京"}}]}',
        encoding="utf-8",
    )
    audio = tmp_path / "audio"
    audio.mkdir()
    (audio / "Q1.mp3").write_bytes(b"ID3fake-q1")
    (audio / "raise-countdown.mp3").write_bytes(b"ID3fake-cd")

    _reset_bank(monkeypatch, bank)
    client = TestClient(server.app)
    q = client.get("/api/speech/questions")
    assert q.status_code == 200
    body = q.json()
    assert body["questions"][0]["has_audio"] is True
    assert body["has_raise_countdown_audio"] is True

    res = client.get("/api/speech/audio/Q1")
    assert res.status_code == 200
    assert res.content == b"ID3fake-q1"
    assert res.headers["content-type"].startswith("audio/mpeg")

    cd = client.get("/api/speech/audio/raise-countdown")
    assert cd.status_code == 200
    assert cd.content == b"ID3fake-cd"
    monkeypatch.delenv("SPEECH_ANSWERS_PATH", raising=False)
    server._bank = None
    server._active_path = None


def test_speech_audio_missing_file(tmp_path: Path, monkeypatch):
    bank = tmp_path / "answers.json"
    bank.write_text(
        '{"questions":[{"id":"Q1","answer":"北京","prompt":"首都？"}]}',
        encoding="utf-8",
    )
    _reset_bank(monkeypatch, bank)

    res = TestClient(server.app).get("/api/speech/audio/Q1")
    assert res.status_code == 404
    assert "prebuild_audio" in res.json()["detail"]
    monkeypatch.delenv("SPEECH_ANSWERS_PATH", raising=False)
    server._bank = None
    server._active_path = None
