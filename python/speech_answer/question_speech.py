"""Spoken script for a question: stem + options, never the answer key."""

from __future__ import annotations

from speech_answer.answer_bank import OPTION_KEYS, QuestionRecord


def build_question_speech_text(question: QuestionRecord) -> str:
    parts: list[str] = []
    prompt = (question.prompt or "").strip()
    parts.append(prompt or f"题目 {question.id}")

    options = question.options or {}
    for key in OPTION_KEYS:
        text = options.get(key, "").strip()
        if text:
            parts.append(f"选项{key}，{text}")

    return "。".join(parts)
