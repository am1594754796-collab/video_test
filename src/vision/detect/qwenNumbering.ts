/**
 * Number people by on-screen face center: smallest x is #1 (viewer left → right).
 * Any model-provided `index` is ignored.
 */

import type { FaceBox } from "./faceDetector";

export type NumberedFace = FaceBox & { index: number };

export function numberFacesLeftToRight(
  faces: readonly FaceBox[],
  maxPeople = 6,
): NumberedFace[] {
  const cap = Math.max(1, Math.min(8, Math.floor(maxPeople)));
  return [...faces]
    .sort((a, b) => a.cx - b.cx || a.cy - b.cy)
    .slice(0, cap)
    .map((f, i) => ({ ...f, index: i + 1 }));
}

export function blendNumberedFace(
  prev: NumberedFace,
  live: FaceBox,
  alpha: number,
): NumberedFace {
  const a = Math.min(1, Math.max(0, alpha));
  const cx = prev.cx + (live.cx - prev.cx) * a;
  const cy = prev.cy + (live.cy - prev.cy) * a;
  const width = prev.width + (live.width - prev.width) * a;
  const height = prev.height + (live.height - prev.height) * a;
  return {
    cx,
    cy,
    width,
    height,
    xMin: cx - width / 2,
    yMin: cy - height / 2,
    score: live.score,
    index: prev.index,
  };
}

/**
 * After lock, keep each Qwen index on the same person.
 * Match new detections to the previous face box — never re-sort left→right.
 * Unmatched seats keep their last box so numbers cannot jump or vanish.
 */
export function followLockedFaces(
  locked: readonly NumberedFace[],
  live: readonly FaceBox[],
  options: { maxDistance?: number; alpha?: number } = {},
): NumberedFace[] {
  if (locked.length === 0) return [];
  if (live.length === 0) return [...locked];

  const maxDistance = options.maxDistance ?? 0.15;
  const alpha = options.alpha ?? 0.45;

  type Pair = { si: number; fi: number; d: number };
  const pairs: Pair[] = [];
  for (let si = 0; si < locked.length; si++) {
    const seat = locked[si]!;
    for (let fi = 0; fi < live.length; fi++) {
      const f = live[fi]!;
      const d = Math.hypot(f.cx - seat.cx, f.cy - seat.cy);
      if (d <= maxDistance) pairs.push({ si, fi, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);

  const usedSeat = new Set<number>();
  const usedLive = new Set<number>();
  const hit = new Map<number, FaceBox>();
  for (const p of pairs) {
    if (usedSeat.has(p.si) || usedLive.has(p.fi)) continue;
    usedSeat.add(p.si);
    usedLive.add(p.fi);
    hit.set(p.si, live[p.fi]!);
  }

  return locked.map((seat, si) => {
    const next = hit.get(si);
    return next ? blendNumberedFace(seat, next, alpha) : seat;
  });
}

/**
 * Ease a locked face toward that same index's nose. Ignore heads that are too far
 * (wrong-person pose) so a raised arm cannot steal a neighbor's number.
 */
export function nudgeLockedFacesTowardHeads(
  locked: readonly NumberedFace[],
  heads: readonly { index: number; x: number; y: number }[],
  options: { maxDistance?: number; alpha?: number } = {},
): NumberedFace[] {
  const maxDistance = options.maxDistance ?? 0.11;
  const alpha = options.alpha ?? 0.28;
  const byIndex = new Map<number, { x: number; y: number }>();
  for (const h of heads) {
    if (!byIndex.has(h.index)) byIndex.set(h.index, h);
  }
  return locked.map((face) => {
    const head = byIndex.get(face.index);
    if (!head) return face;
    const d = Math.hypot(head.x - face.cx, head.y - face.cy);
    if (d > maxDistance) return face;
    return blendNumberedFace(face, { ...face, cx: head.x, cy: head.y }, alpha);
  });
}

export type VisionFacePollGate = {
  force?: boolean;
  nowMs: number;
  lastFaceTs: number;
  minIntervalMs: number;
  inFlight: boolean;
};

/** Poll Qwen for numbering / crop updates (not only when a seat is missing). */
export function shouldPollVisionFaces(gate: VisionFacePollGate): boolean {
  if (gate.inFlight) return false;
  if (gate.force) return true;
  return gate.nowMs - gate.lastFaceTs >= gate.minIntervalMs;
}
