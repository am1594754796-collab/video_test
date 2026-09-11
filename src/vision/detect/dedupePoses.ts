/**
 * Collapse near-duplicate pose detections (one person → multiple boxes).
 */

import { POSE, type PoseLandmark } from "./isHandRaised";

export type PoseLike = {
  landmarks: readonly PoseLandmark[];
};

export type DedupeOptions = {
  /** Normalized image distance between torso centers to treat as the same person. */
  minDistance?: number;
  /**
   * If |Δx| between torso centers is at least this, never merge (row seating).
   * Keeps adjacent people who sit shoulder-to-shoulder but are still distinct seats.
   */
  minSeparationX?: number;
  /**
   * Scale applied to Δy inside the distance metric (default 1).
   * Values < 1 make vertical lean less likely to trigger a merge.
   */
  yWeight?: number;
};

export function torsoCenter(landmarks: readonly PoseLandmark[]): { x: number; y: number } {
  const ls = landmarks[POSE.LEFT_SHOULDER];
  const rs = landmarks[POSE.RIGHT_SHOULDER];
  if (ls && rs) {
    return { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  }
  const nose = landmarks[0];
  return { x: nose?.x ?? 0.5, y: nose?.y ?? 0.5 };
}

function meanVisibility(landmarks: readonly PoseLandmark[]): number {
  const keys = [POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER, POSE.LEFT_WRIST, POSE.RIGHT_WRIST];
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

function mergeDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
  yWeight: number,
): number {
  const dx = a.x - b.x;
  const dy = (a.y - b.y) * yWeight;
  return Math.hypot(dx, dy);
}

/**
 * Greedy NMS on torso centers: keep higher-visibility pose when two are too close.
 * For classroom rows, prefer horizontal separation so adjacent seats are not merged.
 */
export function dedupePosesByTorso<T extends PoseLike>(
  poses: readonly T[],
  options: DedupeOptions = {},
): T[] {
  const minDistance = options.minDistance ?? 0.12;
  const minSeparationX = options.minSeparationX;
  const yWeight = options.yWeight ?? 1;
  const ranked = [...poses].sort(
    (a, b) => meanVisibility(b.landmarks) - meanVisibility(a.landmarks),
  );
  const kept: T[] = [];

  for (const pose of ranked) {
    const c = torsoCenter(pose.landmarks);
    const dup = kept.some((k) => {
      const other = torsoCenter(k.landmarks);
      const dx = Math.abs(c.x - other.x);
      if (minSeparationX != null && dx >= minSeparationX) return false;
      return mergeDistance(c, other, yWeight) < minDistance;
    });
    if (!dup) kept.push(pose);
  }

  return kept;
}
