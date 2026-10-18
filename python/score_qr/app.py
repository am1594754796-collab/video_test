"""Six-slot LAN scoring. Each QR code belongs to one teacher-assigned code."""

from __future__ import annotations

import io
import re
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import quote

import qrcode
from flask import Flask, abort, redirect, render_template_string, request, send_file

SLOT_COUNT = 6
SCORE_MIN = 1
SCORE_MAX = 5
COMMENT_MAX = 200
CODE_RE = re.compile(r"^[\w-]{1,32}$")

ADMIN_HTML = """
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>扫码打分</title>
<style>
  body { font-family: sans-serif; margin: 24px auto; max-width: 1080px; padding: 0 16px; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  .note { color: #444; }
  .error { color: #8a1f1f; font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 16px; }
  .card { border: 1px solid #ccc; padding: 12px; text-align: center; }
  .card img { width: 160px; height: 160px; }
  label { display: block; margin-bottom: 6px; }
  input[type=text] { width: 8rem; padding: 6px; }
  button, .linkish { font-size: 1rem; padding: 8px 14px; }
  table { border-collapse: collapse; width: 100%; margin-top: 12px; }
  th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
  code { background: #f3f3f3; padding: 0 4px; }
</style>
</head>
<body>
<h1>六个编号 · 扫码打分</h1>
<p class="note">给每个二维码填一个编号（默认 1–6）。手机和这台电脑须在同一 Wi-Fi。分数只记在对应编号上。</p>
{% if error %}<p class="error">{{ error }}</p>{% endif %}
<form method="post" action="/codes">
  <div class="grid">
    {% for slot in slots %}
    <div class="card">
      <label for="code{{ slot.slot }}">编号 {{ slot.slot }}</label>
      <input id="code{{ slot.slot }}" name="code{{ slot.slot }}" value="{{ slot.code }}" maxlength="32" required>
      <p><img src="/qr/{{ slot.slot }}" alt="编号 {{ slot.code }} 的二维码"></p>
      <p>{{ slot.code }}</p>
    </div>
    {% endfor %}
  </div>
  <p><button type="submit">保存编号并刷新二维码</button></p>
</form>

<h2>按编号查看</h2>
<form method="get" action="/lookup">
  <label for="lookup-code">编号</label>
  <input id="lookup-code" name="code" value="{{ lookup_code }}" maxlength="32">
  <button type="submit">查询总分和平均分</button>
</form>
{% if lookup %}
<p>编号 <strong>{{ lookup.code }}</strong>：{{ lookup.count }} 份，总分 <strong>{{ lookup.total }}</strong>，平均分 <strong>{{ lookup.average if lookup.average is not none else "—" }}</strong></p>
{% endif %}

<h2>当前六个编号</h2>
<table>
  <tr><th>编号</th><th>份数</th><th>总分</th><th>平均分</th></tr>
  {% for row in rows %}
  <tr>
    <td>{{ row.code }}</td>
    <td>{{ row.count }}</td>
    <td>{{ row.total }}</td>
    <td>{{ row.average if row.average is not none else "—" }}</td>
  </tr>
  {% endfor %}
</table>

<h2>最近提交</h2>
<table>
  <tr><th>编号</th><th>分数</th><th>备注</th><th>时间</th></tr>
  {% for item in recent %}
  <tr>
    <td>{{ item.code }}</td>
    <td>{{ item.score }}</td>
    <td>{{ item.comment }}</td>
    <td>{{ item.submit_time }}</td>
  </tr>
  {% endfor %}
</table>
<p class="note">程序调用：<code>GET {{ public_base }}/api/summary/编号</code>，返回 count、total、average。</p>
</body>
</html>
"""

RATE_HTML = """
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>为 {{ code }} 打分</title>
<style>
  body { font-family: sans-serif; text-align: center; padding: 32px 16px; }
  .score-btn { font-size: 1.4rem; margin: 8px; padding: 14px 22px; }
  input[type=text] { padding: 8px; width: min(280px, 90vw); }
</style>
</head>
<body>
<h1>为编号 {{ code }} 打分</h1>
{% if error %}<p>{{ error }}</p>{% endif %}
<form method="post">
  <div>
    {% for n in range(1, 6) %}
    <button class="score-btn" type="submit" name="score" value="{{ n }}">{{ n }} 分</button>
    {% endfor %}
  </div>
  <p><input type="text" name="comment" maxlength="200" placeholder="备注（可选）"></p>
</form>
</body>
</html>
"""

DONE_HTML = """
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>已提交</title>
<style>body { font-family: sans-serif; text-align: center; padding: 48px 16px; }</style>
</head>
<body>
<h1>已记到编号 {{ code }}</h1>
<p><a href="{{ again }}">再打一次</a></p>
</body>
</html>
"""


