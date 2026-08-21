"""Semantic scoring router: online (API) / offline (local BGE) / off.

Mode via SPEECH_SEMANTIC_MODE:
  online  — OpenAI-compatible LLM judge (needs SPEECH_LLM_API_KEY)
  offline — local sentence-transformers embedding
  auto    — online if API key set, else offline, else None
  off     — disable semantic (same as SPEECH_SEMANTIC=0)
"""

from __future__ import annotations

import os
from typing import Callable

import numpy as np

DEFAULT_EMBED_MODEL = os.environ.get("SPEECH_EMBED_MODEL", "BAAI/bge-small-zh-v1.5")


def _env_semantic_enabled() -> bool:
    raw = os.environ.get("SPEECH_SEMANTIC", "1").strip().lower()
    if raw in {"0", "false", "off", "no"}:
        return False
    mode = os.environ.get("SPEECH_SEMANTIC_MODE", "auto").strip().lower()
    return mode not in {"off", "0", "false", "no"}


def _mode() -> str:
    return os.environ.get("SPEECH_SEMANTIC_MODE", "auto").strip().lower() or "auto"


class SemanticScorer:
    """Lazy-loaded local embedding cosine similarity in [0, 1]."""

    def __init__(
        self,
        model_name: str = DEFAULT_EMBED_MODEL,
        *,
        encode_fn: Callable[[list[str]], np.ndarray] | None = None,
    ) -> None:
        self.model_name = model_name
        self._encode_fn = encode_fn
        self._model = None
        self._load_error: str | None = None

    def _ensure(self) -> Callable[[list[str]], np.ndarray] | None:
        if self._encode_fn is not None:
            return self._encode_fn
        if self._load_error is not None:
            return None
        if self._model is not None:
            return self._encode_with_model
        try:
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer(self.model_name)
        except Exception as exc:  # noqa: BLE001
            self._load_error = str(exc)
            return None
        return self._encode_with_model

    def _encode_with_model(self, texts: list[str]) -> np.ndarray:
        assert self._model is not None
        vectors = self._model.encode(
            texts,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        return np.asarray(vectors, dtype=np.float32)

    @property
    def available(self) -> bool:
        return self._ensure() is not None

    @property
    def load_error(self) -> str | None:
        self._ensure()
        return self._load_error

    def score(self, transcript: str, expected: str) -> float | None:
        a = (transcript or "").strip()
        b = (expected or "").strip()
        if not a and not b:
            return 1.0
        if not a or not b:
            return 0.0
        encode = self._ensure()
        if encode is None:
            return None
        vecs = encode([a, b])
        if vecs.shape[0] < 2:
            return None
        sim = float(np.dot(vecs[0], vecs[1]))
        return max(0.0, min(1.0, sim))


_default_scorer: SemanticScorer | None = None


def get_semantic_scorer() -> SemanticScorer:
    global _default_scorer
    if _default_scorer is None:
        _default_scorer = SemanticScorer()
    return _default_scorer


def semantic_score(transcript: str, expected: str) -> float | None:
    """Return semantic similarity in [0,1], or None if unavailable.

    Cloud path goes through ``providers.semantic`` (SPEECH_SEMANTIC_PROVIDER).
    Local embedding remains here for ``offline`` / ``auto`` fallback.
    """
    if not _env_semantic_enabled():
        return None

    from providers.semantic.factory import get_semantic_judge, semantic_provider_name

    name = semantic_provider_name()
    if name in {"off", "0", "false", "no"}:
        return None

    if name in {"online", "qwen", "openai", "compatible"}:
        return get_semantic_judge().score(transcript, expected)

    if name == "offline" or _mode() == "offline":
        return get_semantic_scorer().score(transcript, expected)

    # auto: prefer online provider when key present, else local embedding
    judge = get_semantic_judge()
    if judge.configured():
        online = judge.score(transcript, expected)
        if online is not None:
            return online
    return get_semantic_scorer().score(transcript, expected)
