"""Offline Chinese ASR via faster-whisper."""

from __future__ import annotations

from pathlib import Path
from typing import Any

DEFAULT_MODEL = "base"


class WhisperAsr:
    """Lazy-loaded faster-whisper wrapper (language forced to zh)."""

    def __init__(
        self,
        model_size: str = DEFAULT_MODEL,
        *,
        device: str = "cpu",
        compute_type: str = "int8",
    ) -> None:
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        self._model: Any | None = None

    def _ensure_model(self) -> Any:
        if self._model is None:
            from faster_whisper import WhisperModel

            self._model = WhisperModel(
                self.model_size,
                device=self.device,
                compute_type=self.compute_type,
            )
        return self._model

    def transcribe_zh(self, audio_path: str | Path) -> str:
        path = Path(audio_path)
        if not path.is_file():
            raise FileNotFoundError(path)
        model = self._ensure_model()
        segments, _info = model.transcribe(
            str(path),
            language="zh",
            beam_size=1,
            vad_filter=True,
        )
        parts = [seg.text.strip() for seg in segments if seg.text and seg.text.strip()]
        return "".join(parts)


def transcribe_zh(
    audio_path: str | Path,
    *,
    model_size: str = DEFAULT_MODEL,
) -> str:
    """One-shot helper using default Whisper settings."""
    return WhisperAsr(model_size=model_size).transcribe_zh(audio_path)
