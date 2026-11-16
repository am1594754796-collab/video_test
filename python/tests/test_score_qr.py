"""LAN score QR service: assign six codes, collect scores, query totals."""

import sqlite3
import re

from score_qr.app import create_app


def _client(tmp_path):
    app = create_app(tmp_path / "scores.db", public_base="http://192.168.1.9:8000")
    return app.test_client()


def _assign(client, codes):
    data = {f"code{i}": code for i, code in enumerate(codes, start=1)}
    res = client.post("/codes", data=data, follow_redirects=False)
    assert res.status_code == 302
    assert res.headers["Location"].endswith("/")


def test_default_six_codes_and_single_qr_png(tmp_path):
    client = _client(tmp_path)
    page = client.get("/")
    assert page.status_code == 200
    body = page.get_data(as_text=True)
    for n in range(1, 7):
        assert f'value="{n}"' in body

    png = client.get("/qr")
    assert png.status_code == 200
    assert png.mimetype == "image/png"
    assert png.data[:8] == b"\x89PNG\r\n\x1a\n"

    missing = client.get("/qr/7")
    assert missing.status_code == 404


def test_public_entry_only_exposes_scoring(tmp_path):
    app = create_app(tmp_path / "scores.db", public_base="https://example.trycloudflare.com", public_only=True)
    client = app.test_client()
    assert client.get("/s").status_code == 200
    assert client.get("/s/1").status_code == 200
    assert client.post("/s", data={"slot": "1", "score": "40"}).status_code == 200
    for path in ("/live", "/person", "/qrs", "/api/live-scores", "/api/person/1", "/static/live.js", "/static/person.js", "/qr/1"):
        assert client.get(path).status_code == 200
    assert "清空全部评分" not in client.get("/live").get_data(as_text=True)
    for path in ("/", "/qr", "/api/summary/1", "/lookup"):
        assert client.get(path).status_code == 404
    assert client.post("/codes", data={}).status_code == 404
    assert client.post("/scores/clear", data={}).status_code == 404


def test_person_qr_and_records_are_scoped_to_slot(tmp_path):
    client = _client(tmp_path)
    person_page = client.get("/person?slot=2")
    assert person_page.status_code == 200
    assert 'id="person-title" colspan="6"' in person_page.get_data(as_text=True)
    assert 'id="average" colspan="6"' in person_page.get_data(as_text=True)
    assert 'id="person-qr"' not in person_page.get_data(as_text=True)
    assert 'id="tabs"' not in person_page.get_data(as_text=True)
    qr_page = client.get("/qrs").get_data(as_text=True)
    for slot in range(1, 7):
        assert f'src="/qr/{slot}"' in qr_page
    assert client.get("/qr/2").mimetype == "image/png"
    assert client.get("/qr/7").status_code == 404
    assert client.post("/s/2", data={"slot": "1", "score": "42"}).status_code == 200
    second = client.get("/api/person/2").get_json()
    assert second["summary"]["average"] == 42
    assert second["records"][0]["score"] == 42
    assert second["records"][0]["submit_time"]
    assert client.get("/api/person/1").get_json()["records"] == []


def test_submit_sums_and_averages_by_code(tmp_path):
    client = _client(tmp_path)
    _assign(client, ["1", "2", "3", "4", "5", "6"])

    assert client.post("/s", data={"slot": "3", "score": "40", "comment": "清楚"}).status_code == 200
    with client.application.test_client() as second_device:
        assert second_device.post("/s", data={"slot": "3", "score": "20", "comment": ""}).status_code == 200
    with client.application.test_client() as third_device:
        assert third_device.post("/s", data={"slot": "3", "score": "50"}).status_code == 200

    summary = client.get("/api/summary/3")
    assert summary.status_code == 200
    body = summary.get_json()
    assert body == {"code": "3", "count": 3, "total": 110, "average": 36.67}

    empty = client.get("/api/summary/1").get_json()
    assert empty["count"] == 0
    assert empty["total"] == 0
    assert empty["average"] is None


def test_one_device_can_rate_each_code_once(tmp_path):
    client = _client(tmp_path)
    first = client.get("/s")
    assert first.status_code == 200
    assert "score_qr_device=" in first.headers["Set-Cookie"]

    submitted = client.post("/s", data={"slot": "2", "score": "0"})
    assert submitted.status_code == 200
    assert "同一浏览器只能评分一次" not in submitted.get_data(as_text=True)
    already = client.get("/s").get_data(as_text=True)
    assert "您已提交过评分" not in already
    assert "同一浏览器只能评分一次" not in already
    assert client.post("/s", data={"slot": "2", "score": "50"}).status_code == 409
    assert client.get("/api/summary/2").get_json()["total"] == 0

    assert client.get("/s/2").status_code == 200
    assert "已给编号 2 提交过评分" in client.get("/s/2").get_data(as_text=True)
    assert client.post("/s/3", data={"slot": "2", "score": "100"}).status_code == 200
    assert client.post("/s/3", data={"score": "50"}).status_code == 409
    assert client.get("/api/summary/3").get_json()["total"] == 100

    with client.application.test_client() as another_device:
        assert another_device.post("/s", data={"slot": "2", "score": "100"}).status_code == 200
    assert client.get("/api/summary/2").get_json()["total"] == 100


