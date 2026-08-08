import { describe, expect, it } from "vitest";
import {
  POSE,
  isHandRaised,
  type PoseLandmark,
} from "../../src/vision/detect/isHandRaised";

function lm(x: number, y: number, visibility = 1): PoseLandmark {
  return { x, y, z: 0, visibility };
}

/** Standing pose: shoulders mid, wrists low (not raised). */
function armsDown(): PoseLandmark[] {
  const pts: PoseLandmark[] = Array.from({ length: 33 }, () => lm(0.5, 0.5, 0));
  pts[POSE.LEFT_SHOULDER] = lm(0.4, 0.4);
  pts[POSE.RIGHT_SHOULDER] = lm(0.6, 0.4);
  pts[POSE.LEFT_WRIST] = lm(0.35, 0.7);
  pts[POSE.RIGHT_WRIST] = lm(0.65, 0.7);
  return pts;
}

describe("isHandRaised", () => {
  it("returns false when both wrists are below shoulders", () => {
    expect(isHandRaised(armsDown())).toBe(false);
  });

  it("returns true when left wrist is clearly above left shoulder", () => {
    const pts = armsDown();
    pts[POSE.LEFT_WRIST] = lm(0.4, 0.2); // smaller y = higher
    expect(isHandRaised(pts, { margin: 0.08 })).toBe(true);
  });

  it("returns true when right wrist is clearly above right shoulder", () => {
    const pts = armsDown();
    pts[POSE.RIGHT_WRIST] = lm(0.6, 0.2);
    expect(isHandRaised(pts, { margin: 0.08 })).toBe(true);
  });

  it("returns false at the margin boundary (not strictly above)", () => {
    const pts = armsDown();
    // wrist.y = shoulder.y - margin → not strictly less
    pts[POSE.LEFT_WRIST] = lm(0.4, 0.4 - 0.08);
    expect(isHandRaised(pts, { margin: 0.08 })).toBe(false);
  });

  it("returns false when landmarks are missing or low visibility", () => {
    const pts = armsDown();
    pts[POSE.LEFT_WRIST] = lm(0.4, 0.1, 0.1);
    pts[POSE.RIGHT_WRIST] = lm(0.6, 0.1, 0.1);
    expect(isHandRaised(pts, { margin: 0.08, minVisibility: 0.5 })).toBe(false);
  });
});
