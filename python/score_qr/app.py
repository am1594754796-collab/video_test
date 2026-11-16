"""Six-slot LAN scoring. Each QR code belongs to one teacher-assigned code."""

from __future__ import annotations

import io
import re
import secrets
import sqlite3
from contextlib import contextmanager
from pathlib import Path

import qrcode
from flask import Flask, abort, make_response, redirect, render_template_string, request, send_file


SLOT_COUNT = 6
SCORE_MIN = 0
SCORE_MAX = 100
COMMENT_MAX = 200
CODE_RE = re.compile(r"^[\w-]{1,32}$")
DEVICE_COOKIE = "score_qr_device"
DEVICE_RE = re.compile(r"^[A-Za-z0-9_-]{32,64}$")
DEVICE_COOKIE_AGE = 365 * 24 * 60 * 60

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
<p class="note">六人分别使用自己的二维码，扫码后直接给对应编号打分。同一浏览器对每个编号只能评分一次。</p>
<p><a href="/person?slot=1">单人评分展示</a></p>
<p><a href="/qrs">六人评分二维码展示</a></p>
<p><a href="/live">打开实时评分展示页</a></p>
{% if can_clear %}<form id="clear-scores" method="post" action="/scores/clear"><input type="hidden" name="token" value="{{ clear_token }}"><button type="submit">清空全部评分</button></form>{% endif %}
{% if error %}<p class="error">{{ error }}</p>{% endif %}
<form method="post" action="/codes">
  <div class="grid">
    {% for slot in slots %}
    <div class="card">
      <label for="code{{ slot.slot }}">编号 {{ slot.slot }}</label>
      <input id="code{{ slot.slot }}" name="code{{ slot.slot }}" value="{{ slot.code }}" maxlength="32" required>
      <p>{{ slot.code }}</p><img src="/qr/{{ slot.slot }}" alt="{{ slot.slot }} 号评分二维码"><p><a href="/person?slot={{ slot.slot }}">查看单人展示</a></p>
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
<script src="/static/admin.js"></script>
</body>
</html>
"""

RATE_HTML = """
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>扫码评分</title>
<style>
  body { font-family: sans-serif; text-align: center; padding: 28px 16px; color: #17212b; background: #f5f8fc; }
  form { max-width: 420px; margin: 24px auto; padding: 24px; background: white; border-radius: 18px; box-shadow: 0 8px 28px #14243a18; }
  .field { margin: 0 0 28px; text-align: left; }
  .field label { display: block; margin-bottom: 10px; font-size: 1.35rem; font-weight: 800; }
  .field select, .field input { box-sizing: border-box; width: 100%; min-height: 68px; padding: 10px 16px; border: 3px solid #2870d5; border-radius: 12px; background: #fff; color: #142c4c; font-size: 2rem; font-weight: 700; }
  .field select:focus, .field input:focus { outline: 4px solid #9ec7ff; outline-offset: 2px; }
  input[type=text] { box-sizing: border-box; width: 100%; padding: 12px; font-size: 1rem; }
  button { width: 100%; min-height: 58px; border: 0; border-radius: 12px; background: #1765ce; color: white; font-size: 1.3rem; font-weight: 700; }
</style>
</head>
<body>
<h1>扫码评分</h1>
{% if error %}<p>{{ error }}</p>{% endif %}
<form method="post">
  {% if locked_slot %}<p>正在给 <strong>{{ locked_slot.slot }} 号 · {{ locked_slot.code }}</strong> 打分</p><input type="hidden" name="slot" value="{{ locked_slot.slot }}">{% else %}<div class="field"><label for="slot">选择编号</label><select id="slot" name="slot" required><option value="">请选择</option>{% for slot in slots %}<option value="{{ slot.slot }}" {% if selected_slot == slot.slot|string %}selected{% endif %}>{{ slot.slot }} 号</option>{% endfor %}</select></div>{% endif %}
  <div class="field"><label for="score">分数（0–100）</label><input id="score" name="score" type="number" inputmode="numeric" min="0" max="100" step="1" value="{{ selected_score }}" required></div>
  <p><input type="text" name="comment" maxlength="200" placeholder="备注（可选）"></p>
  <button type="submit">提交评分</button>
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
</body>
</html>
"""

ALREADY_HTML = """
<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>已评分</title></head>
<body style="font-family:sans-serif;text-align:center;padding:48px 16px">
<h1>您已给编号 {{ code }} 提交过评分</h1>
</body>
</html>
"""

LIVE_HTML = """
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>扫码评分 · 实时展示</title>
<style>
body{font-family:system-ui,sans-serif;background:#101820;color:#eef3f7;margin:0;padding:24px}
main{max-width:1100px;margin:auto}h1{margin-bottom:4px}p{color:#a9b8c4}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px}
.card{background:#1b2934;border:2px solid #344a59;border-radius:16px;padding:20px}
.num{font-size:3rem;font-weight:800}.avg{font-size:2.5rem;color:#65dcbd;font-weight:800}
.detail{font-size:1rem;color:#a9b8c4}.missing{color:#ffb86b}button{padding:10px 16px;font-size:1rem}
a{color:#8ac7ff}#status{min-height:1.5em}.qr{width:130px;height:130px;background:white;display:block;margin:14px 0}
</style>
</head>
<body><main>
<section class="grid" id="cards"></section>
</main>
<script src="/static/live.js"></script></body></html>
"""


PERSON_HTML = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>单人评分展示</title>
<style>
*{box-sizing:border-box}body{font-family:system-ui,"Microsoft YaHei",sans-serif;background:#11161c;margin:0}
main{min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:clamp(12px,2vw,36px)}
.scroll{width:min(100%,1600px);height:min(90vh,900px);overflow:auto;background:#fff}
table{width:100%;height:100%;table-layout:fixed;border-collapse:collapse;background:#fff;color:#111}
th,td{border:1px solid #111;text-align:center}
thead th{position:sticky;top:0;background:#fff;font-size:clamp(1.8rem,3vw,3rem);height:clamp(52px,7vh,80px);z-index:1}
tbody td{height:clamp(38px,5vh,60px);font-size:clamp(1.3rem,2.4vw,2.5rem);vertical-align:middle}
tfoot td{position:sticky;bottom:0;height:clamp(48px,6vh,72px);font-size:clamp(1.4rem,2.5vw,2.5rem);font-weight:700;background:#fff}
</style></head><body><main>
<div class="scroll"><table><thead><tr><th id="person-title" colspan="6">1号选手</th></tr></thead><tbody id="records"></tbody><tfoot><tr id="average-row"><td id="average" colspan="6">平均分：—</td></tr></tfoot></table></div>
</main><script src="/static/person.js"></script></body></html>"""

QR_PAGE_HTML = """<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>评分二维码</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,"Microsoft YaHei",sans-serif;background:#11161c;color:#f4f7fb}
main{min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:clamp(16px,3vw,48px)}
.grid{width:min(100%,1600px);display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(12px,2vw,28px)}
.card{background:#1a222c;border:2px solid #344a59;border-radius:20px;text-align:center;padding:clamp(16px,2vw,32px)}
.num{font-size:clamp(28px,3vw,52px);font-weight:800;margin-bottom:16px}
img{display:block;width:min(100%,260px);aspect-ratio:1;margin:auto;background:#fff;padding:10px}
@media(max-width:650px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.num{font-size:24px}}
</style></head><body><main><section class="grid">
{% for slot in range(1, 7) %}<article class="card"><div class="num">{{ slot }} 号评分</div><img src="/qr/{{ slot }}" alt="{{ slot }} 号评分二维码"></article>{% endfor %}
</section></main></body></html>"""


def create_app(db_path: str | Path, public_base: str = "http://127.0.0.1:8000", public_only: bool = False) -> Flask:
    app = Flask(__name__)
    app.config["DB_PATH"] = str(db_path)
    app.config["PUBLIC_BASE"] = public_base.rstrip("/")
    app.config["MAX_CONTENT_LENGTH"] = 8 * 1024
    app.config["CLEAR_TOKEN"] = secrets.token_urlsafe(32)
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    _init_db(app.config["DB_PATH"])

    @app.before_request
    def _limit_public_routes():
        if public_only:
            scoring = (request.path == "/s" or re.fullmatch(r"/s/[1-6]", request.path)) and request.method in {"GET", "POST"}
            display = request.method == "GET" and (
                request.path in {"/live", "/person", "/qrs", "/api/live-scores", "/static/live.js", "/static/person.js"}
                or re.fullmatch(r"/api/person/[1-6]", request.path)
                or re.fullmatch(r"/qr/[1-6]", request.path)
            )
            if not (scoring or display):
                abort(404)

    @app.after_request
    def _headers(resp):
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["Content-Security-Policy"] = "default-src 'self'; style-src 'unsafe-inline'; img-src 'self'"
        resp.headers["Referrer-Policy"] = "no-referrer"
        return resp

    @app.get("/")
    def index():
        return _admin(app, lookup=None, lookup_code="", error=None)

    @app.get("/live")
    def live_board():
        can_clear = not public_only and request.remote_addr in {"127.0.0.1", "::1"}
        return render_template_string(LIVE_HTML, clear_token=app.config["CLEAR_TOKEN"], can_clear=can_clear, cleared=request.args.get("cleared") == "1")

    @app.get("/person")
    def person_board():
        return render_template_string(PERSON_HTML)

    @app.get("/qrs")
    def qr_board():
        return render_template_string(QR_PAGE_HTML)

    @app.get("/api/person/<int:slot_number>")
    def person_scores(slot_number):
        with _connect(app) as conn:
            slot = conn.execute("SELECT slot, code FROM slots WHERE slot = ?", (slot_number,)).fetchone()
            if slot is None:
                abort(404)
            records = [dict(row) for row in conn.execute("SELECT score, submit_time FROM scores WHERE code = ? ORDER BY id DESC", (slot["code"],))]
        response = make_response({"slot": dict(slot), "summary": _summary(app, slot["code"]), "records": records})
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.post("/scores/clear")
    def clear_scores():
        if request.remote_addr not in {"127.0.0.1", "::1"}:
            abort(403)
        if not secrets.compare_digest(request.form.get("token", ""), app.config["CLEAR_TOKEN"]):
            abort(403)
        with _connect(app) as conn:
            conn.execute("DELETE FROM scores")
            conn.execute("DELETE FROM score_voters")
        return redirect("/live?cleared=1")

    @app.get("/api/live-scores")
    def live_scores():
        with _connect(app) as conn:
            rows = [dict(row) for row in conn.execute(
                """SELECT slots.slot, slots.code, COUNT(scores.id) AS count,
                          COALESCE(SUM(scores.score), 0) AS total
                   FROM slots LEFT JOIN scores ON scores.code = slots.code
                   GROUP BY slots.slot, slots.code ORDER BY slots.slot"""
            )]
        for row in rows:
            row["average"] = round(row["total"] / row["count"], 2) if row["count"] else None
        response = make_response({"rows": rows})
        response.headers["Cache-Control"] = "no-store"
        return response

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

    @app.get("/qr")
    @app.get("/qr/<int:slot_number>")
    def qr_image(slot_number=None):
        if slot_number is not None:
            with _connect(app) as conn:
                if conn.execute("SELECT 1 FROM slots WHERE slot = ?", (slot_number,)).fetchone() is None:
                    abort(404)
        url = f"{app.config['PUBLIC_BASE']}/s" + (f"/{slot_number}" if slot_number is not None else "")
        img = _qr_png(url)
        response = send_file(img, mimetype="image/png")
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.route("/s", methods=["GET", "POST"])
    @app.route("/s/<int:slot_number>", methods=["GET", "POST"])
    def rate(slot_number=None):
        device_id = request.cookies.get(DEVICE_COOKIE, "")
        if not DEVICE_RE.fullmatch(device_id):
            device_id = secrets.token_urlsafe(32)
        with _connect(app) as conn:
            slots = [dict(row) for row in conn.execute("SELECT slot, code FROM slots ORDER BY slot")]
        locked_slot = next((row for row in slots if row["slot"] == slot_number), None)
        if slot_number is not None and locked_slot is None:
            abort(404)
        if locked_slot and _already_scored(app, device_id, locked_slot["code"]):
            response = make_response(render_template_string(ALREADY_HTML, code=locked_slot["code"]), 409 if request.method == "POST" else 200)
            _set_device_cookie(response, device_id)
            return response
        if request.method == "GET":
            response = make_response(render_template_string(RATE_HTML, slots=slots, locked_slot=locked_slot, selected_slot="", selected_score="", error=None))
            _set_device_cookie(response, device_id)
            return response
        selected_slot = str(slot_number) if locked_slot else request.form.get("slot", "")
        slot = next((row for row in slots if str(row["slot"]) == selected_slot), None)
        score, comment, error = _parse_submission(request.form)
        if slot is None:
            error = "请选择 1–6 号。"
        if error:
            response = make_response(render_template_string(RATE_HTML, slots=slots, locked_slot=locked_slot, selected_slot=selected_slot, selected_score=request.form.get("score", ""), error=error), 400)
            _set_device_cookie(response, device_id)
            return response
        if _already_scored(app, device_id, slot["code"]):
            response = make_response(render_template_string(ALREADY_HTML, code=slot["code"]), 409)
            _set_device_cookie(response, device_id)
            return response
        try:
            with _connect(app) as conn:
                conn.execute(
                    "INSERT INTO scores (code, score, comment, device_id) VALUES (?, ?, ?, ?)",
                    (slot["code"], score, comment, device_id),
                )
        except sqlite3.IntegrityError:
            response = make_response(render_template_string(ALREADY_HTML, code=slot["code"]), 409)
            _set_device_cookie(response, device_id)
            return response
        response = make_response(render_template_string(DONE_HTML, code=slot["code"]))
        _set_device_cookie(response, device_id)
        return response

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
        can_clear=request.remote_addr in {"127.0.0.1", "::1"},
        clear_token=app.config["CLEAR_TOKEN"],
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
            submit_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            device_id TEXT
        )"""
    )
    columns = {row[1] for row in conn.execute("PRAGMA table_info(scores)")}
    if "device_id" not in columns:
        conn.execute("ALTER TABLE scores ADD COLUMN device_id TEXT")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS scores_one_per_device_code ON scores (code, device_id)")
    conn.execute("CREATE TABLE IF NOT EXISTS score_voters (device_id TEXT PRIMARY KEY)")
    conn.execute("INSERT OR IGNORE INTO score_voters (device_id) SELECT DISTINCT device_id FROM scores WHERE device_id IS NOT NULL")
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


def _already_scored(app: Flask, device_id: str, code: str) -> bool:
    with _connect(app) as conn:
        row = conn.execute("SELECT 1 FROM scores WHERE device_id = ? AND code = ?", (device_id, code)).fetchone()
    return row is not None


def _set_device_cookie(response, device_id: str) -> None:
    response.set_cookie(
        DEVICE_COOKIE,
        device_id,
        max_age=DEVICE_COOKIE_AGE,
        httponly=True,
        samesite="Lax",
    )


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
        return None, "", "请输入 0 到 100 的整数分数。"
    comment = (form.get("comment") or "").strip()
    if len(comment) > COMMENT_MAX:
        return None, "", "备注请控制在 200 字以内。"
    return int(raw_score), comment, None


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
