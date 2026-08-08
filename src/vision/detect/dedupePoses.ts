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

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/**
 * Greedy NMS on torso centers: keep higher-visibility pose when two are too close.
 */
export function dedupePosesByTorso<T extends PoseLike>(
  poses: readonly T[],
  options: DedupeOptions = {},
): T[] {
  const minDistance = options.minDistance ?? 0.12;
  const ranked = [...poses].sort(
    (a, b) => meanVisibility(b.landmarks) - meanVisibility(a.landmarks),
  );
  const kept: T[] = [];

  for (const pose of ranked) {
    const c = torsoCenter(pose.landmarks);
    const dup = kept.some((k) => dist(c, torsoCenter(k.landmarks)) < minDistance);
    if (!dup) kept.push(pose);
  }

  return kept;
}
