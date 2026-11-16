import { publishClassroomEvent } from "./classroomBus";

const form = document.querySelector<HTMLFormElement>("#score-form")!;
const status = document.querySelector<HTMLElement>("#status")!;
const saveButton = document.querySelector<HTMLButtonElement>("#save")!;
const seats = [1, 2, 3, 4, 5, 6] as const;
const nameInput = (seat: number) => form.elements.namedItem(`name${seat}`) as HTMLInputElement;
const scoreInput = (seat: number) => form.elements.namedItem(`score${seat}`) as HTMLInputElement;
let dirty = false;
let saving = false;
let flashing: number | null = null;
let loadVersion = 0;

async function load(): Promise<void> {
  const version = loadVersion;
  try {
    const response = await fetch("/api/classroom-scores", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const state = await response.json() as {
      scores: Record<string, number>;
      names?: Record<string, string>;
      flashing: number | null;
    };
    if (state.names === undefined) throw new Error("请关闭并重新运行课堂启动脚本，加载新版分数接口");
    if (version !== loadVersion) return;
    if (!saving) saveButton.disabled = false;
    flashing = state.flashing;
    if (dirty || saving) return;
    for (const seat of seats) {
      nameInput(seat).value = state.names?.[String(seat)] ?? "";
      scoreInput(seat).value = String(state.scores[String(seat)] ?? 0);
    }
    status.textContent = "已同步当前分数";
  } catch (error) {
    saveButton.disabled = true;
    if (!dirty) status.textContent = `读取失败：${error instanceof Error ? error.message : error}`;
  }
}

form.addEventListener("input", () => {
  dirty = true;
  status.textContent = "有未保存的修改";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (saving || !form.reportValidity()) return;
  const scores: Record<string, number> = {};
  const names: Record<string, string> = {};
  for (const seat of seats) {
    const value = Number(scoreInput(seat).value);
    if (!Number.isInteger(value) || value < 0 || value > 100000) {
      status.textContent = `${seat} 号分数应为 0–100000 的整数`;
      return;
    }
    scores[String(seat)] = value;
    names[String(seat)] = nameInput(seat).value.trim();
  }
  saving = true;
  saveButton.disabled = true;
  status.textContent = "正在保存…";
  try {
    const response = await fetch("/api/classroom-scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scores, names, flashing }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    publishClassroomEvent({ type: "scores-admin-set", scores, names, source: "scoreboard-admin" });
    dirty = false;
    loadVersion++;
    status.textContent = "已保存，本机与远程计分板将自动更新";
  } catch (error) {
    status.textContent = `保存失败：${error instanceof Error ? error.message : error}`;
  } finally {
    saving = false;
    saveButton.disabled = false;
  }
});

void load();
window.setInterval(() => { if (!dirty && !saving) void load(); }, 1000);
