"""Normalize text and fuzzy-match against a unique expected answer.

Score = max(character similarity, pinyin similarity) so ASR 同音错字 can still pass.
"""

from __future__ import annotations

import re
import unicodedata

from pypinyin import Style, lazy_pinyin
from rapidfuzz import fuzz

MATCH_THRESHOLD = 0.90

_SPACE_RE = re.compile(r"\s+")


def normalize_text(text: str) -> str:
    """NFKC, strip, drop whitespace, unify common punctuation noise lightly."""
    s = unicodedata.normalize("NFKC", text or "")
    s = s.strip()
    s = _SPACE_RE.sub("", s)
    # Drop common Chinese/ASCII punctuation that ASR may insert
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


def fuzzy_score(transcript: str, expected: str) -> float:
    a = normalize_text(transcript)
    b = normalize_text(expected)
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0

    char_score = fuzz.ratio(a, b) / 100.0
    py_a = pinyin_key(a)
    py_b = pinyin_key(b)
    if not py_a or not py_b:
        return char_score
    pinyin_score = fuzz.ratio(py_a, py_b) / 100.0
    return max(char_score, pinyin_score)


def is_match(transcript: str, expected: str, threshold: float = MATCH_THRESHOLD) -> bool:
    return fuzzy_score(transcript, expected) >= threshold
