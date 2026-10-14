/**
 * Gate: wait until on-screen person count meets requirement and stays stable,
 * then signal that a one-shot left→right sort/lock should run.
 */

export type CountLockOptions = {
  /** Required on-screen count before locking (e.g. 6). */
  expectedCount: number;
  /** Consecutive frames at expectedCount required before lock. */
  minStableFrames?: number;
  /**
   * Tolerate this many consecutive off-count frames without resetting streak.
   * Helps when harsh light briefly drops a detection (5→6→5 flicker).
   */
  maxGapFrames?: number;
};

export type CountLockSnapshot = {
  locked: boolean;
  streak: number;
  lastCount: number;
  /** Consecutive frames where count ≠ expected while streak > 0. */
  gapFrames: number;
};

export function createCountLockState(): CountLockSnapshot {
  return { locked: false, streak: 0, lastCount: -1, gapFrames: 0 };
}

/**
 * Feed one frame's detected person count.
 * Returns whether this frame should trigger the one-shot sort + lock.
 */
export function observePersonCount(
  state: CountLockSnapshot,
  count: number,
  options: CountLockOptions,
): { state: CountLockSnapshot; shouldLock: boolean } {
  if (state.locked) {
    return { state, shouldLock: false };
  }

  const minStable = Math.max(1, options.minStableFrames ?? 8);
  const maxGap = Math.max(0, options.maxGapFrames ?? 0);
  const expected = options.expectedCount;

  if (count !== expected) {
    if (state.streak === 0 || maxGap === 0) {
      return {
        state: { locked: false, streak: 0, lastCount: count, gapFrames: 0 },
        shouldLock: false,
      };
    }
    const gapFrames = state.gapFrames + 1;
    if (gapFrames > maxGap) {
      return {
        state: { locked: false, streak: 0, lastCount: count, gapFrames: 0 },
        shouldLock: false,
      };
    }
    // Keep progress; treat as still aiming at expected.
    return {
      state: {
        locked: false,
        streak: state.streak,
        lastCount: expected,
        gapFrames,
      },
      shouldLock: false,
    };
  }

  const streak = state.lastCount === expected ? state.streak + 1 : 1;
  if (streak >= minStable) {
    return {
      state: { locked: true, streak, lastCount: count, gapFrames: 0 },
      shouldLock: true,
    };
  }

  return {
    state: { locked: false, streak, lastCount: count, gapFrames: 0 },
    shouldLock: false,
  };
}

export function unlockCountLock(_state?: CountLockSnapshot): CountLockSnapshot {
  return { locked: false, streak: 0, lastCount: -1, gapFrames: 0 };
}
