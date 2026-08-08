/**
 * Independent people board:
 * MediaPipe detects persons → Python API sorts left→right → UI shows count + indices.
 */

import { PoseLandmarker } from "@mediapipe/tasks-vision";
import {
  createPoseLandmarker,
  dedupePosesByTorso,
  detectPosesForVideo,
  PoseTracker,
  startCamera,
  torsoCenter,
  type CameraHandle,
} from "../vision";
import { POSE } from "../vision/detect/isHandRaised";

type SortedPerson = {
  index: number;
  x: number;
  y: number;
  id?: string | number | null;
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
const listEl = document.querySelector<HTMLOListElement>("#number-list")!;
const btnStart = document.querySelector<HTMLButtonElement>("#btn-start")!;
const btnStop = document.querySelector<HTMLButtonElement>("#btn-stop")!;

const SORT_URL = "/api/people/sort";
const HEALTH_URL = "/api/health";

let camera: CameraHandle | null = null;
let landmarker: PoseLandmarker | null = null;
let raf = 0;
let lastTs = 0;
let canvasSized = false;
let apiOk = false;
let tracker = new PoseTracker({ matchDistance: 0.18, maxMissed: 12, minFrames: 3 });
let lastUiKey = "";

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

async function sortViaPython(
  people: { id: number; x: number; y: number }[],
): Promise<SortResponse> {
  const res = await fetch(SORT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ people, max_people: 6 }),
  });
  if (!res.ok) throw new Error(`sort HTTP ${res.status}`);
  return (await res.json()) as SortResponse;
}

/** Local fallback if Python is down (still show count). */
function sortLocal(people: { id: number; x: number; y: number }[]): SortResponse {
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

function renderHud(result: SortResponse): void {
  const key = `${result.count}:${result.people.map((p) => p.index).join(",")}`;
  if (key === lastUiKey) return;
  lastUiKey = key;

  countEl.textContent = String(result.count);
  listEl.innerHTML = "";
  for (const p of result.people) {
    const li = document.createElement("li");
    li.textContent = String(p.index);
    li.title = `x=${p.x.toFixed(3)}`;
    listEl.appendChild(li);
  }
}

function drawOverlay(
  tracked: { landmarks: readonly { x: number; y: number }[]; center: { x: number; y: number } }[],
  numbered: SortedPerson[],
): void {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Map track centers to nearest sorted index for labels.
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
    const ls = t.landmarks[POSE.LEFT_SHOULDER];
    const rs = t.landmarks[POSE.RIGHT_SHOULDER];
    if (ls && rs) {
      ctx.strokeStyle = "#3d9cfd";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ls.x * w, ls.y * h);
      ctx.lineTo(rs.x * w, rs.y * h);
      ctx.stroke();
    }
    ctx.fillStyle = "#e7ecf1";
    ctx.font = "bold 28px Segoe UI, sans-serif";
    ctx.fillText(`#${label}`, t.center.x * w - 14, t.center.y * h - 16);
  }
}

async function loop(nowMs: number): Promise<void> {
  raf = requestAnimationFrame((t) => void loop(t));
  if (!landmarker || video.readyState < 2) return;
  if (!ensureCanvasSize()) return;
  if (nowMs - lastTs < 100) return; // ~10 Hz is enough for count board
  lastTs = nowMs;

  const raw = detectPosesForVideo(landmarker, video, nowMs);
  const poses = dedupePosesByTorso(raw, { minDistance: 0.14 });
  const tracked = tracker.update(poses);

  const payload = tracked.map((t) => ({
    id: t.trackId,
    x: torsoCenter(t.landmarks).x,
    y: torsoCenter(t.landmarks).y,
  }));

  let result: SortResponse;
  try {
    if (!apiOk) await checkHealth();
    result = apiOk ? await sortViaPython(payload) : sortLocal(payload);
    if (apiOk) setApiStatus(true, "排序中");
  } catch {
    setApiStatus(false, "请求失败，暂用本地排序");
    result = sortLocal(payload);
  }

  renderHud(result);
  drawOverlay(
    tracked.map((t) => ({ landmarks: t.landmarks, center: t.center })),
    result.people,
  );

  setStatus(
    result.count === 0
      ? "未检测到人物"
      : `检出 ${result.count} 人 · 已按左→右编号 1–${result.count}`,
  );
}

async function onStart(): Promise<void> {
  btnStart.disabled = true;
  setStatus("加载 Pose 模型…");
  try {
    await checkHealth();
    landmarker = await createPoseLandmarker({
      numPoses: 6,
      minPoseDetectionConfidence: 0.55,
      minPosePresenceConfidence: 0.55,
      minTrackingConfidence: 0.5,
    });
    camera = await startCamera(video);
    tracker = new PoseTracker({ matchDistance: 0.18, maxMissed: 12, minFrames: 3 });
    lastTs = 0;
    lastUiKey = "";
    canvasSized = false;
    btnStop.disabled = false;
    setStatus("运行中");
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
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  renderHud({ count: 0, people: [] });
  btnStart.disabled = false;
  btnStop.disabled = true;
  setStatus("已停止");
}

btnStart.addEventListener("click", () => void onStart());
btnStop.addEventListener("click", onStop);
void checkHealth();
