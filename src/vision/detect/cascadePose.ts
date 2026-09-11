/**
 * Stage 2 of Qwen + MediaPipe cascade:
 * crop each person box → single-target Pose → map landmarks back to full frame.
 */

import type { PoseLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { PoseFrame } from "./poseLandmarker";
import { boxCenter, type PersonBox } from "./personBox";

export type CascadePose = PoseFrame & {
  box: PersonBox;
};

export type CascadePoseOptions = {
  /** Reject a pose whose torso is outside this distance from the box center. */
  maxTorsoDist?: number;
};

export function mapLandmarksFromCrop(
  landmarks: readonly NormalizedLandmark[],
  box: PersonBox,
): NormalizedLandmark[] {
  const spanX = Math.max(1e-6, box.xMax - box.xMin);
  const spanY = Math.max(1e-6, box.yMax - box.yMin);
  return landmarks.map((p) => ({
    ...p,
    x: box.xMin + p.x * spanX,
    y: box.yMin + p.y * spanY,
  }));
}

function meanVis(landmarks: readonly NormalizedLandmark[]): number {
  const keys = [11, 12, 15, 16];
  let sum = 0;
  let n = 0;
  for (const i of keys) {
    const v = landmarks[i]?.visibility;
    if (v != null) {
      sum += v;
      n += 1;
    }
  }
  return n ? sum / n : 0;
}

function torsoOf(landmarks: readonly NormalizedLandmark[]): { x: number; y: number } {
  const ls = landmarks[11];
  const rs = landmarks[12];
  if (ls && rs) return { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  const nose = landmarks[0];
  return { x: nose?.x ?? 0.5, y: nose?.y ?? 0.5 };
}

/**
 * Run Pose on one person ROI. Caller should use a landmarker with numPoses=1.
 */
export function detectPoseInPersonBox(
  landmarker: PoseLandmarker,
  frameCanvas: HTMLCanvasElement,
  cropCanvas: HTMLCanvasElement,
  box: PersonBox,
  options: CascadePoseOptions = {},
): CascadePose | null {
  const vw = frameCanvas.width;
  const vh = frameCanvas.height;
  if (vw < 2 || vh < 2) return null;

  const x0 = Math.floor(box.xMin * vw);
  const y0 = Math.floor(box.yMin * vh);
  const bw = Math.max(16, Math.ceil(box.xMax * vw) - x0);
  const bh = Math.max(16, Math.ceil(box.yMax * vh) - y0);

  if (cropCanvas.width !== bw || cropCanvas.height !== bh) {
    cropCanvas.width = bw;
    cropCanvas.height = bh;
  }
  const ctx = cropCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.clearRect(0, 0, bw, bh);
  ctx.drawImage(frameCanvas, x0, y0, bw, bh, 0, 0, bw, bh);

  const result = landmarker.detect(cropCanvas);
  const poses = result.landmarks ?? [];
  if (!poses.length) return null;

  const maxTorsoDist = options.maxTorsoDist ?? 0.22;
  const target = boxCenter(box);

  let best: NormalizedLandmark[] | null = null;
  let bestScore = -Infinity;
  for (const lm of poses) {
    const mapped = mapLandmarksFromCrop(lm, box);
    const t = torsoOf(mapped);
    const dist = Math.hypot(t.x - target.x, (t.y - target.y) * 0.5);
    if (dist > maxTorsoDist) continue;
    const score = meanVis(mapped) - dist;
    if (score > bestScore) {
      bestScore = score;
      best = mapped;
    }
  }
  if (!best) return null;
  return { landmarks: best, box };
}

export function detectPosesFromPersonBoxes(
  landmarker: PoseLandmarker,
  frameCanvas: HTMLCanvasElement,
  cropCanvas: HTMLCanvasElement,
  boxes: readonly PersonBox[],
  options: CascadePoseOptions = {},
): CascadePose[] {
  const out: CascadePose[] = [];
  for (const box of boxes) {
    const pose = detectPoseInPersonBox(landmarker, frameCanvas, cropCanvas, box, options);
    if (pose) out.push(pose);
  }
  return out;
}
