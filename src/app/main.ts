/**
 * Single-person debug shell: stabilize hand-raise detection.
 * numPoses = 1 (no multi-person detector thrash).
 */

import { PoseLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import {
  createPoseLandmarker,
  detectPosesForVideo,
  isHandRaised,
  RaiseDebouncer,
  startCamera,
  type CameraHandle,
} from "../vision";
import { POSE } from "../vision/detect/isHandRaised";

const video = document.querySelector<HTMLVideoElement>("#video")!;
const canvas = document.querySelector<HTMLCanvasElement>("#overlay")!;
const ctx = canvas.getContext("2d")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const raisePill = document.querySelector<HTMLElement>("#raise-pill")!;
const btnStart = document.querySelector<HTMLButtonElement>("#btn-start")!;
const btnStop = document.querySelector<HTMLButtonElement>("#btn-stop")!;
const inputMargin = document.querySelector<HTMLInputElement>("#input-margin")!;
const inputFrames = document.querySelector<HTMLInputElement>("#input-frames")!;

/** EMA smoothing factor for landmarks (0=no smooth, closer to 1=heavier). */
const SMOOTH = 0.55;
/** Keep drawing last pose if detection drops briefly. */
const HOLD_MS = 250;

let camera: CameraHandle | null = null;
let landmarker: PoseLandmarker | null = null;
let raf = 0;
let lastTs = 0;
let debouncer = new RaiseDebouncer({ minFrames: 5 });
let smoothed: NormalizedLandmark[] | null = null;
let lastPoseAt = 0;
let lastShownRaised: boolean | null = null;
let canvasSized = false;

function readMargin(): number {
  return Number(inputMargin.value) || 0.08;
}

function readMinFrames(): number {
  return Math.max(1, Number(inputFrames.value) || 5);
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function setRaisedUi(raised: boolean): void {
  if (lastShownRaised === raised) return;
  lastShownRaised = raised;
  raisePill.textContent = raised ? "举手" : "未举手";
  raisePill.classList.toggle("raised", raised);
}

inputFrames.addEventListener("change", () => {
  debouncer = new RaiseDebouncer({ minFrames: readMinFrames() });
  lastShownRaised = null;
});

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

function smoothLandmarks(next: NormalizedLandmark[]): NormalizedLandmark[] {
  if (!smoothed || smoothed.length !== next.length) {
    smoothed = next.map((p) => ({ ...p }));
    return smoothed;
  }
  for (let i = 0; i < next.length; i++) {
    const a = smoothed[i];
    const b = next[i];
    a.x = a.x * SMOOTH + b.x * (1 - SMOOTH);
    a.y = a.y * SMOOTH + b.y * (1 - SMOOTH);
    a.z = (a.z ?? 0) * SMOOTH + (b.z ?? 0) * (1 - SMOOTH);
    a.visibility = b.visibility;
  }
  return smoothed;
}

function drawPose(landmarks: readonly { x: number; y: number }[], raised: boolean): void {
  const w = canvas.width;
  const h = canvas.height;
  const pairs: [number, number][] = [
    [POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER],
    [POSE.LEFT_SHOULDER, POSE.LEFT_WRIST],
    [POSE.RIGHT_SHOULDER, POSE.RIGHT_WRIST],
  ];

  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = raised ? "#2dd4a8" : "#3d9cfd";
  ctx.lineWidth = 4;
  for (const [a, b] of pairs) {
    const pa = landmarks[a];
    const pb = landmarks[b];
    if (!pa || !pb) continue;
    ctx.beginPath();
    ctx.moveTo(pa.x * w, pa.y * h);
    ctx.lineTo(pb.x * w, pb.y * h);
    ctx.stroke();
  }

  const midX =
    ((landmarks[POSE.LEFT_SHOULDER]?.x ?? 0.5) + (landmarks[POSE.RIGHT_SHOULDER]?.x ?? 0.5)) / 2;
  const midY =
    ((landmarks[POSE.LEFT_SHOULDER]?.y ?? 0.3) + (landmarks[POSE.RIGHT_SHOULDER]?.y ?? 0.3)) / 2;
  ctx.fillStyle = raised ? "#2dd4a8" : "#e7ecf1";
  ctx.font = "bold 22px Segoe UI, sans-serif";
  ctx.fillText(raised ? "举手" : "未举手", midX * w - 28, midY * h - 14);
}

function loop(nowMs: number): void {
  raf = requestAnimationFrame(loop);
  if (!landmarker || video.readyState < 2) return;
  if (!ensureCanvasSize()) return;

  // ~30 Hz cap — reduces thrash vs running every display refresh.
  if (nowMs - lastTs < 33) return;
  lastTs = nowMs;

  const poses = detectPosesForVideo(landmarker, video, nowMs);
  const margin = readMargin();

  if (poses.length > 0) {
    lastPoseAt = nowMs;
    const landmarks = smoothLandmarks(poses[0].landmarks);
    const raised = debouncer.update(isHandRaised(landmarks, { margin }));
    drawPose(landmarks, raised);
    setRaisedUi(raised);
    setStatus(`单人调试 · 已锁定 · margin=${margin} · minFrames=${readMinFrames()}`);
    return;
  }

  // Hold last pose briefly instead of blanking (avoids flash on miss).
  if (smoothed && nowMs - lastPoseAt < HOLD_MS) {
    drawPose(smoothed, debouncer.raised);
    setRaisedUi(debouncer.raised);
    setStatus("单人调试 · 短暂丢检，保持上一帧");
    return;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  setRaisedUi(false);
  setStatus("单人调试 · 未检测到人体 — 请正对镜头、上半身入画");
}

async function onStart(): Promise<void> {
  btnStart.disabled = true;
  setStatus("加载 Pose 模型（单人）…");
  try {
    landmarker = await createPoseLandmarker({
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    setStatus("请求相机权限…");
    camera = await startCamera(video);
    debouncer = new RaiseDebouncer({ minFrames: readMinFrames() });
    smoothed = null;
    lastPoseAt = 0;
    lastTs = 0;
    lastShownRaised = null;
    canvasSized = false;
    btnStop.disabled = false;
    setStatus("单人调试运行中");
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
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
  smoothed = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  lastShownRaised = null;
  setRaisedUi(false);
  btnStart.disabled = false;
  btnStop.disabled = true;
  setStatus("已停止 · 单人模式");
}

btnStart.addEventListener("click", () => void onStart());
btnStop.addEventListener("click", onStop);
