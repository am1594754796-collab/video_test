import { describe, expect, it } from "vitest";
import { createFaceTrackState, dedupeFaceLocations, trackFaceLocations, type FaceLocation } from "../../src/vision/detect/faceLocator";

function face(x: number, score: number): FaceLocation {
  return { x, y: 0.4, width: 0.04, height: 0.06, score };
}

describe("face locations", () => {
  it("merges duplicate detections from overlapping stage crops", () => {
    const result = dedupeFaceLocations([
      face(0.2, 0.7), face(0.204, 0.9), face(0.33, 0.8),
    ]);
    expect(result.map((p) => p.x)).toEqual([0.204, 0.33]);
  });
  it("waits for the same face and smooths small position jitter", () => {
    let state = createFaceTrackState();
    for (const x of [0.2, 0.208, 0.195]) {
      const result = trackFaceLocations(state, [face(x, 0.9)]);
      state = result.state;
      expect(result.stable).toHaveLength(0);
    }
    const result = trackFaceLocations(state, [face(0.204, 0.9)]);
    expect(result.stable).toHaveLength(1);
    expect(result.stable[0]!.x).toBeGreaterThan(0.198);
    expect(result.stable[0]!.x).toBeLessThan(0.205);
  });
  it("does not replace a tracked person with a one-frame face elsewhere", () => {
    let state = createFaceTrackState();
    for (let i = 0; i < 4; i++) state = trackFaceLocations(state, [face(0.2, 0.9)]).state;
    const jumped = trackFaceLocations(state, [face(0.7, 0.95)]);
    expect(jumped.stable).toHaveLength(1);
    expect(jumped.stable[0]!.x).toBeCloseTo(0.2);
    expect(jumped.state.tracks).toHaveLength(2);
    const recovered = trackFaceLocations(jumped.state, [face(0.21, 0.9)]);
    expect(recovered.stable).toHaveLength(1);
    expect(recovered.stable[0]!.x).toBeLessThan(0.3);
  });
  it("keeps a stable face through a brief detector dropout", () => {
    let state = createFaceTrackState();
    for (let i = 0; i < 4; i++) state = trackFaceLocations(state, [face(0.2, 0.9)]).state;
    for (let i = 0; i < 3; i++) {
      const result = trackFaceLocations(state, []);
      state = result.state;
      expect(result.stable).toHaveLength(1);
    }
    expect(trackFaceLocations(state, []).stable).toHaveLength(0);
  });
});
