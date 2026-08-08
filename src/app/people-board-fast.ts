/**
 * People board (fast path):
 * ~20 Hz MediaPipe camera loop + synchronous Python left→right sort each frame.
 * If a sort is still in flight, later rAF ticks are skipped (no overlapping requests).
 */

import { PoseLandmarker } from "@mediapipe/tasks-vision";
import {
  createPoseLandmarker,
  dedupePosesByTorso,
  detectPosesForVideo,
  FirstRaiseTracker,
  isHandRaised,
  PoseTracker,
  startCamera,
  torsoCenter,
  type CameraHandle,
  type FirstRaiseEvent,
  type TrackedPose,
} from "../vision";
import { POSE } from "../vision/detect/isHandRaised";

/** Target ~20 FPS camera / pose sampling (50ms). */
const DETECT_INTERVAL_MS = 50;
const RAISE_MARGIN = 0.08;

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

const SORT_URL = "/api/people/sort";
const HEALTH_URL = "/api/health";

let camera: CameraHandle | null = null;
let landmarker: PoseLandmarker | null = null;
let raf = 0;
let lastTs = 0;
let canvasSized = false;
let apiOk = false;
/** Hold ~1.2s of misses at 20 Hz. */
let tracker = new PoseTracker({ matchDistance: 0.18, maxMissed: 24, minFrames: 5 });
let race = new FirstRaiseTracker();
let lastUiKey = "";
let lastWinnerKey = "";
/** Prevent overlapping sync sort requests while targeting 20 FPS. */
let frameBusy = false;

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

