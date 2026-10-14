"""CLI: text match against answer bank (debug / smoke).

Usage (paths relative to python/):
  python -m speech_answer.cli --answers data/answers.json --question Q1 --text 北京
"""

from __future__ import annotations

import argparse
import json
import sys

from speech_answer.answer_bank import AnswerBank
from speech_answer.match_service import match_text
from speech_answer.paths import DEFAULT_ANSWERS_RELATIVE, resolve_answers_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Speech answer match (text)")
    parser.add_argument(
        "--answers",
        default=DEFAULT_ANSWERS_RELATIVE,
        help=f"Answer bank JSON path relative to python/ (default: {DEFAULT_ANSWERS_RELATIVE})",
    )
    parser.add_argument("--question", required=True, help="External question id")
    parser.add_argument(
        "--text",
        required=True,
        help="Transcript to match against the question's answer",
    )
    args = parser.parse_args(argv)

    answers_file = resolve_answers_path(args.answers)
    bank = AnswerBank.load(answers_file)
    result = match_text(bank, args.question, args.text)

    payload = {
        "question_id": result.question_id,
        "transcript": result.transcript,
        "expected": result.expected,
        "score": round(result.score, 4),
        "passed": result.passed,
        "score_char": round(result.score_char, 4),
        "score_pinyin": round(result.score_pinyin, 4),
        "score_semantic": (
            None if result.score_semantic is None else round(result.score_semantic, 4)
        ),
        "answers_path": str(answers_file),
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if result.passed else 2


if __name__ == "__main__":
    sys.exit(main())
