/**
 * Scoreboard: lock people numbers → first raise flashes forever →
 * speech match pass → that seat +1 and stop flash.
 */

import { PoseLandmarker } from "@mediapipe/tasks-vision";
import {
  createCountLockState,
  createPoseLandmarker,
  dedupePosesByTorso,
  detectPosesForVideo,
  FirstRaiseTracker,
  indexByTrackIdFromSlots,
  isHandRaised,
  observePersonCount,
  PoseTracker,
  rebindSlotsToTracks,
  slotsFromSort,
  startCamera,
  torsoCenter,
  unlockCountLock,
  type CameraHandle,
  type CountLockSnapshot,
  type NumberingSlot,
  type TrackedPose,
} from "../vision";
import { POSE } from "../vision/detect/isHandRaised";

const DETECT_INTERVAL_MS = 50;
const RAISE_MARGIN = 0.08;
const LOCK_STABLE_FRAMES = 8;
const REBIND_MAX_DISTANCE = 0.35;
const TRACK_MATCH_DISTANCE = 0.28;
const TRACK_MAX_MISSED = 60;
const MATCH_DEBOUNCE_MS = 280;
const ANSWER_LIMIT_MS = 10_000;

type PersonPoint = { id: number; x: number; y: number };
type SortedPerson = {
  index: number;
  x: number;
  y: number;
  id?: string | number | null;
  raised?: boolean;
};
type SortResponse = { count: number; people: SortedPerson[] };
type Question = { id: string; answer: string };
type MatchResponse = {
  question_id: string;
  transcript: string;
  expected: string;
  score: number;
  passed: boolean;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const video = document.querySelector<HTMLVideoElement>("#video")!;
const canvas = document.querySelector<HTMLCanvasElement>("#overlay")!;
const ctx = canvas.getContext("2d")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const speechLine = document.querySelector<HTMLElement>("#speech-line")!;
const apiStatusEl = document.querySelector<HTMLElement>("#api-status")!;
const boardEl = document.querySelector<HTMLElement>("#score-board")!;
const btnStart = document.querySelector<HTMLButtonElement>("#btn-start")!;
const btnStop = document.querySelector<HTMLButtonElement>("#btn-stop")!;
const btnRelock = document.querySelector<HTMLButtonElement>("#btn-relock")!;
const btnListen = document.querySelector<HTMLButtonElement>("#btn-listen")!;
const inputExpected = document.querySelector<HTMLInputElement>("#input-expected")!;
const questionSelect = document.querySelector<HTMLSelectElement>("#question-select")!;

const SORT_URL = "/api/people/sort";
const HEALTH_URL = "/api/health";

let camera: CameraHandle | null = null;
let landmarker: PoseLandmarker | null = null;
let raf = 0;
let lastTs = 0;
let canvasSized = false;
let apiOk = false;
let tracker = new PoseTracker({
  matchDistance: TRACK_MATCH_DISTANCE,
  maxMissed: TRACK_MAX_MISSED,
  minFrames: 5,
});
let race = new FirstRaiseTracker();
let countLock: CountLockSnapshot = createCountLockState();
let numberingSlots: NumberingSlot[] = [];
let indexByTrackId = new Map<number, number>();
let lockedPeople: SortedPerson[] = [];
let sortInFlight = false;

/** Seat index → points. */
const scores = new Map<number, number>();
/** While set, that number flashes until speech passes. */
let flashingIndex: number | null = null;
let boardDirty = true;

let recognition: SpeechRecognitionLike | null = null;
let listening = false;
let finalTranscript = "";
let interimTranscript = "";
let stopRequested = false;
let passedLocked = false;
let matchTimer: number | null = null;
let matchAbort: AbortController | null = null;
let lastMatchedText = "";
let answerTimer: number | null = null;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function setSpeechLine(text: string): void {
  speechLine.textContent = `转写：${text || "—"}`;
}

function setApiStatus(ok: boolean, detail?: string): void {
  apiOk = ok;
  apiStatusEl.textContent = ok
    ? `API 已连接${detail ? ` · ${detail}` : ""}`
    : `API 未连接${detail ? ` · ${detail}` : ""}`;
  apiStatusEl.classList.toggle("ok", ok);
  apiStatusEl.classList.toggle("bad", !ok);
}

function readExpectedCount(): number {
  const n = Number(inputExpected.value);
  if (!Number.isFinite(n)) return 2;
  return Math.min(6, Math.max(1, Math.round(n)));
}

function ensureCanvasSize(): boolean {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return false;
  if (!canvasSized || canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    canvasSized = true;
  }
  return true;
}

async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    setApiStatus(true, "排序 + 语音匹配");
    return true;
  } catch {
    setApiStatus(false, "请启动 python/server.py");
    return false;
  }
}

