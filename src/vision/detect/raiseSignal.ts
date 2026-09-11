/**
 * Classroom raise signal: mid-shoulder reference + continuous score + edge timing.
 * Mid-shoulder is stabler than a single noisy shoulder point.
 */

import { RaiseDebouncer } from "./raiseDebouncer";
import {
  POSE,
  type HandRaiseOptions,
  type PoseLandmark,
} from "./isHandRaised";

export type RaiseEval = {
  raised: boolean;
  /** How far the winning wrist is above the shoulder midline (normalized). */
  score: number;
  side: "left" | "right" | null;
};

export type SeatRaiseUpdate = {
  /** Debounced flag for HUD / list. */
  raised: boolean;
  /** Instantaneous geometric raise (for race timing). */
  rawRaised: boolean;
  score: number;
  side: "left" | "right" | null;
  /** Interpolated clock when score crossed the raise threshold (rising edge only). */
  edgeAtMs?: number;
};

function visibleEnough(lm: PoseLandmark | undefined, minV: number): lm is PoseLandmark {
  return !!lm && (lm.visibility ?? 1) >= minV;
}

function hypot2(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function torsoCenter(landmarks: readonly PoseLandmark[]): { x: number; y: number } {
  const ls = landmarks[POSE.LEFT_SHOULDER];
  const rs = landmarks[POSE.RIGHT_SHOULDER];
  if (ls && rs) return { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  const nose = landmarks[POSE.NOSE];
  return { x: nose?.x ?? 0.5, y: nose?.y ?? 0.5 };
}

/** Stable horizontal reference for "above the shoulders". */
export function shoulderMidline(landmarks: readonly PoseLandmark[]): { x: number; y: number } | null {
  const ls = landmarks[POSE.LEFT_SHOULDER];
  const rs = landmarks[POSE.RIGHT_SHOULDER];
  if (!ls || !rs) return null;
  return { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
}

function wristCloserToNeighbor(
  wrist: PoseLandmark,
  selfTorso: { x: number; y: number },
  others: readonly (readonly PoseLandmark[])[],
): boolean {
  const dSelf = hypot2(wrist.x, wrist.y, selfTorso.x, selfTorso.y);
  for (const other of others) {
    const t = torsoCenter(other);
    if (hypot2(wrist.x, wrist.y, t.x, t.y) + 0.04 < dSelf) return true;
  }
  return false;
}

function sideScore(
  landmarks: readonly PoseLandmark[],
  side: "left" | "right",
  mid: { x: number; y: number },
  options: {
    margin: number;
    minVisibility: number;
    maxReach: number;
    otherLandmarks: readonly (readonly PoseLandmark[])[];
  },
): number {
  const shoulder = landmarks[side === "left" ? POSE.LEFT_SHOULDER : POSE.RIGHT_SHOULDER];
  const wrist = landmarks[side === "left" ? POSE.LEFT_WRIST : POSE.RIGHT_WRIST];
  const opposite = landmarks[side === "left" ? POSE.RIGHT_SHOULDER : POSE.LEFT_SHOULDER];
  const { margin, minVisibility, maxReach, otherLandmarks } = options;

  if (!visibleEnough(wrist, minVisibility)) return 0;
  // Prefer mid-shoulder; fall back to same-side if mid missing (caller guards).
  const refY = mid.y;
  const sameY = shoulder && visibleEnough(shoulder, minVisibility * 0.7) ? shoulder.y : refY;
  // Blend: mostly midline, light same-side so a floating opposite shoulder doesn't dominate.
  const baseline = refY * 0.65 + sameY * 0.35;

  const height = baseline - wrist.y - margin;
  if (height <= 0) return 0;

  if (wristCloserToNeighbor(wrist, torsoCenter(landmarks), otherLandmarks)) return 0;

  const anchor = shoulder && visibleEnough(shoulder, minVisibility * 0.5) ? shoulder : mid;
  const reach = hypot2(anchor.x, anchor.y, wrist.x, wrist.y);
  if (reach < 0.035 || reach > maxReach) return 0;

  if (opposite && visibleEnough(opposite, minVisibility * 0.7)) {
    if (side === "left" && wrist.x > opposite.x + 0.2) return 0;
    if (side === "right" && wrist.x < opposite.x - 0.2) return 0;
  }

  // Nose gate: raised hand should reach near/above head line (rejects shrug).
  const nose = landmarks[POSE.NOSE];
  if (nose && visibleEnough(nose, minVisibility * 0.6)) {
    if (wrist.y > nose.y + 0.12) return 0;
  }

  return height;
}

/**
 * Continuous classroom raise evaluation (mid-shoulder based).
 */
export function evaluateHandRaise(
  landmarks: readonly PoseLandmark[],
  options: HandRaiseOptions = {},
): RaiseEval {
  const margin = options.margin ?? 0.028;
  const minVisibility = options.minVisibility ?? 0.22;
  const maxReach = options.maxWristFromShoulder ?? 0.72;
  const otherLandmarks = options.otherLandmarks ?? [];
  const mid = shoulderMidline(landmarks);
  if (!mid) return { raised: false, score: 0, side: null };

  const left = sideScore(landmarks, "left", mid, {
    margin,
    minVisibility,
    maxReach,
    otherLandmarks,
  });
  const right = sideScore(landmarks, "right", mid, {
    margin,
    minVisibility,
    maxReach,
    otherLandmarks,
  });
  if (left <= 0 && right <= 0) return { raised: false, score: 0, side: null };
  if (left >= right) return { raised: true, score: left, side: "left" };
  return { raised: true, score: right, side: "right" };
}

export type SeatRaiseTrackerOptions = {
  minFrames?: number;
  /** Score must exceed this to count as raised. */
  scoreThreshold?: number;
  raiseOptions?: HandRaiseOptions;
};

/**
 * Per-seat raise state: debounced HUD flag + interpolated rising-edge time for races.
 */
export class SeatRaiseTracker {
  private readonly debouncer: RaiseDebouncer;
  private readonly scoreThreshold: number;
  private readonly raiseOptions: HandRaiseOptions;
  private prevScore = 0;
  private prevMs = 0;

  constructor(options: SeatRaiseTrackerOptions = {}) {
    this.debouncer = new RaiseDebouncer({ minFrames: options.minFrames ?? 1 });
    this.scoreThreshold = options.scoreThreshold ?? 0.014;
    this.raiseOptions = options.raiseOptions ?? {};
  }

  reset(): void {
    this.debouncer.reset();
    this.prevScore = 0;
    this.prevMs = 0;
  }

  update(
    landmarks: readonly PoseLandmark[] | null,
    nowMs: number,
    otherLandmarks: readonly (readonly PoseLandmark[])[] = [],
  ): SeatRaiseUpdate {
    if (!landmarks) {
      this.debouncer.update(false);
      this.prevScore = 0;
      this.prevMs = nowMs;
      return { raised: false, rawRaised: false, score: 0, side: null };
    }

    const ev = evaluateHandRaise(landmarks, {
      ...this.raiseOptions,
      otherLandmarks,
    });
    const rawRaised = ev.score >= this.scoreThreshold;
    const raised = this.debouncer.update(rawRaised);

    let edgeAtMs: number | undefined;
    if (rawRaised && this.prevScore < this.scoreThreshold && ev.score >= this.scoreThreshold) {
      const span = Math.max(1e-3, nowMs - this.prevMs);
      const t =
        (this.scoreThreshold - this.prevScore) / Math.max(1e-6, ev.score - this.prevScore);
      edgeAtMs = this.prevMs + Math.min(1, Math.max(0, t)) * span;
    }

    this.prevScore = ev.score;
    this.prevMs = nowMs;
    return { raised, rawRaised, score: ev.score, side: ev.side, edgeAtMs };
  }
}
