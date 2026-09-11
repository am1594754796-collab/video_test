/**
 * Vision Recognition module — hand-raise detection with MediaPipe Pose.
 * Scoring / round flow live outside this package.
 */

export { isHandRaised, handsRaised, POSE, type HandRaiseOptions, type PoseLandmark, type HandsRaised } from "./detect/isHandRaised";
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
  detectPosesMultiBand,
  detectPoseInSeatCrop,
  refineSeatsWithCrops,
  DEFAULT_MODEL_URL,
  FULL_MODEL_URL,
  HEAVY_MODEL_URL,
  DEFAULT_WASM_ROOT,
  REMOTE_LITE_MODEL_URL,
  REMOTE_FULL_MODEL_URL,
  REMOTE_HEAVY_MODEL_URL,
  type PoseFrame,
  type PoseLandmarkerConfig,
  type SeatCropHint,
  type SeatCropOptions,
} from "./detect/poseLandmarker";
export {
  dedupeRowPoses,
  collapseByMinGapX,
  selectPosesBySeatBins,
  type RowSelectOptions,
} from "./detect/rowPoseSelect";
export {
  createSeatAnchors,
  matchDetectionsToSeats,
  seatsToNumberingSlots,
  type SeatAnchor,
  type SeatDetection,
} from "./detect/seatAnchors";
export { emaBlendLandmarks } from "./detect/landmarkSmooth";
export {
  evaluateHandRaise,
  shoulderMidline,
  SeatRaiseTracker,
  type RaiseEval,
  type SeatRaiseUpdate,
} from "./detect/raiseSignal";
export { startCamera, type CameraHandle } from "./camera/startCamera";
