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

function leftRaise(): PoseLandmark[] {
  const pts = armsDown();
  pts[POSE.LEFT_ELBOW] = { x: 0.3, y: 0.28, visibility: 1 };
  pts[POSE.LEFT_WRIST] = { x: 0.38, y: 0.12, visibility: 1 };
  return pts;
}

describe("evaluateHandRaise", () => {
  it("scores a clear raise above mid-shoulder", () => {
    const ev = evaluateHandRaise(leftRaise());
    expect(ev.raised).toBe(true);
    expect(ev.side).toBe("left");
    expect(ev.score).toBeGreaterThan(0.05);
  });

  it("returns zero when arms hang", () => {
    expect(evaluateHandRaise(armsDown()).raised).toBe(false);
    expect(evaluateHandRaise(armsDown()).score).toBe(0);
  });

  it("still raises when one shoulder jitters upward", () => {
    const pts = leftRaise();
    // Same-side shoulder jumps up toward the wrist (common MediaPipe noise).
    pts[POSE.LEFT_SHOULDER] = { x: 0.4, y: 0.18, visibility: 1 };
    const ev = evaluateHandRaise(pts, { margin: 0.02 });
    expect(ev.raised).toBe(true);
  });
});

describe("SeatRaiseTracker", () => {
  it("interpolates rising-edge time between frames", () => {
    const t = new SeatRaiseTracker({ minFrames: 1, scoreThreshold: 0.02 });
    expect(t.update(armsDown(), 1000).edgeAtMs).toBeUndefined();
    const up = t.update(leftRaise(), 1100);
    expect(up.rawRaised).toBe(true);
    expect(up.edgeAtMs).toBeGreaterThan(1000);
    expect(up.edgeAtMs).toBeLessThanOrEqual(1100);
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
