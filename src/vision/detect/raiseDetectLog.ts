/**
 * Throttled structured console logs for classroom hand-raise false negatives.
 *
 * Enable: default on vision pages. Disable with ?raiseLog=0 or localStorage raiseLog=0.
 */

import type { HandRaiseDiagnosis } from "./isHandRaised";

export type RaiseDetectLogPayload = {
  event: "raise_edge" | "raise_miss" | "raise_no_pose";
  seat: number;
  nowMs: number;
  rawRaised: boolean;
  raised: boolean;
  score: number;
  side: "left" | "right" | null;
  paddleScore?: number;
  poseAssist?: number;
  diagnosis?: HandRaiseDiagnosis;
  note?: string;
};

const NEAR_MISS_UP = -0.05;
const MISS_THROTTLE_MS = 500;

let enabledCache: boolean | null = null;

export function isRaiseDetectLogEnabled(): boolean {
  if (enabledCache != null) return enabledCache;
  try {
    if (typeof window === "undefined") {
      enabledCache = false;
      return false;
    }
    const q = new URLSearchParams(window.location.search).get("raiseLog");
    if (q === "0" || q === "false") {
      enabledCache = false;
      return false;
    }
    if (q === "1" || q === "true") {
      enabledCache = true;
      return true;
    }
    const ls = window.localStorage?.getItem("raiseLog");
    if (ls === "0" || ls === "false") {
      enabledCache = false;
      return false;
    }
    // Classroom vision tooling: on by default so false negatives are diagnosable.
    enabledCache = true;
    return true;
  } catch {
    enabledCache = true;
    return true;
  }
}

/** Test / hot-reload helper. */
export function resetRaiseDetectLogEnabledCache(): void {
  enabledCache = null;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function compactDiagnosis(d: HandRaiseDiagnosis | undefined) {
  if (!d) return undefined;
  const side = (s: HandRaiseDiagnosis["left"]) => ({
    raised: s.raised,
    reason: s.reason,
    up: s.metrics ? round4(s.metrics.up) : null,
    sideways: s.metrics ? round4(s.metrics.sideways) : null,
    reach: s.metrics ? round4(s.metrics.reach) : null,
    wristY: s.metrics ? round4(s.metrics.wristY) : null,
    shoulderY: s.metrics ? round4(s.metrics.shoulderY) : null,
    elbowY: s.metrics ? round4(s.metrics.elbowY) : null,
    noseY: s.metrics?.noseY != null ? round4(s.metrics.noseY) : null,
    wristVis: s.metrics ? round4(s.metrics.wristVis) : null,
    shoulderVis: s.metrics ? round4(s.metrics.shoulderVis) : null,
    minUp: s.metrics ? round4(s.metrics.minUp) : null,
    wristSlack: s.metrics ? round4(s.metrics.wristSlack) : null,
  });
  return { raised: d.raised, left: side(d.left), right: side(d.right) };
}

export class SeatRaiseLogger {
  private readonly seat: number;
  private lastRaw = false;
  private lastRaised = false;
  private lastMissLogMs = 0;
  private lastNoPose = false;
  private primed = false;

  constructor(seat: number) {
    this.seat = seat;
  }

  reset(): void {
    this.lastRaw = false;
    this.lastRaised = false;
    this.lastMissLogMs = 0;
    this.lastNoPose = false;
    this.primed = false;
  }

  /**
   * Log rising/falling edges always; near-miss (arm somewhat up but not raised)
   * at most every MISS_THROTTLE_MS.
   */
  observe(payload: Omit<RaiseDetectLogPayload, "event" | "seat"> & {
    diagnosis?: HandRaiseDiagnosis;
  }): void {
    if (!isRaiseDetectLogEnabled()) return;

    const edge =
      this.primed &&
      (payload.rawRaised !== this.lastRaw || payload.raised !== this.lastRaised);
    const bestUp = Math.max(
      payload.diagnosis?.left.metrics?.up ?? -1,
      payload.diagnosis?.right.metrics?.up ?? -1,
    );
    const nearMiss =
      !payload.rawRaised &&
      !payload.raised &&
      bestUp >= NEAR_MISS_UP &&
      payload.nowMs - this.lastMissLogMs >= MISS_THROTTLE_MS;

    this.lastNoPose = false;

    if (!this.primed) {
      this.primed = true;
      this.lastRaw = payload.rawRaised;
      this.lastRaised = payload.raised;
      return;
    }

    if (!edge && !nearMiss) {
      this.lastRaw = payload.rawRaised;
      this.lastRaised = payload.raised;
      return;
    }

    const event: RaiseDetectLogPayload["event"] = edge ? "raise_edge" : "raise_miss";
    if (event === "raise_miss") this.lastMissLogMs = payload.nowMs;

    const body: RaiseDetectLogPayload = {
      event,
      seat: this.seat,
      nowMs: Math.round(payload.nowMs),
      rawRaised: payload.rawRaised,
      raised: payload.raised,
      score: round4(payload.score),
      side: payload.side,
      paddleScore: payload.paddleScore != null ? round4(payload.paddleScore) : undefined,
      poseAssist: payload.poseAssist != null ? round4(payload.poseAssist) : undefined,
      diagnosis: payload.diagnosis,
      note: edge
        ? `raw ${this.lastRaw}->${payload.rawRaised} confirmed ${this.lastRaised}->${payload.raised}`
        : "near-miss: arm up-ish but predicate false",
    };

    // Structured object for DevTools expand/filter; keep one stable prefix.
    console.info("[raiseDetect]", {
      ...body,
      diagnosis: compactDiagnosis(body.diagnosis),
    });

    this.lastRaw = payload.rawRaised;
    this.lastRaised = payload.raised;
  }

  noPose(nowMs: number, held: boolean): void {
    if (!isRaiseDetectLogEnabled()) return;
    // Only log the transition into missing-pose (not every held frame).
    if (this.lastNoPose) return;
    this.lastNoPose = true;
    this.lastMissLogMs = nowMs;
    console.info("[raiseDetect]", {
      event: "raise_no_pose",
      seat: this.seat,
      nowMs: Math.round(nowMs),
      rawRaised: false,
      raised: held,
      score: 0,
      side: null,
      note: held ? "pose missing; holding last confirmed" : "pose missing; cleared",
    } satisfies RaiseDetectLogPayload);
  }
}
