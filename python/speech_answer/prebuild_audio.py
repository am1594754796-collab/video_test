"""Generate CosyVoice MP3s for a question bank (run once when building the bank).

Usage (from python/):
  .venv\\Scripts\\python.exe -m speech_answer.prebuild_audio
  .venv\\Scripts\\python.exe -m speech_answer.prebuild_audio --answers data/answers.json --rate 0.95
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from speech_answer.answer_bank import AnswerBank
from speech_answer.audio_bank import (
    RAISE_COUNTDOWN_TEXT,
    audio_dir_for_bank,
    has_question_audio,
    has_raise_countdown_audio,
    question_audio_path,
    raise_countdown_audio_path,
)
from speech_answer.cosyvoice import CosyVoiceError, synthesize
from speech_answer.envfile import load_env_file
from speech_answer.llm_config import llm_api_key
from speech_answer.paths import PYTHON_ROOT, read_configured_relative_path, resolve_answers_path
from speech_answer.question_speech import build_question_speech_text


def _write_mp3(path: Path, audio: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(audio)


def prebuild_bank_audio(
    bank_path: Path,
    *,
    rate: float = 0.95,
    force: bool = False,
) -> dict[str, object]:
    if not llm_api_key():
        raise CosyVoiceError("未配置 LLM_API_KEY（见 python/data/api.env）")

    bank = AnswerBank.load(bank_path)
    out_dir = audio_dir_for_bank(bank_path)
    out_dir.mkdir(parents=True, exist_ok=True)

    built: list[str] = []
    skipped: list[str] = []

    countdown_path = raise_countdown_audio_path(bank_path)
    if force or not countdown_path.is_file():
        _write_mp3(countdown_path, synthesize(RAISE_COUNTDOWN_TEXT, rate=rate))
        built.append(countdown_path.name)
    else:
        skipped.append(countdown_path.name)

    for qid in bank.question_ids():
        path = question_audio_path(bank_path, qid)
        if not force and path.is_file():
            skipped.append(path.name)
            continue
        text = build_question_speech_text(bank.get_question(qid))
        if not text.strip():
            skipped.append(f"{path.name}(empty)")
            continue
        _write_mp3(path, synthesize(text, rate=rate))
        built.append(path.name)

    return {
        "bank": str(bank_path),
        "audio_dir": str(out_dir),
        "built": built,
        "skipped": skipped,
        "has_countdown": has_raise_countdown_audio(bank_path),
        "questions_with_audio": [
            qid for qid in bank.question_ids() if has_question_audio(bank_path, qid)
        ],
    }


def main(argv: list[str] | None = None) -> int:
    load_env_file(PYTHON_ROOT / "data" / "api.env", override=False)
    load_env_file(PYTHON_ROOT / "data" / "online.env", override=False)

    parser = argparse.ArgumentParser(description="Prebuild CosyVoice MP3s for the question bank")
    parser.add_argument(
        "--answers",
        default="",
        help="Bank path relative to python/ (default: data/answers.path or data/answers.json)",
    )
    parser.add_argument("--rate", type=float, default=0.95, help="Speech rate 0.5–2.0")
    parser.add_argument("--force", action="store_true", help="Rebuild even if MP3 already exists")
    args = parser.parse_args(argv)

    spec = args.answers.strip() or read_configured_relative_path()
    bank_path = resolve_answers_path(spec)
    if not bank_path.is_file():
        print(f"bank not found: {bank_path}", file=sys.stderr)
        return 1

    try:
        result = prebuild_bank_audio(bank_path, rate=args.rate, force=args.force)
    except CosyVoiceError as exc:
        print(f"prebuild failed: {exc}", file=sys.stderr)
        return 2

    print(f"bank: {result['bank']}")
    print(f"audio_dir: {result['audio_dir']}")
    print(f"built ({len(result['built'])}): {', '.join(result['built']) or '—'}")
    print(f"skipped ({len(result['skipped'])}): {', '.join(result['skipped']) or '—'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
