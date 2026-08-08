"""Normalize text and score answers (lexical + optional offline semantic).

Score = max(character, pinyin, semantic) so:
- short answers: 同音 / 近形仍可过
- 整句解释: 同义转述可由本地 embedding 判对
"""

from __future__ import annotations

import os
import re
import unicodedata
from typing import TypedDict

from pypinyin import Style, lazy_pinyin
from rapidfuzz import fuzz

MATCH_THRESHOLD = 0.90

_SPACE_RE = re.compile(r"\s+")


class ScoreBreakdown(TypedDict):
    char: float
    pinyin: float
    semantic: float | None
    score: float


def normalize_text(text: str) -> str:
    """NFKC, strip, drop whitespace, unify common punctuation noise lightly."""
    s = unicodedata.normalize("NFKC", text or "")
    s = s.strip()
    s = _SPACE_RE.sub("", s)
    for ch in "，。！？、；：\"\"''（）()[]【】《》<>…—-·.,!?;:'\"":
        s = s.replace(ch, "")
    return s


def pinyin_key(text: str) -> str:
    """Tone-marked pinyin sequence (TONE3) for same-reading comparison."""
    s = normalize_text(text)
    if not s:
        return ""
    parts = lazy_pinyin(s, style=Style.TONE3, errors="default")
    return "".join(parts).lower()


def _want_semantic(use_semantic: bool | None) -> bool:
    if use_semantic is not None:
        return use_semantic
    raw = os.environ.get("SPEECH_SEMANTIC", "1").strip().lower()
    return raw not in {"0", "false", "off", "no"}


def score_breakdown(
    transcript: str,
    expected: str,
    *,
    use_semantic: bool | None = None,
) -> ScoreBreakdown:
    a = normalize_text(transcript)
    b = normalize_text(expected)
    if not a and not b:
        return {"char": 1.0, "pinyin": 1.0, "semantic": 1.0, "score": 1.0}
    if not a or not b:
        return {"char": 0.0, "pinyin": 0.0, "semantic": 0.0, "score": 0.0}

    char_score = fuzz.ratio(a, b) / 100.0
    py_a = pinyin_key(a)
    py_b = pinyin_key(b)
    pinyin_score = (
        fuzz.ratio(py_a, py_b) / 100.0 if py_a and py_b else char_score
    )

    sem: float | None = None
    if _want_semantic(use_semantic):
        from speech_answer.semantic import semantic_score

        # Compare lightly cleaned originals (keep wording for semantics)
        sem = semantic_score((transcript or "").strip(), (expected or "").strip())

    parts = [char_score, pinyin_score]
    if sem is not None:
        parts.append(sem)
    return {
        "char": char_score,
        "pinyin": pinyin_score,
        "semantic": sem,
        "score": max(parts),
    }


def fuzzy_score(
    transcript: str,
    expected: str,
    *,
    use_semantic: bool | None = None,
) -> float:
    return score_breakdown(transcript, expected, use_semantic=use_semantic)["score"]


def is_match(
    transcript: str,
    expected: str,
    threshold: float = MATCH_THRESHOLD,
    *,
    use_semantic: bool | None = None,
) -> bool:
    return fuzzy_score(transcript, expected, use_semantic=use_semantic) >= threshold
