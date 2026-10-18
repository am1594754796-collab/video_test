/**
 * Classroom raise signal: colored paddle (primary) + weak pose assist + N-frame confirm.
 *
 * Pipeline:
 *   MediaPipe Pose (EMA) + frame pixels → evaluatePaddleRaise (color-heavy)
 *   → RaiseDebouncer → FirstRaiseTracker score/edge.
 *
 * `evaluateHandRaise` remains available for pose-only debugging.
 */

import { RaiseDebouncer } from "./raiseDebouncer";
import { emaBlendLandmarks } from "./landmarkSmooth";
import {
  handsRaised,
  POSE,
  type HandRaiseOptions,
  type PoseLandmark,
} from "./isHandRaised";
import { paddleColorForSeat, type PaddleColor } from "./paddleColors";
import {
  evaluatePaddleRaise,
  type FramePixels,
  type PaddleRaiseOptions,
} from "./paddleSignal";

export type RaiseEval = {
  raised: boolean;
  /** Wrist-above-shoulder clearance on the winning side (for race ties). */
  score: number;
  side: "left" | "right" | null;
};

export type SeatRaiseUpdate = {
  /** Debounced / N-frame-confirmed flag for HUD + first-raise race. */
  raised: boolean;
  /** Instantaneous paddle+pose raise. */
  rawRaised: boolean;
  score: number;
  side: "left" | "right" | null;
  paddleScore?: number;
  poseAssist?: number;
  /** Clock when confirmed raise first became true (rising edge). */
  edgeAtMs?: number;
};

export type SeatRaiseFrameContext = {
  otherLandmarks?: readonly (readonly PoseLandmark[])[];
  frame?: FramePixels | null;
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
  /** Instantaneous fused score must exceed this to count as a raw hit. */
  scoreThreshold?: number;
  /** EMA alpha for pose-assisted landmark smoothing (0 = off). */
  smoothAlpha?: number;
  /** Seat index 1–6 → paddle color. Required for classroom paddle mode. */
  seatIndex?: number;
  /** Override paddle color (defaults from seatIndex). */
  paddleColor?: PaddleColor;
  /**
   * When true (default), require paddle color in the frame.
   * Set false only for pose-only unit tests / legacy debug.
   */
  requirePaddle?: boolean;
  raiseOptions?: HandRaiseOptions;
  paddleOptions?: PaddleRaiseOptions;
};

/**
 * Per-seat raise: EMA pose smooth → paddle color + weak pose → N-frame confirm.
 * With minFrames=1, the first qualifying frame is raised + race edge.
 */
export class SeatRaiseTracker {
  private readonly debouncer: RaiseDebouncer;
  private readonly scoreThreshold: number;
  private readonly raiseOptions: HandRaiseOptions;
  private readonly paddleOptions: PaddleRaiseOptions;
  private readonly smoothAlpha: number;
  private readonly paddleColor: PaddleColor;
  private readonly requirePaddle: boolean;
  private prevConfirmed = false;
  private confirmStreakStartMs = 0;
  private smoothed: PoseLandmark[] | null = null;

  constructor(options: SeatRaiseTrackerOptions = {}) {
    this.debouncer = new RaiseDebouncer({ minFrames: options.minFrames ?? 1 });
    this.scoreThreshold = options.scoreThreshold ?? 0.01;
    this.raiseOptions = { classroom: true, ...(options.raiseOptions ?? {}) };
    this.paddleOptions = options.paddleOptions ?? {};
    this.smoothAlpha = options.smoothAlpha ?? 0.45;
    this.paddleColor = options.paddleColor ?? paddleColorForSeat(options.seatIndex ?? 1);
    this.requirePaddle = options.requirePaddle ?? true;
  }

  get color(): PaddleColor {
    return this.paddleColor;
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
    ctx: SeatRaiseFrameContext | readonly (readonly PoseLandmark[])[] = {},
  ): SeatRaiseUpdate {
    const frameCtx: SeatRaiseFrameContext = Array.isArray(ctx)
      ? { otherLandmarks: ctx as readonly (readonly PoseLandmark[])[] }
      : (ctx as SeatRaiseFrameContext);

    if (!landmarks) {
      this.debouncer.update(false);
      this.prevConfirmed = false;
      this.confirmStreakStartMs = 0;
      this.smoothed = null;
      return { raised: false, rawRaised: false, score: 0, side: null, paddleScore: 0, poseAssist: 0 };
    }

    const pose =
      this.smoothAlpha > 0
        ? emaBlendLandmarks(this.smoothed, landmarks, this.smoothAlpha)
        : landmarks.map((p) => ({ ...p }));
    this.smoothed = pose;

    let rawRaised = false;
    let score = 0;
    let side: "left" | "right" | null = null;
    let paddleScore = 0;
    let poseAssist = 0;

    if (this.requirePaddle) {
      const ev = evaluatePaddleRaise(pose, frameCtx.frame, this.paddleColor, this.paddleOptions);
      paddleScore = ev.paddleScore;
      poseAssist = ev.poseAssist;
      score = ev.score;
      side = ev.side;
      rawRaised = ev.raised && ev.score >= this.scoreThreshold;
    } else {
      const ev = evaluateHandRaise(pose, {
        ...this.raiseOptions,
        classroom: true,
        otherLandmarks: frameCtx.otherLandmarks ?? [],
      });
      score = ev.score;
      side = ev.side;
      rawRaised = ev.raised && ev.score >= this.scoreThreshold;
    }

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
    return { raised, rawRaised, score, side, paddleScore, poseAssist, edgeAtMs };
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
