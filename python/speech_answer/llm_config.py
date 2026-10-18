"""Unified LLM / cloud API config (CosyVoice read-aloud).

Primary file: python/data/api.env  (gitignored)
Legacy file:  python/data/online.env (still loaded if present)

Operator-facing (api.env): only LLM_API_KEY.
Built-in: DashScope + cosyvoice-v2 (read-aloud). Chat model default remains
for any leftover semantic helpers; the read-aloud page does not call match.

Env overrides (developers / tests only): LLM_BASE_URL, LLM_CHAT_MODEL,
plus aliases SPEECH_LLM_* / VISION_LLM_API_KEY (key only).
"""

from __future__ import annotations

import os

_DEFAULT_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1"
_DEFAULT_CHAT = "qwen-plus"


def llm_api_key() -> str:
    return (
        os.environ.get("LLM_API_KEY", "").strip()
        or os.environ.get("VISION_LLM_API_KEY", "").strip()
        or os.environ.get("SPEECH_LLM_API_KEY", "").strip()
    )


def llm_base_url() -> str:
    return (
        os.environ.get("LLM_BASE_URL", "").strip()
        or os.environ.get("VISION_LLM_BASE_URL", "").strip()
        or os.environ.get("SPEECH_LLM_BASE_URL", "").strip()
        or _DEFAULT_BASE
    ).rstrip("/")


def llm_chat_model() -> str:
    return (
        os.environ.get("LLM_CHAT_MODEL", "").strip()
        or os.environ.get("SPEECH_LLM_MODEL", "").strip()
        or _DEFAULT_CHAT
    )


def llm_configured() -> bool:
    return bool(llm_api_key())


def llm_status() -> dict[str, object]:
    key = llm_api_key()
    return {
        "configured": bool(key),
        "base_url": llm_base_url() if key else None,
        "chat_model": llm_chat_model() if key else None,
        "key_suffix": key[-4:] if len(key) >= 4 else None,
    }
