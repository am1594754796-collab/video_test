/**
 * Vision Recognition module — hand-raise detection with MediaPipe Pose.
 * Scoring / round flow live outside this package.
 */

export { isHandRaised, POSE, type HandRaiseOptions, type PoseLandmark } from "./detect/isHandRaised";
export { RaiseDebouncer, type RaiseDebouncerOptions } from "./detect/raiseDebouncer";
export { dedupePosesByTorso, torsoCenter, type DedupeOptions } from "./detect/dedupePoses";
export { PoseTracker, type TrackedPose, type PoseTrackerOptions } from "./detect/poseTracker";
export {
  createPoseLandmarker,
  detectPosesForVideo,
  DEFAULT_MODEL_URL,
  DEFAULT_WASM_ROOT,
  type PoseFrame,
  type PoseLandmarkerConfig,
} from "./detect/poseLandmarker";
export { startCamera, type CameraHandle } from "./camera/startCamera";
