import { describe, expect, it } from "vitest";
import {
  indexByTrackIdFromSlots,
  rebindSlotsToTracks,
  slotsFromSort,
} from "../../src/vision/detect/numberingSlots";

describe("numberingSlots", () => {
  it("builds slots from a sort result", () => {
    const slots = slotsFromSort([
      { index: 1, id: 10, x: 0.2, y: 0.4 },
      { index: 2, id: 20, x: 0.7, y: 0.4 },
    ]);
    expect(slots).toEqual([
      { index: 1, trackId: 10, x: 0.2, y: 0.4, faceDescriptor: null },
      { index: 2, trackId: 20, x: 0.7, y: 0.4, faceDescriptor: null },
    ]);
  });

  it("keeps the same index when trackId changes but position is near the slot", () => {
    const slots = slotsFromSort([
      { index: 1, id: 10, x: 0.25, y: 0.4 },
      { index: 2, id: 20, x: 0.75, y: 0.4 },
    ]);
    // Person #1 dropped out and came back as trackId 99 near old seat.
    const next = rebindSlotsToTracks(
      slots,
      [
        { trackId: 99, x: 0.27, y: 0.41 },
        { trackId: 20, x: 0.76, y: 0.4 },
      ],
      { maxDistance: 0.35 },
    );
    expect(next.find((s) => s.index === 1)?.trackId).toBe(99);
    expect(next.find((s) => s.index === 2)?.trackId).toBe(20);
    expect(indexByTrackIdFromSlots(next).get(99)).toBe(1);
  });

  it("does not steal a far-away track for an orphaned slot", () => {
    const slots = slotsFromSort([{ index: 1, id: 10, x: 0.1, y: 0.4 }]);
    const next = rebindSlotsToTracks(
      [{ ...slots[0], trackId: null }],
      [{ trackId: 50, x: 0.9, y: 0.4 }],
      { maxDistance: 0.25 },
    );
    expect(next[0].trackId).toBeNull();
  });

  it("prefers keeping an existing live trackId over a nearer stranger", () => {
    const slots = slotsFromSort([
      { index: 1, id: 10, x: 0.3, y: 0.4 },
      { index: 2, id: 20, x: 0.7, y: 0.4 },
    ]);
    const next = rebindSlotsToTracks(slots, [
      { trackId: 10, x: 0.45, y: 0.4 },
      { trackId: 20, x: 0.7, y: 0.4 },
      { trackId: 30, x: 0.32, y: 0.4 },
    ]);
    expect(next.find((s) => s.index === 1)?.trackId).toBe(10);
  });

  it("rebinds orphaned slot by face even when position is far", () => {
    const faceA = Array.from({ length: 8 }, (_, i) => (i === 0 ? 1 : 0));
    const faceB = Array.from({ length: 8 }, (_, i) => (i === 1 ? 1 : 0));
    const slots = [
      {
        index: 1,
        trackId: null as number | null,
        x: 0.2,
        y: 0.4,
        faceDescriptor: faceA,
      },
      {
        index: 2,
        trackId: 20 as number | null,
        x: 0.8,
        y: 0.4,
        faceDescriptor: faceB,
      },
    ];
    // New track for person 1 appears on the right (far from seat x=0.2) but face matches A.
    const next = rebindSlotsToTracks(
      slots,
      [
        { trackId: 99, x: 0.85, y: 0.4, faceDescriptor: faceA },
        { trackId: 20, x: 0.8, y: 0.4, faceDescriptor: faceB },
      ],
      { maxDistance: 0.2, minFaceSimilarity: 0.9 },
    );
    expect(next.find((s) => s.index === 1)?.trackId).toBe(99);
    expect(next.find((s) => s.index === 2)?.trackId).toBe(20);
  });
});