def create_app(db_path: str | Path, public_base: str = "http://127.0.0.1:8000") -> Flask:
    app = Flask(__name__)
    app.config["DB_PATH"] = str(db_path)
    app.config["PUBLIC_BASE"] = public_base.rstrip("/")
    app.config["MAX_CONTENT_LENGTH"] = 8 * 1024
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    _init_db(app.config["DB_PATH"])

    @app.after_request
    def _headers(resp):
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["Content-Security-Policy"] = "default-src 'self'; style-src 'unsafe-inline'; img-src 'self'"
        resp.headers["Referrer-Policy"] = "no-referrer"
        return resp

    @app.get("/")
    def index():
        return _admin(app, lookup=None, lookup_code="", error=None)

    @app.post("/codes")
    def save_codes():
        raw = [request.form.get(f"code{i}", "") for i in range(1, SLOT_COUNT + 1)]
        codes, error = _parse_codes(raw)
        if error:
            return _admin(app, lookup=None, lookup_code="", error=error), 200
        with _connect(app) as conn:
            conn.execute("DELETE FROM slots")
            conn.executemany(
                "INSERT INTO slots (slot, code) VALUES (?, ?)",
                list(enumerate(codes, start=1)),
            )
        return redirect("/")

    @app.get("/qr/<int:slot>")
    def qr_image(slot: int):
        if slot < 1 or slot > SLOT_COUNT:
            abort(404)
        with _connect(app) as conn:
            row = conn.execute("SELECT code FROM slots WHERE slot = ?", (slot,)).fetchone()
        if row is None:
            abort(404)
        url = f"{app.config['PUBLIC_BASE']}/s/{quote(row['code'], safe='')}"
        img = _qr_png(url)
        return send_file(img, mimetype="image/png")

    @app.route("/s/<code>", methods=["GET", "POST"])
    def rate(code: str):
        if not _valid_code(code) or not _is_assigned(app, code):
            abort(404)
        if request.method == "GET":
            return render_template_string(RATE_HTML, code=code, error=None)
        score, comment, error = _parse_submission(request.form)
        if error:
            return render_template_string(RATE_HTML, code=code, error=error), 400
        with _connect(app) as conn:
            conn.execute(
                "INSERT INTO scores (code, score, comment) VALUES (?, ?, ?)",
                (code, score, comment),
            )
        return render_template_string(DONE_HTML, code=code, again=f"/s/{quote(code, safe='')}")

    @app.get("/api/summary/<code>")
    def api_summary(code: str):
        if not _valid_code(code):
            abort(400)
        return _summary(app, code)

    @app.get("/lookup")
    def lookup():
        code = (request.args.get("code") or "").strip()
        found = None
        error = None
        if code:
            if not _valid_code(code):
                error = "编号只能是 1–32 位字母、数字、中文、下划线或连字符。"
            else:
                found = _summary(app, code)
        return _admin(app, lookup=found, lookup_code=code, error=error)

    return app


def _admin(app: Flask, lookup, lookup_code: str, error: str | None):
    with _connect(app) as conn:
        slots = [dict(r) for r in conn.execute("SELECT slot, code FROM slots ORDER BY slot").fetchall()]
        recent = [
            dict(r)
            for r in conn.execute(
                "SELECT code, score, comment, submit_time FROM scores ORDER BY id DESC LIMIT 20"
            ).fetchall()
        ]
    rows = [_summary(app, slot["code"]) for slot in slots]
    return render_template_string(
        ADMIN_HTML,
        slots=slots,
        rows=rows,
        recent=recent,
        lookup=lookup,
        lookup_code=lookup_code,
        error=error,
        public_base=app.config["PUBLIC_BASE"],
    )


def _init_db(db_path: str) -> None:
    conn = sqlite3.connect(db_path)
    try:
        _ensure_schema(conn)
        conn.commit()
    finally:
        conn.close()


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """CREATE TABLE IF NOT EXISTS slots (
            slot INTEGER PRIMARY KEY,
            code TEXT NOT NULL UNIQUE
        )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL,
            score INTEGER NOT NULL,
            comment TEXT NOT NULL DEFAULT '',
            submit_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )"""
    )
    count = conn.execute("SELECT COUNT(*) FROM slots").fetchone()[0]
    if count == 0:
        conn.executemany(
            "INSERT INTO slots (slot, code) VALUES (?, ?)",
            [(i, str(i)) for i in range(1, SLOT_COUNT + 1)],
        )


@contextmanager
def _connect(app: Flask):
    conn = sqlite3.connect(app.config["DB_PATH"])
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _valid_code(code: str) -> bool:
    return bool(CODE_RE.fullmatch(code))


def _parse_codes(raw: list[str]) -> tuple[list[str] | None, str | None]:
    codes = [item.strip() for item in raw]
    if len(codes) != SLOT_COUNT:
        return None, "需要正好六个编号。"
    if any(not _valid_code(code) for code in codes):
        return None, "每个编号只能是 1–32 位字母、数字、中文、下划线或连字符。"
    if len(set(codes)) != SLOT_COUNT:
        return None, "六个编号不能重复。"
    return codes, None


def _parse_submission(form) -> tuple[int | None, str, str | None]:
    raw_score = form.get("score", "")
    if raw_score not in {str(n) for n in range(SCORE_MIN, SCORE_MAX + 1)}:
        return None, "", "请选择 1 到 5 分。"
    comment = (form.get("comment") or "").strip()
    if len(comment) > COMMENT_MAX:
        return None, "", "备注请控制在 200 字以内。"
    return int(raw_score), comment, None


def _is_assigned(app: Flask, code: str) -> bool:
    with _connect(app) as conn:
        row = conn.execute("SELECT 1 FROM slots WHERE code = ?", (code,)).fetchone()
    return row is not None


def _summary(app: Flask, code: str) -> dict:
    with _connect(app) as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS count, COALESCE(SUM(score), 0) AS total FROM scores WHERE code = ?",
            (code,),
        ).fetchone()
    count = int(row["count"])
    total = int(row["total"])
    average = round(total / count, 2) if count else None
    return {"code": code, "count": count, "total": total, "average": average}


def _qr_png(url: str) -> io.BytesIO:
    qr = qrcode.QRCode(box_size=8, border=2)
    qr.add_data(url)
    qr.make(fit=True)
    image = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    buf.seek(0)
    return buf


def get_lan_ip() -> str:
    import socket

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()
