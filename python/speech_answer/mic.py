"""Microphone capture → 16 kHz mono WAV."""

from __future__ import annotations

import wave
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16_000
CHANNELS = 1


def record_wav(
    path: str | Path,
    *,
    seconds: float = 5.0,
    sample_rate: int = SAMPLE_RATE,
    device: int | None = None,
) -> Path:
    """
    Record from the default (or given) input device into a mono WAV file.

    Requires a working microphone and PortAudio (via sounddevice).
    """
    import sounddevice as sd

    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    frames = int(seconds * sample_rate)
    audio = sd.rec(
        frames,
        samplerate=sample_rate,
        channels=CHANNELS,
        dtype="float32",
        device=device,
    )
    sd.wait()
    pcm = np.clip(audio.reshape(-1), -1.0, 1.0)
    pcm16 = (pcm * 32767.0).astype(np.int16)
    with wave.open(str(out), "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm16.tobytes())
    return out


def write_wav_from_float32(
    path: str | Path,
    samples: np.ndarray,
    *,
    sample_rate: int = SAMPLE_RATE,
) -> Path:
    """Test helper: write mono float32 [-1,1] samples to WAV."""
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    pcm = np.clip(np.asarray(samples, dtype=np.float32).reshape(-1), -1.0, 1.0)
    pcm16 = (pcm * 32767.0).astype(np.int16)
    with wave.open(str(out), "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm16.tobytes())
    return out
