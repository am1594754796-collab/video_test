/**
 * Temporal EMA on pose landmarks — stabilizes noisy shoulders/wrists for overlay + raise.
 */

import { POSE, type PoseLandmark } from "./isHandRaised";

const SMOOTH_IDX = [
  POSE.NOSE,
  POSE.LEFT_SHOULDER,
  POSE.RIGHT_SHOULDER,
  POSE.LEFT_ELBOW,
  POSE.RIGHT_ELBOW,
  POSE.LEFT_WRIST,
  POSE.RIGHT_WRIST,
] as const;

export function emaBlendLandmarks(
  prev: readonly PoseLandmark[] | null | undefined,
  next: readonly PoseLandmark[],
  alpha = 0.42,
): PoseLandmark[] {
  if (!prev || prev.length === 0) {
    return next.map((p) => ({ ...p }));
  }
  const out = next.map((p) => ({ ...p }));
  const a = Math.min(1, Math.max(0.05, alpha));
  for (const i of SMOOTH_IDX) {
    const n = next[i];
    const p = prev[i];
    if (!n || !p) continue;
    out[i] = {
      x: p.x * (1 - a) + n.x * a,
      y: p.y * (1 - a) + n.y * a,
      z: n.z,
      visibility: n.visibility ?? p.visibility,
    };
  }
  return out;
}
