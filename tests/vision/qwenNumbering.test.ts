import { describe, expect, it } from "vitest";
import {
  followLockedFaces,
  numberFacesLeftToRight,
  nudgeLockedFacesTowardHeads,
  shouldPollVisionFaces,
} from "../../src/vision/detect/qwenNumbering";
import { personBoxesFromNumberedSeats } from "../../src/vision/detect/qwenMpCascade";

describe("numberFacesLeftToRight", () => {
  it("assigns 1..N from leftmost face, ignoring input order", () => {
    const numbered = numberFacesLeftToRight([
      { cx: 0.7, cy: 0.3, xMin: 0.64, yMin: 0.2, width: 0.12, height: 0.16, score: 0.8 },
      { cx: 0.2, cy: 0.28, xMin: 0.14, yMin: 0.2, width: 0.12, height: 0.16, score: 0.9 },
      { cx: 0.45, cy: 0.3, xMin: 0.39, yMin: 0.2, width: 0.12, height: 0.16, score: 0.85 },
    ]);
    expect(numbered.map((f) => f.index)).toEqual([1, 2, 3]);
    expect(numbered.map((f) => f.cx)).toEqual([0.2, 0.45, 0.7]);
  });

  it("caps at maxPeople", () => {
    const faces = [0.1, 0.2, 0.3, 0.4, 0.5].map((cx) => ({
      cx,
      cy: 0.3,
      xMin: cx - 0.04,
      yMin: 0.2,
      width: 0.08,
      height: 0.12,
      score: 1,
    }));
    expect(numberFacesLeftToRight(faces, 3)).toHaveLength(3);
  });

  it("discards a model-provided index and re-numbers left→right", () => {
    const numbered = numberFacesLeftToRight([
      { cx: 0.8, cy: 0.3, xMin: 0.74, yMin: 0.2, width: 0.12, height: 0.16, score: 1, index: 1 },
      { cx: 0.15, cy: 0.3, xMin: 0.09, yMin: 0.2, width: 0.12, height: 0.16, score: 1, index: 2 },
    ]);
    expect(numbered[0]?.index).toBe(1);
    expect(numbered[0]?.cx).toBe(0.15);
    expect(numbered[1]?.index).toBe(2);
    expect(numbered[1]?.cx).toBe(0.8);
  });
});

function face(cx: number, index?: number, cy = 0.28) {
  return {
    cx,
    cy,
    xMin: cx - 0.05,
    yMin: cy - 0.08,
    width: 0.1,
    height: 0.16,
    score: 1,
    ...(index != null ? { index } : {}),
  };
}

describe("followLockedFaces", () => {
  it("keeps locked indices when live detections are currently right-to-left", () => {
    const locked = [
      { ...face(0.2), index: 1 },
      { ...face(0.8), index: 2 },
    ];
    const next = followLockedFaces(locked, [face(0.82), face(0.18)], { alpha: 1 });
    expect(next.map((f) => f.index)).toEqual([1, 2]);
    expect(next[0]?.cx).toBeCloseTo(0.18);
    expect(next[1]?.cx).toBeCloseTo(0.82);
  });

  it("does not re-number by current left→right order", () => {
    const locked = [
      { ...face(0.2), index: 1 },
      { ...face(0.8), index: 2 },
    ];
    const next = followLockedFaces(locked, [face(0.81), face(0.22)], { alpha: 1, maxDistance: 0.12 });
    expect(next.find((f) => f.index === 1)?.cx).toBeCloseTo(0.22);
    expect(next.find((f) => f.index === 2)?.cx).toBeCloseTo(0.81);
  });

  it("keeps the previous box when a live face is missing", () => {
    const locked = [
      { ...face(0.2), index: 1 },
      { ...face(0.8), index: 2 },
    ];
    const next = followLockedFaces(locked, [face(0.21)], { alpha: 1 });
    expect(next).toHaveLength(2);
    expect(next[0]?.cx).toBeCloseTo(0.21);
    expect(next[1]?.cx).toBeCloseTo(0.8);
    expect(next[1]?.index).toBe(2);
  });
});

describe("nudgeLockedFacesTowardHeads", () => {
  it("ignores a far head so a neighbor pose cannot steal the number", () => {
    const locked = [{ ...face(0.2), index: 1 }];
    const next = nudgeLockedFacesTowardHeads(locked, [{ index: 1, x: 0.8, y: 0.28 }], {
      maxDistance: 0.11,
      alpha: 1,
    });
    expect(next[0]?.index).toBe(1);
    expect(next[0]?.cx).toBeCloseTo(0.2);
  });

  it("eases toward a nearby nose of the same index", () => {
    const locked = [{ ...face(0.2), index: 1 }];
    const next = nudgeLockedFacesTowardHeads(locked, [{ index: 1, x: 0.24, y: 0.28 }], {
      maxDistance: 0.11,
      alpha: 1,
    });
    expect(next[0]?.cx).toBeCloseTo(0.24);
  });
});

describe("shouldPollVisionFaces", () => {
  it("polls on interval even when every seat already has a template", () => {
    const base = { nowMs: 2000, lastFaceTs: 500, minIntervalMs: 1000, inFlight: false };
    expect(shouldPollVisionFaces(base)).toBe(true);
    expect(shouldPollVisionFaces({ ...base, nowMs: 1400 })).toBe(false);
    expect(shouldPollVisionFaces({ ...base, inFlight: true })).toBe(false);
    expect(shouldPollVisionFaces({ ...base, force: true, nowMs: 501, inFlight: false })).toBe(true);
  });
});

describe("personBoxesFromNumberedSeats", () => {
  it("keeps one crop per numbered seat even if a face is missing", () => {
    const seats = [
      { index: 1, x: 0.2, y: 0.45 },
      { index: 2, x: 0.5, y: 0.45 },
      { index: 3, x: 0.8, y: 0.45 },
    ];
    const faces = new Map([
      [
        1,
        { cx: 0.2, cy: 0.28, xMin: 0.15, yMin: 0.2, width: 0.1, height: 0.16, score: 1, index: 1 },
      ],
      [
        3,
        { cx: 0.8, cy: 0.28, xMin: 0.75, yMin: 0.2, width: 0.1, height: 0.16, score: 1, index: 3 },
      ],
    ]);
    const boxes = personBoxesFromNumberedSeats(seats, faces);
    expect(boxes).toHaveLength(3);
    expect(boxes.map((b) => b.index).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 2, 3]);
    expect(boxes.every((b) => b.index != null)).toBe(true);
  });

  it("keeps Qwen index on a crop even if spatial x order differs", () => {
    const seats = [
      { index: 1, x: 0.8, y: 0.45 },
      { index: 2, x: 0.2, y: 0.45 },
    ];
    const faces = new Map([
      [
        1,
        { cx: 0.8, cy: 0.28, xMin: 0.75, yMin: 0.2, width: 0.1, height: 0.16, score: 1, index: 1 },
      ],
      [
        2,
        { cx: 0.2, cy: 0.28, xMin: 0.15, yMin: 0.2, width: 0.1, height: 0.16, score: 1, index: 2 },
      ],
    ]);
    const boxes = personBoxesFromNumberedSeats(seats, faces);
    const left = boxes.reduce((a, b) => (a.xMin < b.xMin ? a : b));
    const right = boxes.reduce((a, b) => (a.xMin > b.xMin ? a : b));
    expect(left.index).toBe(2);
    expect(right.index).toBe(1);
  });
});
