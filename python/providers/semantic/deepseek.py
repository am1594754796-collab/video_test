"""
Skeleton for a future dedicated vendor semantic judge (e.g. DeepSeek-only path).

Register in factory.py and set SPEECH_SEMANTIC_PROVIDER=deepseek when ready.
"""

from __future__ import annotations

from typing import Any


class DeepSeekSemanticJudge:
    name = "deepseek"

    def configured(self) -> bool:
        return False

    def score(self, transcript: str, expected: str) -> float | None:
        raise NotImplementedError(
            "DeepSeek semantic provider is a skeleton. "
            "Implement score() or reuse OnlineSemanticJudge with LLM_BASE_URL pointed at DeepSeek."
        )

    def status(self) -> dict[str, Any]:
        return {"provider": self.name, "configured": False, "note": "skeleton only"}
