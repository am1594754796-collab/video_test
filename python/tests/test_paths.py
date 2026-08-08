from pathlib import Path

import pytest

from speech_answer.paths import (
    DEFAULT_ANSWERS_RELATIVE,
    PYTHON_ROOT,
    resolve_answers_path,
    to_relative_display,
)


def test_resolve_relative_under_python_root():
    resolved = resolve_answers_path("data/answers.json")
    assert resolved == (PYTHON_ROOT / "data" / "answers.json").resolve()
    assert resolved.is_file()


def test_default_relative_constant():
    assert DEFAULT_ANSWERS_RELATIVE == "data/answers.json"


def test_to_relative_display_roundtrip():
    p = resolve_answers_path("data/answers.json")
    assert to_relative_display(p) == "data/answers.json"


def test_empty_path_rejected():
    with pytest.raises(ValueError):
        resolve_answers_path("   ")
