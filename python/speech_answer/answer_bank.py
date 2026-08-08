"""Load answer bank JSON: one unique answer per question id."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class UnknownQuestionIdError(KeyError):
    """Raised when question_id is not in the bank."""


class DuplicateQuestionIdError(ValueError):
    """Raised when the answer bank contains duplicate question ids."""


class AnswerBank:
    def __init__(self, answers: dict[str, str]) -> None:
        self._answers = dict(answers)

    @classmethod
    def load(cls, path: str | Path) -> AnswerBank:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls.from_dict(data)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AnswerBank:
        questions = data.get("questions")
        if not isinstance(questions, list):
            raise ValueError("answer bank must contain a 'questions' list")

        answers: dict[str, str] = {}
        for item in questions:
            if not isinstance(item, dict):
                raise ValueError("each question must be an object")
            qid = item.get("id")
            answer = item.get("answer")
            if not isinstance(qid, str) or not qid:
                raise ValueError("question id must be a non-empty string")
            if not isinstance(answer, str):
                raise ValueError(f"question {qid!r} answer must be a string")
            if qid in answers:
                raise DuplicateQuestionIdError(f"duplicate question id: {qid}")
            answers[qid] = answer
        return cls(answers)

    def get_answer(self, question_id: str) -> str:
        try:
            return self._answers[question_id]
        except KeyError as exc:
            raise UnknownQuestionIdError(question_id) from exc

    def question_ids(self) -> list[str]:
        return sorted(self._answers)

    def as_question_list(self) -> list[dict[str, str]]:
        return [{"id": qid, "answer": self._answers[qid]} for qid in self.question_ids()]
