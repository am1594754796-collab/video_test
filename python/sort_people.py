"""
Left-to-right person ordering (Vision Recognition helper).

Input: people with normalized image coordinates (x increases rightward).
Output: sorted list with 1-based indices from left to right.
"""

from __future__ import annotations

from typing import Any, TypedDict


class PersonIn(TypedDict, total=False):
    id: str | int
    x: float
    y: float


class PersonOut(TypedDict):
    index: int  # 1-based, left → right
    x: float
    y: float
    id: str | int | None


class SortResult(TypedDict):
    count: int
    people: list[PersonOut]


def sort_people_left_to_right(
    people: list[dict[str, Any]],
    *,
    max_people: int = 6,
) -> SortResult:
    """
    Sort people by torso x ascending (left → right).

    - Keeps at most `max_people` leftmost persons when more are provided.
    - Assigns stable 1-based `index` after sorting.
    """
    cleaned: list[dict[str, Any]] = []
    for p in people:
        if p is None:
            continue
        try:
            x = float(p["x"])
            y = float(p.get("y", 0.5))
        except (KeyError, TypeError, ValueError):
            continue
        cleaned.append(
            {
                "id": p.get("id"),
                "x": x,
                "y": y,
            }
        )

    cleaned.sort(key=lambda item: item["x"])
    if max_people > 0:
        cleaned = cleaned[:max_people]

    out: list[PersonOut] = []
    for i, item in enumerate(cleaned, start=1):
        out.append(
            PersonOut(
                index=i,
                x=item["x"],
                y=item["y"],
                id=item.get("id"),
            )
        )

    return SortResult(count=len(out), people=out)
