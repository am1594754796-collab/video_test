"""Disable semantic scoring."""

from __future__ import annotations

from typing import Any


class OffSemanticJudge:
    name = "off"

    def configured(self) -> bool:
        return False

    def score(self, transcript: str, expected: str) -> float | None:
        return None

    def status(self) -> dict[str, Any]:
        return {"provider": self.name, "configured": False, "model": None}
