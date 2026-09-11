/**
 * Row / classroom seating helpers.
 * Goal: merge multi-band phantoms without swallowing real neighbors in a tight row.
 */

import { dedupePosesByTorso, torsoCenter, type PoseLike } from "./dedupePoses";

export type RowSelectOptions = {
  /** Target seat count (e.g. 6). */
  expectedCount: number;
  /** Merge near-identical double detections (multi-band overlap). */
  duplicateDistance?: number;
  /** Never merge when horizontal gap is at least this (legacy dedupe). */
  minSeparationX?: number;
  /**
   * Minimum normalized Δx between kept people.
   * Must stay below typical real seat spacing (~0.04–0.08 for 6 at a table).
   */
  minSeatGap?: number;
};

function meanVisibility(landmarks: readonly { visibility?: number }[]): number {
  const keys = [11, 12, 15, 16];
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

/**
 * Drop near-identical double-detections from overlapping crops.
 */
export function dedupeRowPoses<T extends PoseLike>(
  poses: readonly T[],
  options: Pick<RowSelectOptions, "duplicateDistance" | "minSeparationX"> = {},
): T[] {
  return dedupePosesByTorso(poses, {
    minDistance: options.duplicateDistance ?? 0.032,
    minSeparationX: options.minSeparationX ?? 0.035,
    yWeight: 0.35,
  });
}

/**
 * Left→right collapse: if two torsos are closer than `minGap`, keep the clearer one.
 */
export function collapseByMinGapX<T extends PoseLike>(
  poses: readonly T[],
  minGap: number,
): T[] {
  if (poses.length <= 1) return [...poses];
  const ranked = [...poses].sort(
    (a, b) => torsoCenter(a.landmarks).x - torsoCenter(b.landmarks).x,
  );
  const kept: T[] = [];
  for (const pose of ranked) {
    const x = torsoCenter(pose.landmarks).x;
    if (kept.length === 0) {
      kept.push(pose);
      continue;
    }
    const last = kept[kept.length - 1];
    const lx = torsoCenter(last.landmarks).x;
    if (x - lx >= minGap) {
      kept.push(pose);
      continue;
    }
    if (meanVisibility(pose.landmarks) > meanVisibility(last.landmarks)) {
      kept[kept.length - 1] = pose;
    }
  }
  return kept;
}

function pickTopSpread<T extends PoseLike>(poses: readonly T[], expected: number, minGap: number): T[] {
  const byVis = [...poses].sort(
    (a, b) => meanVisibility(b.landmarks) - meanVisibility(a.landmarks),
  );
  const chosen: T[] = [];
  for (const pose of byVis) {
    if (chosen.length >= expected) break;
    const x = torsoCenter(pose.landmarks).x;
    const conflict = chosen.some(
      (c) => Math.abs(torsoCenter(c.landmarks).x - x) < minGap,
    );
    if (!conflict) chosen.push(pose);
  }
  return chosen.sort(
    (a, b) => torsoCenter(a.landmarks).x - torsoCenter(b.landmarks).x,
  );
}

/**
 * Select at most `expectedCount` people for a seated row.
 * Uses a tight gap first (kill phantoms); if under-count, retries with a softer gap
 * so real shoulder-to-shoulder neighbors are kept.
 */
export function selectPosesBySeatBins<T extends PoseLike>(
  poses: readonly T[],
  options: RowSelectOptions,
): T[] {
  const expected = Math.max(1, Math.min(8, Math.floor(options.expectedCount)));
  // Tight enough for phantoms (~0.02–0.03), soft enough for real neighbors (~0.04+).
  const tightGap =
    options.minSeatGap ?? Math.min(0.038, Math.max(0.032, 0.32 / expected));
  const softGap = Math.max(0.028, tightGap * 0.78);

  const deduped = dedupeRowPoses(poses, options);
  if (deduped.length === 0) return [];

  let cleaned = collapseByMinGapX(deduped, tightGap);
  if (cleaned.length < expected && cleaned.length < deduped.length) {
    cleaned = collapseByMinGapX(deduped, softGap);
  }

  if (cleaned.length <= expected) return cleaned;
  return pickTopSpread(cleaned, expected, softGap);
}
