import { describe, expect, it } from "vitest";
import { mapLandmarksToFullFrame } from "../../src/vision/detect/poseLandmarker";

describe("mapLandmarksToFullFrame", () => {
  it("maps x and y from a desk ROI back to full frame", () => {
    const mapped = mapLandmarksToFullFrame(
      [{ x: 0.5, y: 0.5, z: 0, visibility: 1 }],
      { x0: 0, x1: 0.5, y0: 0.25, y1: 0.85 },
    );
    expect(mapped[0]!.x).toBeCloseTo(0.25, 5);
    expect(mapped[0]!.y).toBeCloseTo(0.55, 5);
  });
});
