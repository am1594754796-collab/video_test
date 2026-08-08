/**
 * Gate: wait until on-screen person count meets requirement and stays stable,
 * then signal that a one-shot left→right sort/lock should run.
 */

export type CountLockOptions = {
  /** Required on-screen count before locking (e.g. 6). */
  expectedCount: number;
  /** Consecutive frames at expectedCount required before lock. */
  minStableFrames?: number;
};

export type CountLockSnapshot = {
  locked: boolean;
  streak: number;
  lastCount: number;
};

export function createCountLockState(): CountLockSnapshot {
  return { locked: false, streak: 0, lastCount: -1 };
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
  const expected = options.expectedCount;

  if (count !== expected) {
    return {
      state: { locked: false, streak: 0, lastCount: count },
      shouldLock: false,
    };
  }

  const streak = state.lastCount === count ? state.streak + 1 : 1;
  if (streak >= minStable) {
    return {
      state: { locked: true, streak, lastCount: count },
      shouldLock: true,
    };
  }

  return {
    state: { locked: false, streak, lastCount: count },
    shouldLock: false,
  };
}

export function unlockCountLock(_state?: CountLockSnapshot): CountLockSnapshot {
  return { locked: false, streak: 0, lastCount: -1 };
}
