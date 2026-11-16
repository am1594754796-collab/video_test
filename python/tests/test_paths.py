from pathlib import Path

import pytest

from speech_answer.paths import (
    DEFAULT_ANSWERS_RELATIVE,
    PYTHON_ROOT,
    resolve_answers_path,
    to_relative_display,
)
from speech_answer import paths


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


def test_configured_path_skips_comment_lines(tmp_path, monkeypatch):
    config = tmp_path / "answers.path"
    config.write_text("# chosen bank\ndata/banks/dividend_insurance/answers.json\n", encoding="utf-8")
    monkeypatch.setattr(paths, "ANSWERS_PATH_CONFIG", config)
    assert paths.read_configured_relative_path() == "data/banks/dividend_insurance/answers.json"
