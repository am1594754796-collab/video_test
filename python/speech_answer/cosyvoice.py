"""CosyVoice non-streaming TTS via DashScope HTTP API.

Defaults target CosyVoice 2 (stable Chinese pronunciation, numeric rate,
system or cloned voice id). Official contract:
https://www.alibabacloud.com/help/en/model-studio/cosyvoice-tts-http-api
"""

from __future__ import annotations

import base64
import os
from typing import Any

import httpx

from speech_answer.llm_config import llm_api_key

_PATH = "/api/v1/services/audio/tts/SpeechSynthesizer"
_CLASSIC_URL = f"https://dashscope.aliyuncs.com{_PATH}"
_DEFAULT_MODEL = "cosyvoice-v2"
_DEFAULT_VOICES = {
    "cosyvoice-v2": "longxiaochun_v2",
    "cosyvoice-v3-flash": "longanyang",
    "cosyvoice-v3-plus": "longanyang",
}
_RATE_MIN = 0.5
_RATE_MAX = 2.0


class CosyVoiceError(RuntimeError):
    """DashScope CosyVoice request failed."""


def tts_model() -> str:
    return os.environ.get("TTS_MODEL", "").strip() or _DEFAULT_MODEL


def tts_voice() -> str:
    explicit = os.environ.get("TTS_VOICE", "").strip()
    if explicit:
        return explicit
    return _DEFAULT_VOICES.get(tts_model(), "longxiaochun_v2")


def tts_http_url() -> str:
    explicit = os.environ.get("TTS_HTTP_URL", "").strip()
    if explicit:
        return explicit
    workspace = os.environ.get("TTS_WORKSPACE_ID", "").strip()
    if workspace:
        return f"https://{workspace}.cn-beijing.maas.aliyuncs.com{_PATH}"
    return _CLASSIC_URL


def clamp_rate(rate: float) -> float:
    return max(_RATE_MIN, min(_RATE_MAX, float(rate)))


def tts_status() -> dict[str, object]:
    return {
        "configured": bool(llm_api_key()),
        "model": tts_model(),
        "voice": tts_voice(),
        "endpoint": tts_http_url(),
    }


def _error_message(payload: dict[str, Any], status: int) -> str:
    message = payload.get("message") or payload.get("code")
    if isinstance(message, str) and message.strip():
        return message.strip()
    return f"CosyVoice HTTP {status}"


def audio_source(payload: dict[str, Any]) -> bytes | str:
    """Return raw audio bytes, or an https URL to download."""
    output = payload.get("output")
    if not isinstance(output, dict):
        raise CosyVoiceError(_error_message(payload, 200))
    audio = output.get("audio")
    if not isinstance(audio, dict):
        raise CosyVoiceError("CosyVoice 响应缺少音频")
    data = audio.get("data")
    if isinstance(data, str) and data.strip():
        try:
            raw = base64.b64decode(data, validate=True)
        except Exception as exc:  # noqa: BLE001
            raise CosyVoiceError("CosyVoice 音频数据无法解码") from exc
        if raw:
            return raw
    url = audio.get("url")
    if isinstance(url, str) and url.startswith(("https://", "http://")):
        return url
    raise CosyVoiceError("CosyVoice 未返回音频")


def synthesize(
    text: str,
    *,
    rate: float = 0.95,
    client: httpx.Client | None = None,
    timeout: float = 60.0,
) -> bytes:
    spoken = text.strip()
    if not spoken:
        raise CosyVoiceError("没有可朗读的文本")
    key = llm_api_key()
    if not key:
        raise CosyVoiceError("未配置 LLM_API_KEY")

    body = {
        "model": tts_model(),
        "input": {
            "text": spoken,
            "voice": tts_voice(),
            "format": "mp3",
            "sample_rate": 22050,
            "volume": 50,
            "rate": clamp_rate(rate),
            "pitch": 1.0,
            "seed": 0,
            "language_hints": ["zh"],
        },
    }
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    own_client = client is None
    http = client or httpx.Client(timeout=timeout, follow_redirects=True)
    try:
        response = http.post(tts_http_url(), headers=headers, json=body)
        content_type = response.headers.get("content-type", "")
        if response.status_code >= 400:
            detail = response.text[:300]
            try:
                detail = _error_message(response.json(), response.status_code)
            except Exception:  # noqa: BLE001
                pass
            raise CosyVoiceError(detail)
        if content_type.startswith("audio/") and response.content:
            return response.content
        payload = response.json()
        source = audio_source(payload)
        if isinstance(source, bytes):
            return source
        audio_res = http.get(source)
        if audio_res.status_code >= 400 or not audio_res.content:
            raise CosyVoiceError(f"下载合成音频失败 HTTP {audio_res.status_code}")
        return audio_res.content
    except CosyVoiceError:
        raise
    except httpx.HTTPError as exc:
        raise CosyVoiceError(f"CosyVoice 请求失败: {exc}") from exc
    finally:
        if own_client:
            http.close()
