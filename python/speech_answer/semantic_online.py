"""Online semantic judge for full-sentence answers (OpenAI-compatible Chat API).

Configured via environment (recommended file: python/data/online.env):

  SPEECH_SEMANTIC_MODE=online
  SPEECH_LLM_API_KEY=sk-...
  SPEECH_LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
  SPEECH_LLM_MODEL=qwen-turbo

Works with DashScope / DeepSeek / OpenAI and other OpenAI-compatible endpoints.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx

from speech_answer.fuzzy_match import MATCH_THRESHOLD

_DEFAULT_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1"
_DEFAULT_MODEL = "qwen-turbo"

_SCORE_RE = re.compile(r"(-?\d+(?:\.\d+)?)")


def _cfg() -> dict[str, str]:
    return {
        "api_key": os.environ.get("SPEECH_LLM_API_KEY", "").strip(),
        "base_url": os.environ.get("SPEECH_LLM_BASE_URL", _DEFAULT_BASE).strip().rstrip("/"),
        "model": os.environ.get("SPEECH_LLM_MODEL", _DEFAULT_MODEL).strip(),
    }


def online_configured() -> bool:
    return bool(_cfg()["api_key"])


def _extract_score(payload: dict[str, Any] | None, text: str) -> float | None:
    if isinstance(payload, dict):
        for key in ("score", "similarity", "置信度"):
            if key in payload:
                try:
                    v = float(payload[key])
                    if v > 1.0:
                        v = v / 100.0
                    return max(0.0, min(1.0, v))
                except (TypeError, ValueError):
                    pass
        if "passed" in payload and payload.get("score") is None:
            return 1.0 if payload["passed"] else 0.0

    # Fallback: first number in text
    m = _SCORE_RE.search(text or "")
    if not m:
        return None
    v = float(m.group(1))
    if v > 1.0:
        v = v / 100.0
    return max(0.0, min(1.0, v))


def online_semantic_score(transcript: str, expected: str) -> float | None:
    """Ask an online chat model how well transcript matches expected answer."""
    a = (transcript or "").strip()
    b = (expected or "").strip()
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0

    cfg = _cfg()
    if not cfg["api_key"]:
        return None

    system = (
        "你是教室抢答判题助手。根据「标准答案」判断「学生口头作答」语义是否答对。"
        "允许口语化、语序调整、同义转述；不允许答非所问。"
        "只输出一行 JSON，不要其它文字，格式："
        '{"score":0.0到1.0的小数,"passed":true或false,"reason":"极短说明"}。'
        f"score>={MATCH_THRESHOLD} 视为通过。"
    )
    user = f"标准答案：{b}\n学生作答：{a}"

    url = f"{cfg['base_url']}/chat/completions"
    headers = {
        "Authorization": f"Bearer {cfg['api_key']}",
        "Content-Type": "application/json",
    }
    body = {
        "model": cfg["model"],
        "temperature": 0,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }

    try:
        with httpx.Client(timeout=30.0) as client:
            res = client.post(url, headers=headers, json=body)
            res.raise_for_status()
            data = res.json()
        content = (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        content = (content or "").strip()
        parsed: dict[str, Any] | None = None
        try:
            # tolerate ```json fences
            if "```" in content:
                inner = content.split("```")[1]
                if inner.startswith("json"):
                    inner = inner[4:]
                content_json = inner.strip()
            else:
                content_json = content
            parsed = json.loads(content_json)
        except json.JSONDecodeError:
            # try substring object
            start = content.find("{")
            end = content.rfind("}")
            if start >= 0 and end > start:
                try:
                    parsed = json.loads(content[start : end + 1])
                except json.JSONDecodeError:
                    parsed = None
        return _extract_score(parsed, content)
    except Exception:  # noqa: BLE001 — fall back to lexical
        return None