function attachRaised(
  numbered: SortedPerson[],
  tracked: TrackedPose[],
): SortedPerson[] {
  return numbered.map((p) => {
    let best: TrackedPose | null = null;
    let bestD = Infinity;
    for (const t of tracked) {
      const d = Math.hypot(t.center.x - p.x, t.center.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return { ...p, raised: best?.debouncer.raised ?? false };
  });
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

function renderHud(result: SortResponse, winner: FirstRaiseEvent | null): void {
  const key = result.people
    .map((p) => `${p.index}:${p.raised ? 1 : 0}`)
    .join(",");
  const fullKey = `${result.count}:${key}:w${winner?.personIndex ?? "-"}`;
  if (fullKey === lastUiKey) return;
  lastUiKey = fullKey;

  countEl.textContent = String(result.count);
  listEl.innerHTML = "";
  for (const p of result.people) {
    const li = document.createElement("li");
    const isWinner = winner?.personIndex === p.index;
    if (isWinner) {
      li.textContent = `${p.index} 最先`;
    } else if (p.raised) {
      li.textContent = `${p.index} 举手`;
    } else {
      li.textContent = String(p.index);
    }
    li.title = `x=${p.x.toFixed(3)}${p.raised ? " · raised" : ""}${isWinner ? " · first" : ""}`;
    li.classList.toggle("raised", !!p.raised && !isWinner);
    li.classList.toggle("winner", isWinner);
    listEl.appendChild(li);
  }
  renderWinner(winner);
}

function drawOverlay(
  tracked: TrackedPose[],
  numbered: SortedPerson[],
  winner: FirstRaiseEvent | null,
): void {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  for (const t of tracked) {
    let best: SortedPerson | null = null;
    let bestD = Infinity;
    for (const p of numbered) {
      const d = Math.hypot(t.center.x - p.x, t.center.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    const label = best?.index ?? "?";
    const isWinner = winner != null && best?.index === winner.personIndex;
    const raised = t.debouncer.raised;
    const ls = t.landmarks[POSE.LEFT_SHOULDER];
    const rs = t.landmarks[POSE.RIGHT_SHOULDER];
    if (ls && rs) {
      ctx.strokeStyle = isWinner ? "#f0b429" : raised ? "#2dd4a8" : "#3d9cfd";
      ctx.lineWidth = isWinner ? 5 : 3;
      ctx.beginPath();
      ctx.moveTo(ls.x * w, ls.y * h);
      ctx.lineTo(rs.x * w, rs.y * h);
      ctx.stroke();
    }
    ctx.fillStyle = isWinner ? "#f0b429" : raised ? "#2dd4a8" : "#e7ecf1";
    ctx.font = "bold 28px Segoe UI, sans-serif";
    const text = isWinner ? `#${label} 最先` : raised ? `#${label} 举手` : `#${label}`;
    ctx.fillText(text, t.center.x * w - 14, t.center.y * h - 16);
  }
}

async function loop(nowMs: number): Promise<void> {
  raf = requestAnimationFrame((t) => void loop(t));
  if (!landmarker || video.readyState < 2) return;
  if (!ensureCanvasSize()) return;
  if (frameBusy) return;
  if (nowMs - lastTs < DETECT_INTERVAL_MS) return;
  lastTs = nowMs;
  frameBusy = true;

  try {
    const raw = detectPosesForVideo(landmarker, video, nowMs);
    const poses = dedupePosesByTorso(raw, { minDistance: 0.14 });
    const tracked = tracker.update(poses);

    for (const t of tracked) {
      if (!t.fresh) continue;
      t.debouncer.update(isHandRaised(t.landmarks, { margin: RAISE_MARGIN }));
    }

    const payload = tracked.map((t) => ({
      id: t.trackId,
      x: torsoCenter(t.landmarks).x,
      y: torsoCenter(t.landmarks).y,
    }));

    // Synchronous Python sort on this frame's 20FPS camera sample.
    let sorted: SortResponse;
    try {
      if (!apiOk) await checkHealth();
      sorted = apiOk ? await sortViaPython(payload) : sortLocal(payload);
      if (apiOk) setApiStatus(true, "同步排序 · ~20FPS");
    } catch {
      setApiStatus(false, "请求失败，暂用本地排序");
      sorted = sortLocal(payload);
    }

    const people = attachRaised(sorted.people, tracked);
    const result: SortResponse = { count: sorted.count, people };

    race.update(
      people.map((p) => ({ personIndex: p.index, raised: !!p.raised })),
      nowMs,
    );
    const winner = race.winner;

    renderHud(result, winner);
    drawOverlay(tracked, people, winner);

    const raisedIndexes = people.filter((p) => p.raised).map((p) => p.index);
    if (result.count === 0) {
      setStatus("未检测到人物 · ~20FPS · Python 同步编号");
    } else if (winner) {
      setStatus(`最先举手：#${winner.personIndex} · 点「下一轮」可再赛`);
    } else if (raisedIndexes.length === 0) {
      setStatus(`检出 ${result.count} 人 · 等待举手…`);
    } else {
      setStatus(
        `检出 ${result.count} 人 · 举手中：${raisedIndexes.map((n) => `#${n}`).join("、")}`,
      );
    }
  } finally {
    frameBusy = false;
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
    race = new FirstRaiseTracker();
    frameBusy = false;
    lastTs = 0;
    lastUiKey = "";
    lastWinnerKey = "";
    canvasSized = false;
    btnStop.disabled = false;
    btnReset.disabled = false;
    setStatus("运行中 · ~20FPS 相机 · Python 同步排序");
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
  race.reset();
  frameBusy = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  lastUiKey = "";
  lastWinnerKey = "";
  renderHud({ count: 0, people: [] }, null);
  btnStart.disabled = false;
  btnStop.disabled = true;
  btnReset.disabled = true;
  setStatus("已停止");
}

function onReset(): void {
  race.reset();
  lastUiKey = "";
  lastWinnerKey = "";
  renderWinner(null);
  setStatus("已重置 · 等待最先举手");
}

btnStart.addEventListener("click", () => void onStart());
btnStop.addEventListener("click", onStop);
btnReset.addEventListener("click", onReset);
void checkHealth();
