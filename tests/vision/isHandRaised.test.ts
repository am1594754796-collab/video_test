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

  it("classroom mode detects temple raise and rejects lateral lean", () => {
    const temple = armsDown();
    temple[POSE.RIGHT_ELBOW] = { x: 0.68, y: 0.3, visibility: 1 };
    temple[POSE.RIGHT_WRIST] = { x: 0.56, y: 0.18, visibility: 1 };
    expect(isHandRaised(temple, { classroom: true, margin: 0.02 })).toBe(true);

    const lean = armsDown();
    lean[POSE.LEFT_SHOULDER] = { x: 0.4, y: 0.4, visibility: 1 };
    lean[POSE.RIGHT_SHOULDER] = { x: 0.62, y: 0.3, visibility: 1 };
    lean[POSE.RIGHT_ELBOW] = { x: 0.78, y: 0.34, visibility: 1 };
    lean[POSE.RIGHT_WRIST] = { x: 0.82, y: 0.28, visibility: 1 };
    expect(isHandRaised(lean, { classroom: true, margin: 0.02 })).toBe(false);
  });

  it("rejects large torso tilt when the wrist is only beside the raised shoulder", () => {
    // #5-style: heavy lean lifts one shoulder; wrist stays near that shoulder / chair.
    const tilt = armsDown();
    tilt[POSE.NOSE] = { x: 0.52, y: 0.2, visibility: 1 };
    tilt[POSE.LEFT_SHOULDER] = { x: 0.38, y: 0.42, visibility: 1 };
    tilt[POSE.RIGHT_SHOULDER] = { x: 0.64, y: 0.26, visibility: 1 }; // tilt ≈ 0.16
    tilt[POSE.RIGHT_ELBOW] = { x: 0.74, y: 0.3, visibility: 1 };
    tilt[POSE.RIGHT_WRIST] = { x: 0.72, y: 0.24, visibility: 1 }; // near raised shoulder, not head
    expect(isHandRaised(tilt, { classroom: true, margin: 0.02 })).toBe(false);
  });

  it("rejects chair-lean where elbow is high but the hand hangs down", () => {
    // Real #5 false positive: elbow on chair back, wrist below elbow toward seat.
    const chair = armsDown();
    chair[POSE.NOSE] = { x: 0.55, y: 0.22, visibility: 1 };
    chair[POSE.LEFT_SHOULDER] = { x: 0.48, y: 0.4, visibility: 1 };
    chair[POSE.RIGHT_SHOULDER] = { x: 0.68, y: 0.28, visibility: 1 };
    chair[POSE.LEFT_ELBOW] = { x: 0.78, y: 0.32, visibility: 1 };
    chair[POSE.LEFT_WRIST] = { x: 0.8, y: 0.48, visibility: 1 };
    expect(isHandRaised(chair, { classroom: true, margin: 0.02 })).toBe(false);
  });
});
