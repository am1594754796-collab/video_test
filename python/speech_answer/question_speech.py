"""Spoken script for a question: stem + options, never the answer key."""

from __future__ import annotations

import re

from speech_answer.answer_bank import OPTION_KEYS, QuestionRecord


_CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"
_CHINESE = ("一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十")


def _speakable_numbers(text: str) -> str:
    def replace(match: re.Match[str]) -> str:
        labels = [f"第{_CHINESE[_CIRCLED.index(char)]}项" for char in match.group()]
        spoken = "、".join(labels)
        if match.end() < len(text) and text[match.end()].isalnum():
            spoken += "，"
        return spoken

    return re.sub(f"[{_CIRCLED}]+", replace, text)


def build_question_speech_text(question: QuestionRecord) -> str:
    parts: list[str] = []
    prompt = (question.prompt or "").strip()
    parts.append(_speakable_numbers(prompt) if prompt else f"题目 {question.id}")

    options = question.options or {}
    for key in OPTION_KEYS:
        text = options.get(key, "").strip()
        if text:
            parts.append(f"选项{key}，{_speakable_numbers(text)}")

    return "。".join(parts)
