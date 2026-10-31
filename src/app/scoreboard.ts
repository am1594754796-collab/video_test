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

const SEATS = [1, 2, 3, 4, 5, 6] as const;
/** Seat index → points. */
const scores = new Map<number, number>();
/** Winner flashes through answer judging and the five-second score display. */
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
  for (const index of SEATS) {
    const card = document.createElement("article");
    card.className = "seat" + (flashingIndex === index ? " flashing" : "");
    card.innerHTML = `
      <div class="num">#${index}</div>
      ${flashingIndex === index ? '<div class="winner-label">抢答成功</div>' : ''}
      <div class="score">积分 <strong>${scores.get(index) ?? 0}</strong></div>
    `;
    boardEl.appendChild(card);
  }
}

function onNumberingLocked(nextSeats: number[]): void {
  flashingIndex = null;
  renderScoreBoard();
  setBusStatus(`已锁定参与者：${nextSeats.map((n) => `#${n}`).join(" ")}`);
  setStatus("编号已锁定 · 等待视觉页「最先举手」");
}

function ensureSeat(personIndex: number): void {
  if (!SEATS.includes(personIndex as (typeof SEATS)[number])) return;
  if (!scores.has(personIndex)) scores.set(personIndex, 0);
}

function onFirstRaise(personIndex: number): void {
  ensureSeat(personIndex);
  flashingIndex = personIndex;
  renderScoreBoard();
  setStatus(`#${personIndex} 最先举手 · 持续闪烁 · 请在语音页作答`);
  setBusStatus(`抢答中：#${personIndex}`);
}

function onEarlyRaise(personIndex: number): void {
  ensureSeat(personIndex);
  const next = Math.max(0, (scores.get(personIndex) ?? 0) - 1);
  scores.set(personIndex, next);
  renderScoreBoard();
  setStatus(`#${personIndex} 提前举手 · 扣 1 分 → ${next}`);
  setBusStatus(`提前举手：#${personIndex} -1`);
}

function onAnswerResult(opts: {
  passed: boolean;
  letter?: string;
  personIndex?: number;
  transcript?: string;
}): void {
  const idx = opts.personIndex ?? flashingIndex;
  if (idx == null) {
    setStatus("收到判题信号，但没有抢答座位（请先举手）");
    return;
  }
  ensureSeat(idx);
  const delta = opts.passed ? 1 : -1;
  const next = Math.max(0, (scores.get(idx) ?? 0) + delta);
  scores.set(idx, next);
  renderScoreBoard();
  const tip = opts.transcript
    ? ` ·「${opts.transcript}」`
    : opts.letter
      ? ` · 选 ${opts.letter}`
      : "";
  const verdict = opts.passed ? "答对 +1" : "答错 −1";
  setStatus(`#${idx} ${verdict} → ${next} · 展示 5 秒后进入下一题${tip}`);
  setBusStatus(`上一题：#${idx} ${opts.passed ? "+1" : "-1"}`);
}

function onAnswerPassed(transcript?: string): void {
  onAnswerResult({ passed: true, transcript });
}

function onRaceReset(): void {
  if (flashingIndex != null) {
    flashingIndex = null;
    renderScoreBoard();
    setStatus("视觉页已重置本轮 · 闪烁已清除 · 等待再次举手");
  }
}

function onNumberingCleared(): void {
  flashingIndex = null;
  renderScoreBoard();
  setBusStatus("编号已清除 · 等待视觉页重新锁定", false);
  setStatus("视觉页解除编号 · 等待重新锁定");
}

function onScoresSnapshot(next: Record<string, number>): void {
  for (const index of SEATS) {
    const value = next[String(index)];
    scores.set(index, typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0);
  }
  renderScoreBoard();
  setBusStatus("已同步抢答页分数");
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
    case "early-raise":
      onEarlyRaise(event.personIndex);
      break;
    case "race-reset":
      onRaceReset();
      break;
    case "answer-passed":
      onAnswerPassed(event.transcript);
      break;
    case "answer-result":
      onAnswerResult({
        passed: event.passed,
        letter: event.letter,
        personIndex: event.personIndex,
        transcript: event.transcript,
      });
      break;
    case "scores-clear":
      for (const i of scores.keys()) scores.set(i, 0);
      flashingIndex = null;
      renderScoreBoard();
      setStatus("积分已清空");
      break;
    case "scores-snapshot":
      onScoresSnapshot(event.scores);
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
setBusStatus("等待抢答页同步分数", true);
setStatus("请在另一个标签页打开教室抢答页，开始答题后分数会实时变化");
renderScoreBoard();
publishClassroomEvent({ type: "scores-snapshot-request", source: "scoreboard" });
