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
  /** Override geometry clamps (classroom / high raises). */
  maxWristFromShoulder?: number;
  maxUpperArm?: number;
  maxForearm?: number;
  minElbowDeg?: number;
  maxElbowDeg?: number;
  /**
   * Classroom / video wave: prioritize wrist-above-shoulder; loosen elbow/segment
   * checks so high nearly-straight raises still count.
   */
  classroom?: boolean;
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
  limits: {
    minSegment: number;
    maxUpperArm: number;
    maxForearm: number;
    maxWristFromShoulder: number;
  },
): boolean {
  const upper = hypot2(shoulder.x, shoulder.y, elbow.x, elbow.y);
  const forearm = hypot2(elbow.x, elbow.y, wrist.x, wrist.y);
  const reach = hypot2(shoulder.x, shoulder.y, wrist.x, wrist.y);
  if (upper < limits.minSegment || upper > limits.maxUpperArm) return false;
  if (forearm < limits.minSegment || forearm > limits.maxForearm) return false;
  if (reach > limits.maxWristFromShoulder) return false;

  // Raised hand stays on this person's side of the torso (may cross midline a little).
  if (oppositeShoulder) {
    if (side === "left" && wrist.x > oppositeShoulder.x + 0.12) return false;
    if (side === "right" && wrist.x < oppositeShoulder.x - 0.12) return false;
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
    maxWristFromShoulder: number;
    maxUpperArm: number;
    maxForearm: number;
    minElbowDeg: number;
    maxElbowDeg: number;
    classroom: boolean;
  },
): boolean {
  const shoulder = landmarks[side === "left" ? POSE.LEFT_SHOULDER : POSE.RIGHT_SHOULDER];
  const elbow = landmarks[side === "left" ? POSE.LEFT_ELBOW : POSE.RIGHT_ELBOW];
  const wrist = landmarks[side === "left" ? POSE.LEFT_WRIST : POSE.RIGHT_WRIST];
  const opposite = landmarks[side === "left" ? POSE.RIGHT_SHOULDER : POSE.LEFT_SHOULDER];
  const { margin, minVisibility, otherLandmarks, classroom } = options;

  if (!visibleEnough(shoulder, minVisibility) || !visibleEnough(wrist, minVisibility)) {
    return false;
  }

  if (wristCloserToNeighbor(wrist, torsoCenter(landmarks), otherLandmarks)) return false;

  const reach = hypot2(shoulder.x, shoulder.y, wrist.x, wrist.y);
  if (reach > options.maxWristFromShoulder) return false;

  if (classroom) {
    const nose = landmarks[POSE.NOSE];
    const otherShoulder = opposite;
    const midY =
      otherShoulder && visibleEnough(otherShoulder, minVisibility * 0.6)
        ? (shoulder.y + otherShoulder.y) / 2
        : shoulder.y;
    const topShoulderY = otherShoulder
      ? Math.min(shoulder.y, otherShoulder.y)
      : shoulder.y;
    const bottomShoulderY = otherShoulder
      ? Math.max(shoulder.y, otherShoulder.y)
      : shoulder.y;
    const tilt = bottomShoulderY - topShoulderY;

    // Chair lean / arm on armrest: elbow high, hand hangs down → never a raise.
    if (visibleEnough(elbow, minVisibility * 0.45) && wrist.y > elbow.y + 0.015) {
      return false;
    }

    // Must be more upward than sideways (rejects torso lean with arm out to the side).
    const up = shoulder.y - wrist.y;
    const sideways = Math.abs(wrist.x - shoulder.x);
    if (up < 0.035) return false;
    if (sideways > up * 1.15) return false;

    // Raised hand must reach the head band (leaning with hand at chest/waist fails).
    if (!nose || !visibleEnough(nose, minVisibility * 0.45) || wrist.y > nose.y + 0.08) {
      return false;
    }

    // Outward past the outer shoulder without being close to the face.
    const headX = nose.x;
    const outward =
      side === "right"
        ? wrist.x - Math.max(shoulder.x, headX)
        : Math.min(shoulder.x, headX) - wrist.x;
    const dNose = hypot2(wrist.x, wrist.y, nose.x, nose.y);
    if (outward > 0.05 && dNose > 0.14) return false;

    const nearHead =
      wrist.y <= nose.y + 0.08 &&
      wrist.y <= topShoulderY + 0.01 &&
      reach >= 0.025 &&
      dNose <= 0.16 &&
      Math.abs(wrist.x - nose.x) <= 0.14;

    const highRaise =
      wrist.y < topShoulderY - margin &&
      wrist.y < midY - margin &&
      reach >= 0.045 &&
      up >= 0.05;

    // Any noticeable shoulder tilt: only accept clear hand-to-head, never geometry-only.
    if (tilt > 0.04 && !nearHead) return false;

    if (!highRaise && !nearHead) return false;

    if (opposite && visibleEnough(opposite, minVisibility * 0.8)) {
      if (side === "left" && wrist.x > opposite.x + 0.2) return false;
      if (side === "right" && wrist.x < opposite.x - 0.2) return false;
    }
    if (visibleEnough(elbow, minVisibility * 0.7)) {
      const upper = hypot2(shoulder.x, shoulder.y, elbow.x, elbow.y);
      const forearm = hypot2(elbow.x, elbow.y, wrist.x, wrist.y);
      if (upper > options.maxUpperArm || forearm > options.maxForearm) return false;
      const elbowOut =
        side === "right" ? elbow.x - shoulder.x : shoulder.x - elbow.x;
      if (elbowOut > 0.1 && sideways > up * 0.9 && !nearHead) return false;
    }
    return true;
  }

  // Primary signal: wrist clearly above same-side shoulder.
  if (wrist.y >= shoulder.y - margin) return false;

  if (!visibleEnough(elbow, minVisibility)) return false;

  if (
    !ownArmGeometry(shoulder, elbow, wrist, side, opposite, {
      minSegment: DEFAULTS.minSegment,
      maxUpperArm: options.maxUpperArm,
      maxForearm: options.maxForearm,
      maxWristFromShoulder: options.maxWristFromShoulder,
    })
  ) {
    return false;
  }

  const angle = elbowAngleDeg(shoulder, elbow, wrist);
  if (angle < options.minElbowDeg || angle > options.maxElbowDeg) return false;

  return true;
}

export function handsRaised(
  landmarks: readonly PoseLandmark[],
  options: HandRaiseOptions = {},
): HandsRaised {
  const classroom = !!options.classroom;
  const margin = options.margin ?? (classroom ? 0.025 : DEFAULTS.margin);
  const minVisibility = options.minVisibility ?? (classroom ? 0.28 : DEFAULTS.minVisibility);
  const otherLandmarks = options.otherLandmarks ?? [];
  const opts = {
    margin,
    minVisibility,
    otherLandmarks,
    maxWristFromShoulder:
      options.maxWristFromShoulder ?? (classroom ? 0.7 : DEFAULTS.maxWristFromShoulder),
    maxUpperArm: options.maxUpperArm ?? (classroom ? 0.55 : DEFAULTS.maxSegment),
    maxForearm: options.maxForearm ?? (classroom ? 0.55 : DEFAULTS.maxSegment),
    minElbowDeg: options.minElbowDeg ?? DEFAULTS.minElbowDeg,
    maxElbowDeg: options.maxElbowDeg ?? (classroom ? 175 : DEFAULTS.maxElbowDeg),
    classroom,
  };
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
