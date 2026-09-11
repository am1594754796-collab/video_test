/**
 * Normalized person boxes for the Qwen → MediaPipe cascade.
 * Coordinates are in full-frame [0, 1].
 */

import type { FaceBox } from "./faceDetector";

export type PersonBox = {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  score: number;
  /** Stable id from BoxTracker; unset on raw detections. */
  trackId?: number;
  /** Qwen left→right seat number; must follow the crop through Pose. */
  index?: number;
};

export type BoxPad = {
  /** Extra height above the box (raised hands). Fraction of box height. */
  top?: number;
  /** Extra width each side. Fraction of box width. */
  x?: number;
  /** Extra height below. Fraction of box height. */
  bottom?: number;
};

export function boxWidth(box: PersonBox): number {
  return Math.max(0, box.xMax - box.xMin);
}

export function boxHeight(box: PersonBox): number {
  return Math.max(0, box.yMax - box.yMin);
}

export function boxCenter(box: PersonBox): { x: number; y: number } {
  return {
    x: (box.xMin + box.xMax) / 2,
    y: (box.yMin + box.yMax) / 2,
  };
}

export function clipBox(box: PersonBox): PersonBox {
  return {
    ...box,
    xMin: Math.min(1, Math.max(0, box.xMin)),
    yMin: Math.min(1, Math.max(0, box.yMin)),
    xMax: Math.min(1, Math.max(0, box.xMax)),
    yMax: Math.min(1, Math.max(0, box.yMax)),
  };
}

