from pathlib import Path

from speech_answer.answer_bank import AnswerBank
from speech_answer.match_service import match_text

SAMPLE = Path(__file__).resolve().parents[1] / "data" / "answers.json"


def test_match_text_pass():
    bank = AnswerBank.load(SAMPLE)
    result = match_text(bank, "Q1", "北京")
    assert result.question_id == "Q1"
    assert result.transcript == "北京"
    assert result.expected == "北京"
    assert result.score >= 0.90
    assert result.passed is True


def test_match_text_fail():
    bank = AnswerBank.load(SAMPLE)
    result = match_text(bank, "Q1", "上海")
    assert result.expected == "北京"
    assert result.passed is False
    assert result.score < 0.90
