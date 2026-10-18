/**
 * Colored raise-paddle detection + fusion with a weak pose assist.
 *
 * Color is the primary signal (high threshold). Pose only needs a mild
 * wrist-above / near-shoulder lift; a very strong paddle can pass with
 * that mild assist alone.
 */

import { POSE, type PoseLandmark } from "./isHandRaised";
import type { PaddleColor } from "./paddleColors";

export type FramePixels = {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
};

/** Snapshot pixels from a canvas that already holds the current video frame. */
export function framePixelsFromCanvas(canvas: HTMLCanvasElement): FramePixels | null {
  if (canvas.width <= 0 || canvas.height <= 0) return null;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { data: image.data, width: image.width, height: image.height };
  } catch {
    return null;
  }
}

export type NormRect = { x0: number; y0: number; x1: number; y1: number };

export type PaddleRaiseOptions = {
  /** Minimum paddle color fraction in the search ROI (strict). */
  minPaddleScore?: number;
  /** Above this, only a mild pose assist is required. */
  strongPaddleScore?: number;
  /** Mild pose assist floor when paddle is merely "good". */
  minPoseAssist?: number;
  /** Color vs pose weights for the fused race score. */
  colorWeight?: number;
  poseWeight?: number;
};

export type PaddleRaiseEval = {
  raised: boolean;
  /** Fused score for first-raise ties (color-heavy). */
  score: number;
  side: "left" | "right" | null;
  paddleScore: number;
  poseAssist: number;
};

const DEFAULTS = {
  minPaddleScore: 0.38,
  strongPaddleScore: 0.62,
  minPoseAssist: 0.22,
  colorWeight: 0.8,
  poseWeight: 0.2,
} as const;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function satVal(r: number, g: number, b: number): { sat: number; val: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const val = max / 255;
  const sat = max <= 1e-6 ? 0 : (max - min) / max;
  return { sat, val };
}

/** Strict-ish RGB rules tuned for classroom cards under mixed light. */
export function pixelMatchesPaddleColor(r: number, g: number, b: number, color: PaddleColor): boolean {
  const { sat, val } = satVal(r, g, b);
  switch (color) {
    case "white":
      return val >= 0.72 && sat <= 0.22 && Math.min(r, g, b) >= 160;
    case "black":
      return val <= 0.22 && sat <= 0.4 && Math.max(r, g, b) <= 70;
    case "red":
      return r >= 140 && r >= g + 35 && r >= b + 35 && sat >= 0.32 && val >= 0.35;
    case "blue":
      return b >= 120 && b >= r + 25 && b >= g + 15 && sat >= 0.28 && val >= 0.3;
    case "green":
      return g >= 115 && g >= r + 22 && g >= b + 22 && sat >= 0.28 && val >= 0.3;
    case "yellow":
      return r >= 150 && g >= 140 && b <= 130 && (r + g) / 2 >= b + 35 && sat >= 0.22 && val >= 0.45;
    default:
      return false;
  }
}

/**
 * Upper-body / hand zone where a raised paddle usually appears.
 */
export function paddleSearchRoi(landmarks: readonly PoseLandmark[]): NormRect {
  const ls = landmarks[POSE.LEFT_SHOULDER];
  const rs = landmarks[POSE.RIGHT_SHOULDER];
  const nose = landmarks[POSE.NOSE];
  const lw = landmarks[POSE.LEFT_WRIST];
  const rw = landmarks[POSE.RIGHT_WRIST];

  const midX = ls && rs ? (ls.x + rs.x) / 2 : nose?.x ?? 0.5;
  const shoulderY = ls && rs ? Math.min(ls.y, rs.y) : nose?.y ?? 0.35;
  const shoulderSpan = ls && rs ? Math.abs(rs.x - ls.x) : 0.25;

  let x0 = midX - shoulderSpan * 0.95;
  let x1 = midX + shoulderSpan * 0.95;
  let y0 = Math.min(shoulderY, nose?.y ?? shoulderY) - 0.28;
  let y1 = shoulderY + 0.08;

  for (const w of [lw, rw]) {
    if (!w || (w.visibility ?? 1) < 0.15) continue;
    if (w.y > shoulderY + 0.12) continue;
    x0 = Math.min(x0, w.x - 0.12);
    x1 = Math.max(x1, w.x + 0.12);
    y0 = Math.min(y0, w.y - 0.14);
    y1 = Math.max(y1, w.y + 0.1);
  }

  return {
    x0: clamp01(x0),
    y0: clamp01(y0),
    x1: clamp01(Math.max(x1, x0 + 0.05)),
    y1: clamp01(Math.max(y1, y0 + 0.05)),
  };
}

/**
 * Best local match density for `color` inside ROI (0–1).
 * Uses a sliding window so a small raised card is not diluted by the whole torso box.
 */
