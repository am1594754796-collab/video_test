from speech_answer.fuzzy_match import (
    MATCH_THRESHOLD,
    fuzzy_score,
    is_match,
    normalize_text,
    pinyin_key,
)


def test_normalize_strips_and_collapses_whitespace():
    assert normalize_text("  北  京  ") == "北京"
    assert normalize_text("光合\t作用") == "光合作用"


def test_exact_match_passes():
    assert fuzzy_score("北京", "北京") == 1.0
    assert is_match("北京", "北京") is True


def test_clear_mismatch_fails():
    assert fuzzy_score("上海", "北京") < MATCH_THRESHOLD
    assert is_match("上海", "北京") is False


def test_threshold_boundary():
    high = fuzzy_score("光合作用", "光合作用")
    assert high >= MATCH_THRESHOLD
    assert is_match("光合作用", "光合作用", threshold=MATCH_THRESHOLD) is True

    low = fuzzy_score("光", "光合作用")
    assert low < MATCH_THRESHOLD
    assert is_match("光", "光合作用") is False


def test_homophone_same_reading_passes():
    # 北经 vs 北京：字形不同，读音同（含调号序列）
    assert pinyin_key("北经") == pinyin_key("北京")
    assert is_match("北经", "北京") is True
    assert fuzzy_score("北经", "北京") >= MATCH_THRESHOLD


def test_different_tone_homograph_like_pair_may_fail():
    # 背景 vs 北京：声母韵母近但调不同，不应轻易过 90%
    assert is_match("背景", "北京") is False


def test_partial_pinyin_still_below_threshold():
    assert is_match("北", "北京") is False
