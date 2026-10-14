"""Orchestrate answer lookup + fuzzy match (text path for online speech)."""

from __future__ import annotations

from dataclasses import dataclass

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
