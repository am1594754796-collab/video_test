"""
HTTP API: person sort + speech answer match.
Run: uvicorn server:app --host 127.0.0.1 --port 8765

Answer bank path (relative to python/):
  1) SPEECH_ANSWERS_PATH env (relative or absolute)
  2) else data/answers.path first non-comment line
  3) else data/answers.json
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import httpx

from sort_people import sort_people_left_to_right
from speech_answer.answer_bank import AnswerBank, UnknownQuestionIdError
from speech_answer.asr import WhisperAsr
from speech_answer.match_service import match_audio_file, match_text
from speech_answer.envfile import load_env_file
from speech_answer.paths import (
    DEFAULT_ANSWERS_RELATIVE,
    PYTHON_ROOT,
    read_configured_relative_path,
    resolve_answers_path,
    to_relative_display,
    write_configured_relative_path,
)
from vision_face import detect_faces_qwen, vision_face_configured, vision_face_status
from speech_answer.llm_config import llm_status

# Load unified API config first, then legacy online.env if present
load_env_file(PYTHON_ROOT / "data" / "api.env", override=False)
load_env_file(PYTHON_ROOT / "data" / "online.env", override=False)

app = FastAPI(title="Classroom Vision + Speech API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_WHISPER_MODEL = os.environ.get("SPEECH_WHISPER_MODEL", "base")

_bank: AnswerBank | None = None
_asr: WhisperAsr | None = None
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


def get_asr() -> WhisperAsr:
    global _asr
    if _asr is None:
        _asr = WhisperAsr(model_size=_WHISPER_MODEL)
    return _asr


def _bank_payload() -> dict[str, Any]:
    bank = get_bank()
    return {
        "path": str(_active_path) if _active_path else None,
        "relative_path": _active_relative,
        "questions": bank.as_question_list(),
    }


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


class SetBankRequest(BaseModel):
    """`path` is relative to python/ (recommended), e.g. data/answers.json"""

    path: str = Field(..., min_length=1, description="Relative to python/, or absolute")
    persist: bool = Field(
        default=True,
        description="If true and path is relative, write data/answers.path",
    )


class DetectFacesRequest(BaseModel):
    """JPEG/PNG base64 (raw or data-URL) for Qwen-VL face detection."""

    image_base64: str = Field(..., min_length=8)
    max_faces: int = Field(default=6, ge=1, le=8)
    mime: str = Field(default="image/jpeg")


@app.get("/api/health")
def health() -> dict[str, Any]:
    face = vision_face_status()
    llm = llm_status()
    return {
        "status": "ok",
        "llm_configured": llm["configured"],
        "llm_base_url": llm.get("base_url"),
        "llm_chat_model": llm.get("chat_model"),
        "llm_vision_model": llm.get("vision_model"),
        "vision_face_mode": face["mode"],
        "vision_face_configured": face["configured"],
        "vision_face_model": face.get("model"),
    }


@app.get("/api/vision/face-status")
def vision_face_status_api() -> dict[str, Any]:
    return vision_face_status()


@app.post("/api/vision/detect-faces")
def vision_detect_faces(body: DetectFacesRequest) -> dict[str, Any]:
    if not vision_face_configured():
        raise HTTPException(
            status_code=503,
            detail="千问人脸未配置：请在 python/data/api.env 设置 LLM_API_KEY（及 VISION_FACE_MODE=qwen）",
        )
    try:
        faces = detect_faces_qwen(
            body.image_base64,
            max_faces=body.max_faces,
            mime=body.mime,
        )
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Qwen API HTTP {exc.response.status_code}: {exc.response.text[:300]}",
        ) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"face detect failed: {exc}") from exc
    return {"count": len(faces), "faces": faces}


@app.post("/api/people/sort")
def sort_people(body: SortRequest) -> dict[str, Any]:
    raw = [p.model_dump() for p in body.people]
    result = sort_people_left_to_right(raw, max_people=body.max_people)
    return dict(result)


@app.get("/api/speech/bank")
def speech_bank() -> dict[str, Any]:
    """Current answer-bank path + questions."""
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
    }


def _match_payload(result: Any) -> dict[str, Any]:
    return {
        "question_id": result.question_id,
        "transcript": result.transcript,
        "expected": result.expected,
        "score": result.score,
        "passed": result.passed,
        "score_char": result.score_char,
        "score_pinyin": result.score_pinyin,
        "score_semantic": result.score_semantic,
    }


@app.post("/api/speech/match-text")
def speech_match_text(body: MatchTextRequest) -> dict[str, Any]:
    try:
        result = match_text(get_bank(), body.question_id, body.transcript)
    except UnknownQuestionIdError as exc:
        raise HTTPException(status_code=404, detail=f"unknown question_id: {exc.args[0]}") from exc
    return _match_payload(result)


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

    return _match_payload(result)
