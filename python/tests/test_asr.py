"""Unit tests for ASR helper interface (no model download)."""

from pathlib import Path

import pytest

from speech_answer.asr import WhisperAsr


def test_transcribe_missing_file(tmp_path: Path):
    asr = WhisperAsr(model_size="tiny")
    with pytest.raises(FileNotFoundError):
        asr.transcribe_zh(tmp_path / "missing.wav")
