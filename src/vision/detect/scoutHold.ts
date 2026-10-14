/**
 * Short-term hold for multi-person scout poses during numbering.
 * Harsh light often drops one person for a frame or two; keep the last good set.
 */

export type ScoutHoldState<T> = {
  poses: T[];
  atMs: number;
};

export function createScoutHoldState<T>(): ScoutHoldState<T> {
  return { poses: [], atMs: 0 };
}

export type StabilizeScoutOptions = {
  /** Prefer holding when live count is below this. */
  minCount: number;
  /** How long to reuse the last good scout (ms). */
  holdMs?: number;
};

/**
 * If live scout is full enough, refresh hold.
 * If live under-counts but hold is fresh, return held poses.
 */
export function stabilizeScoutPoses<T>(
  live: readonly T[],
  hold: ScoutHoldState<T>,
  nowMs: number,
  options: StabilizeScoutOptions,
): { poses: T[]; hold: ScoutHoldState<T> } {
  const holdMs = options.holdMs ?? 350;
  const minCount = Math.max(1, options.minCount);

  if (live.length >= minCount) {
    const next: ScoutHoldState<T> = { poses: [...live], atMs: nowMs };
    return { poses: next.poses, hold: next };
  }

  if (hold.poses.length >= minCount && nowMs - hold.atMs <= holdMs) {
    return { poses: hold.poses, hold };
  }

  return { poses: [...live], hold };
}
