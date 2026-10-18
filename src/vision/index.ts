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
  createScoutHoldState,
  stabilizeScoutPoses,
  type ScoutHoldState,
  type StabilizeScoutOptions,
} from "./detect/scoutHold";
export {
  slotsFromSort,
  rebindSlotsToTracks,
  indexByTrackIdFromSlots,
  type NumberingSlot,
  type TrackPoint,
  type RebindOptions,
} from "./detect/numberingSlots";
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
  NUMBERING_SCOUT_BANDS,
  REMOTE_LITE_MODEL_URL,
  REMOTE_FULL_MODEL_URL,
  REMOTE_HEAVY_MODEL_URL,
  type PoseFrame,
  type PoseLandmarkerConfig,
  type SeatCropHint,
  type SeatCropOptions,
} from "./detect/poseLandmarker";
export {
  boxCenter,
  isolateRowCrops,
  selectPersonRow,
  type PersonBox,
} from "./detect/personBox";
export { BoxTracker, type TrackedBox } from "./detect/boxTracker";
export {
  detectPoseInPersonBox,
  detectPosesFromPersonBoxes,
  mapLandmarksFromCrop,
  type CascadePose,
} from "./detect/cascadePose";
export {
  numberPosesLeftToRight,
  personBoxFromLandmarks,
  personBoxesFromPoses,
  personBoxesFromSeats,
  bindPosesToLockedIndexes,
  mergeCropPosesWithScout,
  type IndexedPose,
} from "./detect/personSplit";
export {
  runMpOnPersonBoxes,
  type PersonMpResult,
} from "./detect/personMpCascade";
export {
  dedupeRowPoses,
  collapseByMinGapX,
  selectPosesBySeatBins,
  type RowSelectOptions,
} from "./detect/rowPoseSelect";
export {
  createSeatAnchors,
  matchDetectionsToSeats,
  bindPosesToSeatsByIndex,
  seatsToNumberingSlots,
  type SeatAnchor,
  type SeatDetection,
} from "./detect/seatAnchors";
export { emaBlendLandmarks } from "./detect/landmarkSmooth";
export {
  evaluateHandRaise,
  shoulderMidline,
  isArmVertical,
  isCompactHeadRaise,
  isLateralArmNotRaise,
  DEFAULT_RAISE_MARGIN,
  SeatRaiseTracker,
  type RaiseEval,
  type SeatRaiseUpdate,
  type SeatRaiseFrameContext,
  type SeatRaiseTrackerOptions,
} from "./detect/raiseSignal";
export {
  SEAT_PADDLE_COLORS,
  PADDLE_COLOR_LABELS,
  paddleColorForSeat,
  paddleColorLabelForSeat,
  type PaddleColor,
} from "./detect/paddleColors";
export {
  evaluatePaddleRaise,
  framePixelsFromCanvas,
  paddleSearchRoi,
  pixelMatchesPaddleColor,
  scorePaddleColor,
  weakPoseAssist,
  type FramePixels,
  type PaddleRaiseEval,
  type PaddleRaiseOptions,
} from "./detect/paddleSignal";
export { startCamera, type CameraHandle } from "./camera/startCamera";
