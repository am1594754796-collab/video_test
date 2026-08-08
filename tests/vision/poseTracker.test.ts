import { describe, expect, it } from "vitest";
import { PoseTracker } from "../../src/vision/detect/poseTracker";
import { POSE, type PoseLandmark } from "../../src/vision/detect/isHandRaised";

function poseAt(cx: number): { landmarks: PoseLandmark[] } {
  const pts: PoseLandmark[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 1,
  }));
  pts[POSE.LEFT_SHOULDER] = { x: cx - 0.05, y: 0.4, visibility: 1 };
  pts[POSE.RIGHT_SHOULDER] = { x: cx + 0.05, y: 0.4, visibility: 1 };
  return { landmarks: pts };
}

describe("PoseTracker", () => {
  it("keeps the same track id when a person moves slightly", () => {
    const tracker = new PoseTracker({ matchDistance: 0.2, maxMissed: 8 });
    const a = tracker.update([poseAt(0.5)]);
    expect(a).toHaveLength(1);
    const id = a[0].trackId;

    const b = tracker.update([poseAt(0.53)]);
    expect(b).toHaveLength(1);
    expect(b[0].trackId).toBe(id);
  });

  it("assigns stable left-to-right display indices", () => {
    const tracker = new PoseTracker({ matchDistance: 0.2, maxMissed: 8 });
    const frame = tracker.update([poseAt(0.7), poseAt(0.3)]);
    expect(frame.map((t) => t.displayIndex)).toEqual([1, 2]);
    expect(frame[0].center.x).toBeLessThan(frame[1].center.x);
  });

  it("holds a track briefly when detection drops out one frame", () => {
    const tracker = new PoseTracker({ matchDistance: 0.2, maxMissed: 3 });
    const first = tracker.update([poseAt(0.5)]);
    const id = first[0].trackId;
    const held = tracker.update([]);
    expect(held).toHaveLength(1);
    expect(held[0].trackId).toBe(id);
  });
});
