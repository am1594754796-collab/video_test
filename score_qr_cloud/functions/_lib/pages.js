import { SLOT_COUNT } from "./constants.js";
import { escapeHtml } from "./validate.js";

export function adminPage({ slots, rows, recent, lookup, lookupCode, error, publicBase }) {
  // Kept for compatibility; primary UI is the live board.
  const slotCards = slots
    .map(
      (slot) => `<div class="card">
      <label for="code${slot.slot}">编号 ${slot.slot}</label>
      <input id="code${slot.slot}" name="code${slot.slot}" value="${escapeHtml(slot.code)}" maxlength="32" required>
      <p>${escapeHtml(slot.code)}</p><img class="qr" src="/qr/${slot.slot}" alt="${slot.slot} 号评分二维码">
    </div>`,
    )
    .join("");
  const summaryRows = rows
    .map(
      (row) => `<tr>
      <td>${escapeHtml(row.code)}</td>
      <td>${row.count}</td>
      <td>${row.total}</td>
      <td>${row.average == null ? "—" : row.average}</td>
    </tr>`,
    )
    .join("");
  const recentRows = recent
    .map(
      (item) => `<tr>
      <td>${escapeHtml(item.code)}</td>
      <td>${item.score}</td>
      <td>${escapeHtml(item.comment)}</td>
      <td>${escapeHtml(item.submit_time)}</td>
    </tr>`,
    )
    .join("");
  const lookupBlock = lookup
    ? `<p>编号 <strong>${escapeHtml(lookup.code)}</strong>：${lookup.count} 份，总分 <strong>${lookup.total}</strong>，平均分 <strong>${lookup.average == null ? "—" : lookup.average}</strong></p>`
    : "";
  return `<!DOCTYPE html>
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
  label { display: block; margin-bottom: 6px; }
  input[type=text], input[type=password] { width: 8rem; padding: 6px; }
  button { font-size: 1rem; padding: 8px 14px; }
  table { border-collapse: collapse; width: 100%; margin-top: 12px; }
  th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
  .qr { width: 180px; height: 180px; background: #fff; }
</style>
</head>
<body>
<h1>两人扫码打分（管理）</h1>
<p class="note"><a href="/">返回展示页</a></p>
<form id="clear-scores" method="post" action="/scores/clear"><label for="clear_admin_token">管理口令</label><input id="clear_admin_token" name="admin_token" type="password" required autocomplete="current-password"><button type="submit">清空全部评分</button></form>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/codes">
  <div class="grid">${slotCards}</div>
  <p><label for="admin_token">管理口令</label>
  <input id="admin_token" name="admin_token" type="password" required autocomplete="current-password"></p>
  <p><button type="submit">保存编号并刷新二维码</button></p>
</form>
<h2>按编号查看</h2>
<form method="get" action="/lookup">
  <label for="lookup-code">编号</label>
  <input id="lookup-code" name="code" value="${escapeHtml(lookupCode || "")}" maxlength="32">
  <button type="submit">查询总分和平均分</button>
</form>
${lookupBlock}
<h2>当前编号</h2>
<table>
  <tr><th>编号</th><th>份数</th><th>总分</th><th>平均分</th></tr>
  ${summaryRows}
</table>
<h2>最近提交</h2>
<table>
  <tr><th>编号</th><th>分数</th><th>备注</th><th>时间</th></tr>
  ${recentRows}
</table>
<p class="note">程序调用：<code>GET ${escapeHtml(publicBase)}/api/summary/编号</code></p>
<script src="/static/admin.js"></script>
</body>
</html>`;
}

export function ratePage({ slots, selectedSlot, selectedScore, error, lockedSlot = null }) {
  const labelOf = (slot) => escapeHtml(slot.name || `${slot.slot}号`);
  const options = slots
    .map(
      (slot) =>
        `<option value="${slot.slot}" ${String(selectedSlot) === String(slot.slot) ? "selected" : ""}>${labelOf(slot)}</option>`,
    )
    .join("");
  return `<!DOCTYPE html>
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
  input[type=text] { box-sizing: border-box; width: 100%; padding: 12px; font-size: 1rem; }
  button { width: 100%; min-height: 58px; border: 0; border-radius: 12px; background: #1765ce; color: white; font-size: 1.3rem; font-weight: 700; }
</style>
</head>
<body>
<h1>扫码评分</h1>
${error ? `<p>${escapeHtml(error)}</p>` : ""}
<form method="post">
  ${lockedSlot ? `<p>正在给 <strong>${labelOf(lockedSlot)}</strong> 打分</p><input type="hidden" name="slot" value="${lockedSlot.slot}">` : `<div class="field"><label for="slot">选择给谁打分</label><select id="slot" name="slot" required><option value="">请选择</option>${options}</select></div>`}
  <div class="field"><label for="score">分数（0–100）</label><input id="score" name="score" type="number" inputmode="numeric" min="0" max="100" step="1" value="${escapeHtml(selectedScore || "")}" required></div>
  <p><input type="text" name="comment" maxlength="200" placeholder="备注（可选）"></p>
  <button type="submit">提交评分</button>
</form>
</body>
</html>`;
}

