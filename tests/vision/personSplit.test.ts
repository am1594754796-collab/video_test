import { describe, expect, it } from "vitest";
import { POSE, type PoseLandmark } from "../../src/vision/detect/isHandRaised";
import {
  bindPosesToLockedIndexes,
  numberPosesLeftToRight,
  personBoxFromLandmarks,
  personBoxesFromPoses,
  personBoxesFromSeats,
} from "../../src/vision/detect/personSplit";

function blank(): PoseLandmark[] {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
}

function person(cx: number, cy = 0.4): PoseLandmark[] {
  const pts = blank();
  pts[POSE.NOSE] = { x: cx, y: cy - 0.12, visibility: 1 };
  pts[POSE.LEFT_SHOULDER] = { x: cx - 0.04, y: cy, visibility: 1 };
  pts[POSE.RIGHT_SHOULDER] = { x: cx + 0.04, y: cy, visibility: 1 };
  pts[POSE.LEFT_ELBOW] = { x: cx - 0.05, y: cy + 0.1, visibility: 1 };
  pts[POSE.RIGHT_ELBOW] = { x: cx + 0.05, y: cy + 0.1, visibility: 1 };
  pts[POSE.LEFT_WRIST] = { x: cx - 0.05, y: cy + 0.2, visibility: 1 };
  pts[POSE.RIGHT_WRIST] = { x: cx + 0.05, y: cy + 0.2, visibility: 1 };
  pts[23] = { x: cx - 0.03, y: cy + 0.22, visibility: 1 };
  pts[24] = { x: cx + 0.03, y: cy + 0.22, visibility: 1 };
  return pts;
}

describe("personSplit", () => {
  it("numbers poses left to right", () => {
    const numbered = numberPosesLeftToRight(
      [{ landmarks: person(0.7) }, { landmarks: person(0.2) }, { landmarks: person(0.45) }],
      3,
    );
    expect(numbered.map((p) => p.index)).toEqual([1, 2, 3]);
    expect(numbered[0]!.x).toBeLessThan(numbered[1]!.x);
    expect(numbered[1]!.x).toBeLessThan(numbered[2]!.x);
  });

  it("isolates close neighbors at midpoints", () => {
    const a = { index: 1, x: 0.4, y: 0.4, landmarks: person(0.4) };
    const b = { index: 2, x: 0.48, y: 0.4, landmarks: person(0.48) };
    const boxes = personBoxesFromPoses([a, b]);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]!.xMax).toBeLessThanOrEqual(boxes[1]!.xMin + 0.001);
  });

  it("builds a box from landmarks with raised-hand headroom", () => {
    const box = personBoxFromLandmarks(person(0.5));
    expect(box.yMin).toBeLessThan(0.28);
    expect(box.xMax - box.xMin).toBeGreaterThan(0.05);
  });

  it("binds live poses to locked seat indexes without renumbering", () => {
    const locked = [
      { index: 1, x: 0.2, y: 0.4 },
      { index: 2, x: 0.5, y: 0.4 },
    ];
    const bound = bindPosesToLockedIndexes(locked, [
      { landmarks: person(0.52) },
      { landmarks: person(0.22) },
    ]);
    expect(bound.map((p) => p.index).sort()).toEqual([1, 2]);
    expect(bound.find((p) => p.index === 1)!.x).toBeCloseTo(0.22, 1);
  });

  it("builds seat crops that stay split for close seats", () => {
    const boxes = personBoxesFromSeats([
      { index: 1, x: 0.42, y: 0.4 },
      { index: 2, x: 0.5, y: 0.4 },
    ]);
    expect(boxes[0]!.xMax).toBeLessThanOrEqual(boxes[1]!.xMin + 0.001);
  });
});
