/**
 * Self-segmentation for classroom rows:
 * MediaPipe multi-person Pose → person boxes → isolate close neighbors → L→R numbers.
 * No cloud face / Qwen.
 */

import { torsoCenter } from "./dedupePoses";
import { POSE, type PoseLandmark } from "./isHandRaised";
import {
  boxCenter,
  clipBox,
  isolateRowCrops,
  type PersonBox,
} from "./personBox";

export type IndexedPose = {
  index: number;
  x: number;
  y: number;
  landmarks: readonly PoseLandmark[];
};

function visible(lm: PoseLandmark | undefined, min = 0.2): lm is PoseLandmark {
  return !!lm && (lm.visibility ?? 1) >= min;
}

/**
 * Tight upper-body box from MediaPipe joints, with headroom for raised hands.
 */
export function personBoxFromLandmarks(
  landmarks: readonly PoseLandmark[],
  index?: number,
): PersonBox {
  const pts: PoseLandmark[] = [];
  for (const i of [
    POSE.NOSE,
    POSE.LEFT_SHOULDER,
    POSE.RIGHT_SHOULDER,
    POSE.LEFT_ELBOW,
    POSE.RIGHT_ELBOW,
    POSE.LEFT_WRIST,
    POSE.RIGHT_WRIST,
    23,
    24, // hips
  ]) {
    const p = landmarks[i];
    if (visible(p, 0.15)) pts.push(p);
  }
  if (pts.length === 0) {
    const c = torsoCenter(landmarks);
    return clipBox({
      xMin: c.x - 0.08,
      xMax: c.x + 0.08,
      yMin: c.y - 0.2,
      yMax: c.y + 0.25,
      score: 0.3,
      index,
    });
  }

  let xMin = 1;
  let xMax = 0;
  let yMin = 1;
  let yMax = 0;
  for (const p of pts) {
    xMin = Math.min(xMin, p.x);
    xMax = Math.max(xMax, p.x);
    yMin = Math.min(yMin, p.y);
    yMax = Math.max(yMax, p.y);
  }
  const w = Math.max(0.04, xMax - xMin);
  const h = Math.max(0.06, yMax - yMin);
  // Side pad small so close neighbors stay separable; tall pad for raised hands.
  return clipBox({
    xMin: xMin - w * 0.35,
    xMax: xMax + w * 0.35,
    yMin: yMin - h * 0.55,
    yMax: yMax + h * 0.25,
    score: 1,
    index,
  });
}

/** Left→right seat numbers from pose torso x. */
export function numberPosesLeftToRight(
  poses: readonly { landmarks: readonly PoseLandmark[] }[],
  expected: number,
): IndexedPose[] {
  const n = Math.max(1, Math.min(8, Math.floor(expected)));
  const ranked = [...poses]
    .map((p) => {
      const c = torsoCenter(p.landmarks);
      const nose = p.landmarks[POSE.NOSE];
      const x = visible(nose, 0.25) ? nose.x : c.x;
      const y = visible(nose, 0.25) ? nose.y : Math.max(0, c.y - 0.1);
      return { landmarks: p.landmarks, x, y };
    })
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .slice(0, n);

  return ranked.map((p, i) => ({
    index: i + 1,
    x: p.x,
    y: p.y,
    landmarks: p.landmarks,
  }));
}

/**
 * Build isolated zoom crops: one box per pose, clipped at midpoints so
 * people sitting close do not share an ROI.
 */
export function personBoxesFromPoses(
  poses: readonly IndexedPose[],
  pad: { top?: number; x?: number; bottom?: number } = {},
): PersonBox[] {
  if (poses.length === 0) return [];
  const raw = poses
    .map((p) => ({ ...personBoxFromLandmarks(p.landmarks, p.index), index: p.index }))
    .sort((a, b) => boxCenter(a).x - boxCenter(b).x);

  // Stronger isolation for close seating (smaller side pad, hard mid splits).
  return isolateRowCrops(raw, {
    top: pad.top ?? 0.28,
    x: pad.x ?? 0.02,
    bottom: pad.bottom ?? 0.08,
  });
}

/**
 * Locked seats → zoom crops. Prefer landmark boxes when present so close
 * neighbors stay mid-split; fall back to seat center boxes.
 */
export function personBoxesFromSeats(
  seats: readonly {
    index: number;
    x: number;
    y: number;
    landmarks?: readonly PoseLandmark[] | null;
  }[],
): PersonBox[] {
  const ordered = [...seats].sort((a, b) => a.index - b.index);
  const withPose = ordered.filter((s) => s.landmarks && s.landmarks.length >= 17);
  if (withPose.length === ordered.length && ordered.length > 0) {
    return personBoxesFromPoses(
      ordered.map((s) => ({
        index: s.index,
        x: s.x,
        y: s.y,
        landmarks: s.landmarks!,
      })),
    );
  }
  const raw = ordered.map((s) =>
    clipBox({
      xMin: s.x - 0.09,
      xMax: s.x + 0.09,
      yMin: s.y - 0.28,
      yMax: s.y + 0.32,
      score: 1,
      index: s.index,
    }),
  );
  return isolateRowCrops(raw, { top: 0.22, x: 0.02, bottom: 0.06 });
}

/**
 * Re-bind live poses to locked seat indexes by nearest torso x (never re-sort numbers).
 */
export function bindPosesToLockedIndexes(
  locked: readonly { index: number; x: number; y: number }[],
  poses: readonly { landmarks: readonly PoseLandmark[] }[],
  maxDx = 0.14,
): IndexedPose[] {
  const free = poses.map((p) => {
    const c = torsoCenter(p.landmarks);
    return { landmarks: p.landmarks, x: c.x, y: c.y, used: false };
  });
  const out: IndexedPose[] = [];
  for (const seat of [...locked].sort((a, b) => a.index - b.index)) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < free.length; i++) {
      const p = free[i]!;
      if (p.used) continue;
      const d = Math.abs(p.x - seat.x) + Math.abs(p.y - seat.y) * 0.35;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0 || bestD > maxDx) continue;
    const p = free[best]!;
    p.used = true;
    out.push({ index: seat.index, x: p.x, y: p.y, landmarks: p.landmarks });
  }
  return out;
}
