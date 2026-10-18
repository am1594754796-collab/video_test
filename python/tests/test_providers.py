"""Provider factory smoke tests (no network)."""

from providers.semantic.factory import get_semantic_judge, semantic_provider_name
from speech_answer.llm_config import llm_base_url, llm_chat_model


def test_classroom_defaults_without_model_env(monkeypatch):
    """Operators only set LLM_API_KEY; models/URL/providers stay built-in."""
    for key in (
        "LLM_BASE_URL",
        "LLM_CHAT_MODEL",
        "SPEECH_SEMANTIC_PROVIDER",
        "SPEECH_SEMANTIC_MODE",
        "SPEECH_LLM_BASE_URL",
        "SPEECH_LLM_MODEL",
    ):
        monkeypatch.delenv(key, raising=False)
    assert llm_base_url() == "https://dashscope.aliyuncs.com/compatible-mode/v1"
    assert llm_chat_model() == "qwen-plus"
    assert semantic_provider_name() == "online"


def test_semantic_provider_online_name(monkeypatch):
    monkeypatch.setenv("SPEECH_SEMANTIC_PROVIDER", "online")
    assert semantic_provider_name() == "online"
    assert get_semantic_judge().name == "online"


def test_semantic_provider_off(monkeypatch):
    monkeypatch.setenv("SPEECH_SEMANTIC_PROVIDER", "off")
    judge = get_semantic_judge()
    assert judge.name == "off"
    assert judge.score("a", "b") is None
