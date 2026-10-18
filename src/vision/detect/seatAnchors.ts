/**
 * After numbering lock, identity is the seat index — not MediaPipe trackId.
 * Each frame we re-associate detections to fixed seats by position.
 */

import type { PoseLandmark } from "./isHandRaised";
import { emaBlendLandmarks } from "./landmarkSmooth";
import { RaiseDebouncer } from "./raiseDebouncer";
import type { NumberingSlot } from "./numberingSlots";

export type SeatDetection = {
  x: number;
  y: number;
  landmarks: readonly PoseLandmark[];
};

export type SeatAnchor = {
  index: number;
  x: number;
  y: number;
  landmarks: readonly PoseLandmark[] | null;
  debouncer: RaiseDebouncer;
  missed: number;
  /** True when a live detection was bound this frame. */
  fresh: boolean;
};

export type SeatMatchOptions = {
  /** Max distance to bind a detection to a seat (normalized). */
  maxDistance?: number;
  /** Scale applied to Δy when scoring matches. */
  yWeight?: number;
  /** Frames a seat may miss before landmarks clear. */
  maxMissed?: number;
  minFrames?: number;
};

function dist(
  a: { x: number; y: number },
  b: { x: number; y: number },
  yWeight: number,
): number {
  return Math.hypot(a.x - b.x, (a.y - b.y) * yWeight);
}

export function createSeatAnchors(
  slots: readonly NumberingSlot[],
  options: Pick<SeatMatchOptions, "minFrames"> = {},
): SeatAnchor[] {
  const minFrames = options.minFrames ?? 4;
  return slots
    .map((s) => ({
      index: s.index,
      x: s.x,
      y: s.y,
      landmarks: null as readonly PoseLandmark[] | null,
      debouncer: new RaiseDebouncer({ minFrames }),
      missed: 0,
      fresh: false,
    }))
    .sort((a, b) => a.index - b.index);
}

function bindDetToSeat(seat: SeatAnchor, det: SeatDetection): void {
  seat.x = det.x;
  seat.y = det.y;
  seat.landmarks = det.landmarks;
  seat.missed = 0;
  seat.fresh = true;
}

/**
 * Greedy seat↔detection match by position. Seat `index` never changes.
 */
export function matchDetectionsToSeats(
  anchors: readonly SeatAnchor[],
  detections: readonly SeatDetection[],
  options: SeatMatchOptions = {},
): SeatAnchor[] {
  const maxDistance = options.maxDistance ?? 0.2;
  const yWeight = options.yWeight ?? 0.4;
  const maxMissed = options.maxMissed ?? 12;

  const next = anchors.map((a) => ({
    ...a,
    fresh: false,
    // keep debouncer instance
    debouncer: a.debouncer,
  }));

  const usedSeat = new Set<number>();
  const usedDet = new Set<number>();

  type Pair = { si: number; di: number; d: number };
  const pairs: Pair[] = [];
  for (let si = 0; si < next.length; si++) {
    if (usedSeat.has(si)) continue;
    for (let di = 0; di < detections.length; di++) {
      if (usedDet.has(di)) continue;
      pairs.push({
        si,
        di,
        d: dist(next[si]!, detections[di]!, yWeight),
      });
    }
  }
  pairs.sort((a, b) => a.d - b.d);

  for (const { si, di, d } of pairs) {
    if (usedSeat.has(si) || usedDet.has(di)) continue;
    if (d > maxDistance) continue;
    bindDetToSeat(next[si]!, detections[di]!);
    usedSeat.add(si);
    usedDet.add(di);
  }

  for (let si = 0; si < next.length; si++) {
    if (usedSeat.has(si)) continue;
    const seat = next[si]!;
    seat.missed += 1;
    seat.fresh = false;
    if (seat.missed > maxMissed) {
      seat.landmarks = null;
    }
  }

  return next;
}

/**
 * Bind Pose results to seats by locked index on the crop. Do not re-sort by torso x.
 */
export function bindPosesToSeatsByIndex(
  anchors: readonly SeatAnchor[],
  poses: readonly { index: number; x: number; y: number; landmarks: readonly PoseLandmark[] }[],
  options: Pick<SeatMatchOptions, "maxMissed"> = {},
): SeatAnchor[] {
  const maxMissed = options.maxMissed ?? 12;
  const byIndex = new Map<number, (typeof poses)[number]>();
  for (const pose of poses) {
    if (!byIndex.has(pose.index)) byIndex.set(pose.index, pose);
  }

  return anchors.map((a) => {
    const seat = {
      ...a,
      fresh: false,
      debouncer: a.debouncer,
    };
    const pose = byIndex.get(seat.index);
    if (!pose) {
      seat.missed += 1;
      if (seat.missed > maxMissed) seat.landmarks = null;
      return seat;
    }
    // Pose-assisted track: EMA-smooth MediaPipe joints; keep locked seat x/y.
    seat.landmarks = emaBlendLandmarks(seat.landmarks, pose.landmarks, 0.45);
    seat.missed = 0;
    seat.fresh = true;
    return seat;
  });
}

export function seatsToNumberingSlots(anchors: readonly SeatAnchor[]): NumberingSlot[] {
  return anchors.map((a) => ({
    index: a.index,
    // Stable synthetic id: seat index (never from MediaPipe track churn).
    trackId: a.index,
    x: a.x,
    y: a.y,
  }));
}
