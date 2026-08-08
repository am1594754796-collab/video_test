"""
HTTP API for person count + left-to-right ordering.
Run: uvicorn server:app --host 127.0.0.1 --port 8765
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from sort_people import sort_people_left_to_right

app = FastAPI(title="People Sort API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PersonPayload(BaseModel):
    id: str | int | None = None
    x: float
    y: float = 0.5


class SortRequest(BaseModel):
    people: list[PersonPayload] = Field(default_factory=list)
    max_people: int = 6


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/people/sort")
def sort_people(body: SortRequest) -> dict[str, Any]:
    raw = [p.model_dump() for p in body.people]
    result = sort_people_left_to_right(raw, max_people=body.max_people)
    return dict(result)
