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

/** Stable reject / accept codes for classroom raise diagnostics. */
export type SideRaiseReason =
  | "ok"
  | "low_visibility"
  | "neighbor_wrist"
  | "reach_too_far"
  | "wrist_below_elbow"
  | "wrist_too_low"
  | "too_sideways"
  | "no_nose"
  | "wrist_chest_level"
  | "outward_not_near_head"
  | "tilt_without_near_head"
  | "no_raise_pattern"
  | "crossed_midline"
  | "arm_segment_too_long"
  | "elbow_out_sideways"
  | "elbow_low_visibility"
  | "bad_arm_geometry"
  | "elbow_angle"
  | "below_shoulder_margin";

export type SideRaiseMetrics = {
  shoulderVis: number;
  wristVis: number;
  elbowVis: number;
  up: number;
  sideways: number;
  reach: number;
  wristY: number;
  shoulderY: number;
  elbowY: number;
  noseY: number | null;
  minUp: number;
  wristSlack: number;
};

export type SideRaiseDiagnosis = {
  side: "left" | "right";
  raised: boolean;
  reason: SideRaiseReason;
  metrics: SideRaiseMetrics | null;
};

export type HandRaiseDiagnosis = {
  raised: boolean;
  left: SideRaiseDiagnosis;
  right: SideRaiseDiagnosis;
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

type SideRaiseOpts = Required<Pick<HandRaiseOptions, "margin" | "minVisibility">> & {
  otherLandmarks: readonly (readonly PoseLandmark[])[];
  maxWristFromShoulder: number;
  maxUpperArm: number;
  maxForearm: number;
  minElbowDeg: number;
  maxElbowDeg: number;
  classroom: boolean;
};

function emptyMetrics(): SideRaiseMetrics {
  return {
    shoulderVis: 0,
    wristVis: 0,
    elbowVis: 0,
    up: 0,
    sideways: 0,
    reach: 0,
    wristY: 0,
    shoulderY: 0,
    elbowY: 0,
    noseY: null,
    minUp: 0,
    wristSlack: 0,
  };
}

function resolveRaiseOpts(options: HandRaiseOptions = {}): SideRaiseOpts {
  const classroom = !!options.classroom;
  return {
    margin: options.margin ?? (classroom ? 0.025 : DEFAULTS.margin),
    minVisibility: options.minVisibility ?? (classroom ? 0.28 : DEFAULTS.minVisibility),
    otherLandmarks: options.otherLandmarks ?? [],
    maxWristFromShoulder:
      options.maxWristFromShoulder ?? (classroom ? 0.7 : DEFAULTS.maxWristFromShoulder),
    maxUpperArm: options.maxUpperArm ?? (classroom ? 0.55 : DEFAULTS.maxSegment),
    maxForearm: options.maxForearm ?? (classroom ? 0.55 : DEFAULTS.maxSegment),
    minElbowDeg: options.minElbowDeg ?? DEFAULTS.minElbowDeg,
    maxElbowDeg: options.maxElbowDeg ?? (classroom ? 175 : DEFAULTS.maxElbowDeg),
    classroom,
  };
}

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
    if (dOther + 0.04 >= dSelf) continue;
    // A raised hand can pass nearer a neighbor's torso in a tight row.
    // Reject only when that neighbor's skeleton also owns this wrist.
    for (const i of [POSE.LEFT_WRIST, POSE.RIGHT_WRIST]) {
      const otherWrist = other[i];
      if (otherWrist && (otherWrist.visibility ?? 0) >= 0.35 &&
          hypot2(wrist.x, wrist.y, otherWrist.x, otherWrist.y) < 0.035) return true;
    }
  }
  return false;
}

