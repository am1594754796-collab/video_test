from vision_face import parse_faces_response, vision_face_configured


def test_parse_faces_json():
    faces = parse_faces_response(
        '{"faces":[{"x_min":0.6,"y_min":0.1,"width":0.2,"height":0.25,"score":0.9},'
        '{"x_min":0.1,"y_min":0.12,"width":0.18,"height":0.22,"score":0.95}]}'
    )
    assert len(faces) == 2
    assert faces[0]["cx"] < faces[1]["cx"]


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
