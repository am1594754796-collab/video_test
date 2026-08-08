"""Mic WAV helper tests (no real microphone)."""

from pathlib import Path
import wave

import numpy as np

from speech_answer.mic import SAMPLE_RATE, write_wav_from_float32


def test_write_wav_from_float32(tmp_path: Path):
    samples = np.zeros(SAMPLE_RATE, dtype=np.float32)
    path = write_wav_from_float32(tmp_path / "silence.wav", samples)
    assert path.is_file()
    with wave.open(str(path), "rb") as wf:
        assert wf.getnchannels() == 1
        assert wf.getframerate() == SAMPLE_RATE
        assert wf.getsampwidth() == 2
        assert wf.getnframes() == SAMPLE_RATE
