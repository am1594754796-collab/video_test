/**
 * Vision Recognition module — hand-raise detection with MediaPipe Pose.
 * Scoring / round flow live outside this package.
 */

export { isHandRaised, POSE, type HandRaiseOptions, type PoseLandmark } from "./detect/isHandRaised";
export { RaiseDebouncer, type RaiseDebouncerOptions } from "./detect/raiseDebouncer";
export { dedupePosesByTorso, torsoCenter, type DedupeOptions } from "./detect/dedupePoses";
export { PoseTracker, type TrackedPose, type PoseTrackerOptions } from "./detect/poseTracker";
export {
  FirstRaiseTracker,
  type FirstRaiseEvent,
  type RaiseObservation,
} from "./detect/firstRaiseTracker";
export {
  createCountLockState,
  observePersonCount,
  unlockCountLock,
  type CountLockOptions,
  type CountLockSnapshot,
} from "./detect/countLock";
export {
  slotsFromSort,
  rebindSlotsToTracks,
  shouldRefreshCloudFaces,
  indexByTrackIdFromSlots,
  countSlotsWithFace,
  type NumberingSlot,
  type TrackPoint,
  type RebindOptions,
} from "./detect/numberingSlots";
export {
  type FaceBox,
} from "./detect/faceDetector";
export {
  extractFaceDescriptor,
  cosineSimilarity,
  pickFaceForPerson,
  assignFaceDescriptorsToTracks,
  type FaceDescriptor,
} from "./detect/faceDescriptor";
export {
  createPoseLandmarker,
  detectPosesForVideo,
  DEFAULT_MODEL_URL,
  DEFAULT_WASM_ROOT,
  type PoseFrame,
  type PoseLandmarkerConfig,
} from "./detect/poseLandmarker";
export { startCamera, type CameraHandle } from "./camera/startCamera";
