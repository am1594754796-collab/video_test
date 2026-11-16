const cards = document.getElementById("cards");
const status = document.getElementById("status");
const clearScores = document.getElementById("clear-scores");
let lastRows = "";

if (clearScores) {
  clearScores.addEventListener("submit", (event) => {
    if (!window.confirm("确定清空全部评分吗？所有编号的历史评分将被删除，且无法撤销。")) {
      event.preventDefault();
    }
  });
}

function render(rows) {
  cards.replaceChildren();
  for (const row of rows) {
    const card = document.createElement("article");
    card.className = "card";
    const title = document.createElement("div");
    title.className = "num";
    title.textContent = `#${row.slot}`;
    const name = document.createElement("div");
    name.className = "detail";
    name.textContent = row.name || `${row.slot}号`;
    const average = document.createElement("div");
    average.className = "avg";
    average.textContent = row.average == null ? "—" : Number(row.average).toFixed(2);
    const detail = document.createElement("div");
    detail.className = "detail";
    detail.textContent = `平均分 · ${row.count} 份 · 总分 ${row.total}`;
    card.append(title, name, average, detail);
    cards.append(card);
  }
}

async function load() {
  try {
    const api = document.body?.dataset?.liveApi || "/api/live-scores";
    const response = await fetch(api, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const serialized = JSON.stringify(data.rows);
    if (serialized !== lastRows) {
      render(data.rows);
      lastRows = serialized;
    }
    if (status) status.textContent = `已连接 · 最近检查 ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    if (status) status.textContent = `连接中断：${error.message}`;
  }
}

load();
setInterval(load, 1000);
