"""Qwen-VL (OpenAI-compatible) face detection for classroom seat binding.

Configured via python/data/api.env (unified):

  LLM_API_KEY=sk-...
  LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
  LLM_VISION_MODEL=qwen-vl-plus
  VISION_FACE_MODE=qwen
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx

from speech_answer.llm_config import llm_api_key, llm_base_url, llm_vision_model

_JSON_RE = re.compile(r"\{[\s\S]*\}")


def _provider_name() -> str:
    """VISION_FACE_PROVIDER preferred; legacy VISION_FACE_MODE still works."""
    raw = (
        os.environ.get("VISION_FACE_PROVIDER", "").strip()
        or os.environ.get("VISION_FACE_MODE", "").strip()
        or "qwen"
    )
    return raw.lower()


def _cfg() -> dict[str, str]:
    mode = _provider_name()
    return {
        "api_key": llm_api_key(),
        "base_url": llm_base_url(),
        "model": llm_vision_model(),
        "mode": mode,
    }


def vision_face_configured() -> bool:
    cfg = _cfg()
    if cfg["mode"] in ("off", "none", "disabled"):
        return False
    # Any active provider name still needs a key (qwen / future openai, etc.)
    return bool(cfg["api_key"]) and cfg["mode"] not in ("",)


def vision_face_status() -> dict[str, Any]:
    cfg = _cfg()
    return {
        "mode": cfg["mode"],
        "provider": cfg["mode"],
        "configured": vision_face_configured(),
        "model": cfg["model"] if cfg["api_key"] else None,
        "base_url": cfg["base_url"] if cfg["api_key"] else None,
    }


def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, v))


def _as_unit(vals: list[float]) -> list[float]:
    """Map Qwen coords to [0,1]. VL often returns 0–1, 0–100, or pixel-ish values."""
    peak = max((abs(v) for v in vals), default=0.0)
    if peak <= 1.5:
        scale = 1.0
    elif peak <= 100.0:
        scale = 100.0
    else:
        scale = 960.0
    return [_clamp01(v / scale) for v in vals]


def _normalize_face(raw: dict[str, Any]) -> dict[str, float] | None:
    try:
        if all(k in raw for k in ("x_min", "y_min", "width", "height")):
            x_min, y_min, width, height = _as_unit(
                [
                    float(raw["x_min"]),
                    float(raw["y_min"]),
                    float(raw["width"]),
                    float(raw["height"]),
                ]
            )
        elif all(k in raw for k in ("x1", "y1", "x2", "y2")):
            x1, y1, x2, y2 = _as_unit(
                [
                    float(raw["x1"]),
                    float(raw["y1"]),
                    float(raw["x2"]),
                    float(raw["y2"]),
                ]
            )
            x_min, y_min = min(x1, x2), min(y1, y2)
            width, height = abs(x2 - x1), abs(y2 - y1)
        else:
            return None
        if width < 0.02 or height < 0.02:
            return None
        score = float(raw.get("score", 0.9))
        if score > 1.0:
            score = score / 100.0
        return {
            "x_min": x_min,
            "y_min": y_min,
            "width": min(width, 1.0 - x_min),
            "height": min(height, 1.0 - y_min),
            "score": _clamp01(score),
            "cx": x_min + width / 2,
            "cy": y_min + height / 2,
        }
    except (TypeError, ValueError, KeyError):
        return None


def _parse_faces(text: str) -> list[dict[str, float]]:
    text = (text or "").strip()
    if not text:
        return []
    # Strip markdown fences if present.
    if "```" in text:
        text = re.sub(r"```(?:json)?", "", text).replace("```", "").strip()
    data: Any = None
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        m = _JSON_RE.search(text)
        if m:
            try:
                data = json.loads(m.group(0))
            except json.JSONDecodeError:
                data = None
    if data is None:
        return []
    raw_faces: list[Any]
    if isinstance(data, dict):
        raw_faces = data.get("faces") or data.get("people") or []
    elif isinstance(data, list):
        raw_faces = data
    else:
        return []
    out: list[dict[str, float]] = []
    for item in raw_faces:
        if not isinstance(item, dict):
            continue
        face = _normalize_face(item)
        if face:
            out.append(face)
    out.sort(key=lambda f: (f["cx"], f["cy"]))
    numbered: list[dict[str, float]] = []
    for i, face in enumerate(out, start=1):
        item = dict(face)
        item["index"] = i
        numbered.append(item)
    return numbered


def parse_faces_response(text: str) -> list[dict[str, float]]:
    """Public helper for unit tests."""
    return _parse_faces(text)


def detect_faces_qwen(
    image_base64: str,
    *,
    max_faces: int = 6,
    mime: str = "image/jpeg",
) -> list[dict[str, float]]:
    """Detect faces via Qwen-VL; return normalized boxes sorted left→right."""
    cfg = _cfg()
    if not cfg["api_key"]:
        raise RuntimeError("LLM_API_KEY not configured in python/data/api.env")

    b64 = image_base64.strip()
    if b64.startswith("data:"):
        # data:image/jpeg;base64,xxxx
        parts = b64.split(",", 1)
        b64 = parts[1] if len(parts) == 2 else b64
        if "image/" in parts[0]:
            mime = parts[0].split(";")[0].replace("data:", "") or mime

    prompt = (
        "这是教室画面（未镜像）。请检测每一个可见学生的人脸。"
        "编号规则（必须遵守）：按人脸中心的水平位置从左到右，"
        "画面最左边的人是 1 号，然后 2、3… 不要按远近、高低或返回顺序编号。"
        f"最多 {max_faces} 张脸。"
        "坐标必须是相对整图的 0 到 1（x=0 在画面左边缘，x=1 在右边缘）。"
        "只输出一行 JSON，不要其它文字："
        '{"faces":[{"x_min":0.1,"y_min":0.1,"width":0.12,"height":0.16,"score":0.95},...]}。'
        "faces 数组也请从左到右排列。若无人脸则 {\"faces\":[]}。"
    )

    url = f"{cfg['base_url']}/chat/completions"
    headers = {
        "Authorization": f"Bearer {cfg['api_key']}",
        "Content-Type": "application/json",
    }
    body = {
        "model": cfg["model"],
        "temperature": 0,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{b64}"},
                    },
                    {"type": "text", "text": prompt},
                ],
            }
        ],
    }

    with httpx.Client(timeout=45.0) as client:
        res = client.post(url, headers=headers, json=body)
        res.raise_for_status()
        payload = res.json()

    try:
        text = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"unexpected Qwen response: {payload!r}") from exc

    if isinstance(text, list):
        # Some providers return content parts.
        chunks = []
        for part in text:
            if isinstance(part, dict) and part.get("type") == "text":
                chunks.append(str(part.get("text", "")))
            elif isinstance(part, str):
                chunks.append(part)
        text = "\n".join(chunks)

    faces = _parse_faces(str(text))
    return faces[: max(1, max_faces)]
