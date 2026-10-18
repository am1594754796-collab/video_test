"""Prebuilt CosyVoice MP3s next to the question bank.

Layout (bank = python/data/answers.json):
  python/data/audio/Q1.mp3
  python/data/audio/raise-countdown.mp3
"""

from __future__ import annotations

import re
from pathlib import Path

RAISE_COUNTDOWN_ID = "raise-countdown"
RAISE_COUNTDOWN_TEXT = "举手倒计时，三，二，一"

_SAFE_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


def audio_dir_for_bank(bank_path: Path) -> Path:
    return bank_path.resolve().parent / "audio"


def safe_audio_id(question_id: str) -> str:
    qid = question_id.strip()
    if not _SAFE_ID.match(qid):
        raise ValueError(f"unsafe question id for audio filename: {question_id!r}")
    return qid


def question_audio_path(bank_path: Path, question_id: str) -> Path:
    return audio_dir_for_bank(bank_path) / f"{safe_audio_id(question_id)}.mp3"


def raise_countdown_audio_path(bank_path: Path) -> Path:
    return audio_dir_for_bank(bank_path) / f"{RAISE_COUNTDOWN_ID}.mp3"


def has_question_audio(bank_path: Path, question_id: str) -> bool:
    try:
        return question_audio_path(bank_path, question_id).is_file()
    except ValueError:
        return False


def has_raise_countdown_audio(bank_path: Path) -> bool:
    return raise_countdown_audio_path(bank_path).is_file()
