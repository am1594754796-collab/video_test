from pathlib import Path

from speech_answer.answer_bank import AnswerBank
from speech_answer.match_service import listen_and_match, match_text


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


def test_listen_and_match_with_mocks(tmp_path: Path):
    bank = AnswerBank.load(SAMPLE)

    def fake_record(path, *, seconds=5.0):
        p = Path(path)
        p.write_bytes(b"fake")
        return p

    def fake_asr(_path):
        return "北京"

    result = listen_and_match(
        bank,
        "Q1",
        seconds=1.0,
        record_fn=fake_record,
        transcribe_fn=fake_asr,
        work_dir=tmp_path,
    )
    assert result.passed is True
    assert result.transcript == "北京"
    assert result.expected == "北京"
