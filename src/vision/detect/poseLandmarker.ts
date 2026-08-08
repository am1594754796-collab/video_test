/**
 * MediaPipe Pose Landmarker adapter (Vision Recognition).
 * Setup follows:
 * https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js
 */

import {
  FilesetResolver,
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

/** Lite model — good latency for classroom webcam. */
export const DEFAULT_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

/** Pin WASM to the installed package major line. */
export const DEFAULT_WASM_ROOT =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm";

export type PoseLandmarkerConfig = {
  numPoses?: number;
  modelAssetPath?: string;
  wasmRoot?: string;
  minPoseDetectionConfidence?: number;
  minPosePresenceConfidence?: number;
  minTrackingConfidence?: number;
};

export type PoseFrame = {
  landmarks: NormalizedLandmark[];
};

export async function createPoseLandmarker(
  config: PoseLandmarkerConfig = {},
): Promise<PoseLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(config.wasmRoot ?? DEFAULT_WASM_ROOT);

  const shared = {
    runningMode: "VIDEO" as const,
    numPoses: config.numPoses ?? 6,
    minPoseDetectionConfidence: config.minPoseDetectionConfidence ?? 0.65,
    minPosePresenceConfidence: config.minPosePresenceConfidence ?? 0.65,
    minTrackingConfidence: config.minTrackingConfidence ?? 0.6,
  };

  const modelAssetPath = config.modelAssetPath ?? DEFAULT_MODEL_URL;

  try {
    return await PoseLandmarker.createFromOptions(vision, {
      ...shared,
      baseOptions: { modelAssetPath, delegate: "GPU" },
    });
  } catch {
    return PoseLandmarker.createFromOptions(vision, {
      ...shared,
      baseOptions: { modelAssetPath, delegate: "CPU" },
    });
  }
}

export function detectPosesForVideo(
  landmarker: PoseLandmarker,
  video: HTMLVideoElement,
  timestampMs: number,
): PoseFrame[] {
  const result = landmarker.detectForVideo(video, timestampMs);
  const poses = result.landmarks ?? [];
  return poses.map((landmarks) => ({ landmarks }));
}
