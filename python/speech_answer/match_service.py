"""Orchestrate answer lookup + fuzzy match (text and listen paths)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable
from uuid import uuid4

from speech_answer.answer_bank import AnswerBank
from speech_answer.fuzzy_match import MATCH_THRESHOLD, score_breakdown


@dataclass(frozen=True)
class MatchResult:
    question_id: str
    transcript: str
    expected: str
    score: float
    passed: bool
    score_char: float = 0.0
    score_pinyin: float = 0.0
    score_semantic: float | None = None


def match_text(
    bank: AnswerBank,
    question_id: str,
    transcript: str,
    *,
    threshold: float = MATCH_THRESHOLD,
    use_semantic: bool | None = None,
) -> MatchResult:
    expected = bank.get_answer(question_id)
    bd = score_breakdown(transcript, expected, use_semantic=use_semantic)
    return MatchResult(
        question_id=question_id,
        transcript=transcript,
        expected=expected,
        score=bd["score"],
        passed=bd["score"] >= threshold,
        score_char=bd["char"],
        score_pinyin=bd["pinyin"],
        score_semantic=bd["semantic"],
    )


def match_audio_file(
    bank: AnswerBank,
    question_id: str,
    audio_path: str | Path,
    *,
    threshold: float = MATCH_THRESHOLD,
    model_size: str = "base",
    transcribe_fn: Callable[[Path], str] | None = None,
) -> MatchResult:
    """Transcribe an existing audio file, then fuzzy-match."""
    from speech_answer.asr import WhisperAsr

    if transcribe_fn is None:
        asr = WhisperAsr(model_size=model_size)
        transcribe_fn = asr.transcribe_zh
    transcript = transcribe_fn(Path(audio_path))
    return match_text(bank, question_id, transcript, threshold=threshold)


def listen_and_match(
    bank: AnswerBank,
    question_id: str,
    *,
    seconds: float = 5.0,
    threshold: float = MATCH_THRESHOLD,
    model_size: str = "base",
    record_fn: Callable[..., Path] | None = None,
    transcribe_fn: Callable[[Path], str] | None = None,
    work_dir: str | Path | None = None,
) -> MatchResult:
    """
    Record from mic → offline ASR → fuzzy match against the question's answer.

    `record_fn` / `transcribe_fn` are injectable for tests.
    """
    from speech_answer.mic import record_wav

    recorder = record_fn or record_wav

    base = Path(work_dir) if work_dir is not None else Path.cwd() / ".speech_answer_tmp"
    base.mkdir(parents=True, exist_ok=True)
    wav_path = base / f"listen-{uuid4().hex}.wav"
    try:
        recorded = recorder(wav_path, seconds=seconds)
        return match_audio_file(
            bank,
            question_id,
            recorded,
            threshold=threshold,
            model_size=model_size,
            transcribe_fn=transcribe_fn,
        )
    finally:
        if wav_path.is_file():
            try:
                wav_path.unlink()
            except OSError:
                pass
