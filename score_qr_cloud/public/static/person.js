const title = document.getElementById("person-title");
const records = document.getElementById("records");
const average = document.getElementById("average");
const requestedSlot = new URLSearchParams(location.search).get("slot");
const slot = /^[1-6]$/.test(requestedSlot) ? Number(requestedSlot) : 1;
let last = "";

function render(data) {
  title.textContent = `${data.slot.slot}号选手`;
  average.textContent = data.summary.average == null
    ? "平均分：—"
    : `平均分：${Number(data.summary.average).toFixed(2)}`;
  records.replaceChildren();
  const rowCount = Math.max(14, Math.ceil(data.records.length / 6));
  for (let row = 0; row < rowCount; row++) {
    const tr = document.createElement("tr");
    for (let column = 0; column < 6; column++) {
      const td = document.createElement("td");
      const item = data.records[row * 6 + column];
      if (item) td.textContent = String(item.score);
      tr.append(td);
    }
    records.append(tr);
  }
}

async function load() {
  try {
    const response = await fetch(`/api/person/${slot}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const serialized = JSON.stringify(data);
    if (serialized !== last) {
      render(data);
      last = serialized;
    }
  } catch (error) {
    console.error("评分数据读取失败", error);
  }
}
load();
setInterval(load, 1000);
