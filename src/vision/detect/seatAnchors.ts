/**
 * After numbering lock, identity is the seat index — not MediaPipe trackId.
 * Each frame we re-associate detections to fixed seats by face (preferred) then position.
 */

import { cosineSimilarity, type FaceDescriptor } from "./faceDescriptor";
import type { PoseLandmark } from "./isHandRaised";
import { RaiseDebouncer } from "./raiseDebouncer";
import type { NumberingSlot } from "./numberingSlots";

export type SeatDetection = {
  x: number;
  y: number;
  landmarks: readonly PoseLandmark[];
  faceDescriptor?: FaceDescriptor | null;
};

export type SeatAnchor = {
  index: number;
  x: number;
  y: number;
  landmarks: readonly PoseLandmark[] | null;
  debouncer: RaiseDebouncer;
  missed: number;
  faceDescriptor: FaceDescriptor | null;
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
  /** Min cosine similarity to claim a seat by face before position. */
  minFaceSimilarity?: number;
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
      faceDescriptor: s.faceDescriptor ?? null,
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
  if (det.faceDescriptor && det.faceDescriptor.length) {
    seat.faceDescriptor = det.faceDescriptor;
  }
}

/**
 * Greedy seat↔detection match. Seat `index` never changes.
 * Face templates win over position when both sides have descriptors.
 */
export function matchDetectionsToSeats(
  anchors: readonly SeatAnchor[],
  detections: readonly SeatDetection[],
  options: SeatMatchOptions = {},
): SeatAnchor[] {
  const maxDistance = options.maxDistance ?? 0.2;
  const yWeight = options.yWeight ?? 0.4;
  const maxMissed = options.maxMissed ?? 12;
  const minFaceSimilarity = options.minFaceSimilarity ?? 0.82;

  const next = anchors.map((a) => ({
    ...a,
    fresh: false,
    // keep debouncer instance
    debouncer: a.debouncer,
  }));

  const usedSeat = new Set<number>();
  const usedDet = new Set<number>();

  type FacePair = { si: number; di: number; sim: number };
  const facePairs: FacePair[] = [];
  for (let si = 0; si < next.length; si++) {
    const template = next[si]!.faceDescriptor;
    if (!template?.length) continue;
    for (let di = 0; di < detections.length; di++) {
      const live = detections[di]!.faceDescriptor;
      if (!live?.length) continue;
      const sim = cosineSimilarity(template, live);
      if (sim >= minFaceSimilarity) facePairs.push({ si, di, sim });
    }
  }
  facePairs.sort((a, b) => b.sim - a.sim);
  for (const { si, di } of facePairs) {
    if (usedSeat.has(si) || usedDet.has(di)) continue;
    bindDetToSeat(next[si]!, detections[di]!);
    usedSeat.add(si);
    usedDet.add(di);
  }

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
 * Bind Pose results to seats by Qwen index on the crop. Do not re-sort by torso x.
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
    // Keep x/y on the locked face; pose is only for raise detection.
    seat.landmarks = pose.landmarks;
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
    faceDescriptor: a.faceDescriptor,
  }));
}
