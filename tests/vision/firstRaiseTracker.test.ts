import { describe, expect, it } from "vitest";
import { FirstRaiseTracker } from "../../src/vision/detect/firstRaiseTracker";

describe("FirstRaiseTracker", () => {
  it("awards the first person who rises after priming", () => {
    const t = new FirstRaiseTracker();
    expect(t.update([{ personIndex: 1, raised: false }], 1000)).toBeNull();
    expect(t.update([{ personIndex: 1, raised: true }], 1100)).toEqual({
      personIndex: 1,
      raisedAtMs: 1100,
    });
  });

  it("does not let a later raise steal the winner", () => {
    const t = new FirstRaiseTracker();
    t.update(
      [
        { personIndex: 1, raised: false },
        { personIndex: 2, raised: false },
      ],
      1000,
    );
    t.update(
      [
        { personIndex: 1, raised: true },
        { personIndex: 2, raised: false },
      ],
      1100,
    );
    const again = t.update(
      [
        { personIndex: 1, raised: true },
        { personIndex: 2, raised: true },
      ],
      1200,
    );
    expect(again?.personIndex).toBe(1);
    expect(t.winner?.personIndex).toBe(1);
  });

  it("same-frame equal times: does not prefer lower personIndex", () => {
    const t = new FirstRaiseTracker();
    t.update(
      [
        { personIndex: 3, raised: false },
        { personIndex: 2, raised: false },
      ],
      1000,
    );
    const win = t.update(
      [
        { personIndex: 3, raised: true, score: 0, edgeAtMs: 1100 },
        { personIndex: 2, raised: true, score: 0, edgeAtMs: 1100 },
      ],
      1100,
    );
    // No min-index rule: stable order keeps the earlier candidate (#3).
    expect(win?.personIndex).toBe(3);
  });

  it("same-frame rising edges: earlier edgeAtMs wins", () => {
    const t = new FirstRaiseTracker();
    t.update(
      [
        { personIndex: 2, raised: false },
        { personIndex: 5, raised: false },
      ],
      1000,
    );
    const win = t.update(
      [
        { personIndex: 2, raised: true, score: 0.1, edgeAtMs: 1080 },
        { personIndex: 5, raised: true, score: 0.05, edgeAtMs: 1040 },
      ],
      1100,
    );
    expect(win?.personIndex).toBe(5);
    expect(win?.raisedAtMs).toBe(1040);
  });

  it("same-frame rising edges: higher score wins when edge times match", () => {
    const t = new FirstRaiseTracker();
    t.update(
      [
        { personIndex: 1, raised: false },
        { personIndex: 4, raised: false },
      ],
      1000,
    );
    const win = t.update(
      [
        { personIndex: 1, raised: true, score: 0.04, edgeAtMs: 1100 },
        { personIndex: 4, raised: true, score: 0.12, edgeAtMs: 1100 },
      ],
      1100,
    );
    expect(win?.personIndex).toBe(4);
  });

  it("armed=false does not produce a winner", () => {
    const t = new FirstRaiseTracker();
    t.setArmed(false);
    t.update([{ personIndex: 1, raised: false }], 1000);
    expect(t.update([{ personIndex: 1, raised: true }], 1100)).toBeNull();
    expect(t.winner).toBeNull();
  });

  it("reset clears winner and requires a new rising edge", () => {
    const t = new FirstRaiseTracker();
    t.update([{ personIndex: 2, raised: false }], 1000);
    t.update([{ personIndex: 2, raised: true }], 1100);
    expect(t.winner?.personIndex).toBe(2);

    t.reset();
    expect(t.winner).toBeNull();

    // Still holding raised after reset: prime only, no award yet.
    expect(t.update([{ personIndex: 2, raised: true }], 1200)).toBeNull();
    expect(t.winner).toBeNull();

    // Must go down then up again.
    t.update([{ personIndex: 2, raised: false }], 1300);
    expect(t.update([{ personIndex: 2, raised: true }], 1400)?.personIndex).toBe(2);
  });
});
