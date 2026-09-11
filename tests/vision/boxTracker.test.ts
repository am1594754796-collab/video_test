import { describe, expect, it } from "vitest";
import { BoxTracker } from "../../src/vision/detect/boxTracker";
import type { PersonBox } from "../../src/vision/detect/personBox";

function box(x: number, id?: number): PersonBox {
  return { xMin: x, xMax: x + 0.1, yMin: 0.4, yMax: 0.7, score: 0.9, trackId: id };
}

describe("BoxTracker", () => {
  it("keeps the same id when a person shifts slightly", () => {
    const t = new BoxTracker({ minIou: 0.2, maxMissed: 4 });
    const a = t.update([box(0.4)]);
    expect(a).toHaveLength(1);
    const id = a[0]!.trackId;
    const b = t.update([box(0.42)]);
    expect(b[0]!.trackId).toBe(id);
  });

  it("sorts left to right without swapping ids", () => {
    const t = new BoxTracker({ minIou: 0.2 });
    const first = t.update([box(0.6), box(0.2)]);
    expect(first.map((b) => b.xMin)).toEqual([0.2, 0.6]);
    const leftId = first[0]!.trackId;
    const rightId = first[1]!.trackId;
    const next = t.update([box(0.61), box(0.21)]);
    expect(next[0]!.trackId).toBe(leftId);
    expect(next[1]!.trackId).toBe(rightId);
  });

  it("holds a track for a brief dropout", () => {
    const t = new BoxTracker({ minIou: 0.2, maxMissed: 2 });
    const first = t.update([box(0.4)]);
    const held = t.update([]);
    expect(held).toHaveLength(1);
    expect(held[0]!.trackId).toBe(first[0]!.trackId);
    expect(held[0]!.fresh).toBe(false);
  });
});
