from vision_face import parse_faces_response, vision_face_configured


def test_parse_faces_json():
    faces = parse_faces_response(
        '{"faces":[{"x_min":0.6,"y_min":0.1,"width":0.2,"height":0.25,"score":0.9},'
        '{"x_min":0.1,"y_min":0.12,"width":0.18,"height":0.22,"score":0.95}]}'
    )
    assert len(faces) == 2
    assert faces[0]["cx"] < faces[1]["cx"]
    assert faces[0]["index"] == 1
    assert faces[1]["index"] == 2


def test_parse_faces_ignores_model_index_and_sorts_left_to_right():
    faces = parse_faces_response(
        '{"faces":[{"index":1,"x_min":0.7,"y_min":0.1,"width":0.15,"height":0.2},'
        '{"index":2,"x_min":0.1,"y_min":0.1,"width":0.15,"height":0.2}]}'
    )
    assert faces[0]["index"] == 1
    assert faces[0]["x_min"] == 0.1
    assert faces[1]["index"] == 2
    assert faces[1]["x_min"] == 0.7


def test_parse_faces_percent_coords_still_left_to_right():
    faces = parse_faces_response(
        '{"faces":[{"x_min":62,"y_min":12,"width":18,"height":22},'
        '{"x_min":10,"y_min":12,"width":18,"height":22}]}'
    )
    assert len(faces) == 2
    assert faces[0]["index"] == 1
    assert faces[0]["cx"] < faces[1]["cx"]
    assert abs(faces[0]["x_min"] - 0.10) < 1e-6


def test_parse_faces_xyxy():
    faces = parse_faces_response('{"faces":[{"x1":0.1,"y1":0.1,"x2":0.3,"y2":0.4}]}')
    assert len(faces) == 1
    assert abs(faces[0]["width"] - 0.2) < 1e-6


def test_parse_faces_markdown_fence():
    faces = parse_faces_response('```json\n{"faces":[]}\n```')
    assert faces == []


def test_vision_face_configured_false_without_key(monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("VISION_LLM_API_KEY", raising=False)
    monkeypatch.delenv("SPEECH_LLM_API_KEY", raising=False)
    monkeypatch.setenv("VISION_FACE_MODE", "qwen")
    assert vision_face_configured() is False
