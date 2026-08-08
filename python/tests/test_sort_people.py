from sort_people import sort_people_left_to_right


def test_empty():
    assert sort_people_left_to_right([]) == {"count": 0, "people": []}


def test_sort_left_to_right():
    result = sort_people_left_to_right(
        [
            {"id": "r", "x": 0.8, "y": 0.4},
            {"id": "l", "x": 0.2, "y": 0.4},
            {"id": "m", "x": 0.5, "y": 0.4},
        ]
    )
    assert result["count"] == 3
    assert [p["index"] for p in result["people"]] == [1, 2, 3]
    assert [p["id"] for p in result["people"]] == ["l", "m", "r"]


def test_max_people_keeps_leftmost():
    result = sort_people_left_to_right(
        [{"x": 0.1}, {"x": 0.2}, {"x": 0.3}, {"x": 0.9}],
        max_people=3,
    )
    assert result["count"] == 3
    assert [round(p["x"], 1) for p in result["people"]] == [0.1, 0.2, 0.3]
