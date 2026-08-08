import { describe, expect, it } from "vitest";
import {
  createCountLockState,
  observePersonCount,
  unlockCountLock,
} from "../../src/vision/detect/countLock";

describe("observePersonCount", () => {
  it("does not lock until expected count is stable for minStableFrames", () => {
    let state = createCountLockState();
    for (let i = 0; i < 7; i++) {
      const r = observePersonCount(state, 6, { expectedCount: 6, minStableFrames: 8 });
      state = r.state;
      expect(r.shouldLock).toBe(false);
      expect(state.locked).toBe(false);
    }
    const locked = observePersonCount(state, 6, { expectedCount: 6, minStableFrames: 8 });
    expect(locked.shouldLock).toBe(true);
    expect(locked.state.locked).toBe(true);
  });

  it("resets streak when count leaves expected", () => {
    let state = createCountLockState();
    state = observePersonCount(state, 6, { expectedCount: 6, minStableFrames: 3 }).state;
    state = observePersonCount(state, 6, { expectedCount: 6, minStableFrames: 3 }).state;
    state = observePersonCount(state, 5, { expectedCount: 6, minStableFrames: 3 }).state;
    expect(state.streak).toBe(0);
    const again = observePersonCount(state, 6, { expectedCount: 6, minStableFrames: 3 });
    expect(again.shouldLock).toBe(false);
    expect(again.state.streak).toBe(1);
  });

  it("does not lock again after already locked", () => {
    let state = createCountLockState();
    for (let i = 0; i < 3; i++) {
      state = observePersonCount(state, 4, { expectedCount: 4, minStableFrames: 3 }).state;
    }
    expect(state.locked).toBe(true);
    const again = observePersonCount(state, 4, { expectedCount: 4, minStableFrames: 3 });
    expect(again.shouldLock).toBe(false);
  });

  it("unlock clears lock so a new sort can run", () => {
    let state = createCountLockState();
    for (let i = 0; i < 2; i++) {
      state = observePersonCount(state, 2, { expectedCount: 2, minStableFrames: 2 }).state;
    }
    expect(state.locked).toBe(true);
    state = unlockCountLock(state);
    expect(state.locked).toBe(false);
    const r = observePersonCount(state, 2, { expectedCount: 2, minStableFrames: 2 });
    expect(r.shouldLock).toBe(false);
    expect(r.state.streak).toBe(1);
  });
});
