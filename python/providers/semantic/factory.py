"""Select semantic judge from env."""

from __future__ import annotations

import os
from typing import Any

from providers.base import SemanticJudge
from providers.semantic.off import OffSemanticJudge
from providers.semantic.online import OnlineSemanticJudge


def semantic_provider_name() -> str:
    raw = (
        os.environ.get("SPEECH_SEMANTIC_PROVIDER", "").strip()
        or os.environ.get("SPEECH_SEMANTIC_MODE", "").strip()
        or "online"
    )
    name = raw.lower()
    if name in ("0", "false", "none", "disabled"):
        return "off"
    if name in ("on", "1", "true"):
        return "online"
    return name  # online | offline | auto | off | …


def get_semantic_judge() -> SemanticJudge:
    """Cloud/LLM judges only. Local embedding stays in speech_answer.semantic."""
    name = semantic_provider_name()
    if name in ("off",):
        return OffSemanticJudge()
    if name in ("online", "qwen", "openai", "compatible"):
        return OnlineSemanticJudge()
    if name == "auto":
        online = OnlineSemanticJudge()
        return online if online.configured() else OffSemanticJudge()
    # Unknown cloud name → try online if key present
    online = OnlineSemanticJudge()
    return online if online.configured() else OffSemanticJudge()


def semantic_provider_status() -> dict[str, Any]:
    judge = get_semantic_judge()
    st = judge.status()
    st["provider"] = getattr(judge, "name", semantic_provider_name())
    st["requested"] = semantic_provider_name()
    return st
