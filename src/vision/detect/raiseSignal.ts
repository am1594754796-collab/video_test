/**
 * Classroom raise signal on MediaPipe Pose joints + N-frame confirm + race timing.
 *
 * Pipeline:
 *   MediaPipe Pose landmarks (EMA-smoothed) → isHandRaised / handsRaised
 *   → RaiseDebouncer (default 1 frame = first hit) → FirstRaiseTracker score/edge.
 */

import { RaiseDebouncer } from "./raiseDebouncer";
import { emaBlendLandmarks } from "./landmarkSmooth";
import {
  handsRaised,
  POSE,
  type HandRaiseOptions,
  type PoseLandmark,
} from "./isHandRaised";

export type RaiseEval = {
  raised: boolean;
  /** Wrist-above-shoulder clearance on the winning side (for race ties). */
  score: number;
  side: "left" | "right" | null;
};

export type SeatRaiseUpdate = {
  /** Debounced / N-frame-confirmed flag for HUD + first-raise race. */
  raised: boolean;
  /** Instantaneous MediaPipe joint raise. */
  rawRaised: boolean;
  score: number;
  side: "left" | "right" | null;
  /** Clock when confirmed raise first became true (rising edge). */
  edgeAtMs?: number;
};

/** Default wrist-above-shoulder margin for classroom MediaPipe joints. */
export const DEFAULT_RAISE_MARGIN = 0.02;

