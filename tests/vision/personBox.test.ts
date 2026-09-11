import { describe, expect, it } from "vitest";
import {
  boxCenter,
  boxIou,
  expandBoxForPose,
  expandFaceToPersonCrop,
  isolateRowCrops,
  nmsPersonBoxes,
  personBoxesFromFaces,
  selectPersonRow,
  type PersonBox,
} from "../../src/vision/detect/personBox";

function box(x: number, w = 0.1, score = 0.9, y = 0.4, h = 0.3): PersonBox {
  return { xMin: x, xMax: x + w, yMin: y, yMax: y + h, score };
}

describe("boxIou / nmsPersonBoxes", () => {
  it("keeps two close but distinct people", () => {
    const a = box(0.4, 0.08, 0.9);
    const b = box(0.49, 0.08, 0.85);
    expect(boxIou(a, b)).toBeLessThan(0.45);
    const kept = nmsPersonBoxes([a, b], 0.45, 8);
    expect(kept).toHaveLength(2);
  });

  it("drops a duplicate overlapping the same person", () => {
    const a = box(0.4, 0.12, 0.95);
    const b = box(0.41, 0.12, 0.5);
    expect(boxIou(a, b)).toBeGreaterThan(0.45);
    const kept = nmsPersonBoxes([a, b], 0.45, 8);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.score).toBe(0.95);
  });
});

describe("isolateRowCrops", () => {
  it("does not let a crop cross the midpoint of a neighbor", () => {
    const crops = isolateRowCrops([box(0.4, 0.1), box(0.52, 0.1)], { x: 0.4, top: 0.3 });
    expect(crops).toHaveLength(2);
    const mid = (boxCenter(box(0.4, 0.1)).x + boxCenter(box(0.52, 0.1)).x) / 2;
    expect(crops[0]!.xMax).toBeLessThanOrEqual(mid + 1e-6);
    expect(crops[1]!.xMin).toBeGreaterThanOrEqual(mid - 1e-6);
  });

  it("adds headroom above the original box", () => {
    const src = box(0.4, 0.1, 0.9, 0.4, 0.3);
    const [crop] = isolateRowCrops([src], { top: 0.35 });
    expect(crop!.yMin).toBeLessThan(src.yMin);
  });

  it("keeps Qwen index when crops are re-sorted by x", () => {
    const crops = isolateRowCrops([
      { xMin: 0.6, xMax: 0.72, yMin: 0.2, yMax: 0.5, score: 1, index: 1 },
      { xMin: 0.18, xMax: 0.3, yMin: 0.2, yMax: 0.5, score: 1, index: 2 },
    ]);
    expect(crops.map((c) => c.index).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 2]);
    const left = crops.reduce((a, b) => (a.xMin < b.xMin ? a : b));
    const right = crops.reduce((a, b) => (a.xMin > b.xMin ? a : b));
    expect(left.index).toBe(2);
    expect(right.index).toBe(1);
  });
});

describe("selectPersonRow", () => {
  it("keeps six close seats instead of collapsing to the highest-score boxes", () => {
    const xs = [0.08, 0.22, 0.36, 0.5, 0.64, 0.78];
    const boxes = xs.map((x, i) => box(x, 0.1, 0.9 - i * 0.01, 0.42, 0.28));
    const row = selectPersonRow(boxes, 6, { minGapX: 0.03 });
    expect(row).toHaveLength(6);
    const outX = row.map((b) => boxCenter(b).x);
    for (let i = 1; i < outX.length; i++) {
      expect(outX[i]).toBeGreaterThan(outX[i - 1]!);
    }
  });

  it("drops a far background person outside the row Y band", () => {
    const rowBoxes = [0.2, 0.4, 0.6].map((x) => box(x, 0.1, 0.9, 0.45, 0.25));
    const bg = box(0.5, 0.12, 0.95, 0.05, 0.2);
    const row = selectPersonRow([...rowBoxes, bg], 3, { yBand: 0.18 });
    expect(row).toHaveLength(3);
    expect(row.every((b) => boxCenter(b).y > 0.3)).toBe(true);
  });
});

describe("expandBoxForPose", () => {
  it("clips to the frame", () => {
    const out = expandBoxForPose({ xMin: 0, yMin: 0, xMax: 0.1, yMax: 0.2, score: 1 }, { top: 0.5, x: 0.5 });
    expect(out.xMin).toBe(0);
    expect(out.yMin).toBe(0);
  });
});

describe("expandFaceToPersonCrop", () => {
  it("grows a face downward and sideways for upper-body pose", () => {
    const face = { cx: 0.4, cy: 0.28, xMin: 0.35, yMin: 0.2, width: 0.1, height: 0.16, score: 0.9 };
    const box = expandFaceToPersonCrop(face);
    expect(box.xMin).toBeLessThan(face.xMin);
    expect(box.xMax).toBeGreaterThan(face.xMin + face.width);
    expect(box.yMin).toBeLessThan(face.yMin);
    expect(box.yMax).toBeGreaterThan(face.yMin + face.height);
    expect(box.yMax - box.yMin).toBeGreaterThan(face.height * 2.5);
  });
});

describe("personBoxesFromFaces", () => {
  it("returns left-to-right isolated crops", () => {
    const faces = [
      { cx: 0.62, cy: 0.3, xMin: 0.57, yMin: 0.22, width: 0.1, height: 0.16, score: 0.9 },
      { cx: 0.28, cy: 0.3, xMin: 0.23, yMin: 0.22, width: 0.1, height: 0.16, score: 0.9 },
    ];
    const boxes = personBoxesFromFaces(faces);
    expect(boxes).toHaveLength(2);
    expect(boxes.map((b) => b.index)).toEqual([1, 2]);
    expect(boxCenter(boxes[0]!).x).toBeLessThan(boxCenter(boxes[1]!).x);
    const mid = (boxCenter(boxes[0]!).x + boxCenter(boxes[1]!).x) / 2;
    expect(boxes[0]!.xMax).toBeLessThanOrEqual(mid + 0.08);
    expect(boxes[1]!.xMin).toBeGreaterThanOrEqual(mid - 0.08);
  });
});
