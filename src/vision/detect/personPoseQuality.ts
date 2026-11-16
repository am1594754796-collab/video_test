/**
 * Reject MediaPipe false poses (chairs, bags, glare blobs) before numbering.
 */

import { POSE, type PoseLandmark } from "./isHandRaised";

export type PersonPoseQualityOptions = {
  /** Count people from shoulder landmarks without requiring head landmarks. */
  shouldersOnly?: boolean;
  minShoulderVis?: number;
  minNoseVis?: number;
  /** Minimum |Δx| between shoulders (normalized). */
  minShoulderSpan?: number;
  /** Maximum |Δx| between shoulders (normalized). */
  maxShoulderSpan?: number;
  /** Nose must sit this far above the shoulder midline (normalized y). */
  minNoseAboveShoulders?: number;
  /** Visible eye/ear landmarks required to confirm a head, not a chair back. */
  minFaceLandmarks?: number;
};

const DEFAULTS = {
  /** Distant wide-shot desks often yield softer joint visibility. */
  minShoulderVis: 0.3,
  minNoseVis: 0.25,
  /** Full-frame shoulder width can be ~0.02 for far seated rows. */
  minShoulderSpan: 0.012,
  maxShoulderSpan: 0.45,
  minNoseAboveShoulders: 0.018,
  minFaceLandmarks: 2,
} as const;

function vis(lm: PoseLandmark | undefined): number {
  return lm?.visibility ?? 0;
}

/**
 * Geometric + visibility gate: real seated people keep head above shoulders
 * and a plausible shoulder width. Furniture ghosts usually fail one of these.
 */
export function isLikelyPersonPose(
  landmarks: readonly PoseLandmark[],
  options: PersonPoseQualityOptions = {},
): boolean {
  const minShoulderVis = options.minShoulderVis ?? DEFAULTS.minShoulderVis;
  const minNoseVis = options.minNoseVis ?? DEFAULTS.minNoseVis;
  const minSpan = options.minShoulderSpan ?? DEFAULTS.minShoulderSpan;
  const maxSpan = options.maxShoulderSpan ?? DEFAULTS.maxShoulderSpan;
  const minNoseAbove = options.minNoseAboveShoulders ?? DEFAULTS.minNoseAboveShoulders;
  const minFaceLandmarks = options.minFaceLandmarks ?? DEFAULTS.minFaceLandmarks;

  const ls = landmarks[POSE.LEFT_SHOULDER];
  const rs = landmarks[POSE.RIGHT_SHOULDER];
  const nose = landmarks[POSE.NOSE];
  if (!ls || !rs) return false;
  const shoulderVisibility = options.shouldersOnly ? Math.max(minShoulderVis, 0.45) : minShoulderVis;
  if (vis(ls) < shoulderVisibility || vis(rs) < shoulderVisibility) return false;

  const span = Math.abs(rs.x - ls.x);
  if (span < minSpan || span > maxSpan) return false;
  if (options.shouldersOnly) {
    // Both shoulders should form a plausible, roughly level pair.
    return Math.abs(rs.y - ls.y) <= Math.max(0.035, span * 0.7);
  }
  if (!nose) return false;
  if (vis(nose) < minNoseVis) return false;
  const visibleFace = [2, 5, 7, 8].filter((i) => vis(landmarks[i]) >= 0.22).length;
  if (visibleFace < minFaceLandmarks) return false;

  const shoulderY = (ls.y + rs.y) / 2;
  if (nose.y > shoulderY - Math.max(minNoseAbove, span * 0.35)) return false;

  // Hips are optional. Desks often hide the lower body; MediaPipe may still
  // invent low-confidence hips. Only use a strict hip check when both hips
  // are clearly visible (open lower body), to reject inverted chair ghosts.
  const lh = landmarks[23];
  const rh = landmarks[24];
  if (lh && rh && vis(lh) >= 0.55 && vis(rh) >= 0.55) {
    const hipY = (lh.y + rh.y) / 2;
    if (hipY + 0.02 < shoulderY) return false;
  }

  return true;
}

export function filterLikelyPersonPoses<T extends { landmarks: readonly PoseLandmark[] }>(
  poses: readonly T[],
  options: PersonPoseQualityOptions = {},
): T[] {
  return poses.filter((p) => isLikelyPersonPose(p.landmarks, options));
}
