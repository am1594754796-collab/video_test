/**
 * People board (fast path):
 * 1) Wait until on-screen count matches expected (stable) → one Python L→R sort → lock indices to trackIds
 * 2) After lock: only hand-raise + first-raise feedback (no per-frame re-sort)
 */

import { PoseLandmarker } from "@mediapipe/tasks-vision";
import {
  createCountLockState,
  createPoseLandmarker,
  dedupePosesByTorso,
  detectPosesForVideo,
  FirstRaiseTracker,
  isHandRaised,
  observePersonCount,
  PoseTracker,
  startCamera,
  torsoCenter,
  unlockCountLock,
  type CameraHandle,
  type CountLockSnapshot,
  type FirstRaiseEvent,
  type TrackedPose,
} from "../vision";
import { POSE } from "../vision/detect/isHandRaised";

const DETECT_INTERVAL_MS = 50;
const RAISE_MARGIN = 0.08;
/** Consecutive frames at expected count before one-shot Python sort. */
const LOCK_STABLE_FRAMES = 8;

type PersonPoint = { id: number; x: number; y: number };

type SortedPerson = {
  index: number;
  x: number;
  y: number;
  id?: string | number | null;
  raised?: boolean;
};

type SortResponse = {
  count: number;
  people: SortedPerson[];
};

const video = document.querySelector<HTMLVideoElement>("#video")!;
const canvas = document.querySelector<HTMLCanvasElement>("#overlay")!;
const ctx = canvas.getContext("2d")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const apiStatusEl = document.querySelector<HTMLElement>("#api-status")!;
const countEl = document.querySelector<HTMLElement>("#count-value")!;
const winnerCard = document.querySelector<HTMLElement>("#winner-card")!;
const winnerValue = document.querySelector<HTMLElement>("#winner-value")!;
const listEl = document.querySelector<HTMLOListElement>("#number-list")!;
const btnStart = document.querySelector<HTMLButtonElement>("#btn-start")!;
const btnStop = document.querySelector<HTMLButtonElement>("#btn-stop")!;
const btnReset = document.querySelector<HTMLButtonElement>("#btn-reset")!;
const btnRelock = document.querySelector<HTMLButtonElement>("#btn-relock")!;
const inputExpected = document.querySelector<HTMLInputElement>("#input-expected")!;

const SORT_URL = "/api/people/sort";
const HEALTH_URL = "/api/health";

let camera: CameraHandle | null = null;
let landmarker: PoseLandmarker | null = null;
let raf = 0;
let lastTs = 0;
let canvasSized = false;
let apiOk = false;
let tracker = new PoseTracker({ matchDistance: 0.18, maxMissed: 24, minFrames: 5 });
let race = new FirstRaiseTracker();
let countLock: CountLockSnapshot = createCountLockState();
/** Frozen after one-shot sort: trackId → 1-based index. */
let indexByTrackId = new Map<number, number>();
let lockedPeople: SortedPerson[] = [];
let sortInFlight = false;
let lastUiKey = "";
let lastWinnerKey = "";

