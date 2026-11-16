import { describe, expect, it } from "vitest";
import { POSE, type PoseLandmark } from "../../src/vision/detect/isHandRaised";
import {
  filterLikelyPersonPoses,
  isLikelyPersonPose,
} from "../../src/vision/detect/personPoseQuality";

function blank(): PoseLandmark[] {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
}

function seatedPerson(cx = 0.5): PoseLandmark[] {
  const pts = blank();
  pts[POSE.NOSE] = { x: cx, y: 0.22, visibility: 0.9 };
  pts[2] = { x: cx - 0.015, y: 0.21, visibility: 0.8 };
  pts[5] = { x: cx + 0.015, y: 0.21, visibility: 0.8 };
  pts[POSE.LEFT_SHOULDER] = { x: cx - 0.06, y: 0.36, visibility: 0.9 };
  pts[POSE.RIGHT_SHOULDER] = { x: cx + 0.06, y: 0.36, visibility: 0.9 };
  pts[POSE.LEFT_ELBOW] = { x: cx - 0.08, y: 0.48, visibility: 0.8 };
  pts[POSE.RIGHT_ELBOW] = { x: cx + 0.08, y: 0.48, visibility: 0.8 };
  pts[POSE.LEFT_WRIST] = { x: cx - 0.07, y: 0.58, visibility: 0.7 };
  pts[POSE.RIGHT_WRIST] = { x: cx + 0.07, y: 0.58, visibility: 0.7 };
  pts[23] = { x: cx - 0.05, y: 0.62, visibility: 0.75 };
  pts[24] = { x: cx + 0.05, y: 0.62, visibility: 0.75 };
  return pts;
}

/** Chair-like ghost: shoulders without a head, hips above torso. */
function chairGhost(cx = 0.3): PoseLandmark[] {
  const pts = blank();
  pts[POSE.NOSE] = { x: cx, y: 0.55, visibility: 0.05 };
  pts[POSE.LEFT_SHOULDER] = { x: cx - 0.03, y: 0.5, visibility: 0.35 };
  pts[POSE.RIGHT_SHOULDER] = { x: cx + 0.03, y: 0.48, visibility: 0.32 };
  pts[POSE.LEFT_WRIST] = { x: cx - 0.02, y: 0.52, visibility: 0.2 };
  pts[POSE.RIGHT_WRIST] = { x: cx + 0.04, y: 0.51, visibility: 0.15 };
  pts[23] = { x: cx - 0.04, y: 0.4, visibility: 0.4 };
  pts[24] = { x: cx + 0.04, y: 0.38, visibility: 0.4 };
  return pts;
}

/** Upper body only: desk hides hips (low / missing hip visibility). */
function deskUpperBody(cx = 0.5): PoseLandmark[] {
  const pts = seatedPerson(cx);
  pts[23] = { x: cx - 0.05, y: 0.7, visibility: 0.1 };
  pts[24] = { x: cx + 0.05, y: 0.7, visibility: 0.1 };
  return pts;
}

describe("isLikelyPersonPose", () => {
  it("accepts a seated person with head + shoulders + hips", () => {
    expect(isLikelyPersonPose(seatedPerson())).toBe(true);
  });

  it("rejects a chair-like ghost without a head", () => {
    expect(isLikelyPersonPose(chairGhost())).toBe(false);
  });

  it("accepts desk-occluded upper body without relying on hips", () => {
    expect(isLikelyPersonPose(deskUpperBody())).toBe(true);
  });

  it("accepts a distant wide-shot person with small shoulder span", () => {
    const pts = blank();
    pts[POSE.NOSE] = { x: 0.2, y: 0.42, visibility: 0.55 };
    pts[2] = { x: 0.195, y: 0.415, visibility: 0.4 };
    pts[5] = { x: 0.205, y: 0.415, visibility: 0.4 };
    pts[POSE.LEFT_SHOULDER] = { x: 0.185, y: 0.48, visibility: 0.5 };
    pts[POSE.RIGHT_SHOULDER] = { x: 0.215, y: 0.48, visibility: 0.5 };
    expect(isLikelyPersonPose(pts)).toBe(true);
  });

  it("rejects collapsed shoulder width", () => {
    const pts = seatedPerson();
    pts[POSE.LEFT_SHOULDER] = { x: 0.5, y: 0.36, visibility: 0.9 };
    pts[POSE.RIGHT_SHOULDER] = { x: 0.505, y: 0.36, visibility: 0.9 };
    expect(isLikelyPersonPose(pts)).toBe(false);
  });
  it("rejects chair backs with fabricated nose and shoulders but no visible eyes or ears", () => {
    const pts = seatedPerson();
    pts[2] = { x: 0.48, y: 0.21, visibility: 0.05 };
    pts[5] = { x: 0.52, y: 0.21, visibility: 0.05 };
    expect(isLikelyPersonPose(pts)).toBe(false);
  });
  it("counts visible shoulders without any face landmarks in shoulder mode", () => {
    const pts = seatedPerson();
    for (const i of [POSE.NOSE, 2, 5, 7, 8]) pts[i] = { x: 0.5, y: 0.2, visibility: 0 };
    expect(isLikelyPersonPose(pts, { shouldersOnly: true })).toBe(true);
    expect(isLikelyPersonPose(pts)).toBe(false);
  });
});

describe("filterLikelyPersonPoses", () => {
  it("drops chair ghosts while keeping real people", () => {
    const out = filterLikelyPersonPoses([
      { landmarks: seatedPerson(0.25) },
      { landmarks: chairGhost(0.55) },
      { landmarks: seatedPerson(0.75) },
    ]);
    expect(out).toHaveLength(2);
  });
});
