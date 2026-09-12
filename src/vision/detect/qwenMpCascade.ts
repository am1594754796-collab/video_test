/**
 * Qwen-numbered faces → isolated zoomed person crops → MediaPipe Pose (one person each).
 */

import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { detectPosesFromPersonBoxes, type CascadePose } from "./cascadePose";
import type { FaceBox } from "./faceDetector";
import {
  expandFaceToPersonCrop,
  isolateRowCrops,
  personBoxFromSeat,
  personBoxesFromFaces,
  type PersonBox,
} from "./personBox";

export type QwenMpResult = {
  boxes: PersonBox[];
  poses: CascadePose[];
};

function ensureFrame(
  frameCanvas: HTMLCanvasElement,
  source: HTMLCanvasElement | HTMLVideoElement,
): boolean {
  const vw =
    source instanceof HTMLVideoElement ? source.videoWidth || source.width : source.width;
  const vh =
    source instanceof HTMLVideoElement ? source.videoHeight || source.height : source.height;
  if (vw < 2 || vh < 2) return false;
  if (frameCanvas.width !== vw || frameCanvas.height !== vh) {
    frameCanvas.width = vw;
    frameCanvas.height = vh;
  }
  const ctx = frameCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(source, 0, 0, vw, vh);
  return true;
}

/**
 * Build one crop per locked seat: prefer that seat's Qwen face, else a box around the seat.
 */
export function personBoxesFromNumberedSeats(
  seats: readonly { index: number; x: number; y: number }[],
  faceByIndex: ReadonlyMap<number, FaceBox>,
): PersonBox[] {
  if (seats.length === 0) return [];
  const expanded = [...seats]
    .sort((a, b) => a.index - b.index)
    .map((s) => {
      const face = faceByIndex.get(s.index);
      const box = face ? expandFaceToPersonCrop(face) : personBoxFromSeat(s);
      return { ...box, index: s.index };
    });
  return isolateRowCrops(expanded, { top: 0.22, x: 0.06, bottom: 0.04 });
}

export function runMpOnPersonBoxes(opts: {
  landmarker: PoseLandmarker;
  frameCanvas: HTMLCanvasElement;
  cropCanvas: HTMLCanvasElement;
  source: HTMLCanvasElement | HTMLVideoElement;
  boxes: readonly PersonBox[];
}): QwenMpResult {
  const { landmarker, frameCanvas, cropCanvas, source, boxes } = opts;
  if (!ensureFrame(frameCanvas, source) || boxes.length === 0) {
    return { boxes: [], poses: [] };
  }
  const poses = detectPosesFromPersonBoxes(landmarker, frameCanvas, cropCanvas, boxes, {
    maxTorsoDist: 0.3,
  });
  return { boxes: [...boxes], poses };
}

export function runQwenMpCascade(opts: {
  landmarker: PoseLandmarker;
  frameCanvas: HTMLCanvasElement;
  cropCanvas: HTMLCanvasElement;
  source: HTMLCanvasElement | HTMLVideoElement;
  faces: readonly FaceBox[];
  seats?: readonly { index: number; x: number; y: number }[];
  faceByIndex?: ReadonlyMap<number, FaceBox>;
}): QwenMpResult {
  const boxes =
    opts.seats && opts.seats.length > 0
      ? personBoxesFromNumberedSeats(opts.seats, opts.faceByIndex ?? new Map())
      : personBoxesFromFaces(opts.faces);
  return runMpOnPersonBoxes({
    landmarker: opts.landmarker,
    frameCanvas: opts.frameCanvas,
    cropCanvas: opts.cropCanvas,
    source: opts.source,
    boxes,
  });
}
