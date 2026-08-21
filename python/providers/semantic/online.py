"""Online LLM semantic judge — wraps speech_answer.semantic_online."""

from __future__ import annotations

from typing import Any

from speech_answer.llm_config import llm_api_key, llm_base_url, llm_chat_model
from speech_answer.semantic_online import online_configured, online_semantic_score


class OnlineSemanticJudge:
    name = "online"

    def configured(self) -> bool:
        return online_configured()

    def score(self, transcript: str, expected: str) -> float | None:
        return online_semantic_score(transcript, expected)

    def status(self) -> dict[str, Any]:
        ok = self.configured()
        return {
            "provider": self.name,
            "configured": ok,
            "model": llm_chat_model() if ok else None,
            "base_url": llm_base_url() if ok else None,
            "key_suffix": (llm_api_key()[-4:] if ok and len(llm_api_key()) >= 4 else None),
        }
