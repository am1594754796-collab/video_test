import { describe, expect, it } from "vitest";
import { cosineSimilarity } from "../../src/vision/detect/faceDescriptor";
import { pickFaceForPerson } from "../../src/vision/detect/faceDescriptor";

describe("faceDescriptor helpers", () => {
  it("cosineSimilarity is 1 for identical vectors", () => {
    const a = [0.6, 0.8];
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5);
  });

  it("pickFaceForPerson chooses nearest face above torso", () => {
    const face = pickFaceForPerson(
      [
        { cx: 0.2, cy: 0.2, xMin: 0.1, yMin: 0.1, width: 0.2, height: 0.2, score: 0.9 },
        { cx: 0.8, cy: 0.2, xMin: 0.7, yMin: 0.1, width: 0.2, height: 0.2, score: 0.9 },
      ],
      { x: 0.22, y: 0.35 },
      { maxDistance: 0.3 },
    );
    expect(face?.cx).toBeCloseTo(0.2, 5);
  });
});
