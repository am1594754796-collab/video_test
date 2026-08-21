import { describe, expect, it } from "vitest";
import {
  isHandRaised,
  POSE,
  type PoseLandmark,
} from "../../src/vision/detect/isHandRaised";

function blank(): PoseLandmark[] {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
}

/** Arms hanging: wrists below elbows. */
function armsDown(): PoseLandmark[] {
  const pts = blank();
  pts[POSE.LEFT_SHOULDER] = { x: 0.4, y: 0.35, visibility: 1 };
  pts[POSE.RIGHT_SHOULDER] = { x: 0.6, y: 0.35, visibility: 1 };
  pts[POSE.LEFT_ELBOW] = { x: 0.38, y: 0.5, visibility: 1 };
  pts[POSE.RIGHT_ELBOW] = { x: 0.62, y: 0.5, visibility: 1 };
  pts[POSE.LEFT_WRIST] = { x: 0.36, y: 0.7, visibility: 1 };
  pts[POSE.RIGHT_WRIST] = { x: 0.64, y: 0.7, visibility: 1 };
  return pts;
}

describe("isHandRaised", () => {
  it("returns false when both wrists are below elbows", () => {
    expect(isHandRaised(armsDown())).toBe(false);
  });

  it("returns true when left wrist is clearly above left elbow (even below shoulder)", () => {
    const pts = armsDown();
    // Wrist above elbow but still below shoulder (shoulder y=0.35, elbow=0.5, wrist=0.42)
    pts[POSE.LEFT_WRIST] = { x: 0.36, y: 0.42, visibility: 1 };
    expect(isHandRaised(pts, { margin: 0.05 })).toBe(true);
  });

  it("returns true when right wrist is clearly above right elbow", () => {
    const pts = armsDown();
    pts[POSE.RIGHT_WRIST] = { x: 0.64, y: 0.4, visibility: 1 };
    expect(isHandRaised(pts, { margin: 0.05 })).toBe(true);
  });

  it("returns false at the margin boundary (not strictly above)", () => {
    const pts = armsDown();
    // wrist.y = elbow.y - margin → not strictly less
    pts[POSE.LEFT_WRIST] = { x: 0.36, y: 0.45, visibility: 1 }; // elbow 0.5, margin 0.05
    expect(isHandRaised(pts, { margin: 0.05 })).toBe(false);
  });

  it("returns false when wrist is low-visibility", () => {
    const pts = armsDown();
    pts[POSE.LEFT_WRIST] = { x: 0.36, y: 0.35, visibility: 0.2 };
    pts[POSE.RIGHT_WRIST] = { x: 0.64, y: 0.7, visibility: 1 };
    expect(isHandRaised(pts, { margin: 0.05, minVisibility: 0.5 })).toBe(false);
  });
});
