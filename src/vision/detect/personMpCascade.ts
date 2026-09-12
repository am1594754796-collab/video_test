/**
 * Stage 2: isolated person crops → single-target MediaPipe Pose.
 * Boxes come from self-split (pose/seat), not cloud faces.
 */

import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { detectPosesFromPersonBoxes, type CascadePose } from "./cascadePose";
import type { PersonBox } from "./personBox";

export type PersonMpResult = {
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

export function runMpOnPersonBoxes(opts: {
  landmarker: PoseLandmarker;
  frameCanvas: HTMLCanvasElement;
  cropCanvas: HTMLCanvasElement;
  source: HTMLCanvasElement | HTMLVideoElement;
  boxes: readonly PersonBox[];
}): PersonMpResult {
  const { landmarker, frameCanvas, cropCanvas, source, boxes } = opts;
  if (!ensureFrame(frameCanvas, source) || boxes.length === 0) {
    return { boxes: [], poses: [] };
  }
  const poses = detectPosesFromPersonBoxes(landmarker, frameCanvas, cropCanvas, boxes, {
    maxTorsoDist: 0.28,
  });
  return { boxes: [...boxes], poses };
}