async function sortViaPython(people: PersonPoint[]): Promise<SortResponse> {
  const res = await fetch(SORT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ people, max_people: 6 }),
  });
  if (!res.ok) throw new Error(`sort HTTP ${res.status}`);
  return (await res.json()) as SortResponse;
}

function sortLocal(people: PersonPoint[]): SortResponse {
  const sorted = [...people].sort((a, b) => a.x - b.x).slice(0, 6);
  return {
    count: sorted.length,
    people: sorted.map((p, i) => ({
      index: i + 1,
      x: p.x,
      y: p.y,
      id: p.id,
    })),
  };
}

function applyLockFromSort(sorted: SortResponse): void {
  numberingSlots = slotsFromSort(sorted.people);
  indexByTrackId = indexByTrackIdFromSlots(numberingSlots);
  lockedPeople = sorted.people.map((p) => ({ ...p, raised: false }));
  for (const p of sorted.people) {
    if (!scores.has(p.index)) scores.set(p.index, 0);
  }
  boardDirty = true;
  renderScoreBoard();
}

function syncSlotsWithTracks(tracked: TrackedPose[]): void {
  numberingSlots = rebindSlotsToTracks(
    numberingSlots,
    tracked.map((t) => ({ trackId: t.trackId, x: t.center.x, y: t.center.y })),
    { maxDistance: REBIND_MAX_DISTANCE },
  );
  indexByTrackId = indexByTrackIdFromSlots(numberingSlots);
  lockedPeople = numberingSlots.map((s) => ({
    index: s.index,
    x: s.x,
    y: s.y,
    id: s.trackId,
    raised: false,
  }));
}

async function lockNumbering(payload: PersonPoint[]): Promise<void> {
  if (sortInFlight) return;
  sortInFlight = true;
  try {
    if (!apiOk) await checkHealth();
    const sorted = apiOk ? await sortViaPython(payload) : sortLocal(payload);
    if (apiOk) setApiStatus(true, "编号已锁定");
    applyLockFromSort(sorted);
    race = new FirstRaiseTracker();
    flashingIndex = null;
    setStatus(`已锁定 ${sorted.count} 人 · 等待最先举手`);
  } catch {
    setApiStatus(false, "排序失败，已本地锁定");
    applyLockFromSort(sortLocal(payload));
    race = new FirstRaiseTracker();
    setStatus("本地锁定编号 · 等待最先举手");
  } finally {
    sortInFlight = false;
  }
}

function clearNumberingLock(): void {
  stopListening();
  countLock = unlockCountLock(countLock);
  numberingSlots = [];
  indexByTrackId = new Map();
  lockedPeople = [];
  race = new FirstRaiseTracker();
  flashingIndex = null;
  boardDirty = true;
  renderScoreBoard();
}

function peopleFromLockedTracks(tracked: TrackedPose[]): SortedPerson[] {
  const out: SortedPerson[] = [];
  for (const t of tracked) {
    const index = indexByTrackId.get(t.trackId);
    if (index == null) continue;
    out.push({
      index,
      x: t.center.x,
      y: t.center.y,
      id: t.trackId,
      raised: t.debouncer.raised,
    });
  }
  out.sort((a, b) => a.index - b.index);
  return out;
}

