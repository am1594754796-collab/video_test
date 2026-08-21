/**
 * Face bounding box type used for seat binding.
 * Detection itself is done via Qwen-VL (`/api/vision/detect-faces`), not MediaPipe.
 */

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
