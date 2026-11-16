/**
 * Draw camera frame + seat numbers / pose sticks for the vision preview page.
 */

import { POSE, type PoseLandmark } from "../vision/detect/isHandRaised";
import type { RaiseHudFrame, RaiseHudPerson } from "./backgroundRaiseDetect";

const SKELETON: ReadonlyArray<readonly [number, number]> = [
  [POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER],
  [POSE.LEFT_SHOULDER, POSE.LEFT_ELBOW],
  [POSE.LEFT_ELBOW, POSE.LEFT_WRIST],
  [POSE.RIGHT_SHOULDER, POSE.RIGHT_ELBOW],
  [POSE.RIGHT_ELBOW, POSE.RIGHT_WRIST],
];

const IDLE = "#7aa2c7";
const RAISED = "#3ecf8e";
const SCOUT = "#e6b84d";

function visible(lm: PoseLandmark | undefined, min = 0.25): lm is PoseLandmark {
  return !!lm && (lm.visibility ?? 1) >= min;
}

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  person: RaiseHudPerson,
  w: number,
  h: number,
  color: string,
): void {
  const lm = person.landmarks;
  if (!lm || lm.length < 17) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, w * 0.0025);
  ctx.lineCap = "round";
  for (const [a, b] of SKELETON) {
    const pa = lm[a];
    const pb = lm[b];
    if (!visible(pa) || !visible(pb)) continue;
    ctx.beginPath();
    ctx.moveTo(pa.x * w, pa.y * h);
    ctx.lineTo(pb.x * w, pb.y * h);
    ctx.stroke();
  }
  for (const idx of [
    POSE.NOSE,
    POSE.LEFT_SHOULDER,
    POSE.RIGHT_SHOULDER,
    POSE.LEFT_ELBOW,
    POSE.RIGHT_ELBOW,
    POSE.LEFT_WRIST,
    POSE.RIGHT_WRIST,
  ]) {
    const p = lm[idx];
    if (!visible(p)) continue;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, Math.max(3, w * 0.004), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFaceBox(ctx: CanvasRenderingContext2D, person: RaiseHudPerson, w: number, h: number): void {
  if (!person.faceBox) return;
  const bw = person.faceBox.width * w;
  const bh = person.faceBox.height * h;
  ctx.strokeStyle = SCOUT;
  ctx.lineWidth = 2;
  ctx.strokeRect(person.x * w - bw / 2, person.y * h - bh / 2, bw, bh);
}

function drawBadge(
  ctx: CanvasRenderingContext2D,
  person: RaiseHudPerson,
  w: number,
  h: number,
  locked: boolean,
): void {
  const color = !locked ? SCOUT : person.raised ? RAISED : IDLE;
  const cx = person.x * w;
  const cy = Math.max(28, person.y * h - 18);
  const label = `#${person.index}${person.raised ? " 举手" : ""}`;
  ctx.font = `600 ${Math.max(16, Math.round(w * 0.028))}px "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif`;
  const padX = 12;
  const tw = ctx.measureText(label).width;
  const bw = tw + padX * 2;
  const bh = Math.max(28, Math.round(w * 0.036));
  ctx.fillStyle = "rgba(8, 12, 18, 0.72)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  const x0 = cx - bw / 2;
  const y0 = cy - bh / 2;
  ctx.beginPath();
  ctx.roundRect(x0, y0, bw, bh, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, cy);
}

/**
 * Paint full-frame video + HUD onto an overlay canvas.
 */
export function drawRaiseHud(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  frame: RaiseHudFrame | null,
): void {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw <= 0 || vh <= 0) return;
  if (canvas.width !== vw || canvas.height !== vh) {
    canvas.width = vw;
    canvas.height = vh;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(video, 0, 0, vw, vh);
  if (!frame) return;
  for (const person of frame.people) {
    const color = !frame.locked ? SCOUT : person.raised ? RAISED : IDLE;
    drawSkeleton(ctx, person, vw, vh, color);
    drawFaceBox(ctx, person, vw, vh);
    drawBadge(ctx, person, vw, vh, frame.locked);
  }
}
