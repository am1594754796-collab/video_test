"""CLI: offline listen-and-match demo.

Usage (paths relative to python/):
  python -m speech_answer.cli --answers data/answers.json --question Q3 --text 绿色植物在光下把水和二氧化碳变成有机物并放出氧气
"""

from __future__ import annotations

import argparse
import json
import sys

from speech_answer.answer_bank import AnswerBank
from speech_answer.match_service import listen_and_match, match_text
from speech_answer.paths import DEFAULT_ANSWERS_RELATIVE, resolve_answers_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Speech answer match (offline ZH)")
    parser.add_argument(
        "--answers",
        default=DEFAULT_ANSWERS_RELATIVE,
        help=f"Answer bank JSON path relative to python/ (default: {DEFAULT_ANSWERS_RELATIVE})",
    )
    parser.add_argument("--question", required=True, help="External question id")
    parser.add_argument("--seconds", type=float, default=5.0, help="Mic record length")
    parser.add_argument("--model", default="base", help="faster-whisper model size")
    parser.add_argument(
        "--text",
        default=None,
        help="Skip mic/ASR; match this transcript directly (debug)",
    )
    args = parser.parse_args(argv)

    answers_file = resolve_answers_path(args.answers)
    bank = AnswerBank.load(answers_file)
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
