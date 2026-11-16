/**
 * Scoreboard display only — listens to cross-tab classroom bus.
 * Classroom flow publishes scores to this separate display page.
 */

import { publishClassroomEvent, subscribeClassroomEvents, type ClassroomEvent } from "./classroomBus";

const boardEl = document.querySelector<HTMLElement>("#score-board")!;

const SEATS = [1, 2, 3, 4, 5, 6] as const;
/** Seat index → points. */
const scores = new Map<number, number>();
const names = new Map<number, string>();
/** Winner flashes through answer judging and the five-second score display. */
let flashingIndex: number | null = null;
const localDisplay = location.port === "5173";
let lastPublicState = "";
let pendingSync = Promise.resolve();
let namesReady = !localDisplay;
let namesTouched = false;

function syncScores(): void {
  if (!localDisplay || !namesReady) return;
  const payload = {
    scores: Object.fromEntries(SEATS.map((index) => [String(index), scores.get(index) ?? 0])),
    names: Object.fromEntries(SEATS.map((index) => [String(index), names.get(index) ?? ""])),
    flashing: flashingIndex,
  };
  pendingSync = pendingSync.then(async () => {
    const response = await fetch("/api/classroom-scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }).catch((error) => console.error("计分板同步失败", error));
}

function renderScoreBoard(): void {
  boardEl.innerHTML = "";
  for (const index of SEATS) {
    const card = document.createElement("article");
    card.className = "seat" + (flashingIndex === index ? " flashing" : "");
    const identity = document.createElement("div");
    identity.className = "identity";
    const number = document.createElement("span");
    number.className = "num";
    number.textContent = `#${index}`;
    identity.append(number);
    const name = names.get(index);
    if (name) {
      const personName = document.createElement("span");
      personName.className = "person-name";
      personName.textContent = name;
      identity.append(personName);
    }
    const score = document.createElement("div");
    score.className = "score";
    const value = document.createElement("strong");
    value.textContent = String(scores.get(index) ?? 0);
    value.dataset.digits = String(value.textContent.length);
    score.append(value);
    card.append(identity, score);
    boardEl.appendChild(card);
  }
  syncScores();
}

function onNumberingLocked(): void {
  flashingIndex = null;
  renderScoreBoard();
}

function ensureSeat(personIndex: number): void {
  if (!SEATS.includes(personIndex as (typeof SEATS)[number])) return;
  if (!scores.has(personIndex)) scores.set(personIndex, 0);
}

function onFirstRaise(personIndex: number): void {
  ensureSeat(personIndex);
  flashingIndex = personIndex;
  renderScoreBoard();
}

function onEarlyRaise(personIndex: number): void {
  // Points come from classroom scores-snapshot; only ensure the seat exists.
  ensureSeat(personIndex);
  renderScoreBoard();
}

function onAnswerResult(opts: {
  passed: boolean;
  letter?: string;
  personIndex?: number;
  transcript?: string;
}): void {
  const idx = opts.personIndex ?? flashingIndex;
  if (idx == null) return;
  ensureSeat(idx);
  const delta = opts.passed ? 1 : -1;
  const next = Math.max(0, (scores.get(idx) ?? 0) + delta);
  scores.set(idx, next);
  renderScoreBoard();
}

function onAnswerPassed(transcript?: string): void {
  onAnswerResult({ passed: true, transcript });
}

function onRaceReset(): void {
  if (flashingIndex != null) {
    flashingIndex = null;
    renderScoreBoard();
  }
}

function onNumberingCleared(): void {
  flashingIndex = null;
  renderScoreBoard();
}

function onScoresSnapshot(next: Record<string, number>): void {
  for (const index of SEATS) {
    const value = next[String(index)];
    scores.set(index, typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0);
  }
  renderScoreBoard();
}

function onAdminSet(nextScores: Record<string, number>, nextNames: Record<string, string>): void {
  namesTouched = true;
  for (const index of SEATS) names.set(index, nextNames[String(index)]?.trim() ?? "");
  onScoresSnapshot(nextScores);
}

function handleEvent(event: ClassroomEvent): void {
  switch (event.type) {
    case "numbering-locked":
      onNumberingLocked();
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
      break;
    case "scores-snapshot":
      onScoresSnapshot(event.scores);
      break;
    case "scores-admin-set":
      onAdminSet(event.scores, event.names);
      break;
    default:
      break;
  }
}

if (localDisplay) {
  subscribeClassroomEvents(handleEvent);
  renderScoreBoard();
  publishClassroomEvent({ type: "scores-snapshot-request", source: "scoreboard" });
  void fetch("/api/classroom-scores", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const state = await response.json() as { names?: Record<string, string> };
      if (!namesTouched) {
        for (const index of SEATS) names.set(index, state.names?.[String(index)]?.trim() ?? "");
      }
    })
    .catch((error) => console.error("姓名读取失败", error))
    .finally(() => {
      namesReady = true;
      renderScoreBoard();
    });
} else {
  const refresh = async () => {
    try {
      const response = await fetch("/api/classroom-scores", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const state = await response.json() as { scores: Record<string, number>; names?: Record<string, string>; flashing: number | null };
      const serialized = JSON.stringify(state);
      if (serialized !== lastPublicState) {
        flashingIndex = state.flashing;
        for (const index of SEATS) names.set(index, state.names?.[String(index)]?.trim() ?? "");
        onScoresSnapshot(state.scores);
        lastPublicState = serialized;
      }
    } catch (error) {
      console.error("公网计分板读取失败", error);
    }
  };
  void refresh();
  setInterval(refresh, 1000);
}