function diagnoseSideRaised(
  landmarks: readonly PoseLandmark[],
  side: "left" | "right",
  options: SideRaiseOpts,
): SideRaiseDiagnosis {
  const shoulder = landmarks[side === "left" ? POSE.LEFT_SHOULDER : POSE.RIGHT_SHOULDER];
  const elbow = landmarks[side === "left" ? POSE.LEFT_ELBOW : POSE.RIGHT_ELBOW];
  const wrist = landmarks[side === "left" ? POSE.LEFT_WRIST : POSE.RIGHT_WRIST];
  const opposite = landmarks[side === "left" ? POSE.RIGHT_SHOULDER : POSE.LEFT_SHOULDER];
  const { margin, minVisibility, otherLandmarks, classroom } = options;
  const fail = (reason: SideRaiseReason, metrics: SideRaiseMetrics | null = null): SideRaiseDiagnosis =>
    ({ side, raised: false, reason, metrics });
  const ok = (metrics: SideRaiseMetrics): SideRaiseDiagnosis =>
    ({ side, raised: true, reason: "ok", metrics });

  const baseMetrics = (): SideRaiseMetrics => ({
    ...emptyMetrics(),
    shoulderVis: shoulder?.visibility ?? 0,
    wristVis: wrist?.visibility ?? 0,
    elbowVis: elbow?.visibility ?? 0,
    wristY: wrist?.y ?? 0,
    shoulderY: shoulder?.y ?? 0,
    elbowY: elbow?.y ?? 0,
    noseY: landmarks[POSE.NOSE]?.y ?? null,
  });

  if (!visibleEnough(shoulder, minVisibility) || !visibleEnough(wrist, minVisibility)) {
    return fail("low_visibility", baseMetrics());
  }

  if (wristCloserToNeighbor(wrist, torsoCenter(landmarks), otherLandmarks)) {
    return fail("neighbor_wrist", baseMetrics());
  }

  const reach = hypot2(shoulder.x, shoulder.y, wrist.x, wrist.y);
  if (reach > options.maxWristFromShoulder) {
    return fail("reach_too_far", { ...baseMetrics(), reach });
  }

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
    const bodyScale = Math.max(
      0.02,
      opposite ? Math.abs(opposite.x - shoulder.x) : 0,
      nose ? Math.abs(shoulder.y - nose.y) : 0,
    );
    const minUp = Math.max(0.012, bodyScale * 0.22);
    // MediaPipe tracks the wrist, not fingertips. A real raise often shows fingers
    // above the shoulder while the wrist sits slightly below — allow a small slack.
    const wristSlack = Math.max(0.03, bodyScale * 0.4);
    const up = shoulder.y - wrist.y;
    const sideways = Math.abs(wrist.x - shoulder.x);
    const metrics: SideRaiseMetrics = {
      ...baseMetrics(),
      up,
      sideways,
      reach,
      minUp,
      wristSlack,
    };

    // Chair lean / arm on armrest: elbow high, hand hangs down → never a raise.
    if (visibleEnough(elbow, minVisibility * 0.45) && wrist.y > elbow.y + 0.015) {
      return fail("wrist_below_elbow", metrics);
    }

    // Must be more upward than sideways (rejects torso lean with arm out to the side).
    if (up < -wristSlack) return fail("wrist_too_low", metrics);
    const clearlyHigh = !!nose && visibleEnough(nose, minVisibility * 0.45) &&
      visibleEnough(elbow, minVisibility) &&
      up >= Math.max(0.035, bodyScale * 0.5) &&
      wrist.y <= nose.y + bodyScale * 0.2 &&
      wrist.y < elbow.y - minUp * 0.5 &&
      sideways <= Math.max(up, minUp) * 2.4 &&
      hypot2(elbow.x, elbow.y, wrist.x, wrist.y) >= bodyScale * 0.15;
    if (clearlyHigh) return ok(metrics);
    if (up >= minUp && sideways > up * 1.4) return fail("too_sideways", metrics);

    // Raised hand must reach the head / upper-shoulder band (chest-level fails).
    if (!nose || !visibleEnough(nose, minVisibility * 0.45)) {
      return fail("no_nose", metrics);
    }
    if (wrist.y > Math.max(nose.y + 0.1, topShoulderY + wristSlack)) {
      return fail("wrist_chest_level", metrics);
    }

    // Outward past the outer shoulder without being close to the face.
    const headX = nose.x;
    const outward =
      side === "right"
        ? wrist.x - Math.max(shoulder.x, headX)
        : Math.min(shoulder.x, headX) - wrist.x;
    const dNose = hypot2(wrist.x, wrist.y, nose.x, nose.y);
    if (outward > 0.05 && dNose > 0.14) return fail("outward_not_near_head", metrics);

    const nearHead =
      wrist.y <= nose.y + 0.08 &&
      wrist.y <= topShoulderY + 0.01 &&
      reach >= 0.025 &&
      dNose <= 0.16 &&
      Math.abs(wrist.x - nose.x) <= 0.14;

    // Wrist at / slightly below shoulder but bent up toward the head (fingers often clear).
    // Elbow must also be up near the shoulder band — rejects a floating wrist on a hanging arm.
    const elbowRaised =
      visibleEnough(elbow, minVisibility * 0.5) &&
      elbow.y <= shoulder.y + Math.max(0.05, bodyScale * 0.45) &&
      wrist.y < elbow.y - 0.008;
    const shoulderBandRaise =
      up < minUp &&
      up >= -wristSlack &&
      elbowRaised &&
      wrist.y <= topShoulderY + wristSlack &&
      reach >= 0.025 &&
      sideways <= Math.max(bodyScale * 1.8, 0.08) &&
      (nearHead || (dNose <= 0.22 && Math.abs(wrist.x - nose.x) <= 0.18));

    const highRaise =
      wrist.y < topShoulderY - margin &&
      wrist.y < midY - margin &&
      reach >= 0.045 &&
      up >= minUp;

    // Any noticeable shoulder tilt: only accept clear hand-to-head, never geometry-only.
    if (tilt > 0.04 && !nearHead) return fail("tilt_without_near_head", metrics);

    if (!highRaise && !nearHead && !shoulderBandRaise) {
      return fail("no_raise_pattern", metrics);
    }

    if (opposite && visibleEnough(opposite, minVisibility * 0.8)) {
      if (side === "left" && wrist.x > opposite.x + 0.2) {
        return fail("crossed_midline", metrics);
      }
      if (side === "right" && wrist.x < opposite.x - 0.2) {
        return fail("crossed_midline", metrics);
      }
    }
    if (visibleEnough(elbow, minVisibility * 0.7)) {
      const upper = hypot2(shoulder.x, shoulder.y, elbow.x, elbow.y);
      const forearm = hypot2(elbow.x, elbow.y, wrist.x, wrist.y);
      if (upper > options.maxUpperArm || forearm > options.maxForearm) {
        return fail("arm_segment_too_long", metrics);
      }
      const elbowOut =
        side === "right" ? elbow.x - shoulder.x : shoulder.x - elbow.x;
      // Only apply when the wrist is clearly above the shoulder; with slight-below
      // slack, up is ~0/negative and would falsely trip every bent arm.
      if (up >= minUp && elbowOut > 0.1 && sideways > up * 0.9 && !nearHead) {
        return fail("elbow_out_sideways", metrics);
      }
    }
    return ok(metrics);
  }

  const up = shoulder.y - wrist.y;
  const sideways = Math.abs(wrist.x - shoulder.x);
  const metrics: SideRaiseMetrics = {
    ...baseMetrics(),
    up,
    sideways,
    reach,
  };

  // Primary signal: wrist clearly above same-side shoulder.
  if (wrist.y >= shoulder.y - margin) return fail("below_shoulder_margin", metrics);

  if (!visibleEnough(elbow, minVisibility)) return fail("elbow_low_visibility", metrics);

  if (
    !ownArmGeometry(shoulder, elbow, wrist, side, opposite, {
      minSegment: DEFAULTS.minSegment,
      maxUpperArm: options.maxUpperArm,
      maxForearm: options.maxForearm,
      maxWristFromShoulder: options.maxWristFromShoulder,
    })
  ) {
    return fail("bad_arm_geometry", metrics);
  }

  const angle = elbowAngleDeg(shoulder, elbow, wrist);
  if (angle < options.minElbowDeg || angle > options.maxElbowDeg) {
    return fail("elbow_angle", metrics);
  }

  return ok(metrics);
}

function sideRaised(
  landmarks: readonly PoseLandmark[],
  side: "left" | "right",
  options: SideRaiseOpts,
): boolean {
  return diagnoseSideRaised(landmarks, side, options).raised;
}

export function handsRaised(
  landmarks: readonly PoseLandmark[],
  options: HandRaiseOptions = {},
): HandsRaised {
  const opts = resolveRaiseOpts(options);
  return {
    left: sideRaised(landmarks, "left", opts),
    right: sideRaised(landmarks, "right", opts),
  };
}

/**
 * Same predicate as `handsRaised`, plus reject/accept reason + geometry for logs.
 */
export function diagnoseHandRaise(
  landmarks: readonly PoseLandmark[],
  options: HandRaiseOptions = {},
): HandRaiseDiagnosis {
  const opts = resolveRaiseOpts(options);
  const left = diagnoseSideRaised(landmarks, "left", opts);
  const right = diagnoseSideRaised(landmarks, "right", opts);
  return { raised: left.raised || right.raised, left, right };
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
