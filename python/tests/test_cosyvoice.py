"""CosyVoice helpers used by prebuild (no live speak API)."""

import json

import httpx
import pytest

from speech_answer.answer_bank import QuestionRecord
from speech_answer.cosyvoice import audio_source, clamp_rate, synthesize, tts_http_url, tts_voice
from speech_answer.question_speech import build_question_speech_text


def test_speech_text_reads_stem_and_options_not_a_hidden_key():
    question = QuestionRecord(
        id="Q9",
        answer="标准答案机密",
        prompt="题干",
        options={"A": "甲", "C": "丙"},
    )
    text = build_question_speech_text(question)
    assert text == "题干。选项A，甲。选项C，丙"
    assert "标准答案机密" not in text


def test_speech_text_falls_back_to_question_id():
    question = QuestionRecord(id="Q8", answer="不会被念出")
    assert build_question_speech_text(question) == "题目 Q8"


def test_speech_text_expands_circled_numbers_for_voice():
    question = QuestionRecord(
        id="Q01", answer="B", prompt="①年金 ②养老年金",
        options={"A": "②③④", "B": "①②③"},
    )
    text = build_question_speech_text(question)
    assert "第一项，年金" in text
    assert "选项A，第二项、第三项、第四项" in text
    assert "选项B，第一项、第二项、第三项" in text
    assert "①" not in text and "②" not in text


def test_defaults_are_cosyvoice_v2(monkeypatch):
    monkeypatch.delenv("TTS_MODEL", raising=False)
    monkeypatch.delenv("TTS_VOICE", raising=False)
    monkeypatch.delenv("TTS_HTTP_URL", raising=False)
    monkeypatch.delenv("TTS_WORKSPACE_ID", raising=False)
    assert tts_voice() == "longxiaochun_v2"
    assert tts_http_url().endswith("/api/v1/services/audio/tts/SpeechSynthesizer")
    assert "dashscope.aliyuncs.com" in tts_http_url()


def test_workspace_and_cloned_voice(monkeypatch):
    monkeypatch.setenv("TTS_WORKSPACE_ID", "ws-123")
    monkeypatch.setenv("TTS_VOICE", "clone-voice-id")
    monkeypatch.delenv("TTS_HTTP_URL", raising=False)
    assert tts_http_url().startswith("https://ws-123.cn-beijing.maas.aliyuncs.com/")
    assert tts_voice() == "clone-voice-id"


def test_rate_is_clamped():
    assert clamp_rate(0.1) == 0.5
    assert clamp_rate(3) == 2.0
    assert clamp_rate(0.95) == 0.95


def test_audio_source_url_and_base64():
    url = audio_source({"output": {"audio": {"url": "https://cdn.example/a.mp3", "data": ""}}})
    assert url == "https://cdn.example/a.mp3"
    http_url = audio_source({"output": {"audio": {"url": "http://cdn.example/a.mp3", "data": ""}}})
    assert http_url == "http://cdn.example/a.mp3"
    raw = audio_source({"output": {"audio": {"data": "aGVsbG8="}}})
    assert raw == b"hello"


def test_synthesize_posts_rate_voice_and_downloads_mp3(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.delenv("TTS_MODEL", raising=False)
    monkeypatch.delenv("TTS_VOICE", raising=False)
    monkeypatch.setenv("TTS_HTTP_URL", "https://tts.example/api/v1/services/audio/tts/SpeechSynthesizer")

    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "tts.example":
            body = json.loads(request.content.decode())
            seen["body"] = body
            seen["auth"] = request.headers.get("authorization")
            return httpx.Response(
                200,
                json={"output": {"audio": {"url": "https://cdn.example/out.mp3", "data": ""}, "finish_reason": "stop"}},
            )
        if request.url.host == "cdn.example":
            return httpx.Response(200, content=b"mp3-bytes", headers={"content-type": "audio/mpeg"})
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    audio = synthesize("题干。选项A，甲", rate=1.2, client=client)
    assert audio == b"mp3-bytes"
    body = seen["body"]
    assert isinstance(body, dict)
    assert body["model"] == "cosyvoice-v2"
    assert body["input"]["voice"] == "longxiaochun_v2"
    assert body["input"]["rate"] == pytest.approx(1.2)
    assert seen["auth"] == "Bearer test-key"