function renderScoreBoard(): void {
  if (!countLock.locked) {
    boardEl.innerHTML = "";
    boardDirty = false;
    return;
  }
  const seats = [...lockedPeople].sort((a, b) => a.index - b.index);
  const key = seats.map((s) => `${s.index}:${scores.get(s.index) ?? 0}:${flashingIndex === s.index ? 1 : 0}`).join("|");
  if (!boardDirty && boardEl.dataset.key === key) return;
  boardEl.dataset.key = key;
  boardDirty = false;

  boardEl.innerHTML = "";
  for (const s of seats) {
    const card = document.createElement("article");
    card.className = "seat" + (flashingIndex === s.index ? " flashing" : "");
    card.innerHTML = `
      <div class="num">#${s.index}</div>
      <div class="score">积分 <strong>${scores.get(s.index) ?? 0}</strong></div>
    `;
    boardEl.appendChild(card);
  }
}

function drawOverlay(tracked: TrackedPose[], locked: boolean): void {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!locked) return;

  for (const slot of numberingSlots) {
    if (slot.trackId != null) continue;
    ctx.fillStyle = "rgba(139, 152, 165, 0.85)";
    ctx.font = "bold 22px Segoe UI, sans-serif";
    ctx.fillText(`#${slot.index}?`, slot.x * w - 16, slot.y * h - 12);
  }

  for (const t of tracked) {
    const index = indexByTrackId.get(t.trackId);
    if (index == null) continue;
    const isFlash = flashingIndex === index;
    const raised = t.debouncer.raised;
    const ls = t.landmarks[POSE.LEFT_SHOULDER];
    const rs = t.landmarks[POSE.RIGHT_SHOULDER];
    if (ls && rs) {
      ctx.strokeStyle = isFlash ? "#f0b429" : raised ? "#2dd4a8" : "#3d9cfd";
      ctx.lineWidth = isFlash ? 5 : 3;
      ctx.beginPath();
      ctx.moveTo(ls.x * w, ls.y * h);
      ctx.lineTo(rs.x * w, rs.y * h);
      ctx.stroke();
    }
    ctx.fillStyle = isFlash ? "#f0b429" : raised ? "#2dd4a8" : "#eef2f6";
    ctx.font = "bold 26px Segoe UI, sans-serif";
    const label = isFlash ? `#${index} 抢答` : raised ? `#${index} 举手` : `#${index}`;
    ctx.fillText(label, t.center.x * w - 18, t.center.y * h - 14);
  }
}

/* —— Speech (Web Speech + match-text) —— */

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function liveText(): string {
  return `${finalTranscript}${interimTranscript}`.trim();
}

function clearMatchTimer(): void {
  if (matchTimer !== null) {
    window.clearTimeout(matchTimer);
    matchTimer = null;
  }
}

function clearAnswerTimer(): void {
  if (answerTimer !== null) {
    window.clearTimeout(answerTimer);
    answerTimer = null;
  }
}

async function loadQuestions(): Promise<void> {
  const res = await fetch("/api/speech/questions");
  if (!res.ok) throw new Error(`questions ${res.status}`);
  const data = (await res.json()) as { questions: Question[] };
  questionSelect.innerHTML = "";
  for (const q of data.questions) {
    const opt = document.createElement("option");
    opt.value = q.id;
    opt.textContent = `${q.id} · ${q.answer}`;
    questionSelect.appendChild(opt);
  }
  btnListen.disabled = data.questions.length === 0 || flashingIndex == null;
}

function onAnswerPassed(text: string): void {
  if (flashingIndex == null) return;
  const idx = flashingIndex;
  scores.set(idx, (scores.get(idx) ?? 0) + 1);
  flashingIndex = null;
  boardDirty = true;
  renderScoreBoard();
  race.reset();
  setStatus(`#${idx} 答对 · 积分 ${(scores.get(idx) ?? 0)} · 已停闪 · 可再举手抢答`);
  setSpeechLine(text);
  btnListen.disabled = true;
  btnListen.textContent = "开始作答";
}

