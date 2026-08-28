/**
 * Vision Recognition — hand-raise predicate (MediaPipe Pose landmarks).
 * Landmark indices: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker
 *
 * Raised = this person's own bent arm (left and/or right independently):
 *   wrist clearly above the same-side shoulder, elbow flexed, chain looks like one arm.
 * Neighbor wrists glued onto this skeleton are rejected.
 */

export type PoseLandmark = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
};

export const POSE = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
} as const;

export type HandRaiseOptions = {
  /** Wrist must be at least this far above the same-side shoulder (normalized y). */
  margin?: number;
  minVisibility?: number;
  /** Other people in the same frame — used so we do not claim their wrists. */
  otherLandmarks?: readonly (readonly PoseLandmark[])[];
};

export type HandsRaised = {
  left: boolean;
  right: boolean;
};

const DEFAULTS = {
  margin: 0.04,
  minVisibility: 0.55,
  minElbowDeg: 28,
  maxElbowDeg: 148,
  minSegment: 0.03,
  maxSegment: 0.36,
  maxWristFromShoulder: 0.42,
} as const;

function visibleEnough(lm: PoseLandmark | undefined, minVisibility: number): lm is PoseLandmark {
  return !!lm && (lm.visibility ?? 1) >= minVisibility;
}

function hypot2(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function torsoCenter(landmarks: readonly PoseLandmark[]): { x: number; y: number } {
  const ls = landmarks[POSE.LEFT_SHOULDER];
  const rs = landmarks[POSE.RIGHT_SHOULDER];
  if (ls && rs) {
    return { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  }
  const nose = landmarks[POSE.NOSE];
  return { x: nose?.x ?? 0.5, y: nose?.y ?? 0.5 };
}

function elbowAngleDeg(shoulder: PoseLandmark, elbow: PoseLandmark, wrist: PoseLandmark): number {
  const ux = shoulder.x - elbow.x;
  const uy = shoulder.y - elbow.y;
  const vx = wrist.x - elbow.x;
  const vy = wrist.y - elbow.y;
  const du = Math.hypot(ux, uy);
  const dv = Math.hypot(vx, vy);
  if (du < 1e-6 || dv < 1e-6) return 180;
  const cos = Math.min(1, Math.max(-1, (ux * vx + uy * vy) / (du * dv)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function ownArmGeometry(
  shoulder: PoseLandmark,
  elbow: PoseLandmark,
  wrist: PoseLandmark,
  side: "left" | "right",
  oppositeShoulder: PoseLandmark | undefined,
): boolean {
  const upper = hypot2(shoulder.x, shoulder.y, elbow.x, elbow.y);
  const forearm = hypot2(elbow.x, elbow.y, wrist.x, wrist.y);
  const reach = hypot2(shoulder.x, shoulder.y, wrist.x, wrist.y);
  if (upper < DEFAULTS.minSegment || upper > DEFAULTS.maxSegment) return false;
  if (forearm < DEFAULTS.minSegment || forearm > DEFAULTS.maxSegment) return false;
  if (reach > DEFAULTS.maxWristFromShoulder) return false;

  // Raised hand stays on this person's side of the torso (may cross midline a little).
  if (oppositeShoulder) {
    if (side === "left" && wrist.x > oppositeShoulder.x + 0.1) return false;
    if (side === "right" && wrist.x < oppositeShoulder.x - 0.1) return false;
  }
  return true;
}

function wristCloserToNeighbor(
  wrist: PoseLandmark,
  selfTorso: { x: number; y: number },
  others: readonly (readonly PoseLandmark[])[],
): boolean {
  const dSelf = hypot2(wrist.x, wrist.y, selfTorso.x, selfTorso.y);
  for (const other of others) {
    const t = torsoCenter(other);
    const dOther = hypot2(wrist.x, wrist.y, t.x, t.y);
    if (dOther + 0.04 < dSelf) return true;
  }
  return false;
}

function sideRaised(
  landmarks: readonly PoseLandmark[],
  side: "left" | "right",
  options: Required<Pick<HandRaiseOptions, "margin" | "minVisibility">> & {
    otherLandmarks: readonly (readonly PoseLandmark[])[];
  },
): boolean {
  const shoulder = landmarks[side === "left" ? POSE.LEFT_SHOULDER : POSE.RIGHT_SHOULDER];
  const elbow = landmarks[side === "left" ? POSE.LEFT_ELBOW : POSE.RIGHT_ELBOW];
  const wrist = landmarks[side === "left" ? POSE.LEFT_WRIST : POSE.RIGHT_WRIST];
  const opposite = landmarks[side === "left" ? POSE.RIGHT_SHOULDER : POSE.LEFT_SHOULDER];
  const { margin, minVisibility, otherLandmarks } = options;

  if (
    !visibleEnough(shoulder, minVisibility) ||
    !visibleEnough(elbow, minVisibility) ||
    !visibleEnough(wrist, minVisibility)
  ) {
    return false;
  }

  if (wrist.y >= shoulder.y - margin) return false;

  if (!ownArmGeometry(shoulder, elbow, wrist, side, opposite)) return false;

  const angle = elbowAngleDeg(shoulder, elbow, wrist);
  if (angle < DEFAULTS.minElbowDeg || angle > DEFAULTS.maxElbowDeg) return false;

  if (wristCloserToNeighbor(wrist, torsoCenter(landmarks), otherLandmarks)) return false;

  return true;
}

export function handsRaised(
  landmarks: readonly PoseLandmark[],
  options: HandRaiseOptions = {},
): HandsRaised {
  const margin = options.margin ?? DEFAULTS.margin;
  const minVisibility = options.minVisibility ?? DEFAULTS.minVisibility;
  const otherLandmarks = options.otherLandmarks ?? [];
  const opts = { margin, minVisibility, otherLandmarks };
  return {
    left: sideRaised(landmarks, "left", opts),
    right: sideRaised(landmarks, "right", opts),
  };
}

/**
 * True if this person's left and/or right bent arm is raised.
 * Does not use another person's wrist, even if MediaPipe attached it here.
 */
export function isHandRaised(
  landmarks: readonly PoseLandmark[],
  options: HandRaiseOptions = {},
): boolean {
  const hands = handsRaised(landmarks, options);
  return hands.left || hands.right;
}
