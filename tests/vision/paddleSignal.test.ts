import { describe, expect, it } from "vitest";
import { POSE, type PoseLandmark } from "../../src/vision/detect/isHandRaised";
import {
  paddleColorForSeat,
  SEAT_PADDLE_COLORS,
} from "../../src/vision/detect/paddleColors";
import {
  evaluatePaddleRaise,
  scorePaddleColor,
  type FramePixels,
} from "../../src/vision/detect/paddleSignal";

function blank(): PoseLandmark[] {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
}

function raisedPose(): PoseLandmark[] {
  const pts = blank();
  pts[POSE.NOSE] = { x: 0.5, y: 0.22, visibility: 1 };
  pts[POSE.LEFT_SHOULDER] = { x: 0.4, y: 0.4, visibility: 1 };
  pts[POSE.RIGHT_SHOULDER] = { x: 0.6, y: 0.4, visibility: 1 };
  pts[POSE.LEFT_ELBOW] = { x: 0.38, y: 0.28, visibility: 1 };
  pts[POSE.RIGHT_ELBOW] = { x: 0.62, y: 0.55, visibility: 1 };
  pts[POSE.LEFT_WRIST] = { x: 0.4, y: 0.12, visibility: 1 };
  pts[POSE.RIGHT_WRIST] = { x: 0.64, y: 0.7, visibility: 1 };
  return pts;
}

function armsDown(): PoseLandmark[] {
  const pts = raisedPose();
  pts[POSE.LEFT_ELBOW] = { x: 0.38, y: 0.55, visibility: 1 };
  pts[POSE.LEFT_WRIST] = { x: 0.36, y: 0.72, visibility: 1 };
  return pts;
}