export function boxIou(a: PersonBox, b: PersonBox): number {
  const x0 = Math.max(a.xMin, b.xMin);
  const y0 = Math.max(a.yMin, b.yMin);
  const x1 = Math.min(a.xMax, b.xMax);
  const y1 = Math.min(a.yMax, b.yMax);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  if (inter <= 0) return 0;
  const union = boxWidth(a) * boxHeight(a) + boxWidth(b) * boxHeight(b) - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Greedy class-agnostic NMS. Input should already be person-only.
 */
export function nmsPersonBoxes(
  boxes: readonly PersonBox[],
  iouThreshold = 0.45,
  maxDet = 8,
): PersonBox[] {
  const ranked = [...boxes].sort((a, b) => b.score - a.score);
  const kept: PersonBox[] = [];
  for (const box of ranked) {
    if (kept.length >= maxDet) break;
    if (kept.some((k) => boxIou(k, box) >= iouThreshold)) continue;
    kept.push(box);
  }
  return kept;
}

/**
 * Grow a Qwen face box into an upper-body crop for single-person Pose.
 * Face is the head: pad sideways for shoulders/arms, down for torso, up for raised hands.
 */
export function expandFaceToPersonCrop(face: FaceBox, pad: BoxPad = {}): PersonBox {
  const top = pad.top ?? 1.05;
  const x = pad.x ?? 1.15;
  const bottom = pad.bottom ?? 3.35;
  const w = Math.max(0.02, face.width);
  const h = Math.max(0.02, face.height);
  return clipBox({
    xMin: face.xMin - w * x,
    xMax: face.xMin + face.width + w * x,
    yMin: face.yMin - h * top,
    yMax: face.yMin + face.height + h * bottom,
    score: face.score,
    index: face.index,
  });
}

/**
 * Numbered faces (left→right) → isolated person crops for MediaPipe.
 */
export function personBoxesFromFaces(
  faces: readonly FaceBox[],
  pad: BoxPad = {},
): PersonBox[] {
  if (faces.length === 0) return [];
  const expanded = [...faces]
    .sort((a, b) => a.cx - b.cx || a.cy - b.cy)
    .map((f, i) => {
      const box = expandFaceToPersonCrop(f, pad);
      return { ...box, index: f.index ?? i + 1 };
    });
  return isolateRowCrops(expanded, { top: 0.12, x: 0.05, bottom: 0.06 });
}

/**
 * Fallback crop around a locked seat when the matching face is missing this frame.
 */
export function personBoxFromSeat(
  seat: { x: number; y: number; index?: number },
  size: { halfW?: number; halfH?: number; padTop?: number } = {},
): PersonBox {
  const halfW = size.halfW ?? 0.11;
  const halfH = size.halfH ?? 0.22;
  const padTop = size.padTop ?? 0.28;
  return clipBox({
    xMin: seat.x - halfW,
    xMax: seat.x + halfW,
    yMin: seat.y - halfH - padTop,
    yMax: seat.y + halfH,
    score: 1,
    index: seat.index,
  });
}

export function expandBoxForPose(box: PersonBox, pad: BoxPad = {}): PersonBox {
  const top = pad.top ?? 0.35;
  const x = pad.x ?? 0.08;
  const bottom = pad.bottom ?? 0.08;
  const w = boxWidth(box);
  const h = boxHeight(box);
  return clipBox({
    ...box,
    xMin: box.xMin - w * x,
    xMax: box.xMax + w * x,
    yMin: box.yMin - h * top,
    yMax: box.yMax + h * bottom,
  });
}

/**
 * Expand for raised-hand headroom, then clip each crop at the midpoint
 * between adjacent people so two close bodies do not share keypoints.
 */
export function isolateRowCrops(
  boxes: readonly PersonBox[],
  pad: BoxPad = {},
): PersonBox[] {
  if (boxes.length === 0) return [];
  const sorted = [...boxes].sort((a, b) => boxCenter(a).x - boxCenter(b).x);
  return sorted.map((box, i) => {
    const expanded = expandBoxForPose(box, pad);
    const leftMid = i > 0 ? (boxCenter(sorted[i - 1]!).x + boxCenter(box).x) / 2 : 0;
    const rightMid =
      i < sorted.length - 1 ? (boxCenter(box).x + boxCenter(sorted[i + 1]!).x) / 2 : 1;
    const xMin = Math.min(expanded.xMax - 0.02, Math.max(expanded.xMin, leftMid));
    const xMax = Math.max(xMin + 0.02, Math.min(expanded.xMax, rightMid));
    return clipBox({ ...expanded, xMin, xMax });
  });
}

/**
 * Keep a seated row: drop tiny / low-score boxes, cluster by Y, cap at expected.
 * Close neighbors are kept as long as their centers differ in X.
 */
export function selectPersonRow(
  boxes: readonly PersonBox[],
  expectedCount: number,
  options: { minScore?: number; minHeight?: number; minGapX?: number; yBand?: number } = {},
): PersonBox[] {
  const expected = Math.max(1, Math.min(8, Math.floor(expectedCount)));
  const minScore = options.minScore ?? 0.25;
  const minHeight = options.minHeight ?? 0.08;
  const minGapX = options.minGapX ?? 0.028;
  const yBand = options.yBand ?? 0.2;

  const filtered = boxes.filter(
    (b) => b.score >= minScore && boxHeight(b) >= minHeight && boxWidth(b) >= 0.02,
  );
  if (filtered.length === 0) return [];

  const ys = filtered.map((b) => boxCenter(b).y).sort((a, b) => a - b);
  const medianY = ys[Math.floor(ys.length / 2)]!;
  const row = filtered.filter((b) => Math.abs(boxCenter(b).y - medianY) <= yBand);
  const pool = row.length >= Math.min(2, filtered.length) ? row : filtered;

  if (pool.length <= expected) {
    return [...pool].sort((a, b) => boxCenter(a).x - boxCenter(b).x);
  }

  const byScore = [...pool].sort((a, b) => b.score - a.score);
  const chosen: PersonBox[] = [];
  for (const box of byScore) {
    if (chosen.length >= expected) break;
    const x = boxCenter(box).x;
    if (chosen.some((c) => Math.abs(boxCenter(c).x - x) < minGapX)) continue;
    chosen.push(box);
  }
  return chosen.sort((a, b) => boxCenter(a).x - boxCenter(b).x);
}
