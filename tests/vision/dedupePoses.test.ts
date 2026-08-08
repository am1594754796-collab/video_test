import { describe, expect, it } from "vitest";
import { dedupePosesByTorso, torsoCenter } from "../../src/vision/detect/dedupePoses";
import { POSE, type PoseLandmark } from "../../src/vision/detect/isHandRaised";

function fakePose(cx: number, cy: number, visibility = 1): PoseLandmark[] {
  const pts: PoseLandmark[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 0,
  }));
  pts[POSE.LEFT_SHOULDER] = { x: cx - 0.05, y: cy, visibility };
  pts[POSE.RIGHT_SHOULDER] = { x: cx + 0.05, y: cy, visibility };
  pts[POSE.LEFT_WRIST] = { x: cx - 0.05, y: cy + 0.2, visibility };
  pts[POSE.RIGHT_WRIST] = { x: cx + 0.05, y: cy + 0.2, visibility };
  return pts;
}

describe("dedupePosesByTorso", () => {
  it("keeps two people far apart", () => {
    const out = dedupePosesByTorso(
      [{ landmarks: fakePose(0.2, 0.4) }, { landmarks: fakePose(0.8, 0.4) }],
      { minDistance: 0.12 },
    );
    expect(out).toHaveLength(2);
  });

  it("merges near-duplicate detections of the same person", () => {
    const out = dedupePosesByTorso(
      [
        { landmarks: fakePose(0.5, 0.4, 0.9) },
        { landmarks: fakePose(0.52, 0.41, 0.6) },
      ],
      { minDistance: 0.12 },
    );
    expect(out).toHaveLength(1);
    expect(torsoCenter(out[0].landmarks).x).toBeCloseTo(0.5, 1);
  });

  it("prefers the higher-visibility duplicate", () => {
    const out = dedupePosesByTorso(
      [
        { landmarks: fakePose(0.5, 0.4, 0.4) },
        { landmarks: fakePose(0.51, 0.4, 0.95) },
      ],
      { minDistance: 0.12 },
    );
    expect(out).toHaveLength(1);
    expect(out[0].landmarks[POSE.LEFT_SHOULDER]?.visibility).toBe(0.95);
  });
});
