/**
 * Camera + MediaPipe raise loop (classroom vision page, or headless consumer).
 * Optional onHud supplies seats / scout poses for a detection overlay.
 */

import { FaceDetector, PoseLandmarker } from "@mediapipe/tasks-vision";
import { createFaceDetector, createFaceTrackState, locateFaces, trackFaceLocations } from "../vision/detect/faceLocator";
import {
  bindPosesToSeatsByIndex,
  bindPosesToLockedIndexes,
  createCountLockState,
  createPoseLandmarker,
  createSeatAnchors,
  dedupePosesByTorso,
  detectPosesMultiBand,
  filterLikelyPersonPoses,
  FULL_MODEL_URL,
  isLikelyPersonPose,
  NUMBERING_SCOUT_BANDS,
  numberPosesLeftToRight,
  observePersonCount,
  personBoxesFromSeats,
  personBoxesFromPoses,
  runMpOnPersonBoxes,
  framePixelsFromCanvas,
  filterPosesForLockedSeats,
  PoseTracker,
  SeatRaiseTracker,
  seatsToNumberingSlots,
  slotsFromSort,
  stabilizeScoutPoses,
  createScoutHoldState,
  startCamera,
  torsoCenter,
  unlockCountLock,
  type CameraHandle,
  type CountLockSnapshot,
  type PoseLandmark,
  type PoseFrame,
  type ScoutHoldState,
  type SeatAnchor,
  type SeatRaiseUpdate,
} from "../vision";
import type { RaiseRaceObservation } from "../round";
import { evaluateHandRaise } from "../vision/detect/raiseSignal";

const DETECT_INTERVAL_MS = 20;
const DETECT_INTERVAL_LOCKED_MS = 16;
/** Faster lock: fewer consecutive full frames, more gap tolerance for brief drops. */
const LOCK_STABLE_FRAMES = 4;
const LOCK_GAP_FRAMES = 4;
/** Short set-hold only — identity stability comes from PoseTracker (frame misses). */
const SCOUT_HOLD_MS = 280;
/** Wide classroom + LED wash: slightly lower = fewer misses; chairs still filtered by pose quality. */
const POSE_DETECT_CONFIDENCE = 0.35;
const POSE_PRESENCE_CONFIDENCE = 0.35;
const POSE_TRACK_CONFIDENCE = 0.35;
/** ~5 frames @20ms: hold a seat through a brief miss without feeling laggy. */
const SCOUT_TRACK_MAX_MISSED = 5;
const SCOUT_TRACK_MIN_SEEN = 2;
const RAISE_MARGIN = 0.01;
const RAISE_MIN_VISIBILITY = 0.25;
const RAISE_MIN_FRAMES = 2;
const RAISE_SCORE_THRESHOLD = 0.015;
/** Hold last pose briefly under bright-light flicker (people-fast parity). */
const TRACK_MAX_MISSED = 1;
const LOCKED_SCOUT_BANDS = [
  NUMBERING_SCOUT_BANDS[0]!,
  ...NUMBERING_SCOUT_BANDS.slice(-3),
];
const FACE_BANDS = [
  { x0: 0, x1: 1, y0: 0.15, y1: 0.75 },
  ...NUMBERING_SCOUT_BANDS.slice(-3),
];

export type RaiseHudPerson = {
  index: number;
  x: number;
  y: number;
  raised: boolean;
  score: number;
  landmarks: readonly PoseLandmark[] | null;
  faceBox?: { width: number; height: number };
};

export type RaiseHudFrame = {
  locked: boolean;
  expectedCount: number;
  people: RaiseHudPerson[];
};

export type BackgroundRaiseCallbacks = {
  onStatus?: (text: string) => void;
  onLocked?: (seats: number[]) => void;
  onCleared?: () => void;
  /** Fired each locked frame with raise edges ready for RaiseRaceRound.feed */
  onFrame?: (people: RaiseRaceObservation[], nowMs: number) => void;
  /** Optional preview overlay payload (scout while unlocking, seats when locked). */
  onHud?: (frame: RaiseHudFrame) => void;
};

export type BackgroundRaiseOptions = {
  expectedCount?: number;
  video: HTMLVideoElement;
  identityMode?: "pose" | "face";
};

