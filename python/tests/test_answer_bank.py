from pathlib import Path

import pytest

from speech_answer.answer_bank import AnswerBank, DuplicateQuestionIdError, UnknownQuestionIdError


SAMPLE = Path(__file__).resolve().parents[1] / "data" / "answers.json"



def test_load_sample_and_get_answer():
    bank = AnswerBank.load(SAMPLE)
    assert bank.get_answer("Q1") == "北京"
    assert bank.get_answer("Q2") == "光合作用"
    q1 = bank.get_question("Q1")
    assert q1.prompt and "首都" in q1.prompt
    assert q1.options is not None
    assert q1.options["B"] == "北京"


def test_as_question_list_includes_prompt_options():
    bank = AnswerBank.load(SAMPLE)
    items = {q["id"]: q for q in bank.as_question_list()}
    assert items["Q1"]["prompt"]
    assert items["Q1"]["options"]["A"] == "上海"
    assert "answer" in items["Q1"]


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
