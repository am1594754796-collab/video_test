import { describe, expect, it } from "vitest";
import {
  createScoutHoldState,
  stabilizeScoutPoses,
} from "../../src/vision/detect/scoutHold";

describe("stabilizeScoutPoses", () => {
  it("refreshes hold when live count is enough", () => {
    let hold = createScoutHoldState<number>();
    const a = stabilizeScoutPoses([1, 2, 3], hold, 1000, { minCount: 3, holdMs: 300 });
    expect(a.poses).toEqual([1, 2, 3]);
    hold = a.hold;
    const b = stabilizeScoutPoses([1, 2, 3, 4], hold, 1100, { minCount: 3, holdMs: 300 });
    expect(b.poses).toEqual([1, 2, 3, 4]);
  });

  it("reuses last good scout during a brief under-count", () => {
    let hold = createScoutHoldState<{ id: number }>();
    const good = [{ id: 1 }, { id: 2 }];
    const filled = stabilizeScoutPoses(good, hold, 1000, { minCount: 2, holdMs: 350 });
    hold = filled.hold;
    const dip = stabilizeScoutPoses([{ id: 1 }], hold, 1200, { minCount: 2, holdMs: 350 });
    expect(dip.poses).toEqual(good);
  });

  it("drops hold after holdMs expires", () => {
    let hold = createScoutHoldState<number>();
    const filled = stabilizeScoutPoses([1, 2], hold, 1000, { minCount: 2, holdMs: 200 });
    hold = filled.hold;
    const expired = stabilizeScoutPoses([1], hold, 1300, { minCount: 2, holdMs: 200 });
    expect(expired.poses).toEqual([1]);
  });
});
