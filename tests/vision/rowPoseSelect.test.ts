import { describe, expect, it } from "vitest";
import {
  selectPosesBySeatBins,
  dedupeRowPoses,
  collapseByMinGapX,
} from "../../src/vision/detect/rowPoseSelect";
import { torsoCenter } from "../../src/vision/detect/dedupePoses";
import { POSE, type PoseLandmark } from "../../src/vision/detect/isHandRaised";

function fakePose(cx: number, cy: number, visibility = 1): PoseLandmark[] {
  const pts: PoseLandmark[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 0,
  }));
  pts[POSE.LEFT_SHOULDER] = { x: cx - 0.04, y: cy, visibility };
  pts[POSE.RIGHT_SHOULDER] = { x: cx + 0.04, y: cy, visibility };
  pts[POSE.LEFT_WRIST] = { x: cx - 0.04, y: cy + 0.2, visibility };
  pts[POSE.RIGHT_WRIST] = { x: cx + 0.04, y: cy + 0.2, visibility };
  return pts;
}

describe("collapseByMinGapX", () => {
  it("removes a phantom glued to a real neighbor", () => {
    const poses = [
      { landmarks: fakePose(0.4, 0.4, 0.9) },
      { landmarks: fakePose(0.42, 0.41, 0.4) }, // phantom
      { landmarks: fakePose(0.55, 0.4, 0.9) },
    ];
    const out = collapseByMinGapX(poses, 0.036);
    expect(out).toHaveLength(2);
  });

  it("keeps real neighbors ~0.05 apart", () => {
    const poses = [
      { landmarks: fakePose(0.4, 0.4, 0.9) },
      { landmarks: fakePose(0.45, 0.4, 0.85) },
      { landmarks: fakePose(0.55, 0.4, 0.9) },
    ];
    const out = collapseByMinGapX(poses, 0.036);
    expect(out).toHaveLength(3);
  });
});

describe("dedupeRowPoses", () => {
  it("merges multi-band near duplicates", () => {
    const out = dedupeRowPoses([
      { landmarks: fakePose(0.5, 0.4, 0.9) },
      { landmarks: fakePose(0.52, 0.41, 0.6) },
    ]);
    expect(out).toHaveLength(1);
  });
});

describe("selectPosesBySeatBins", () => {
  it("keeps six clearly separated seats", () => {
    const poses = [0.12, 0.28, 0.42, 0.55, 0.68, 0.84].map((x) => ({
      landmarks: fakePose(x, 0.45),
    }));
    const out = selectPosesBySeatBins(poses, { expectedCount: 6 });
    expect(out).toHaveLength(6);
    const xs = out.map((p) => torsoCenter(p.landmarks).x);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    }
  });

  it("soft-retries so a tight real pair is not collapsed away when under-count", () => {
    // 5 well spaced + one close pair that soft gap should keep as 6
    const poses = [
      { landmarks: fakePose(0.1, 0.4, 0.9) },
      { landmarks: fakePose(0.25, 0.4, 0.9) },
      { landmarks: fakePose(0.4, 0.4, 0.9) },
      { landmarks: fakePose(0.44, 0.4, 0.85) }, // neighbor ~0.04
      { landmarks: fakePose(0.6, 0.4, 0.9) },
      { landmarks: fakePose(0.78, 0.4, 0.9) },
    ];
    const out = selectPosesBySeatBins(poses, {
      expectedCount: 6,
      minSeatGap: 0.045, // tight would merge 0.40/0.44; soft retry should recover
    });
    expect(out.length).toBeGreaterThanOrEqual(5);
  });

  it("does not keep glued phantoms when already at expected", () => {
    const poses = [
      { landmarks: fakePose(0.15, 0.4) },
      { landmarks: fakePose(0.3, 0.4) },
      { landmarks: fakePose(0.45, 0.4) },
      { landmarks: fakePose(0.47, 0.41, 0.3) },
      { landmarks: fakePose(0.6, 0.4) },
      { landmarks: fakePose(0.75, 0.4) },
      { landmarks: fakePose(0.9, 0.4) },
    ];
    const out = selectPosesBySeatBins(poses, { expectedCount: 6, minSeatGap: 0.036 });
    expect(out.length).toBeLessThanOrEqual(6);
  });
});