def test_live_board_updates_after_submission(tmp_path):
    client = _client(tmp_path)
    assert client.get("/live").status_code == 200
    live_html = client.get("/live").get_data(as_text=True)
    assert '<section class="grid" id="cards"></section>' in live_html
    assert '<h1>' not in live_html
    assert '清空全部评分' not in live_html
    assert '单人评分展示' not in live_html
    assert client.get("/static/live.js").status_code == 200
    initial = client.get("/api/live-scores")
    assert initial.headers["Cache-Control"] == "no-store"
    assert len(initial.get_json()["rows"]) == 6
    assert initial.get_json()["rows"][0]["average"] is None

    assert client.post("/s", data={"slot": "1", "score": "40"}).status_code == 200
    with client.application.test_client() as another_device:
        assert another_device.post("/s", data={"slot": "1", "score": "20"}).status_code == 200
    first = client.get("/api/live-scores").get_json()["rows"][0]
    assert first == {"slot": 1, "code": "1", "count": 2, "total": 60, "average": 30.0}


def test_clear_scores_from_local_live_page(tmp_path):
    client = _client(tmp_path)
    assert client.post("/s", data={"slot": "1", "score": "40"}).status_code == 200
    with client.application.test_client() as another_device:
        assert another_device.post("/s", data={"slot": "2", "score": "50"}).status_code == 200
    assert "清空全部评分" not in client.get("/live").get_data(as_text=True)
    page = client.get("/").get_data(as_text=True)
    assert "清空全部评分" in page
    token = re.search(r'name="token" value="([^"]+)"', page).group(1)

    assert client.get("/scores/clear").status_code == 405
    assert client.post("/scores/clear", data={"token": "wrong"}).status_code == 403
    assert client.get("/api/summary/1").get_json()["count"] == 1
    assert client.post("/scores/clear", data={"token": token}, environ_overrides={"REMOTE_ADDR": "192.168.1.2"}).status_code == 403
    assert "清空全部评分" not in client.get("/", environ_overrides={"REMOTE_ADDR": "192.168.1.2"}).get_data(as_text=True)

    cleared = client.post("/scores/clear", data={"token": token}, follow_redirects=True)
    assert cleared.status_code == 200
    assert cleared.status_code == 200
    assert all(row["count"] == 0 for row in client.get("/api/live-scores").get_json()["rows"])
    assert client.post("/s", data={"slot": "1", "score": "30"}).status_code == 200


def test_existing_database_is_migrated_without_losing_scores(tmp_path):
    db_path = tmp_path / "legacy.db"
    with sqlite3.connect(db_path) as conn:
        conn.execute("CREATE TABLE scores (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, score INTEGER NOT NULL, comment TEXT NOT NULL DEFAULT '', submit_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP)")
        conn.execute("INSERT INTO scores (code, score, comment) VALUES ('1', 5, 'old')")
    app = create_app(db_path)
    client = app.test_client()
    assert client.get("/api/summary/1").get_json()["total"] == 5
    assert client.post("/s", data={"slot": "1", "score": "30"}).status_code == 200
    assert client.post("/s", data={"slot": "1", "score": "20"}).status_code == 409
    assert client.get("/api/summary/1").get_json()["total"] == 35


def test_reassign_keeps_history_on_old_code(tmp_path):
    client = _client(tmp_path)
    _assign(client, ["1", "2", "3", "4", "5", "6"])
    client.post("/s", data={"slot": "1", "score": "50", "comment": "a"})

    _assign(client, ["7", "2", "3", "4", "5", "6"])
    with client.application.test_client() as another_device:
        assert another_device.post("/s", data={"slot": "1", "score": "30"}).status_code == 200

    old = client.get("/api/summary/1").get_json()
    assert old["total"] == 50
    assert old["count"] == 1
    new = client.get("/api/summary/7").get_json()
    assert new["total"] == 30
    assert new["average"] == 30.0


def test_rejects_bad_score_duplicate_code_and_escapes_comment(tmp_path):
    client = _client(tmp_path)
    _assign(client, ["1", "2", "3", "4", "5", "6"])

    bad = client.post("/s", data={"slot": "1", "score": "101", "comment": "x"})
    assert bad.status_code == 400
    assert client.get("/api/summary/1").get_json()["count"] == 0

    injected = client.post("/s", data={"slot": "1", "score": "40", "comment": "<script>alert(1)</script>"})
    assert injected.status_code == 200
    page = client.get("/").get_data(as_text=True)
    assert "<script>alert(1)</script>" not in page
    assert "&lt;script&gt;" in page

    dup = client.post(
        "/codes",
        data={f"code{i}": "1" for i in range(1, 7)},
        follow_redirects=True,
    )
    assert dup.status_code == 200
    assert "不能重复" in dup.get_data(as_text=True)
    assert client.get("/api/summary/2").status_code == 200
