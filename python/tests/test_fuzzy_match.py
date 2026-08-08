from speech_answer.fuzzy_match import (
    MATCH_THRESHOLD,
    fuzzy_score,
    is_match,
    normalize_text,
    pinyin_key,
    score_breakdown,
)


def test_normalize_strips_and_collapses_whitespace():
    assert normalize_text("  北  京  ") == "北京"
    assert normalize_text("光合\t作用") == "光合作用"


def test_exact_match_passes():
    assert fuzzy_score("北京", "北京", use_semantic=False) == 1.0
    assert is_match("北京", "北京", use_semantic=False) is True


def test_clear_mismatch_fails():
    assert fuzzy_score("上海", "北京", use_semantic=False) < MATCH_THRESHOLD
    assert is_match("上海", "北京", use_semantic=False) is False


def test_threshold_boundary():
    high = fuzzy_score("光合作用", "光合作用", use_semantic=False)
    assert high >= MATCH_THRESHOLD
    assert is_match("光合作用", "光合作用", use_semantic=False) is True

    low = fuzzy_score("光", "光合作用", use_semantic=False)
    assert low < MATCH_THRESHOLD
    assert is_match("光", "光合作用", use_semantic=False) is False


def test_homophone_same_reading_passes():
    assert pinyin_key("北经") == pinyin_key("北京")
    assert is_match("北经", "北京", use_semantic=False) is True
    assert fuzzy_score("北经", "北京", use_semantic=False) >= MATCH_THRESHOLD


def test_different_tone_homograph_like_pair_may_fail():
    assert is_match("背景", "北京", use_semantic=False) is False


def test_partial_pinyin_still_below_threshold():
    assert is_match("北", "北京", use_semantic=False) is False


def test_semantic_paraphrase_raises_final_score(monkeypatch):
    """整句同义转述：字形不够时，语义分可把总分抬过 90%。"""
    expected = "植物利用阳光把二氧化碳和水转化成有机物并释放氧气"
    transcript = "绿色植物在光下把水和二氧化碳变成有机物，同时放出氧气"

    lexical = score_breakdown(transcript, expected, use_semantic=False)
    assert lexical["score"] < MATCH_THRESHOLD

    monkeypatch.setattr(
        "speech_answer.semantic.semantic_score",
        lambda _t, _e: 0.93,
    )
    bd = score_breakdown(transcript, expected, use_semantic=True)
    assert bd["semantic"] == 0.93
    assert bd["score"] >= MATCH_THRESHOLD
    assert is_match(transcript, expected, use_semantic=True) is True
