/**
 * MediaPipe Face Detector — session face boxes for seat binding.
 * https://developers.google.com/edge/mediapipe/solutions/vision/face_detector/web_js
 */

import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import { DEFAULT_WASM_ROOT } from "./poseLandmarker";

export const DEFAULT_FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.task";

export type FaceBox = {
  /** Normalized center x (0–1). */
  cx: number;
  /** Normalized center y (0–1). */
  cy: number;
  xMin: number;
  yMin: number;
  width: number;
  height: number;
  score: number;
};

export type FaceDetectorConfig = {
  modelAssetPath?: string;
  wasmRoot?: string;
  minDetectionConfidence?: number;
};

export async function createFaceDetector(
  config: FaceDetectorConfig = {},
): Promise<FaceDetector> {
  const vision = await FilesetResolver.forVisionTasks(config.wasmRoot ?? DEFAULT_WASM_ROOT);
  const modelAssetPath = config.modelAssetPath ?? DEFAULT_FACE_MODEL_URL;
  const shared = {
    runningMode: "VIDEO" as const,
    minDetectionConfidence: config.minDetectionConfidence ?? 0.5,
  };

  try {
    return await FaceDetector.createFromOptions(vision, {
      ...shared,
      baseOptions: { modelAssetPath, delegate: "GPU" },
    });
  } catch {
    return FaceDetector.createFromOptions(vision, {
      ...shared,
      baseOptions: { modelAssetPath, delegate: "CPU" },
    });
  }
}

/**
 * Detect faces for the current video frame. Boxes are normalized to video size.
 */
export function detectFacesForVideo(
  detector: FaceDetector,
  video: HTMLVideoElement,
  timestampMs: number,
): FaceBox[] {
  const result = detector.detectForVideo(video, timestampMs);
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const out: FaceBox[] = [];

  for (const det of result.detections ?? []) {
    const box = det.boundingBox;
    if (!box) continue;
    const xMin = box.originX / vw;
    const yMin = box.originY / vh;
    const width = box.width / vw;
    const height = box.height / vh;
    const score = det.categories?.[0]?.score ?? 0;
    out.push({
      cx: xMin + width / 2,
      cy: yMin + height / 2,
      xMin,
      yMin,
      width,
      height,
      score,
    });
  }
  return out;
}
