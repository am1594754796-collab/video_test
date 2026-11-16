import { describe, expect, it } from "vitest";
import { stripDuplicatesOfLoneFullPose, type PoseFrame } from "../../src/vision/detect/poseLandmarker";

function pose(cx: number, cy = 0.4): PoseFrame {
  const landmarks = Array.from({ length: 33 }, () => ({
    x: cx, y: cy, z: 0, visibility: 1,
  }));
  landmarks[11] = { x: cx - 0.04, y: cy, z: 0, visibility: 1 };
  landmarks[12] = { x: cx + 0.04, y: cy, z: 0, visibility: 1 };
  return { landmarks };
}

describe("single-person scout band dedupe", () => {
  it("removes a second skeleton for the lone full-frame person", () => {
    expect(stripDuplicatesOfLoneFullPose([pose(0.5)], [pose(0.55)])).toHaveLength(0);
  });

  it("keeps a distant person found only by a scout strip", () => {
    expect(stripDuplicatesOfLoneFullPose([pose(0.3)], [pose(0.7)])).toHaveLength(1);
  });

  it("preserves close row candidates when the full frame already has multiple people", () => {
    expect(stripDuplicatesOfLoneFullPose([pose(0.4), pose(0.5)], [pose(0.45)])).toHaveLength(1);
  });
});
