"""
HTTP API: person sort + speech answer match.
Run: uvicorn server:app --host 127.0.0.1 --port 8765
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from sort_people import sort_people_left_to_right
from speech_answer.answer_bank import AnswerBank, UnknownQuestionIdError
from speech_answer.asr import WhisperAsr
from speech_answer.match_service import match_audio_file, match_text

app = FastAPI(title="Classroom Vision + Speech API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_ROOT = Path(__file__).resolve().parent
_DEFAULT_ANSWERS = _ROOT / "data" / "answers.sample.json"
_ANSWER_BANK_PATH = Path(os.environ.get("SPEECH_ANSWERS_PATH", str(_DEFAULT_ANSWERS)))
_WHISPER_MODEL = os.environ.get("SPEECH_WHISPER_MODEL", "base")

_bank: AnswerBank | None = None
_asr: WhisperAsr | None = None


def get_bank() -> AnswerBank:
    global _bank
    if _bank is None:
        if not _ANSWER_BANK_PATH.is_file():
            raise HTTPException(status_code=500, detail=f"answer bank missing: {_ANSWER_BANK_PATH}")
        _bank = AnswerBank.load(_ANSWER_BANK_PATH)
    return _bank


def get_asr() -> WhisperAsr:
    global _asr
    if _asr is None:
        _asr = WhisperAsr(model_size=_WHISPER_MODEL)
    return _asr


class PersonPayload(BaseModel):
    id: str | int | None = None
    x: float
    y: float = 0.5


class SortRequest(BaseModel):
    people: list[PersonPayload] = Field(default_factory=list)
    max_people: int = 6


class MatchTextRequest(BaseModel):
    question_id: str
    transcript: str


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/people/sort")
def sort_people(body: SortRequest) -> dict[str, Any]:
    raw = [p.model_dump() for p in body.people]
    result = sort_people_left_to_right(raw, max_people=body.max_people)
    return dict(result)


@app.get("/api/speech/questions")
def speech_questions() -> dict[str, Any]:
    return {"questions": get_bank().as_question_list()}


@app.post("/api/speech/match-text")
def speech_match_text(body: MatchTextRequest) -> dict[str, Any]:
    try:
        result = match_text(get_bank(), body.question_id, body.transcript)
    except UnknownQuestionIdError as exc:
        raise HTTPException(status_code=404, detail=f"unknown question_id: {exc.args[0]}") from exc
    return {
        "question_id": result.question_id,
        "transcript": result.transcript,
        "expected": result.expected,
        "score": result.score,
        "passed": result.passed,
    }


@app.post("/api/speech/match")
async def speech_match(
    question_id: str = Form(...),
    audio: UploadFile = File(...),
) -> dict[str, Any]:
    bank = get_bank()
    try:
        bank.get_answer(question_id)
    except UnknownQuestionIdError as exc:
        raise HTTPException(status_code=404, detail=f"unknown question_id: {exc.args[0]}") from exc

    suffix = Path(audio.filename or "clip.webm").suffix or ".webm"
    raw = await audio.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty audio upload")

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(raw)
        tmp_path = Path(tmp.name)

    try:
        asr = get_asr()
        result = match_audio_file(
            bank,
            question_id,
            tmp_path,
            transcribe_fn=asr.transcribe_zh,
        )
    except Exception as exc:  # noqa: BLE001 — surface ASR failures to client
        raise HTTPException(status_code=500, detail=f"asr failed: {exc}") from exc
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass

    return {
        "question_id": result.question_id,
        "transcript": result.transcript,
        "expected": result.expected,
        "score": result.score,
        "passed": result.passed,
    }