export function scorePaddleColor(
  frame: FramePixels,
  color: PaddleColor,
  roi: NormRect,
  sampleStep = 1,
): number {
  const { data, width, height } = frame;
  if (width <= 0 || height <= 0) return 0;

  const x0 = Math.max(0, Math.floor(roi.x0 * width));
  const y0 = Math.max(0, Math.floor(roi.y0 * height));
  const x1 = Math.min(width, Math.ceil(roi.x1 * width));
  const y1 = Math.min(height, Math.ceil(roi.y1 * height));
  const rw = x1 - x0;
  const rh = y1 - y0;
  if (rw <= 0 || rh <= 0) return 0;

  const step = Math.max(1, sampleStep);
  const winW = Math.max(4, Math.round(Math.min(rw, Math.max(6, width * 0.12))));
  const winH = Math.max(4, Math.round(Math.min(rh, Math.max(6, height * 0.14))));
  const strideX = Math.max(1, Math.floor(winW / 2));
  const strideY = Math.max(1, Math.floor(winH / 2));

  let best = 0;
  for (let wy = y0; wy + winH <= y1; wy += strideY) {
    for (let wx = x0; wx + winW <= x1; wx += strideX) {
      let hit = 0;
      let total = 0;
      for (let y = wy; y < wy + winH; y += step) {
        for (let x = wx; x < wx + winW; x += step) {
          const o = (y * width + x) * 4;
          const r = data[o] ?? 0;
          const g = data[o + 1] ?? 0;
          const b = data[o + 2] ?? 0;
          total += 1;
          if (pixelMatchesPaddleColor(r, g, b, color)) hit += 1;
        }
      }
      if (total > 0) best = Math.max(best, hit / total);
      if (best >= 0.95) return best;
    }
  }

  // Tiny ROI: fall back to whole-ROI density.
  if (best === 0 && (rw < winW || rh < winH)) {
    let hit = 0;
    let total = 0;
    for (let y = y0; y < y1; y += step) {
      for (let x = x0; x < x1; x += step) {
        const o = (y * width + x) * 4;
        total += 1;
        if (pixelMatchesPaddleColor(data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0, color)) {
          hit += 1;
        }
      }
    }
    return total === 0 ? 0 : hit / total;
  }
  return best;
}

/**
 * Weak pose assist: clear raise scores high; wrist near/above shoulder still helps.
 */
export function weakPoseAssist(landmarks: readonly PoseLandmark[]): {
  assist: number;
  side: "left" | "right" | null;
} {
  const nose = landmarks[POSE.NOSE];
  const sides: Array<"left" | "right"> = ["left", "right"];
  let best = 0;
  let bestSide: "left" | "right" | null = null;

  for (const side of sides) {
    const shoulder = landmarks[side === "left" ? POSE.LEFT_SHOULDER : POSE.RIGHT_SHOULDER];
    const wrist = landmarks[side === "left" ? POSE.LEFT_WRIST : POSE.RIGHT_WRIST];
    if (!shoulder || !wrist) continue;
    if ((wrist.visibility ?? 1) < 0.12 || (shoulder.visibility ?? 1) < 0.12) continue;

    const clearance = shoulder.y - wrist.y; // positive when wrist above shoulder
    const nearHead =
      nose && wrist.y <= nose.y + 0.1 && Math.abs(wrist.x - nose.x) <= 0.18 ? 0.25 : 0;
    let assist = 0;
    if (clearance >= 0.04) assist = clamp01(0.55 + clearance * 3 + nearHead);
    else if (clearance >= 0.0) assist = clamp01(0.28 + clearance * 4 + nearHead * 0.5);
    else if (clearance >= -0.06) assist = clamp01(0.12 + (clearance + 0.06) * 2);
    else assist = 0;

    if (assist > best) {
      best = assist;
      bestSide = side;
    }
  }
  return { assist: best, side: bestSide };
}

export function evaluatePaddleRaise(
  landmarks: readonly PoseLandmark[],
  frame: FramePixels | null | undefined,
  color: PaddleColor,
  options: PaddleRaiseOptions = {},
): PaddleRaiseEval {
  const minPaddle = options.minPaddleScore ?? DEFAULTS.minPaddleScore;
  const strongPaddle = options.strongPaddleScore ?? DEFAULTS.strongPaddleScore;
  const minPose = options.minPoseAssist ?? DEFAULTS.minPoseAssist;
  const colorW = options.colorWeight ?? DEFAULTS.colorWeight;
  const poseW = options.poseWeight ?? DEFAULTS.poseWeight;

  const pose = weakPoseAssist(landmarks);
  if (!frame) {
    return {
      raised: false,
      score: 0,
      side: pose.side,
      paddleScore: 0,
      poseAssist: pose.assist,
    };
  }

  const roi = paddleSearchRoi(landmarks);
  const paddleScore = scorePaddleColor(frame, color, roi);
  const fused = colorW * paddleScore + poseW * pose.assist;

  const colorOk = paddleScore >= minPaddle;
  const poseOk =
    pose.assist >= minPose || (paddleScore >= strongPaddle && pose.assist >= 0.1);
  const raised = colorOk && poseOk;

  return {
    raised,
    score: raised ? Math.max(0.02, fused) : fused,
    side: pose.side,
    paddleScore,
    poseAssist: pose.assist,
  };
}