export function donePage(name) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>已提交</title>
<style>body{font-family:sans-serif;text-align:center;padding:48px 16px}</style></head>
<body><h1>已记到 ${escapeHtml(name)}</h1></body></html>`;
}

export function alreadyPage(name) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>已评分</title></head>
<body style="font-family:sans-serif;text-align:center;padding:48px 16px"><h1>您已给 ${escapeHtml(name)} 提交过评分</h1></body></html>`;
}

export function livePage({ cleared = false, saved = false, slots = [], error = null }) {
  const nameFields = (slots.length ? slots : [{ slot: 1, name: "1号" }, { slot: 2, name: "2号" }])
    .map(
      (slot) => `<label class="name-field">#${slot.slot}
        <input name="name${slot.slot}" type="text" maxlength="32" required value="${escapeHtml(slot.name || `${slot.slot}号`)}">
      </label>`,
    )
    .join("");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>扫码评分</title>
<style>
body{font-family:system-ui,sans-serif;background:#101820;color:#eef3f7;margin:0;padding:24px}
main{max-width:900px;margin:auto}
.qr-wrap{background:#1b2934;border:2px solid #344a59;border-radius:16px;padding:16px;text-align:center;max-width:280px;margin:8px 0 20px}
.qr{width:min(100%,220px);aspect-ratio:1;background:#fff;display:block;margin:0 auto 10px;border-radius:8px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:8px}
.card{background:#1b2934;border:2px solid #344a59;border-radius:16px;padding:20px}
.num{font-size:3rem;font-weight:800}.avg{font-size:2.5rem;color:#65dcbd;font-weight:800;margin:8px 0}
.detail{font-size:1rem;color:#a9b8c4}#status{min-height:1.5em;color:#a9b8c4}
.admin{margin-top:28px;padding-top:18px;border-top:1px solid #344a59}
.name-form{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin-bottom:16px}
.name-field{display:grid;gap:6px;color:#c5d5e3;font-weight:600}
.name-field input{min-width:140px;padding:10px 12px;border:2px solid #648094;border-radius:10px;background:#101820;color:#fff;font-size:1.1rem}
button{padding:10px 16px;font-size:1rem}
.ok{color:#65dcbd}.error{color:#ff8f8f}
@media(max-width:640px){.grid{grid-template-columns:1fr}}
</style>
</head>
<body><main>
<section class="qr-wrap">
  <img class="qr" src="/qr" alt="统一评分二维码">
  <p class="detail">扫码后选择给谁打分</p>
</section>
<p id="status">正在读取…</p>
${cleared ? `<p class="ok">已清空全部评分</p>` : ""}
${saved ? `<p class="ok">名称已保存</p>` : ""}
${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
<section class="grid" id="cards"></section>
<section class="admin">
<form class="name-form" method="post" action="/codes">
  ${nameFields}
  <button type="submit">保存名称</button>
</form>
<form id="clear-scores" method="post" action="/scores/clear">
  <button type="submit">清空全部评分</button>
</form>
</section>
</main>
<script src="/static/live.js"></script></body></html>`;
}

export function personPage() {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>单人评分展示</title>
<style>
*{box-sizing:border-box}body{font-family:system-ui,"Microsoft YaHei",sans-serif;background:#11161c;margin:0}
main{min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:clamp(12px,2vw,36px)}
.scroll{width:min(100%,1600px);height:min(90vh,900px);overflow:auto;background:#fff}
table{width:100%;height:100%;table-layout:fixed;border-collapse:collapse;background:#fff;color:#111}
th,td{border:1px solid #111;text-align:center}
</style></head><body><main>
<p style="color:#fff"><a href="/" style="color:#8ac7ff">返回展示页</a></p>
</main></body></html>`;
}

export function qrPage() {
  const cards = Array.from({ length: SLOT_COUNT }, (_, i) => {
    const slot = i + 1;
    return `<article class="card"><div class="num">${slot} 号评分</div><img src="/qr/${slot}" alt="${slot} 号评分二维码"></article>`;
  }).join("");
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>评分二维码</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,"Microsoft YaHei",sans-serif;background:#11161c;color:#f4f7fb}
main{min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:clamp(16px,3vw,48px)}
.grid{width:min(100%,900px);display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:clamp(12px,2vw,28px)}
.card{background:#1a222c;border:2px solid #344a59;border-radius:20px;text-align:center;padding:clamp(16px,2vw,32px)}
.num{font-size:clamp(28px,3vw,52px);font-weight:800;margin-bottom:16px}
img{display:block;width:min(100%,260px);aspect-ratio:1;margin:auto;background:#fff;padding:10px}
</style></head><body><main><section class="grid">${cards}</section></main></body></html>`;
}
