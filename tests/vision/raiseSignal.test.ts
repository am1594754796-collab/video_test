import { describe, expect, it } from "vitest";
import { POSE, type PoseLandmark } from "../../src/vision/detect/isHandRaised";
import {
  evaluateHandRaise,
  SeatRaiseTracker,
} from "../../src/vision/detect/raiseSignal";
import { emaBlendLandmarks } from "../../src/vision/detect/landmarkSmooth";

function blank(): PoseLandmark[] {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
}

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

function leftClearRaise(): PoseLandmark[] {
  const pts = armsDown();
  pts[POSE.LEFT_ELBOW] = { x: 0.4, y: 0.22, visibility: 1 };
  pts[POSE.LEFT_WRIST] = { x: 0.4, y: 0.08, visibility: 1 };
  return pts;
}

function rightTempleRaise(): PoseLandmark[] {
  const pts = armsDown();
  pts[POSE.RIGHT_ELBOW] = { x: 0.68, y: 0.3, visibility: 1 };
  pts[POSE.RIGHT_WRIST] = { x: 0.56, y: 0.18, visibility: 1 };
  return pts;
}

function rightShoulderLeanNotRaise(): PoseLandmark[] {
  const pts = armsDown();
  pts[POSE.LEFT_SHOULDER] = { x: 0.38, y: 0.42, visibility: 1 };
  pts[POSE.RIGHT_SHOULDER] = { x: 0.64, y: 0.26, visibility: 1 };
  pts[POSE.NOSE] = { x: 0.52, y: 0.2, visibility: 1 };
  pts[POSE.RIGHT_ELBOW] = { x: 0.74, y: 0.3, visibility: 1 };
  pts[POSE.RIGHT_WRIST] = { x: 0.72, y: 0.24, visibility: 1 };
  return pts;
}

describe("evaluateHandRaise (MediaPipe joints)", () => {
  it("raises on a clear high wrist via Pose landmarks", () => {
    const ev = evaluateHandRaise(leftClearRaise(), { margin: 0.02 });
    expect(ev.raised).toBe(true);
    expect(ev.side).toBe("left");
    expect(ev.score).toBeGreaterThan(0.05);
  });

  it("raises on temple / hand-to-head Pose joints", () => {
    const ev = evaluateHandRaise(rightTempleRaise(), { margin: 0.02 });
    expect(ev.raised).toBe(true);
    expect(ev.side).toBe("right");
  });

  it("rejects tilted-shoulder lateral arm", () => {
    expect(evaluateHandRaise(rightShoulderLeanNotRaise(), { margin: 0.02 }).raised).toBe(false);
  });

  it("returns zero when arms hang", () => {
    expect(evaluateHandRaise(armsDown()).raised).toBe(false);
  });
});

describe("SeatRaiseTracker", () => {
  it("requires N consecutive MediaPipe frames before confirming raise", () => {
    const t = new SeatRaiseTracker({ minFrames: 3, scoreThreshold: 0, smoothAlpha: 0 });
    expect(t.update(leftClearRaise(), 1000).raised).toBe(false);
    expect(t.update(leftClearRaise(), 1050).raised).toBe(false);
    const c = t.update(leftClearRaise(), 1100);
    expect(c.raised).toBe(true);
    expect(c.edgeAtMs).toBeDefined();
  });

  it("confirms on the first qualifying frame when minFrames is 1", () => {
    const t = new SeatRaiseTracker({ minFrames: 1, scoreThreshold: 0, smoothAlpha: 0 });
    const u = t.update(leftClearRaise(), 2000);
    expect(u.raised).toBe(true);
    expect(u.rawRaised).toBe(true);
    expect(u.edgeAtMs).toBe(2000);
  });
});

describe("emaBlendLandmarks", () => {
  it("pulls noisy shoulders toward the previous frame", () => {
    const a = armsDown();
    const b = armsDown();
    b[POSE.LEFT_SHOULDER] = { x: 0.4, y: 0.5, visibility: 1 };
    const blended = emaBlendLandmarks(a, b, 0.5);
    expect(blended[POSE.LEFT_SHOULDER]!.y).toBeCloseTo(0.425, 3);
  });
});
