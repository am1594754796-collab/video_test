"""Resolve answer-bank paths relative to the python/ package root."""

from __future__ import annotations

from pathlib import Path

# python/ (parent of speech_answer/)
PYTHON_ROOT = Path(__file__).resolve().parents[1]

# Default relative path (from python/) — edit this file, or point elsewhere.
DEFAULT_ANSWERS_RELATIVE = "data/answers.json"
ANSWERS_PATH_CONFIG = PYTHON_ROOT / "data" / "answers.path"


def resolve_answers_path(path: str | Path) -> Path:
    """
    Resolve an answer-bank path.

    - Absolute paths are used as-is.
    - Relative paths are resolved against `python/` (not the process CWD),
      so `data/answers.json` always means `python/data/answers.json`.
    """
    s = str(path).strip().strip('"').strip("'")
    if not s:
        raise ValueError("answer bank path is empty")
    raw = Path(s)
    if raw.is_absolute():
        return raw.resolve()
    return (PYTHON_ROOT / raw).resolve()


def read_configured_relative_path() -> str:
    """Read relative path from data/answers.path, or return the default."""
    if ANSWERS_PATH_CONFIG.is_file():
        line = ANSWERS_PATH_CONFIG.read_text(encoding="utf-8").strip().splitlines()
        if line:
            candidate = line[0].strip()
            if candidate and not candidate.startswith("#"):
                return candidate
    return DEFAULT_ANSWERS_RELATIVE


def write_configured_relative_path(relative_path: str) -> None:
    """Persist the active relative path so the next process start picks it up."""
    rel = str(relative_path).strip().replace("\\", "/")
    if Path(rel).is_absolute():
        raise ValueError("answers.path must store a relative path under python/")
    ANSWERS_PATH_CONFIG.parent.mkdir(parents=True, exist_ok=True)
    ANSWERS_PATH_CONFIG.write_text(
        f"# Relative to python/ — change this to switch answer banks\n{rel}\n",
        encoding="utf-8",
    )


def to_relative_display(path: Path) -> str:
    """Best-effort path relative to python/ for UI/API display."""
    try:
        return path.resolve().relative_to(PYTHON_ROOT.resolve()).as_posix()
    except ValueError:
        return str(path)
