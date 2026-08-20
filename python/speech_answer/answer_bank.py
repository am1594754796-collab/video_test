"""Load answer bank JSON: one unique answer per question id.

Optional fields for aloud reading (TTS):
  - prompt: question stem
  - options: {"A": "...", "B": "...", "C": "...", "D": "..."}
Matching still uses `answer` only (do not speak the key).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class UnknownQuestionIdError(KeyError):
    """Raised when question_id is not in the bank."""


class DuplicateQuestionIdError(ValueError):
    """Raised when the answer bank contains duplicate question ids."""


OPTION_KEYS = ("A", "B", "C", "D")


@dataclass(frozen=True)
class QuestionRecord:
    id: str
    answer: str
    prompt: str | None = None
    options: dict[str, str] | None = None


def _parse_options(qid: str, raw: Any) -> dict[str, str] | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError(f"question {qid!r} options must be an object")
    out: dict[str, str] = {}
    for key in OPTION_KEYS:
        if key not in raw:
            continue
        val = raw[key]
        if not isinstance(val, str) or not val.strip():
            raise ValueError(f"question {qid!r} options.{key} must be a non-empty string")
        out[key] = val.strip()
    if not out:
        return None
    return out


class AnswerBank:
    def __init__(self, questions: dict[str, QuestionRecord]) -> None:
        self._questions = dict(questions)

    @classmethod
    def load(cls, path: str | Path) -> AnswerBank:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls.from_dict(data)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AnswerBank:
        questions = data.get("questions")
        if not isinstance(questions, list):
            raise ValueError("answer bank must contain a 'questions' list")

        records: dict[str, QuestionRecord] = {}
        for item in questions:
            if not isinstance(item, dict):
                raise ValueError("each question must be an object")
            qid = item.get("id")
            answer = item.get("answer")
            if not isinstance(qid, str) or not qid:
                raise ValueError("question id must be a non-empty string")
            if not isinstance(answer, str):
                raise ValueError(f"question {qid!r} answer must be a string")
            if qid in records:
                raise DuplicateQuestionIdError(f"duplicate question id: {qid}")

            prompt_raw = item.get("prompt")
            prompt: str | None = None
            if prompt_raw is not None:
                if not isinstance(prompt_raw, str):
                    raise ValueError(f"question {qid!r} prompt must be a string")
                prompt = prompt_raw.strip() or None

            options = _parse_options(qid, item.get("options"))
            records[qid] = QuestionRecord(
                id=qid,
                answer=answer,
                prompt=prompt,
                options=options,
            )
        return cls(records)

    def get_answer(self, question_id: str) -> str:
        try:
            return self._questions[question_id].answer
        except KeyError as exc:
            raise UnknownQuestionIdError(question_id) from exc

    def get_question(self, question_id: str) -> QuestionRecord:
        try:
            return self._questions[question_id]
        except KeyError as exc:
            raise UnknownQuestionIdError(question_id) from exc

    def question_ids(self) -> list[str]:
        return sorted(self._questions)

    def as_question_list(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for qid in self.question_ids():
            q = self._questions[qid]
            item: dict[str, Any] = {"id": q.id, "answer": q.answer}
            if q.prompt:
                item["prompt"] = q.prompt
            if q.options:
                item["options"] = dict(q.options)
            out.append(item)
        return out
