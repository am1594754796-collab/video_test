"""Shared types for providers."""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class SemanticJudge(Protocol):
    """Score how well a transcript matches an expected answer in [0, 1]."""

    name: str

    def configured(self) -> bool: ...

    def score(self, transcript: str, expected: str) -> float | None: ...

    def status(self) -> dict[str, Any]: ...