/** Fill a normalized ROI with a solid RGB color on a dark background. */
function frameWithPatch(
  rgb: [number, number, number],
  roi: { x0: number; y0: number; x1: number; y1: number },
  w = 40,
  h = 40,
  background: [number, number, number] = [30, 30, 30],
): FramePixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    data[o] = background[0];
    data[o + 1] = background[1];
    data[o + 2] = background[2];
    data[o + 3] = 255;
  }
  const x0 = Math.floor(roi.x0 * w);
  const y0 = Math.floor(roi.y0 * h);
  const x1 = Math.ceil(roi.x1 * w);
  const y1 = Math.ceil(roi.y1 * h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const o = (y * w + x) * 4;
      data[o] = rgb[0];
      data[o + 1] = rgb[1];
      data[o + 2] = rgb[2];
      data[o + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

describe("SEAT_PADDLE_COLORS", () => {
  it("uses white paddles for all six seats", () => {
    expect(SEAT_PADDLE_COLORS).toEqual({
      1: "white",
      2: "white",
      3: "white",
      4: "white",
      5: "white",
      6: "white",
    });
    expect(paddleColorForSeat(1)).toBe("white");
    expect(paddleColorForSeat(6)).toBe("white");
  });
});

describe("scorePaddleColor", () => {
  it("scores a white patch high for white and low for red", () => {
    const frame = frameWithPatch([245, 245, 245], { x0: 0.3, y0: 0.05, x1: 0.55, y1: 0.25 });
    const white = scorePaddleColor(frame, "white", { x0: 0.25, y0: 0, x1: 0.65, y1: 0.35 });
    const red = scorePaddleColor(frame, "red", { x0: 0.25, y0: 0, x1: 0.65, y1: 0.35 });
    expect(white).toBeGreaterThan(0.45);
    expect(red).toBeLessThan(0.1);
  });

  it("distinguishes saturated seat colors", () => {
    const cases: Array<["red" | "blue" | "green" | "yellow" | "black", [number, number, number]]> = [
      ["red", [220, 30, 30]],
      ["blue", [30, 50, 220]],
      ["green", [30, 200, 40]],
      ["yellow", [230, 220, 30]],
      ["black", [15, 15, 15]],
    ];
    for (const [color, rgb] of cases) {
      const frame = frameWithPatch(rgb, { x0: 0.35, y0: 0.05, x1: 0.6, y1: 0.28 });
      const hit = scorePaddleColor(frame, color, { x0: 0.3, y0: 0, x1: 0.7, y1: 0.35 });
      expect(hit, color).toBeGreaterThan(0.4);
    }
  });
});

describe("evaluatePaddleRaise", () => {
  it("detects a small white paddle in a realistic wide camera frame", () => {
    const frame = frameWithPatch(
      [245, 245, 245],
      { x0: 0.37, y0: 0.04, x1: 0.43, y1: 0.16 },
      320,
      180,
    );
    expect(evaluatePaddleRaise(raisedPose(), frame, "white").raised).toBe(true);
  });

  it("detects a white paddle against a light background with visible contrast", () => {
    const frame = frameWithPatch(
      [250, 250, 250],
      { x0: 0.37, y0: 0.04, x1: 0.43, y1: 0.16 },
      320,
      180,
      [205, 205, 205],
    );
    expect(evaluatePaddleRaise(raisedPose(), frame, "white").raised).toBe(true);
  });

  it("requires strong paddle color; weak pose is enough", () => {
    const frame = frameWithPatch([250, 250, 250], { x0: 0.32, y0: 0.02, x1: 0.52, y1: 0.22 });
    const ev = evaluatePaddleRaise(raisedPose(), frame, "white");
    expect(ev.paddleScore).toBeGreaterThan(0.4);
    expect(ev.raised).toBe(true);
    expect(ev.side).toBe("left");
  });

  it("rejects matching color when arms hang (no pose assist)", () => {
    const frame = frameWithPatch([250, 250, 250], { x0: 0.32, y0: 0.02, x1: 0.52, y1: 0.22 });
    const ev = evaluatePaddleRaise(armsDown(), frame, "white");
    expect(ev.paddleScore).toBeLessThan(0.2);
    expect(ev.raised).toBe(false);
  });

  it("does not count a white shirt away from the raised wrist", () => {
    const frame = frameWithPatch([250, 250, 250], { x0: 0.32, y0: 0.32, x1: 0.64, y1: 0.6 });
    expect(evaluatePaddleRaise(raisedPose(), frame, "white").raised).toBe(false);
  });

  it("does not count a white card beside another position", () => {
    const frame = frameWithPatch([250, 250, 250], { x0: 0.72, y0: 0.02, x1: 0.92, y1: 0.22 });
    expect(evaluatePaddleRaise(raisedPose(), frame, "white").raised).toBe(false);
  });

  it("rejects a uniformly white background behind a raised wrist", () => {
    const frame = frameWithPatch([250, 250, 250], { x0: 0, y0: 0, x1: 1, y1: 1 });
    const ev = evaluatePaddleRaise(raisedPose(), frame, "white");
    expect(ev.paddleScore).toBeLessThan(0.38);
    expect(ev.raised).toBe(false);
  });

  it("rejects wrong paddle color even with a clear raise pose", () => {
    const frame = frameWithPatch([30, 40, 220], { x0: 0.32, y0: 0.02, x1: 0.52, y1: 0.22 });
    const ev = evaluatePaddleRaise(raisedPose(), frame, "white");
    expect(ev.paddleScore).toBeLessThan(0.2);
    expect(ev.raised).toBe(false);
  });

  it("allows very strong paddle with only mild wrist lift", () => {
    const mild = armsDown();
    mild[POSE.LEFT_WRIST] = { x: 0.4, y: 0.36, visibility: 1 }; // near shoulder
    mild[POSE.LEFT_ELBOW] = { x: 0.39, y: 0.42, visibility: 1 };
    const frame = frameWithPatch([255, 255, 255], { x0: 0.3, y0: 0.0, x1: 0.55, y1: 0.3 });
    const ev = evaluatePaddleRaise(mild, frame, "white", {
      minPaddleScore: 0.35,
      strongPaddleScore: 0.55,
    });
    expect(ev.paddleScore).toBeGreaterThan(0.55);
    expect(ev.raised).toBe(true);
  });
});
