"""No-op face detector (VISION_FACE_PROVIDER=off)."""

from __future__ import annotations

from typing import Any


class OffFaceDetector:
    name = "off"

    def configured(self) -> bool:
        return False

    def detect(
        self,
        image_base64: str,
        *,
        max_faces: int = 6,
        mime: str = "image/jpeg",
    ) -> list[dict[str, float]]:
        return []

    def status(self) -> dict[str, Any]:
        return {"provider": self.name, "configured": False, "model": None, "base_url": None}
