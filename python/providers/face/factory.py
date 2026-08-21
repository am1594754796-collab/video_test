"""Select face detector implementation from env."""

from __future__ import annotations

import os
from typing import Any

from providers.base import FaceDetector
from providers.face.off import OffFaceDetector
from providers.face.qwen import QwenFaceDetector


def face_provider_name() -> str:
    # Prefer explicit PROVIDER; fall back to legacy VISION_FACE_MODE.
    raw = (
        os.environ.get("VISION_FACE_PROVIDER", "").strip()
        or os.environ.get("VISION_FACE_MODE", "").strip()
        or "qwen"
    )
    return raw.lower()


def get_face_detector() -> FaceDetector:
    name = face_provider_name()
    if name in ("off", "none", "disabled"):
        return OffFaceDetector()
    if name in ("qwen", "dashscope", "tongyi"):
        return QwenFaceDetector()
    # Unknown → safe off (do not crash classroom)
    return OffFaceDetector()


def face_provider_status() -> dict[str, Any]:
    det = get_face_detector()
    st = det.status()
    st["provider"] = getattr(det, "name", face_provider_name())
    st["requested"] = face_provider_name()
    return st
