"""Tests for online LLM semantic judge (mocked HTTP)."""

import json

import httpx
import pytest

from speech_answer import semantic_online


class _FakeResponse:
    def __init__(self, payload: dict):
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._payload


class _FakeClient:
    def __init__(self, payload: dict):
        self._payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def post(self, *args, **kwargs):
        return _FakeResponse(self._payload)


def test_online_semantic_paraphrase(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://example.test/v1")
    monkeypatch.setenv("LLM_CHAT_MODEL", "qwen-plus")
    content = json.dumps({"score": 0.94, "passed": True, "reason": "同义"}, ensure_ascii=False)
    payload = {"choices": [{"message": {"content": content}}]}
    monkeypatch.setattr(httpx, "Client", lambda timeout=30.0: _FakeClient(payload))

    score = semantic_online.online_semantic_score(
        "绿色植物在光下把水和二氧化碳变成有机物并放出氧气",
        "植物利用阳光把二氧化碳和水转化成有机物并释放氧气",
    )
    assert score == pytest.approx(0.94)


def test_online_without_key_returns_none(monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("SPEECH_LLM_API_KEY", raising=False)
    monkeypatch.delenv("VISION_LLM_API_KEY", raising=False)
    assert semantic_online.online_semantic_score("a", "b") is None
