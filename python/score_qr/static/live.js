const cards = document.getElementById("cards");
let lastRows = "";

function render(rows) {
  cards.replaceChildren();
  for (const row of rows) {
    const card = document.createElement("article");
    card.className = "card";
    const title = document.createElement("div");
    title.className = "num";
    title.textContent = `#${row.slot}`;
    const code = document.createElement("div");
    code.className = "detail";
    code.textContent = `编号 ${row.code}`;
    const average = document.createElement("div");
    average.className = "avg";
    average.textContent = row.average == null ? "—" : Number(row.average).toFixed(2);
    card.append(title, code, average);
    cards.append(card);
  }
}

async function load() {
  try {
    const response = await fetch("/api/live-scores", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const serialized = JSON.stringify(data.rows);
    if (serialized !== lastRows) {
      render(data.rows);
      lastRows = serialized;
    }
  } catch (error) {
    console.error("评分数据读取失败", error);
  }
}

load();
setInterval(load, 1000);