async function matchNow(transcript: string): Promise<void> {
  if (passedLocked || flashingIndex == null) return;
  const questionId = questionSelect.value;
  const text = transcript.trim();
  if (!questionId || !text || text === lastMatchedText) return;

  matchAbort?.abort();
  const ac = new AbortController();
  matchAbort = ac;

  try {
    const res = await fetch("/api/speech/match-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question_id: questionId, transcript: text }),
      signal: ac.signal,
    });
    const body = (await res.json().catch(() => ({}))) as MatchResponse & { detail?: string };
    if (!res.ok) throw new Error(body.detail || `HTTP ${res.status}`);
    if (passedLocked) return;

    lastMatchedText = text;
    setSpeechLine(text);
    if (body.passed) {
      passedLocked = true;
      clearMatchTimer();
      clearAnswerTimer();
      stopRequested = true;
      try {
        recognition?.stop();
      } catch {
        /* ignore */
      }
      listening = false;
      onAnswerPassed(text);
      return;
    }
    if (listening) {
      setStatus(`#${flashingIndex} 作答中 · 匹配 ${(body.score * 100).toFixed(0)}% · ${text}`);
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
  }
}

function scheduleLiveMatch(text: string): void {
  if (passedLocked) return;
  clearMatchTimer();
  matchTimer = window.setTimeout(() => {
    void matchNow(text);
  }, MATCH_DEBOUNCE_MS);
}

function stopListening(): void {
  clearMatchTimer();
  clearAnswerTimer();
  matchAbort?.abort();
  stopRequested = true;
  try {
    recognition?.stop();
  } catch {
    /* ignore */
  }
  listening = false;
  recognition = null;
  btnListen.textContent = "开始作答";
  btnListen.disabled = flashingIndex == null || !questionSelect.value;
}

function startListening(): void {
  if (flashingIndex == null) {
    setStatus("请先等待有人举手抢答");
    return;
  }
  if (!questionSelect.value) {
    setStatus("请先选择题目");
    return;
  }
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    setStatus("当前浏览器不支持 Web Speech（请用 Chrome / Edge）");
    return;
  }

  stopListening();
  passedLocked = false;
  finalTranscript = "";
  interimTranscript = "";
  lastMatchedText = "";
  stopRequested = false;
  listening = true;
  btnListen.textContent = "结束作答";
  btnListen.disabled = false;
  setStatus(`#${flashingIndex} 抢答中 · 请作答（限时 10s）`);
  setSpeechLine("");

  const rec = new Ctor();
  recognition = rec;
  rec.lang = "zh-CN";
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onresult = (ev) => {
    if (passedLocked) return;
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const piece = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) finalTranscript += piece;
      else interim += piece;
    }
    interimTranscript = interim;
    const text = liveText();
    setSpeechLine(text);
    scheduleLiveMatch(text);
  };

  rec.onerror = (ev) => {
    if (ev.error === "aborted" || ev.error === "no-speech") return;
    setStatus(`听写错误：${ev.error}`);
  };

  rec.onend = () => {
    listening = false;
    recognition = null;
    btnListen.textContent = "开始作答";
    btnListen.disabled = flashingIndex == null || !questionSelect.value;
    if (!stopRequested && !passedLocked && flashingIndex != null) {
      // Unexpected end — allow manual restart
      setStatus(`#${flashingIndex} 听写已停 · 可点「开始作答」重试`);
    }
  };

  try {
    rec.start();
  } catch (err) {
    listening = false;
    setStatus(err instanceof Error ? err.message : "无法开始听写");
    return;
  }

  clearAnswerTimer();
  answerTimer = window.setTimeout(() => {
    if (!listening || passedLocked) return;
    setStatus(`#${flashingIndex} 答题时间到 · 仍闪烁，答对后才停 · 可再点开始作答`);
    const text = liveText();
    if (text) void matchNow(text);
    stopListening();
  }, ANSWER_LIMIT_MS);
}

function onFirstRaise(personIndex: number): void {
  if (flashingIndex != null) return;
  flashingIndex = personIndex;
  passedLocked = false;
  boardDirty = true;
  renderScoreBoard();
  btnListen.disabled = !questionSelect.value;
  setStatus(`最先举手：#${personIndex} · 持续闪烁 · 请选题后作答`);
  if (questionSelect.value) {
    startListening();
  }
}

