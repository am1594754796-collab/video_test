"""
Skeleton for a future OpenAI-compatible vision face provider.

To activate later:
  1. Implement detect() using LLM_API_KEY + LLM_BASE_URL + a vision-capable model
  2. Register in factory.py under name \"openai\"
  3. Set VISION_FACE_PROVIDER=openai in api.env
"""

from __future__ import annotations

from typing import Any


class OpenAIVisionFaceDetector:
    """Placeholder — not wired. Raises if called."""

    name = "openai"

    def configured(self) -> bool:
        return False

    def detect(
        self,
        image_base64: str,
        *,
        max_faces: int = 6,
        mime: str = "image/jpeg",
    ) -> list[dict[str, float]]:
        raise NotImplementedError(
            "OpenAI vision face provider is a skeleton. "
            "Implement detect() in providers/face/openai_vision.py and register it."
        )

    def status(self) -> dict[str, Any]:
        return {
            "provider": self.name,
            "configured": False,
            "model": None,
            "base_url": None,
            "note": "skeleton only",
        }
