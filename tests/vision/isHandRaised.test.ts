import { describe, expect, it } from "vitest";
import {
  handsRaised,
  isHandRaised,
  POSE,
  type PoseLandmark,
} from "../../src/vision/detect/isHandRaised";

function blank(): PoseLandmark[] {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
}

/** Arms hanging: wrists below elbows and shoulders. */
function armsDown(): PoseLandmark[] {
  const pts = blank();
  pts[POSE.NOSE] = { x: 0.5, y: 0.22, visibility: 1 };
  pts[POSE.LEFT_SHOULDER] = { x: 0.4, y: 0.35, visibility: 1 };
  pts[POSE.RIGHT_SHOULDER] = { x: 0.6, y: 0.35, visibility: 1 };
  pts[POSE.LEFT_ELBOW] = { x: 0.38, y: 0.5, visibility: 1 };
  pts[POSE.RIGHT_ELBOW] = { x: 0.62, y: 0.5, visibility: 1 };
  pts[POSE.LEFT_WRIST] = { x: 0.36, y: 0.7, visibility: 1 };
  pts[POSE.RIGHT_WRIST] = { x: 0.64, y: 0.7, visibility: 1 };
  return pts;
}

/** Classroom raise: bent left arm, wrist above shoulder, elbow still below shoulder. */
function leftBentRaise(): PoseLandmark[] {
  const pts = armsDown();
  pts[POSE.LEFT_ELBOW] = { x: 0.28, y: 0.44, visibility: 1 };
  pts[POSE.LEFT_WRIST] = { x: 0.4, y: 0.16, visibility: 1 };
  return pts;
}

function rightBentRaise(): PoseLandmark[] {
  const pts = armsDown();
  pts[POSE.RIGHT_ELBOW] = { x: 0.72, y: 0.44, visibility: 1 };
  pts[POSE.RIGHT_WRIST] = { x: 0.6, y: 0.16, visibility: 1 };
  return pts;
}

describe("isHandRaised", () => {
  it("returns false when both arms hang down", () => {
    expect(isHandRaised(armsDown())).toBe(false);
    expect(handsRaised(armsDown())).toEqual({ left: false, right: false });
  });

  it("returns false when wrist is only above the elbow but still below the shoulder", () => {
    const pts = armsDown();
    pts[POSE.LEFT_WRIST] = { x: 0.36, y: 0.42, visibility: 1 };
    expect(isHandRaised(pts)).toBe(false);
  });

  it("detects a bent left-arm raise without marking the right arm", () => {
    const pts = leftBentRaise();
    expect(handsRaised(pts)).toEqual({ left: true, right: false });
    expect(isHandRaised(pts)).toBe(true);
  });

  it("detects a bent right-arm raise without marking the left arm", () => {
    const pts = rightBentRaise();
    expect(handsRaised(pts)).toEqual({ left: false, right: true });
    expect(isHandRaised(pts)).toBe(true);
  });

  it("returns false when the wrist is low-visibility", () => {
    const pts = leftBentRaise();
    pts[POSE.LEFT_WRIST] = { ...pts[POSE.LEFT_WRIST]!, visibility: 0.2 };
    expect(isHandRaised(pts, { minVisibility: 0.5 })).toBe(false);
  });

  it("does not count a neighbor's raised wrist glued onto this skeleton", () => {
    const self = armsDown();
    const neighbor = rightBentRaise();
    neighbor[POSE.LEFT_SHOULDER] = { x: 0.78, y: 0.35, visibility: 1 };
    neighbor[POSE.RIGHT_SHOULDER] = { x: 0.92, y: 0.35, visibility: 1 };
    neighbor[POSE.NOSE] = { x: 0.85, y: 0.22, visibility: 1 };
    neighbor[POSE.RIGHT_ELBOW] = { x: 0.9, y: 0.46, visibility: 1 };
    neighbor[POSE.RIGHT_WRIST] = { x: 0.86, y: 0.16, visibility: 1 };
    // Neighbor's raised wrist was copied onto this person's left wrist.
    self[POSE.LEFT_WRIST] = { ...neighbor[POSE.RIGHT_WRIST]! };

    expect(
      isHandRaised(self, {
        otherLandmarks: [neighbor],
      }),
    ).toBe(false);
    expect(handsRaised(self, { otherLandmarks: [neighbor] }).left).toBe(false);
  });

  it("still detects own raise when a neighbor is also in frame", () => {
    const self = leftBentRaise();
    const neighbor = armsDown();
    neighbor[POSE.LEFT_SHOULDER] = { x: 0.78, y: 0.35, visibility: 1 };
    neighbor[POSE.RIGHT_SHOULDER] = { x: 0.92, y: 0.35, visibility: 1 };
    neighbor[POSE.LEFT_ELBOW] = { x: 0.76, y: 0.5, visibility: 1 };
    neighbor[POSE.RIGHT_ELBOW] = { x: 0.94, y: 0.5, visibility: 1 };
    neighbor[POSE.LEFT_WRIST] = { x: 0.74, y: 0.7, visibility: 1 };
    neighbor[POSE.RIGHT_WRIST] = { x: 0.96, y: 0.7, visibility: 1 };
    neighbor[POSE.NOSE] = { x: 0.85, y: 0.22, visibility: 1 };

    expect(isHandRaised(self, { otherLandmarks: [neighbor] })).toBe(true);
    expect(handsRaised(self, { otherLandmarks: [neighbor] }).left).toBe(true);
  });
});