export class BackgroundRaiseSession {
  private readonly video: HTMLVideoElement;
  private readonly expectedCount: number;
  private readonly identityMode: "pose" | "face";
  private readonly cb: BackgroundRaiseCallbacks;
  private readonly frameCanvas = document.createElement("canvas");
  private readonly cropCanvas = document.createElement("canvas");
  private readonly bandCanvas = document.createElement("canvas");
  private readonly faceCanvas = document.createElement("canvas");

  private camera: CameraHandle | null = null;
  private landmarker: PoseLandmarker | null = null;
  private faceDetector: FaceDetector | null = null;
  private raf = 0;
  private timer = 0;
  private lastTs = 0;
  private detectInFlight = false;
  private lockInFlight = false;
  private countLock: CountLockSnapshot = createCountLockState();
  private seatAnchors: SeatAnchor[] = [];
  private seatRaiseByIndex = new Map<number, SeatRaiseTracker>();
  private lastRaiseByIndex = new Map<number, SeatRaiseUpdate>();
  private scoutHold: ScoutHoldState<PoseFrame> = createScoutHoldState();
  private scoutTracker = new PoseTracker({
    matchDistance: 0.14,
    matchYWeight: 0.45,
    maxMissed: SCOUT_TRACK_MAX_MISSED,
    minSeen: SCOUT_TRACK_MIN_SEEN,
    stickyDisplay: true,
    minFrames: RAISE_MIN_FRAMES,
  });
  private faceTracks = createFaceTrackState();
  private running = false;
  private readonly onVisibilityChange = (): void => {
    if (!this.running) return;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.timer);
    this.scheduleNext();
  };

  constructor(opts: BackgroundRaiseOptions, callbacks: BackgroundRaiseCallbacks = {}) {
    this.video = opts.video;
    this.expectedCount = Math.min(6, Math.max(1, opts.expectedCount ?? 1));
    this.identityMode = opts.identityMode ?? "pose";
    this.cb = callbacks;
  }

  get locked(): boolean {
    return this.countLock.locked;
  }

  get seats(): number[] {
    return this.seatAnchors.map((s) => s.index);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.cb.onStatus?.("正在加载举手检测模型…");
    this.landmarker = await createPoseLandmarker({
      numPoses: 6,
      runningMode: "IMAGE",
      modelAssetPath: FULL_MODEL_URL,
      minPoseDetectionConfidence: POSE_DETECT_CONFIDENCE,
      minPosePresenceConfidence: POSE_PRESENCE_CONFIDENCE,
      minTrackingConfidence: POSE_TRACK_CONFIDENCE,
    });
    if (this.identityMode === "face") this.faceDetector = await createFaceDetector();
    this.cb.onStatus?.("正在打开相机…");
    this.camera = await startCamera(this.video);
    await this.waitForVideo();
    this.running = true;
    this.clearLock(false);
    this.lastTs = 0;
    this.cb.onStatus?.(`检测中 · 等待 ${this.expectedCount} 人稳定后锁定`);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.scheduleNext();
  }

  private waitForVideo(): Promise<void> {
    const v = this.video;
    if (v.readyState >= 2 && v.videoWidth > 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("相机画面超时未就绪"));
      }, 8000);
      const onReady = () => {
        if (v.videoWidth <= 0) return;
        cleanup();
        resolve();
      };
      const cleanup = () => {
        window.clearTimeout(timer);
        v.removeEventListener("loadeddata", onReady);
        v.removeEventListener("playing", onReady);
      };
      v.addEventListener("loadeddata", onReady);
      v.addEventListener("playing", onReady);
      void v.play().catch(() => undefined);
    });
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.timer);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.raf = 0;
    this.timer = 0;
    this.running = false;
    this.camera?.stop();
    this.camera = null;
    this.landmarker?.close();
    this.landmarker = null;
    this.faceDetector?.close();
    this.faceDetector = null;
    this.clearLock(true);
    this.cb.onStatus?.("检测已停止");
  }

  private clearLock(announce: boolean): void {
    this.countLock = unlockCountLock(this.countLock);
    this.seatAnchors = [];
    this.seatRaiseByIndex = new Map();
    this.lastRaiseByIndex = new Map();
    this.scoutHold = createScoutHoldState();
    this.faceTracks = createFaceTrackState();
    this.lockInFlight = false;
    if (announce) this.cb.onCleared?.();
  }

  private scoutPosesRaw(bands = NUMBERING_SCOUT_BANDS) {
    if (!this.landmarker) return [];
    const raw = detectPosesMultiBand(
      this.landmarker,
      this.video,
      this.frameCanvas,
      this.bandCanvas,
      bands,
    );
    const people = filterLikelyPersonPoses(raw, this.identityMode === "pose"
      ? { shouldersOnly: true }
      : this.countLock.locked ? { minFaceLandmarks: 0, minNoseVis: 0.15 } : {});
    return dedupePosesByTorso(people, {
      minDistance: this.countLock.locked ? 0.05 : 0.1,
      minSeparationX: this.countLock.locked ? 0.025 : 0.05,
      yWeight: 0.45,
    });
  }

  private scoutPoses() {
    const live = this.scoutPosesRaw();
    const stabilized = stabilizeScoutPoses(live, this.scoutHold, performance.now(), {
      minCount: this.expectedCount,
      holdMs: SCOUT_HOLD_MS,
    });
    this.scoutHold = stabilized.hold;
    return stabilized.poses;
  }

  private applyLock(
    numbered: { index: number; x: number; y: number }[],
  ): void {
    if (this.seatAnchors.length > 0) return;
    this.countLock = {
      locked: true,
      streak: 1,
      lastCount: numbered.length,
      gapFrames: 0,
    };
    const slots = slotsFromSort(
      numbered.map((p) => ({ index: p.index, x: p.x, y: p.y, id: p.index })),
    );
    this.seatAnchors = createSeatAnchors(slots, { minFrames: RAISE_MIN_FRAMES });
    this.seatRaiseByIndex = new Map(
      this.seatAnchors.map((s) => [
        s.index,
        new SeatRaiseTracker({
          seatIndex: s.index,
          minFrames: RAISE_MIN_FRAMES,
          scoreThreshold: RAISE_SCORE_THRESHOLD,
          smoothAlpha: 0.7,
          // Pose-only build: ignore white paddle; keep weights ready if paddle returns.
          requirePaddle: false,
          requirePoseForPaddle: false,
          allowPoseFallback: true,
          paddleOptions: {
            poseWeight: 0.9,
            colorWeight: 0.1,
          },
          raiseOptions: {
            classroom: true,
            margin: RAISE_MARGIN,
            minVisibility: RAISE_MIN_VISIBILITY,
          },
        }),
      ]),
    );
    this.lastRaiseByIndex = new Map();
    this.cb.onLocked?.(this.seatAnchors.map((s) => s.index));
    this.cb.onStatus?.(
      `已锁定 ${numbered.length} 人 · 读题倒计时后判定抢答`,
    );
  }

  private emitHud(
    people: RaiseHudPerson[],
    locked: boolean = this.countLock.locked,
  ): void {
    this.cb.onHud?.({
      locked,
      expectedCount: this.expectedCount,
      people,
    });
  }

  private indexedFromCascade(
    poses: readonly { box: { index?: number | null }; landmarks: readonly PoseLandmark[] }[],
  ) {
    const out: Array<{
      index: number;
      x: number;
      y: number;
      landmarks: readonly PoseLandmark[];
    }> = [];
    for (const p of poses) {
      const index = p.box.index;
      if (index == null) continue;
      if (!isLikelyPersonPose(p.landmarks, this.identityMode === "pose"
        ? { shouldersOnly: true }
        : this.countLock.locked ? { minFaceLandmarks: 0, minNoseVis: 0.15 } : {})) continue;
      const c = torsoCenter(p.landmarks);
      out.push({ index, x: c.x, y: c.y, landmarks: p.landmarks });
    }
    return out;
  }

  /** Keep paddle pixels in sync with the live camera even if scout skipped a draw. */
  private syncFramePixels(): ReturnType<typeof framePixelsFromCanvas> {
    const v = this.video;
    const vw = v.videoWidth || 0;
    const vh = v.videoHeight || 0;
    if (vw < 2 || vh < 2) return framePixelsFromCanvas(this.frameCanvas);
    if (this.frameCanvas.width !== vw || this.frameCanvas.height !== vh) {
      this.frameCanvas.width = vw;
      this.frameCanvas.height = vh;
    }
    const ctx = this.frameCanvas.getContext("2d", { willReadFrequently: true });
    if (ctx) ctx.drawImage(v, 0, 0, vw, vh);
    return framePixelsFromCanvas(this.frameCanvas);
  }

  private updateRaises(nowMs: number): RaiseRaceObservation[] {
    const frame = this.syncFramePixels();
    const withLm = this.seatAnchors.filter((s) => s.landmarks);
    for (const seat of this.seatAnchors) {
      const tracker = this.seatRaiseByIndex.get(seat.index);
      if (!tracker) continue;
      const neighborLms = withLm
        .filter((s) => s.index !== seat.index)
        .map((s) => s.landmarks!);
      const upd = tracker.update(seat.fresh ? seat.landmarks : null, nowMs, {
        otherLandmarks: neighborLms,
        frame,
      });
      this.lastRaiseByIndex.set(seat.index, upd);
    }
    return this.seatAnchors.map((s) => {
      const u = this.lastRaiseByIndex.get(s.index);
      return {
        personIndex: s.index,
        raised: !!u?.raised,
        score: u?.score ?? 0,
        edgeAtMs: u?.edgeAtMs,
      };
    });
  }

  private scheduleNext(): void {
    if (!this.running) return;
    if (document.hidden) {
      // requestAnimationFrame pauses in background tabs; camera capture stays active.
      this.timer = window.setTimeout(() => this.loop(performance.now()), DETECT_INTERVAL_LOCKED_MS);
    } else {
      this.raf = requestAnimationFrame((t) => this.loop(t));
    }
  }

  private loop(nowMs: number): void {
    this.scheduleNext();
    if (!this.running || !this.landmarker || this.video.readyState < 2) return;
    const interval = this.countLock.locked ? DETECT_INTERVAL_LOCKED_MS : DETECT_INTERVAL_MS;
    if (nowMs - this.lastTs < interval) return;
    this.lastTs = nowMs;
    if (this.detectInFlight) return;
    this.detectInFlight = true;
    try {
      if (!this.countLock.locked) {
        if (this.identityMode === "face" && this.faceDetector) {
          const detected = locateFaces(this.faceDetector, this.video, this.faceCanvas, FACE_BANDS, this.expectedCount);
          const tracked = trackFaceLocations(this.faceTracks, detected);
          this.faceTracks = tracked.state;
          const faces = tracked.stable;
          const numbered = faces.map((p, i) => ({ index: i + 1, x: p.x, y: p.y }));
          const observed = observePersonCount(this.countLock, faces.length, {
            expectedCount: this.expectedCount,
            minStableFrames: LOCK_STABLE_FRAMES,
            maxGapFrames: LOCK_GAP_FRAMES,
          });
          this.countLock = observed.state;
          this.emitHud(faces.map((p, i) => ({
            index: i + 1, x: p.x, y: p.y, raised: false, score: 0,
            landmarks: null, faceBox: { width: p.width, height: p.height },
          })), false);
          if (observed.shouldLock && faces.length === this.expectedCount) {
            // Face centers identify the seats, while Pose crops and matching use
            // torso centers. Keep face order and attach the nearest live torso.
            const poses = this.scoutPosesRaw();
            const free = poses.map((p) => ({ ...p, used: false }));
            const torsoSeats = numbered.map((seat) => {
              let best = -1;
              let bestDx = 0.12;
              for (let i = 0; i < free.length; i++) {
                if (free[i]!.used) continue;
                const center = torsoCenter(free[i]!.landmarks);
                const dx = Math.abs(center.x - seat.x);
                if (dx < bestDx && center.y > seat.y - 0.03 && center.y < seat.y + 0.4) {
                  best = i;
                  bestDx = dx;
                }
              }
              if (best < 0) return { ...seat, y: Math.min(0.9, seat.y + 0.18) };
              free[best]!.used = true;
              const center = torsoCenter(free[best]!.landmarks);
              return { ...seat, x: center.x, y: center.y };
            });
            this.applyLock(torsoSeats);
          } else {
            this.cb.onStatus?.(`人脸定位 ${faces.length}/${this.expectedCount} · 稳定后锁定编号`);
          }
          return;
        }
        const scout = this.scoutPoses();
        const numbered = numberPosesLeftToRight(scout, this.expectedCount);
        const observed = observePersonCount(this.countLock, numbered.length, {
          expectedCount: this.expectedCount,
          minStableFrames: LOCK_STABLE_FRAMES,
          maxGapFrames: LOCK_GAP_FRAMES,
        });
        this.countLock = observed.state;
        this.emitHud(
          numbered.map((p) => ({
            index: p.index,
            x: p.x,
            y: p.y,
            raised: false,
            score: 0,
            landmarks: p.landmarks,
          })),
          false,
        );
        if (observed.shouldLock && !this.lockInFlight && numbered.length >= this.expectedCount) {
          this.lockInFlight = true;
          const take = numbered.slice(0, this.expectedCount);
          const boxes = personBoxesFromPoses(take);
          const cascade = runMpOnPersonBoxes({
            landmarker: this.landmarker,
            frameCanvas: this.frameCanvas,
            cropCanvas: this.cropCanvas,
            source: this.video,
            boxes,
          });
          const refined = this.indexedFromCascade(cascade.poses);
          const byIndex = new Map(refined.map((p) => [p.index, p]));
          this.applyLock(take.map((p) => byIndex.get(p.index) ?? p));
          this.scoutHold = createScoutHoldState();
          this.lockInFlight = false;
        } else {
          this.cb.onStatus?.(
            `检测 ${numbered.length}/${this.expectedCount} · 稳定后锁定编号`,
          );
        }
        return;
      }

      // people-fast parity: always near-zoom each seat, then refill misses from scout.
      const boxes = personBoxesFromSeats(this.seatAnchors);
      const cascade = runMpOnPersonBoxes({
        landmarker: this.landmarker,
        frameCanvas: this.frameCanvas,
        cropCanvas: this.cropCanvas,
        source: this.video,
        boxes,
      });
      let indexedPoses = filterPosesForLockedSeats(
        this.seatAnchors, this.indexedFromCascade(cascade.poses),
      );
      const scout = this.scoutPosesRaw(LOCKED_SCOUT_BANDS);
      const scoutIndexed = filterPosesForLockedSeats(
        this.seatAnchors,
        bindPosesToLockedIndexes(this.seatAnchors, scout, 0.14),
      );
      // A raised wrist can leave the isolated crop. Prefer a matching full-frame
      // pose only when its own arm clearly passes the raise predicate.
      const cropByIndex = new Map(indexedPoses.map((p) => [p.index, p]));
      for (const p of scoutIndexed) {
        const others = scoutIndexed.filter((s) => s.index !== p.index).map((s) => s.landmarks);
        const options = { classroom: true, margin: RAISE_MARGIN,
          minVisibility: RAISE_MIN_VISIBILITY, otherLandmarks: others };
        const scoutRaise = evaluateHandRaise(p.landmarks, options);
        const crop = cropByIndex.get(p.index);
        if (!crop || (scoutRaise.raised && !evaluateHandRaise(crop.landmarks, options).raised)) {
          cropByIndex.set(p.index, p);
        }
      }
      indexedPoses = [...cropByIndex.values()];
      this.seatAnchors = bindPosesToSeatsByIndex(this.seatAnchors, indexedPoses, {
        maxMissed: TRACK_MAX_MISSED,
      });
      void seatsToNumberingSlots(this.seatAnchors);
      const people = this.updateRaises(nowMs);
      this.emitHud(
        this.seatAnchors.map((s) => {
          const u = this.lastRaiseByIndex.get(s.index);
          return {
            index: s.index,
            x: s.x,
            y: s.y,
            raised: !!u?.raised,
            score: u?.score ?? 0,
            landmarks: s.fresh ? s.landmarks : null,
          };
        }),
      );
      this.cb.onFrame?.(people, nowMs);
    } finally {
      this.detectInFlight = false;
    }
  }
}