function readExpectedCount(): number {
  const n = Number(inputExpected.value);
  if (!Number.isFinite(n)) return 2;
  return Math.min(6, Math.max(1, Math.round(n)));
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function setApiStatus(ok: boolean, detail?: string): void {
  apiOk = ok;
  apiStatusEl.textContent = ok
    ? `Python API: 已连接${detail ? ` · ${detail}` : ""}`
    : `Python API: 未连接${detail ? ` · ${detail}` : ""}`;
  apiStatusEl.classList.toggle("ok", ok);
  apiStatusEl.classList.toggle("bad", !ok);
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
    setApiStatus(true);
    return true;
  } catch {
    setApiStatus(false, "请先启动 python/server.py");
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
  indexByTrackId = new Map();
  lockedPeople = sorted.people.map((p) => ({ ...p, raised: false }));
  for (const p of sorted.people) {
    const id = typeof p.id === "number" ? p.id : Number(p.id);
    if (Number.isFinite(id)) indexByTrackId.set(id, p.index);
  }
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
    lastUiKey = "";
    lastWinnerKey = "";
    setStatus(`已锁定 ${sorted.count} 人编号 · 开始举手检测`);
  } catch {
    setApiStatus(false, "排序失败，已用本地锁定");
    applyLockFromSort(sortLocal(payload));
    race = new FirstRaiseTracker();
    setStatus(`本地锁定 ${payload.length} 人编号 · 开始举手检测`);
  } finally {
    sortInFlight = false;
  }
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

function renderWinner(winner: FirstRaiseEvent | null): void {
  const key = winner ? String(winner.personIndex) : "";
  if (key === lastWinnerKey) return;
  lastWinnerKey = key;

  if (winner) {
    winnerValue.textContent = `#${winner.personIndex}`;
    winnerCard.classList.add("has-winner");
    winnerValue.style.animation = "none";
    void winnerValue.offsetWidth;
    winnerValue.style.animation = "";
  } else {
    winnerValue.textContent = "—";
    winnerCard.classList.remove("has-winner");
    winnerValue.style.animation = "";
  }
}

function renderHud(
  liveCount: number,
  people: SortedPerson[],
  winner: FirstRaiseEvent | null,
  locked: boolean,
): void {
  const key = `${locked ? 1 : 0}:${liveCount}:${people
    .map((p) => `${p.index}:${p.raised ? 1 : 0}`)
    .join(",")}:w${winner?.personIndex ?? "-"}`;
  if (key === lastUiKey) return;
  lastUiKey = key;

  countEl.textContent = String(locked ? people.length || lockedPeople.length : liveCount);
  listEl.innerHTML = "";
  const display = locked
    ? lockedPeople.map((base) => {
        const live = people.find((p) => p.index === base.index);
        return { ...base, raised: live?.raised ?? false };
      })
    : [];

  for (const p of display) {
    const li = document.createElement("li");
    const isWinner = winner?.personIndex === p.index;
    if (isWinner) {
      li.textContent = `${p.index} 最先`;
    } else if (p.raised) {
      li.textContent = `${p.index} 举手`;
    } else {
      li.textContent = String(p.index);
    }
    li.classList.toggle("raised", !!p.raised && !isWinner);
    li.classList.toggle("winner", isWinner);
    listEl.appendChild(li);
  }
  renderWinner(winner);
}

function drawOverlay(
  tracked: TrackedPose[],
  people: SortedPerson[],
  winner: FirstRaiseEvent | null,
  locked: boolean,
): void {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  for (const t of tracked) {
    const index = locked ? indexByTrackId.get(t.trackId) : undefined;
    const label = index ?? "?";
    const isWinner = winner != null && index === winner.personIndex;
    const raised = t.debouncer.raised;
    const ls = t.landmarks[POSE.LEFT_SHOULDER];
    const rs = t.landmarks[POSE.RIGHT_SHOULDER];
    if (ls && rs) {
      ctx.strokeStyle = isWinner ? "#f0b429" : raised ? "#2dd4a8" : locked ? "#3d9cfd" : "#8b98a5";
      ctx.lineWidth = isWinner ? 5 : 3;
      ctx.beginPath();
      ctx.moveTo(ls.x * w, ls.y * h);
      ctx.lineTo(rs.x * w, rs.y * h);
      ctx.stroke();
    }
    ctx.fillStyle = isWinner ? "#f0b429" : raised ? "#2dd4a8" : "#e7ecf1";
    ctx.font = "bold 28px Segoe UI, sans-serif";
    let text: string;
    if (!locked) text = "…";
    else if (isWinner) text = `#${label} 最先`;
    else if (raised) text = `#${label} 举手`;
    else text = `#${label}`;
    ctx.fillText(text, t.center.x * w - 14, t.center.y * h - 16);
  }

  void people;
}

function clearNumberingLock(): void {
  countLock = unlockCountLock(countLock);
  indexByTrackId = new Map();
  lockedPeople = [];
  race = new FirstRaiseTracker();
  lastUiKey = "";
  lastWinnerKey = "";
  renderWinner(null);
}

async function loop(nowMs: number): Promise<void> {
  raf = requestAnimationFrame((t) => void loop(t));
  if (!landmarker || video.readyState < 2) return;
  if (!ensureCanvasSize()) return;
  if (nowMs - lastTs < DETECT_INTERVAL_MS) return;
  lastTs = nowMs;

  const raw = detectPosesForVideo(landmarker, video, nowMs);
  const poses = dedupePosesByTorso(raw, { minDistance: 0.14 });
  const tracked = tracker.update(poses);

  for (const t of tracked) {
    if (!t.fresh) continue;
    // Only score raises after numbering is locked.
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
    renderHud(liveCount, [], null, false);
    drawOverlay(tracked, [], null, false);

    if (observed.shouldLock) {
      setStatus(`人数已达 ${expected} · 正在 Python 排序锁定…`);
      await lockNumbering(payload);
    } else if (liveCount === expected) {
      setStatus(
        `人数 ${liveCount}/${expected} · 稳定中 ${countLock.streak}/${LOCK_STABLE_FRAMES} 帧后锁定编号`,
      );
    } else {
      setStatus(`等待出镜人数达到 ${expected}（当前 ${liveCount}）· 暂不排序`);
    }
    return;
  }

  // Locked: hand-raise + first-raise only (no Python sort).
  const people = peopleFromLockedTracks(tracked);
  race.update(
    people.map((p) => ({ personIndex: p.index, raised: !!p.raised })),
    nowMs,
  );
  const winner = race.winner;

  renderHud(liveCount, people, winner, true);
  drawOverlay(tracked, people, winner, true);

  const raisedIndexes = people.filter((p) => p.raised).map((p) => p.index);
  if (winner) {
    setStatus(`最先举手：#${winner.personIndex} · 「下一轮」再赛 · 「重新编号」可重排`);
  } else if (raisedIndexes.length === 0) {
    setStatus(`编号已锁定 ${lockedPeople.length} 人 · 等待举手…`);
  } else {
    setStatus(`举手中：${raisedIndexes.map((n) => `#${n}`).join("、")}`);
  }
}

async function onStart(): Promise<void> {
  btnStart.disabled = true;
  setStatus("加载 Pose 模型…");
  try {
    await checkHealth();
    landmarker = await createPoseLandmarker({
      numPoses: 6,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.45,
    });
    camera = await startCamera(video);
    tracker = new PoseTracker({ matchDistance: 0.18, maxMissed: 24, minFrames: 5 });
    clearNumberingLock();
    lastTs = 0;
    canvasSized = false;
    btnStop.disabled = false;
    btnReset.disabled = false;
    btnRelock.disabled = false;
    setStatus(`运行中 · 等待 ${readExpectedCount()} 人出镜后锁定编号`);
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
  camera?.stop();
  camera = null;
  landmarker?.close();
  landmarker = null;
  tracker.reset();
  clearNumberingLock();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  renderHud(0, [], null, false);
  btnStart.disabled = false;
  btnStop.disabled = true;
  btnReset.disabled = true;
  btnRelock.disabled = true;
  setStatus("已停止");
}

function onResetRound(): void {
  race.reset();
  lastUiKey = "";
  lastWinnerKey = "";
  renderWinner(null);
  setStatus("已重置本轮 · 编号保持 · 等待最先举手");
}

function onRelock(): void {
  clearNumberingLock();
  setStatus(`已解除编号 · 等待 ${readExpectedCount()} 人出镜后重新排序`);
}

btnStart.addEventListener("click", () => void onStart());
btnStop.addEventListener("click", onStop);
btnReset.addEventListener("click", onResetRound);
btnRelock.addEventListener("click", onRelock);
void checkHealth();