function hypot2(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function sideClearance(
  landmarks: readonly PoseLandmark[],
  side: "left" | "right",
  margin: number,
): number {
  const shoulder = landmarks[side === "left" ? POSE.LEFT_SHOULDER : POSE.RIGHT_SHOULDER];
  const opposite = landmarks[side === "left" ? POSE.RIGHT_SHOULDER : POSE.LEFT_SHOULDER];
  const wrist = landmarks[side === "left" ? POSE.LEFT_WRIST : POSE.RIGHT_WRIST];
  if (!shoulder || !wrist) return 0;
  const midY = opposite ? (shoulder.y + opposite.y) / 2 : shoulder.y;
  const baseline = Math.min(midY, shoulder.y) * 0.55 + midY * 0.45;
  return Math.max(0, baseline - wrist.y - margin);
}

/**
 * Evaluate raise from MediaPipe Pose landmarks (joints 11–16 + nose).
 */
export function evaluateHandRaise(
  landmarks: readonly PoseLandmark[],
  options: HandRaiseOptions = {},
): RaiseEval {
  const margin = options.margin ?? DEFAULT_RAISE_MARGIN;
  const opts: HandRaiseOptions = {
    ...options,
    classroom: true,
    margin,
    minVisibility: options.minVisibility ?? 0.2,
    maxWristFromShoulder: options.maxWristFromShoulder ?? 0.72,
  };
  const hands = handsRaised(landmarks, opts);
  const leftScore = hands.left ? Math.max(0.02, sideClearance(landmarks, "left", margin)) : 0;
  const rightScore = hands.right ? Math.max(0.02, sideClearance(landmarks, "right", margin)) : 0;

  if (!hands.left && !hands.right) return { raised: false, score: 0, side: null };
  if (leftScore >= rightScore && hands.left) {
    return { raised: true, score: leftScore, side: "left" };
  }
  if (hands.right) return { raised: true, score: rightScore, side: "right" };
  return { raised: true, score: leftScore, side: "left" };
}

export type SeatRaiseTrackerOptions = {
  /**
   * Consecutive frames required to confirm / clear raised.
   * Default 1: first frame that passes the raise predicate counts (race-friendly).
   */
  minFrames?: number;
  /** Instantaneous score must exceed this to count as a raw hit. */
  scoreThreshold?: number;
  /** EMA alpha for pose-assisted landmark smoothing (0 = off). */
  smoothAlpha?: number;
  raiseOptions?: HandRaiseOptions;
};

/**
 * Per-seat raise: EMA pose smooth → MediaPipe joint raise → optional N-frame confirm.
 * With minFrames=1, the first qualifying frame is raised + race edge.
 */
export class SeatRaiseTracker {
  private readonly debouncer: RaiseDebouncer;
  private readonly scoreThreshold: number;
  private readonly raiseOptions: HandRaiseOptions;
  private readonly smoothAlpha: number;
  private prevConfirmed = false;
  private confirmStreakStartMs = 0;
  private smoothed: PoseLandmark[] | null = null;

  constructor(options: SeatRaiseTrackerOptions = {}) {
    this.debouncer = new RaiseDebouncer({ minFrames: options.minFrames ?? 1 });
    this.scoreThreshold = options.scoreThreshold ?? 0.01;
    this.raiseOptions = { classroom: true, ...(options.raiseOptions ?? {}) };
    this.smoothAlpha = options.smoothAlpha ?? 0.45;
  }

  reset(): void {
    this.debouncer.reset();
    this.prevConfirmed = false;
    this.confirmStreakStartMs = 0;
    this.smoothed = null;
  }

  update(
    landmarks: readonly PoseLandmark[] | null,
    nowMs: number,
    otherLandmarks: readonly (readonly PoseLandmark[])[] = [],
  ): SeatRaiseUpdate {
    if (!landmarks) {
      this.debouncer.update(false);
      this.prevConfirmed = false;
      this.confirmStreakStartMs = 0;
      this.smoothed = null;
      return { raised: false, rawRaised: false, score: 0, side: null };
    }

    const pose =
      this.smoothAlpha > 0
        ? emaBlendLandmarks(this.smoothed, landmarks, this.smoothAlpha)
        : landmarks.map((p) => ({ ...p }));
    this.smoothed = pose;

    const ev = evaluateHandRaise(pose, {
      ...this.raiseOptions,
      classroom: true,
      otherLandmarks,
    });
    const rawRaised = ev.raised && ev.score >= this.scoreThreshold;

    if (rawRaised && this.confirmStreakStartMs === 0) {
      this.confirmStreakStartMs = nowMs;
    } else if (!rawRaised) {
      this.confirmStreakStartMs = 0;
    }

    const raised = this.debouncer.update(rawRaised);

    let edgeAtMs: number | undefined;
    if (raised && !this.prevConfirmed) {
      edgeAtMs = this.confirmStreakStartMs || nowMs;
    }

    this.prevConfirmed = raised;
    return { raised, rawRaised, score: ev.score, side: ev.side, edgeAtMs };
  }
}

/** @deprecated kept for older imports; use evaluateHandRaise / isHandRaised. */
export function shoulderMidline(landmarks: readonly PoseLandmark[]): { x: number; y: number } | null {
  const ls = landmarks[POSE.LEFT_SHOULDER];
  const rs = landmarks[POSE.RIGHT_SHOULDER];
  if (!ls || !rs) return null;
  return { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
}

export function isArmVertical(
  shoulder: PoseLandmark,
  _elbow: PoseLandmark | undefined,
  wrist: PoseLandmark,
): boolean {
  void _elbow;
  const rise = shoulder.y - wrist.y;
  if (rise < 0.05) return false;
  const dx = Math.abs(wrist.x - shoulder.x);
  return dx / rise <= 0.5;
}

export function isCompactHeadRaise(
  shoulder: PoseLandmark,
  _elbow: PoseLandmark | undefined,
  wrist: PoseLandmark,
  nose: PoseLandmark | undefined,
): boolean {
  void _elbow;
  if (!nose) return false;
  if (wrist.y > shoulder.y + 0.02) return false;
  if (wrist.y > nose.y + 0.12) return false;
  return hypot2(wrist.x, wrist.y, nose.x, nose.y) <= 0.2;
}

export function isLateralArmNotRaise(
  shoulder: PoseLandmark,
  wrist: PoseLandmark,
  nose: PoseLandmark | undefined,
  side: "left" | "right",
): boolean {
  const headX = nose?.x ?? shoulder.x;
  const outward =
    side === "right" ? wrist.x - Math.max(shoulder.x, headX) : Math.min(shoulder.x, headX) - wrist.x;
  if (outward <= 0.08) return false;
  const headLine = nose ? nose.y + 0.06 : shoulder.y - 0.06;
  return wrist.y > headLine;
}
