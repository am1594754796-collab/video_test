"""
HTTP API: person sort + prebuilt CosyVoice read-aloud (question bank).
Run: python server.py
  (or: uvicorn server:app --host 127.0.0.1 --port 8765)

Question bank path (relative to python/):
  1) SPEECH_ANSWERS_PATH env (relative or absolute)
  2) else data/answers.path first non-comment line
  3) else data/answers.json

Audio MP3s live in <bank-dir>/audio/ (see speech_answer.prebuild_audio).
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from sort_people import sort_people_left_to_right
from speech_answer.answer_bank import AnswerBank, UnknownQuestionIdError
from speech_answer.audio_bank import (
    RAISE_COUNTDOWN_ID,
    audio_dir_for_bank,
    has_question_audio,
    has_raise_countdown_audio,
    question_audio_path,
    raise_countdown_audio_path,
    safe_audio_id,
)
from speech_answer.envfile import load_env_file
from speech_answer.paths import (
    DEFAULT_ANSWERS_RELATIVE,
    PYTHON_ROOT,
    read_configured_relative_path,
    resolve_answers_path,
    to_relative_display,
    write_configured_relative_path,
)

# Load unified API config first, then legacy online.env if present
load_env_file(PYTHON_ROOT / "data" / "api.env", override=False)
load_env_file(PYTHON_ROOT / "data" / "online.env", override=False)

app = FastAPI(title="Classroom Vision + Speech API", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_bank: AnswerBank | None = None
_active_path: Path | None = None
_active_relative: str = DEFAULT_ANSWERS_RELATIVE


def _initial_path_spec() -> str:
    env = os.environ.get("SPEECH_ANSWERS_PATH", "").strip()
    if env:
        return env
    return read_configured_relative_path()


def set_answer_bank(path_spec: str, *, persist: bool = False) -> AnswerBank:
    """Load answer bank from relative (to python/) or absolute path."""
    global _bank, _active_path, _active_relative
    resolved = resolve_answers_path(path_spec)
    if not resolved.is_file():
        raise FileNotFoundError(f"answer bank not found: {path_spec} -> {resolved}")
    bank = AnswerBank.load(resolved)
    _bank = bank
    _active_path = resolved
    _active_relative = to_relative_display(resolved)
    if persist and not Path(path_spec).is_absolute():
        write_configured_relative_path(path_spec.replace("\\", "/"))
        _active_relative = path_spec.replace("\\", "/")
    return bank


def get_bank() -> AnswerBank:
    global _bank
    if _bank is None:
        try:
            set_answer_bank(_initial_path_spec(), persist=False)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"failed to load answer bank: {exc}") from exc
    assert _bank is not None
    return _bank


def _bank_path() -> Path:
    get_bank()
    assert _active_path is not None
    return _active_path


def _questions_with_audio() -> list[dict[str, Any]]:
    bank = get_bank()
    bank_path = _bank_path()
    out: list[dict[str, Any]] = []
    for item in bank.as_question_list():
        qid = str(item["id"])
        row = dict(item)
        row["has_audio"] = has_question_audio(bank_path, qid)
        out.append(row)
    return out


def _bank_payload() -> dict[str, Any]:
    bank_path = _bank_path()
    questions = _questions_with_audio()
    return {
        "path": str(bank_path),
        "relative_path": _active_relative,
        "audio_dir": str(audio_dir_for_bank(bank_path)),
        "has_raise_countdown_audio": has_raise_countdown_audio(bank_path),
        "questions": questions,
    }


class PersonPayload(BaseModel):
    id: str | int | None = None
    x: float
    y: float = 0.5


class SortRequest(BaseModel):
    people: list[PersonPayload] = Field(default_factory=list)
    max_people: int = 6


class SetBankRequest(BaseModel):
    """`path` is relative to python/ (recommended), e.g. data/answers.json"""

    path: str = Field(..., min_length=1, description="Relative to python/, or absolute")
    persist: bool = Field(
        default=True,
        description="If true and path is relative, write data/answers.path",
    )


@app.get("/api/health")
def health() -> dict[str, Any]:
    bank_path: Path | None = None
    try:
        bank_path = _bank_path()
    except HTTPException:
        bank_path = None
    audio_ready = 0
    countdown = False
    if bank_path is not None:
        bank = get_bank()
        audio_ready = sum(1 for qid in bank.question_ids() if has_question_audio(bank_path, qid))
        countdown = has_raise_countdown_audio(bank_path)
    return {
        "status": "ok",
        "tts_mode": "prebuilt",
        "questions_with_audio": audio_ready,
        "has_raise_countdown_audio": countdown,
    }


@app.post("/api/people/sort")
def sort_people(body: SortRequest) -> dict[str, Any]:
    raw = [p.model_dump() for p in body.people]
    result = sort_people_left_to_right(raw, max_people=body.max_people)
    return dict(result)


@app.get("/api/speech/bank")
def speech_bank() -> dict[str, Any]:
    """Current question-bank path + questions (+ has_audio)."""
    return _bank_payload()


@app.post("/api/speech/bank")
def speech_set_bank(body: SetBankRequest) -> dict[str, Any]:
    """Point the API at another JSON via relative path under python/."""
    try:
        set_answer_bank(body.path, persist=body.persist)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"invalid answer bank: {exc}") from exc
    return _bank_payload()


@app.get("/api/speech/questions")
def speech_questions() -> dict[str, Any]:
    payload = _bank_payload()
    return {
        "questions": payload["questions"],
        "relative_path": payload["relative_path"],
        "path": payload["path"],
        "has_raise_countdown_audio": payload["has_raise_countdown_audio"],
    }


@app.get("/api/speech/audio/{audio_id}")
def speech_audio(audio_id: str) -> FileResponse:
    """Serve a prebuilt MP3. Use raise-countdown for the shared countdown clip."""
    bank_path = _bank_path()
    try:
        safe = safe_audio_id(audio_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if safe == RAISE_COUNTDOWN_ID:
        path = raise_countdown_audio_path(bank_path)
        if not path.is_file():
            raise HTTPException(
                status_code=404,
                detail="缺少举手倒计时音频：请先运行 python -m speech_answer.prebuild_audio",
            )
        return FileResponse(path, media_type="audio/mpeg", filename=path.name)

    try:
        get_bank().get_question(safe)
    except UnknownQuestionIdError as exc:
        raise HTTPException(status_code=404, detail=f"unknown question_id: {exc.args[0]}") from exc

    path = question_audio_path(bank_path, safe)
    if not path.is_file():
        raise HTTPException(
            status_code=404,
            detail=f"缺少 {safe}.mp3：请先运行 python -m speech_answer.prebuild_audio",
        )
    return FileResponse(path, media_type="audio/mpeg", filename=path.name)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="127.0.0.1", port=8765)
