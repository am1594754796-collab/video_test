from pathlib import Path

from speech_answer.answer_bank import AnswerBank
from speech_answer.match_service import match_audio_file


SAMPLE = Path(__file__).resolve().parents[1] / "data" / "answers.sample.json"


def test_match_audio_file_with_mock(tmp_path: Path):
    bank = AnswerBank.load(SAMPLE)
    audio = tmp_path / "x.wav"
    audio.write_bytes(b"fake")

    result = match_audio_file(
        bank,
        "Q2",
        audio,
        transcribe_fn=lambda _p: "光合作用",
    )
    assert result.passed is True
    assert result.expected == "光合作用"
    assert result.transcript == "光合作用"
