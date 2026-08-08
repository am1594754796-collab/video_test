from pathlib import Path

import pytest

from speech_answer.answer_bank import AnswerBank, DuplicateQuestionIdError, UnknownQuestionIdError


SAMPLE = Path(__file__).resolve().parents[1] / "data" / "answers.json"



def test_load_sample_and_get_answer():
    bank = AnswerBank.load(SAMPLE)
    assert bank.get_answer("Q1") == "北京"
    assert bank.get_answer("Q2") == "光合作用"


def test_unknown_question_id():
    bank = AnswerBank.load(SAMPLE)
    with pytest.raises(UnknownQuestionIdError):
        bank.get_answer("QX")


def test_duplicate_id_rejected(tmp_path: Path):
    path = tmp_path / "dup.json"
    path.write_text(
        '{"questions":[{"id":"Q1","answer":"a"},{"id":"Q1","answer":"b"}]}',
        encoding="utf-8",
    )
    with pytest.raises(DuplicateQuestionIdError):
        AnswerBank.load(path)
