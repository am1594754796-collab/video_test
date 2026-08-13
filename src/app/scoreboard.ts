/**
 * Scoreboard display only — listens to cross-tab classroom bus.
 * Vision (people-fast) and speech (speech-online) stay on their own pages.
 */

import {
  publishClassroomEvent,
  subscribeClassroomEvents,
  type ClassroomEvent,
} from "./classroomBus";

const boardEl = document.querySelector<HTMLElement>("#score-board")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const busStatusEl = document.querySelector<HTMLElement>("#bus-status")!;
const btnClear = document.querySelector<HTMLButtonElement>("#btn-clear-scores")!;

/** Seat index → points. */
const scores = new Map<number, number>();
let seats: number[] = [];
/** While set, that number flashes until answer-passed. */
let flashingIndex: number | null = null;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function setBusStatus(text: string, ok = true): void {
  busStatusEl.textContent = text;
  busStatusEl.classList.toggle("ok", ok);
  busStatusEl.classList.toggle("bad", !ok);
}

function renderScoreBoard(): void {
  boardEl.innerHTML = "";
  if (seats.length === 0) {
    return;
  }
  for (const index of seats) {
    const card = document.createElement("article");
    card.className = "seat" + (flashingIndex === index ? " flashing" : "");
    card.innerHTML = `
      <div class="num">#${index}</div>
      <div class="score">积分 <strong>${scores.get(index) ?? 0}</strong></div>
    `;
    boardEl.appendChild(card);
  }
}

function onNumberingLocked(nextSeats: number[]): void {
  seats = [...nextSeats].sort((a, b) => a - b);
  for (const i of seats) {
    if (!scores.has(i)) scores.set(i, 0);
  }
  flashingIndex = null;
  renderScoreBoard();
  setBusStatus(`已同步编号：${seats.map((n) => `#${n}`).join(" ")}`);
  setStatus("编号已锁定 · 等待视觉页「最先举手」");
}

function onFirstRaise(personIndex: number): void {
  if (!seats.includes(personIndex)) {
    seats = [...seats, personIndex].sort((a, b) => a - b);
    if (!scores.has(personIndex)) scores.set(personIndex, 0);
  }
  flashingIndex = personIndex;
  renderScoreBoard();
  setStatus(`#${personIndex} 最先举手 · 持续闪烁 · 请在语音页作答`);
  setBusStatus(`抢答中：#${personIndex}`);
}

function onAnswerPassed(transcript?: string): void {
  if (flashingIndex == null) {
    setStatus("收到答对信号，但当前没有闪烁中的编号（请先在视觉页举手）");
    return;
  }
  const idx = flashingIndex;
  scores.set(idx, (scores.get(idx) ?? 0) + 1);
  flashingIndex = null;
  renderScoreBoard();
  const tip = transcript ? ` ·「${transcript}」` : "";
  setStatus(`#${idx} 答对 · 积分 ${scores.get(idx)} · 已停闪${tip} · 可再举手`);
  setBusStatus(`上一题：#${idx} +1`);
}

function onRaceReset(): void {
  if (flashingIndex != null) {
    flashingIndex = null;
    renderScoreBoard();
    setStatus("视觉页已重置本轮 · 闪烁已清除 · 等待再次举手");
  }
}

function onNumberingCleared(): void {
  seats = [];
  flashingIndex = null;
  renderScoreBoard();
  setBusStatus("编号已清除 · 等待视觉页重新锁定", false);
  setStatus("视觉页解除编号 · 计分板清空座位（积分仍保留在内存，重锁同号会沿用）");
}

function handleEvent(event: ClassroomEvent): void {
  switch (event.type) {
    case "numbering-locked":
      onNumberingLocked(event.seats);
      break;
    case "numbering-cleared":
      onNumberingCleared();
      break;
    case "first-raise":
      onFirstRaise(event.personIndex);
      break;
    case "race-reset":
      onRaceReset();
      break;
    case "answer-passed":
      onAnswerPassed(event.transcript);
      break;
    case "scores-clear":
      for (const i of scores.keys()) scores.set(i, 0);
      flashingIndex = null;
      renderScoreBoard();
      setStatus("积分已清空");
      break;
    default:
      break;
  }
}

btnClear.addEventListener("click", () => {
  publishClassroomEvent({ type: "scores-clear", source: "scoreboard" });
  for (const i of scores.keys()) scores.set(i, 0);
  flashingIndex = null;
  renderScoreBoard();
  setStatus("积分已清空");
});

subscribeClassroomEvents(handleEvent);
setBusStatus("总线已就绪 · 请打开视觉快版与语音页", true);
setStatus("本页只展示计分。请另开标签页运行视觉识别与语音识别。");
renderScoreBoard();
