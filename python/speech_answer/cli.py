"""CLI: offline listen-and-match demo.

Usage:
  python -m speech_answer.cli --answers data/answers.json --question Q1 --seconds 5
  python -m speech_answer.cli --answers data/answers.json --question Q1 --text 北京
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from speech_answer.answer_bank import AnswerBank
from speech_answer.match_service import listen_and_match, match_text


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Speech answer match (offline ZH)")
    parser.add_argument("--answers", required=True, type=Path, help="Answer bank JSON path")
    parser.add_argument("--question", required=True, help="External question id")
    parser.add_argument("--seconds", type=float, default=5.0, help="Mic record length")
    parser.add_argument("--model", default="base", help="faster-whisper model size")
    parser.add_argument(
        "--text",
        default=None,
        help="Skip mic/ASR; match this transcript directly (debug)",
    )
    args = parser.parse_args(argv)

    bank = AnswerBank.load(args.answers)
    if args.text is not None:
        result = match_text(bank, args.question, args.text)
    else:
        result = listen_and_match(
            bank,
            args.question,
            seconds=args.seconds,
            model_size=args.model,
        )

    payload = {
        "question_id": result.question_id,
        "transcript": result.transcript,
        "expected": result.expected,
        "score": round(result.score, 4),
        "passed": result.passed,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if result.passed else 2


if __name__ == "__main__":
    sys.exit(main())
