/**
 * Vision Recognition — hand-raise predicate (MediaPipe Pose landmarks).
 * Landmark indices: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker
 *
 * Raised = wrist clearly above same-side elbow (need not clear the shoulder).
 */

export type PoseLandmark = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
};

export const POSE = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
} as const;

export type HandRaiseOptions = {
  /** Wrist must be at least this far above the elbow (normalized image y). */
  margin?: number;
  minVisibility?: number;
};

const DEFAULTS = {
  margin: 0.05,
  minVisibility: 0.5,
} as const;

function visibleEnough(lm: PoseLandmark | undefined, minVisibility: number): lm is PoseLandmark {
  return !!lm && (lm.visibility ?? 1) >= minVisibility;
}

function sideRaised(
  wrist: PoseLandmark | undefined,
  elbow: PoseLandmark | undefined,
  margin: number,
  minVisibility: number,
): boolean {
  if (!visibleEnough(wrist, minVisibility) || !visibleEnough(elbow, minVisibility)) {
    return false;
  }
  // Image coords: smaller y is higher on screen.
  return wrist.y < elbow.y - margin;
}

/**
 * True if at least one visible wrist is clearly above its elbow.
 * Does not require the wrist to be above the shoulder.
 */
export function isHandRaised(
  landmarks: readonly PoseLandmark[],
  options: HandRaiseOptions = {},
): boolean {
  const margin = options.margin ?? DEFAULTS.margin;
  const minVisibility = options.minVisibility ?? DEFAULTS.minVisibility;

  const left = sideRaised(
    landmarks[POSE.LEFT_WRIST],
    landmarks[POSE.LEFT_ELBOW],
    margin,
    minVisibility,
  );
  const right = sideRaised(
    landmarks[POSE.RIGHT_WRIST],
    landmarks[POSE.RIGHT_ELBOW],
    margin,
    minVisibility,
  );
  return left || right;
}