async function loop(nowMs: number): Promise<void> {
  raf = requestAnimationFrame((t) => void loop(t));
  if (!landmarker || video.readyState < 2) return;
  if (!ensureCanvasSize()) return;
  if (nowMs - lastTs < DETECT_INTERVAL_MS) return;
  lastTs = nowMs;

  const raw = detectPosesForVideo(landmarker, video, nowMs);
  const poses = dedupePosesByTorso(raw, { minDistance: 0.12 });
  const tracked = tracker.update(poses);

  if (countLock.locked) syncSlotsWithTracks(tracked);

  for (const t of tracked) {
    if (!t.fresh) continue;
    if (countLock.locked && indexByTrackId.has(t.trackId)) {
      t.debouncer.update(isHandRaised(t.landmarks, { margin: RAISE_MARGIN }));
    }
  }

  const payload = tracked.map((t) => ({
    id: t.trackId,
    x: torsoCenter(t.landmarks).x,
    y: torsoCenter(t.landmarks).y,
  }));
  const liveCount = payload.length;
  const expected = readExpectedCount();

  if (!countLock.locked) {
    const observed = observePersonCount(countLock, liveCount, {
      expectedCount: expected,
      minStableFrames: LOCK_STABLE_FRAMES,
    });
    countLock = observed.state;
    drawOverlay(tracked, false);
    renderScoreBoard();

    if (observed.shouldLock) {
      setStatus(`人数已达 ${expected} · 正在锁定编号…`);
      await lockNumbering(payload);
    } else if (liveCount === expected) {
      setStatus(`人数 ${liveCount}/${expected} · 稳定 ${countLock.streak}/${LOCK_STABLE_FRAMES}`);
    } else {
      setStatus(`等待 ${expected} 人出镜（当前 ${liveCount}）`);
    }
    return;
  }

  const people = peopleFromLockedTracks(tracked);
  const before = race.winner;
  race.update(
    people.map((p) => ({ personIndex: p.index, raised: !!p.raised })),
    nowMs,
  );
  const winner = race.winner;
  if (winner && !before && flashingIndex == null) {
    onFirstRaise(winner.personIndex);
  }

  renderScoreBoard();
  drawOverlay(tracked, true);

  if (flashingIndex != null) {
    if (!listening && !passedLocked) {
      /* keep status unless speech updates it */
    }
  } else if (winner == null) {
    setStatus(`编号已锁定 · 积分已累计 · 等待下一轮举手`);
  }
}

async function onStart(): Promise<void> {
  btnStart.disabled = true;
  setStatus("加载 Pose 模型…");
  try {
    await checkHealth();
    await loadQuestions();
    landmarker = await createPoseLandmarker({
      numPoses: 6,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.45,
    });
    camera = await startCamera(video);
    tracker = new PoseTracker({
      matchDistance: TRACK_MATCH_DISTANCE,
      maxMissed: TRACK_MAX_MISSED,
      minFrames: 5,
    });
    clearNumberingLock();
    scores.clear();
    lastTs = 0;
    canvasSized = false;
    btnStop.disabled = false;
    btnRelock.disabled = false;
    setStatus(`运行中 · 等待 ${readExpectedCount()} 人出镜`);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame((t) => void loop(t));
  } catch (err) {
    console.error(err);
    setStatus(err instanceof Error ? err.message : "启动失败");
    btnStart.disabled = false;
    landmarker?.close();
    landmarker = null;
  }
}

function onStop(): void {
  cancelAnimationFrame(raf);
  stopListening();
  camera?.stop();
  camera = null;
  landmarker?.close();
  landmarker = null;
  tracker.reset();
  clearNumberingLock();
  scores.clear();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  btnStart.disabled = false;
  btnStop.disabled = true;
  btnRelock.disabled = true;
  btnListen.disabled = true;
  setStatus("已停止");
  setSpeechLine("");
}

function onRelock(): void {
  stopListening();
  clearNumberingLock();
  setStatus(`已解除编号 · 等待 ${readExpectedCount()} 人出镜（积分保留）`);
}

btnStart.addEventListener("click", () => void onStart());
btnStop.addEventListener("click", onStop);
btnRelock.addEventListener("click", onRelock);
btnListen.addEventListener("click", () => {
  if (listening) stopListening();
  else startListening();
});

void (async () => {
  await checkHealth();
  try {
    await loadQuestions();
  } catch {
    setStatus("无法加载题目 · 请确认 Python API 与答案库");
  }
})();
