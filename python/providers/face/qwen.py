"""Qwen-VL face detector — wraps existing vision_face.detect_faces_qwen."""

from __future__ import annotations

from typing import Any

from speech_answer.llm_config import llm_api_key, llm_base_url, llm_vision_model
from vision_face import detect_faces_qwen, vision_face_configured


class QwenFaceDetector:
    name = "qwen"

    def configured(self) -> bool:
        return vision_face_configured() and bool(llm_api_key())

    def detect(
        self,
        image_base64: str,
        *,
        max_faces: int = 6,
        mime: str = "image/jpeg",
    ) -> list[dict[str, float]]:
        return detect_faces_qwen(image_base64, max_faces=max_faces, mime=mime)

    def status(self) -> dict[str, Any]:
        ok = self.configured()
        return {
            "provider": self.name,
            "configured": ok,
            "model": llm_vision_model() if ok else None,
            "base_url": llm_base_url() if ok else None,
        }
