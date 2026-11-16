import { describe, expect, it } from "vitest";
import { RaiseRaceRound } from "../../src/round/raiseRaceRound";

describe("RaiseRaceRound", () => {
  it("compares confirmed edges arriving in nearby frames before locking", () => {
    const r = new RaiseRaceRound({ openGraceMs: 0, settleMs: 80 });
    r.beginOpenNow(1000);
    expect(r.feed([{ personIndex: 2, raised: true, edgeAtMs: 1030 }], 1050)).toEqual([]);
    expect(r.feed([
      { personIndex: 2, raised: true },
      { personIndex: 1, raised: true, edgeAtMs: 1020 },
    ], 1080)).toEqual([]);
    expect(r.feed([], 1110)).toEqual([{ type: "winner", personIndex: 1, atMs: 1020 }]);
  });

  it("COUNTDOWN: first raise per person is early-raise once", () => {
    const r = new RaiseRaceRound();
    r.beginCountdown(1000);
    expect(r.phase).toBe("countdown");

    const first = r.feed([{ personIndex: 2, raised: false }], 1010);
    expect(first).toEqual([]);

    const early = r.feed([{ personIndex: 2, raised: true, edgeAtMs: 1100 }], 1100);
    expect(early).toEqual([{ type: "early-raise", personIndex: 2, atMs: 1100 }]);
    expect(r.phase).toBe("countdown");

    const again = r.feed([{ personIndex: 2, raised: true }], 1200);
    expect(again).toEqual([]);

    const down = r.feed([{ personIndex: 2, raised: false }], 1300);
    expect(down).toEqual([]);
    const secondWave = r.feed([{ personIndex: 2, raised: true, edgeAtMs: 1400 }], 1400);
    expect(secondWave).toEqual([]);
  });

  it("COUNTDOWN: already raised on first armed frame counts as early", () => {
    const r = new RaiseRaceRound();
    r.beginCountdown(1000);
    const early = r.feed([{ personIndex: 2, raised: true, edgeAtMs: 1000 }], 1000);
    expect(early).toEqual([{ type: "early-raise", personIndex: 2, atMs: 1000 }]);
  });

  it("COUNTDOWN: multiple people each get one early-raise", () => {
    const r = new RaiseRaceRound();
    r.beginCountdown(1000);
    r.feed(
      [
        { personIndex: 1, raised: false },
        { personIndex: 3, raised: false },
      ],
      1000,
    );
    const events = r.feed(
      [
        { personIndex: 1, raised: true, edgeAtMs: 1050 },
        { personIndex: 3, raised: true, edgeAtMs: 1060 },
      ],
      1060,
    );
    expect(events).toEqual([
      { type: "early-raise", personIndex: 1, atMs: 1050 },
      { type: "early-raise", personIndex: 3, atMs: 1060 },
    ]);
  });

  it("OPEN after countdown+delay: first valid raise wins; duplicate open keeps stamp", () => {
    const r = new RaiseRaceRound({ openGraceMs: 0 });
    r.beginCountdown(1000);
    r.feed([{ personIndex: 1, raised: false }], 1000);
    r.openWindow(2800); // after countdown hold
    expect(r.phase).toBe("open");
    expect(r.openTimestampMs).toBe(2800);
    r.openWindow(3000); // duplicate — must not move stamp later
    expect(r.openTimestampMs).toBe(2800);

    const win = r.feed([{ personIndex: 1, raised: true, edgeAtMs: 2850 }], 2850);
    expect(win).toEqual([{ type: "winner", personIndex: 1, atMs: 2850 }]);
    expect(r.phase).toBe("locked");
    expect(r.winner).toEqual({ personIndex: 1, raisedAtMs: 2850 });
  });

  it("capture before effective open counts as early even after openWindow", () => {
    const r = new RaiseRaceRound({ openGraceMs: 80 });
    r.beginCountdown(1000);
    r.feed([{ personIndex: 4, raised: false }], 1000);
    r.openWindow(2000);
    // edge at 2000 is still inside grace → early
    const early = r.feed([{ personIndex: 4, raised: true, edgeAtMs: 2000 }], 2020);
    expect(early).toEqual([{ type: "early-raise", personIndex: 4, atMs: 2000 }]);
    expect(r.phase).toBe("open");

    r.feed([{ personIndex: 4, raised: false }], 2100);
    const win = r.feed([{ personIndex: 5, raised: true, edgeAtMs: 2090 }], 2090);
    expect(win).toEqual([{ type: "winner", personIndex: 5, atMs: 2090 }]);
  });

  it("early raiser cannot win by putting hand down and raising again after open", () => {
    const r = new RaiseRaceRound({ openGraceMs: 0 });
    r.beginCountdown(1000);
    r.feed([{ personIndex: 2, raised: false }], 1000);
    expect(r.feed([{ personIndex: 2, raised: true, edgeAtMs: 1100 }], 1100)).toEqual([
      { type: "early-raise", personIndex: 2, atMs: 1100 },
    ]);

    // Detector may flicker to "not raised" — must not re-arm a race edge.
    r.feed([{ personIndex: 2, raised: false }], 1500);
    r.openWindow(2000);
    expect(r.feed([{ personIndex: 2, raised: true, edgeAtMs: 2100 }], 2100)).toEqual([]);
    expect(r.phase).toBe("open");
    expect(r.winner).toBeNull();

    const win = r.feed([{ personIndex: 3, raised: true, edgeAtMs: 2200 }], 2200);
    expect(win).toEqual([{ type: "winner", personIndex: 3, atMs: 2200 }]);
  });

  it("beginOpenNow skips countdown for vision-only demo", () => {
    const r = new RaiseRaceRound({ openGraceMs: 0 });
    r.beginOpenNow(500);
    expect(r.phase).toBe("open");
    r.feed([{ personIndex: 1, raised: false }], 500);
    const win = r.feed([{ personIndex: 1, raised: true, edgeAtMs: 600 }], 600);
    expect(win).toEqual([{ type: "winner", personIndex: 1, atMs: 600 }]);
  });

  it("resetToIdle clears winner and violations", () => {
    const r = new RaiseRaceRound({ openGraceMs: 0 });
    r.beginCountdown(1);
    r.feed([{ personIndex: 1, raised: false }], 1);
    r.feed([{ personIndex: 1, raised: true, edgeAtMs: 2 }], 2);
    r.openWindow(10);
    r.feed([{ personIndex: 2, raised: false }], 10);
    r.feed([{ personIndex: 2, raised: true, edgeAtMs: 20 }], 20);
    expect(r.winner).not.toBeNull();

    r.resetToIdle();
    expect(r.phase).toBe("idle");
    expect(r.winner).toBeNull();
    expect(r.earlyViolations.size).toBe(0);
  });

  it("idle ignores raises", () => {
    const r = new RaiseRaceRound();
    expect(r.feed([{ personIndex: 1, raised: true, edgeAtMs: 1 }], 1)).toEqual([]);
  });
});
