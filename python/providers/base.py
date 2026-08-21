"""Shared types for providers."""

from __future__ import annotations

from typing import Any, Protocol, TypedDict, runtime_checkable


class FaceBoxDict(TypedDict, total=False):
    x_min: float
    y_min: float
    width: float
    height: float
    score: float
    cx: float
    cy: float


@runtime_checkable
class FaceDetector(Protocol):
    """Detect faces in a still image; return normalized boxes (0–1), L→R preferred."""

    name: str

    def configured(self) -> bool: ...

    def detect(
        self,
        image_base64: str,
        *,
        max_faces: int = 6,
        mime: str = "image/jpeg",
    ) -> list[dict[str, float]]: ...

    def status(self) -> dict[str, Any]: ...


@runtime_checkable
class SemanticJudge(Protocol):
    """Score how well a transcript matches an expected answer in [0, 1]."""

    name: str

    def configured(self) -> bool: ...

    def score(self, transcript: str, expected: str) -> float | None: ...

    def status(self) -> dict[str, Any]: ...
