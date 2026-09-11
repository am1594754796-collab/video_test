import { describe, expect, it } from "vitest";
import { mapLandmarksFromCrop } from "../../src/vision/detect/cascadePose";
import type { PersonBox } from "../../src/vision/detect/personBox";

describe("mapLandmarksFromCrop", () => {
  it("maps crop-normalized shoulders back to full-frame coordinates", () => {
    const box: PersonBox = { xMin: 0.2, yMin: 0.3, xMax: 0.4, yMax: 0.7, score: 1 };
    const mapped = mapLandmarksFromCrop(
      [
        { x: 0, y: 0, z: 0, visibility: 1 },
        { x: 1, y: 1, z: 0, visibility: 1 },
        { x: 0.5, y: 0.5, z: 0, visibility: 1 },
      ],
      box,
    );
    expect(mapped[0]!.x).toBeCloseTo(0.2);
    expect(mapped[0]!.y).toBeCloseTo(0.3);
    expect(mapped[1]!.x).toBeCloseTo(0.4);
    expect(mapped[1]!.y).toBeCloseTo(0.7);
    expect(mapped[2]!.x).toBeCloseTo(0.3);
    expect(mapped[2]!.y).toBeCloseTo(0.5);
  });
});
