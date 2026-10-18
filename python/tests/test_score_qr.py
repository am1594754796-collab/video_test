"""LAN score QR service: assign six codes, collect scores, query totals."""

from score_qr.app import create_app


def _client(tmp_path):
    app = create_app(tmp_path / "scores.db", public_base="http://192.168.1.9:8000")
    return app.test_client()


def _assign(client, codes):
    data = {f"code{i}": code for i, code in enumerate(codes, start=1)}
    res = client.post("/codes", data=data, follow_redirects=False)
    assert res.status_code == 302
    assert res.headers["Location"].endswith("/")


def test_default_six_codes_and_qr_png(tmp_path):
    client = _client(tmp_path)
    page = client.get("/")
    assert page.status_code == 200
    body = page.get_data(as_text=True)
    for n in range(1, 7):
        assert f'value="{n}"' in body

    png = client.get("/qr/1")
    assert png.status_code == 200
    assert png.mimetype == "image/png"
    assert png.data[:8] == b"\x89PNG\r\n\x1a\n"

    missing = client.get("/qr/7")
    assert missing.status_code == 404


def test_submit_sums_and_averages_by_code(tmp_path):
    client = _client(tmp_path)
    _assign(client, ["1", "2", "3", "4", "5", "6"])

    assert client.post("/s/3", data={"score": "4", "comment": "清楚"}).status_code == 200
    assert client.post("/s/3", data={"score": "2", "comment": ""}).status_code == 200
    assert client.post("/s/3", data={"score": "5"}).status_code == 200

    summary = client.get("/api/summary/3")
    assert summary.status_code == 200
    body = summary.get_json()
    assert body == {"code": "3", "count": 3, "total": 11, "average": 3.67}

    empty = client.get("/api/summary/1").get_json()
    assert empty["count"] == 0
    assert empty["total"] == 0
    assert empty["average"] is None


def test_reassign_keeps_history_on_old_code(tmp_path):
    client = _client(tmp_path)
    _assign(client, ["1", "2", "3", "4", "5", "6"])
    client.post("/s/1", data={"score": "5", "comment": "a"})

    _assign(client, ["7", "2", "3", "4", "5", "6"])
    assert client.post("/s/1", data={"score": "1"}).status_code == 404
    assert client.post("/s/7", data={"score": "3"}).status_code == 200

    old = client.get("/api/summary/1").get_json()
    assert old["total"] == 5
    assert old["count"] == 1
    new = client.get("/api/summary/7").get_json()
    assert new["total"] == 3
    assert new["average"] == 3.0


def test_rejects_bad_score_duplicate_code_and_escapes_comment(tmp_path):
    client = _client(tmp_path)
    _assign(client, ["1", "2", "3", "4", "5", "6"])

    bad = client.post("/s/1", data={"score": "9", "comment": "x"})
    assert bad.status_code == 400
    assert client.get("/api/summary/1").get_json()["count"] == 0

    injected = client.post("/s/1", data={"score": "4", "comment": "<script>alert(1)</script>"})
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
