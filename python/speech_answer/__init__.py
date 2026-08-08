"""Offline Chinese speech → answer-bank fuzzy match (classroom module)."""

from speech_answer.answer_bank import AnswerBank, DuplicateQuestionIdError, UnknownQuestionIdError
from speech_answer.fuzzy_match import MATCH_THRESHOLD, fuzzy_score, is_match, normalize_text
from speech_answer.match_service import MatchResult, listen_and_match, match_audio_file, match_text

__all__ = [
    "AnswerBank",
    "DuplicateQuestionIdError",
    "UnknownQuestionIdError",
    "MATCH_THRESHOLD",
    "fuzzy_score",
    "is_match",
    "normalize_text",
    "MatchResult",
    "match_text",
    "match_audio_file",
    "listen_and_match",
]
