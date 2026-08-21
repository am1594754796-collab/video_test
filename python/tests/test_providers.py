"""Provider factory smoke tests (no network)."""

from providers.face.factory import get_face_detector, face_provider_name
from providers.semantic.factory import get_semantic_judge, semantic_provider_name
from speech_answer.llm_config import llm_base_url, llm_chat_model, llm_vision_model


def test_classroom_defaults_without_model_env(monkeypatch):
    """Operators only set LLM_API_KEY; models/URL/providers stay built-in."""
    for key in (
        "LLM_BASE_URL",
        "LLM_CHAT_MODEL",
        "LLM_VISION_MODEL",
        "VISION_FACE_PROVIDER",
        "VISION_FACE_MODE",
        "SPEECH_SEMANTIC_PROVIDER",
        "SPEECH_SEMANTIC_MODE",
        "SPEECH_LLM_BASE_URL",
        "VISION_LLM_BASE_URL",
        "SPEECH_LLM_MODEL",
        "VISION_LLM_MODEL",
    ):
        monkeypatch.delenv(key, raising=False)
    assert llm_base_url() == "https://dashscope.aliyuncs.com/compatible-mode/v1"
    assert llm_chat_model() == "qwen-plus"
    assert llm_vision_model() == "qwen-vl-plus"
    assert face_provider_name() == "qwen"
    assert semantic_provider_name() == "online"


def test_face_provider_off(monkeypatch):
    monkeypatch.setenv("VISION_FACE_PROVIDER", "off")
    monkeypatch.delenv("VISION_FACE_MODE", raising=False)
    assert face_provider_name() == "off"
    det = get_face_detector()
    assert det.name == "off"
    assert det.configured() is False
    assert det.detect("aaaa") == []


def test_face_provider_qwen_without_key(monkeypatch):
    monkeypatch.setenv("VISION_FACE_PROVIDER", "qwen")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("VISION_LLM_API_KEY", raising=False)
    monkeypatch.delenv("SPEECH_LLM_API_KEY", raising=False)
    det = get_face_detector()
    assert det.name == "qwen"
    assert det.configured() is False


def test_semantic_provider_online_name(monkeypatch):
    monkeypatch.setenv("SPEECH_SEMANTIC_PROVIDER", "online")
    assert semantic_provider_name() == "online"
    assert get_semantic_judge().name == "online"


def test_semantic_provider_off(monkeypatch):
    monkeypatch.setenv("SPEECH_SEMANTIC_PROVIDER", "off")
    judge = get_semantic_judge()
    assert judge.name == "off"
    assert judge.score("a", "b") is None
