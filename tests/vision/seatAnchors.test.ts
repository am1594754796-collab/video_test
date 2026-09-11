import { describe, expect, it } from "vitest";
import {
  createSeatAnchors,
  matchDetectionsToSeats,
} from "../../src/vision/detect/seatAnchors";
import { POSE, type PoseLandmark } from "../../src/vision/detect/isHandRaised";

function lm(cx: number): PoseLandmark[] {
  const pts: PoseLandmark[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 1,
  }));
  pts[POSE.LEFT_SHOULDER] = { x: cx - 0.04, y: 0.4, visibility: 1 };
  pts[POSE.RIGHT_SHOULDER] = { x: cx + 0.04, y: 0.4, visibility: 1 };
  return pts;
}

describe("seatAnchors", () => {
  it("keeps seat index stable when detections shuffle", () => {
    const anchors = createSeatAnchors([
      { index: 1, trackId: 10, x: 0.2, y: 0.5, faceDescriptor: null },
      { index: 2, trackId: 20, x: 0.5, y: 0.5, faceDescriptor: null },
      { index: 3, trackId: 30, x: 0.8, y: 0.5, faceDescriptor: null },
    ]);

    const frame1 = matchDetectionsToSeats(anchors, [
      { x: 0.21, y: 0.5, landmarks: lm(0.21) },
      { x: 0.52, y: 0.5, landmarks: lm(0.52) },
      { x: 0.79, y: 0.5, landmarks: lm(0.79) },
    ]);
    expect(frame1.map((s) => s.index)).toEqual([1, 2, 3]);
    expect(frame1.every((s) => s.fresh)).toBe(true);

    // Same people, detection order reversed — seat indices must not swap.
    const frame2 = matchDetectionsToSeats(frame1, [
      { x: 0.81, y: 0.51, landmarks: lm(0.81) },
      { x: 0.19, y: 0.49, landmarks: lm(0.19) },
      { x: 0.48, y: 0.5, landmarks: lm(0.48) },
    ]);
    expect(frame2.map((s) => s.index)).toEqual([1, 2, 3]);
    expect(frame2[0]!.x).toBeLessThan(0.3);
    expect(frame2[2]!.x).toBeGreaterThan(0.7);
  });

  it("preserves seat identity across a brief miss", () => {
    let anchors = createSeatAnchors([
      { index: 1, trackId: 1, x: 0.3, y: 0.5, faceDescriptor: null },
      { index: 2, trackId: 2, x: 0.7, y: 0.5, faceDescriptor: null },
    ]);
    anchors = matchDetectionsToSeats(anchors, [
      { x: 0.3, y: 0.5, landmarks: lm(0.3) },
      { x: 0.7, y: 0.5, landmarks: lm(0.7) },
    ]);
    anchors = matchDetectionsToSeats(anchors, [{ x: 0.31, y: 0.5, landmarks: lm(0.31) }]);
    expect(anchors[0]!.index).toBe(1);
    expect(anchors[0]!.fresh).toBe(true);
    expect(anchors[1]!.index).toBe(2);
    expect(anchors[1]!.fresh).toBe(false);
    expect(anchors[1]!.landmarks).not.toBeNull();
  });
});
