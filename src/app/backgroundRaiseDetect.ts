/**
 * Background camera + MediaPipe raise loop for the speech page.
 * No HUD — only seat lock + per-frame raise observations.
 */

import { PoseLandmarker } from "@mediapipe/tasks-vision";
import {
  bindPosesToSeatsByIndex,
  createCountLockState,
  createPoseLandmarker,
  createScoutHoldState,
  createSeatAnchors,
  dedupePosesByTorso,
  detectPosesMultiBand,
  FULL_MODEL_URL,
  mergeCropPosesWithScout,
  NUMBERING_SCOUT_BANDS,
  numberPosesLeftToRight,
  observePersonCount,
  personBoxesFromPoses,
  personBoxesFromSeats,
  runMpOnPersonBoxes,
  framePixelsFromCanvas,
  SeatRaiseTracker,
  seatsToNumberingSlots,
  slotsFromSort,
  stabilizeScoutPoses,
  startCamera,
  torsoCenter,
  unlockCountLock,
  type CameraHandle,
  type CountLockSnapshot,
  type PoseFrame,
  type PoseLandmark,
  type ScoutHoldState,
  type SeatAnchor,
  type SeatRaiseUpdate,
} from "../vision";
import { POSE } from "../vision/detect/isHandRaised";
import type { RaiseRaceObservation } from "../round";

const DETECT_INTERVAL_MS = 20;
const DETECT_INTERVAL_LOCKED_MS = 16;
const LOCK_STABLE_FRAMES = 4;
const LOCK_GAP_FRAMES = 2;
const SCOUT_HOLD_MS = 380;
const RAISE_MARGIN = 0.01;
const RAISE_MIN_VISIBILITY = 0.15;
const RAISE_MIN_FRAMES = 1;
const RAISE_SCORE_THRESHOLD = 0.015;
const TRACK_MAX_MISSED = 48;

export type BackgroundRaiseCallbacks = {
  onStatus?: (text: string) => void;
  onLocked?: (seats: number[]) => void;
  onCleared?: () => void;
  /** Fired each locked frame with raise edges ready for RaiseRaceRound.feed */
  onFrame?: (people: RaiseRaceObservation[], nowMs: number) => void;
};

export type BackgroundRaiseOptions = {
  expectedCount?: number;
  video: HTMLVideoElement;
};

export class BackgroundRaiseSession {
  private readonly video: HTMLVideoElement;
  private readonly expectedCount: number;
  private readonly cb: BackgroundRaiseCallbacks;
  private readonly frameCanvas = document.createElement("canvas");
  private readonly cropCanvas = document.createElement("canvas");
  private readonly bandCanvas = document.createElement("canvas");

  private camera: CameraHandle | null = null;
  private landmarker: PoseLandmarker | null = null;
  private raf = 0;
  private lastTs = 0;
  private detectInFlight = false;
  private lockInFlight = false;
  private countLock: CountLockSnapshot = createCountLockState();
  private seatAnchors: SeatAnchor[] = [];
  private seatRaiseByIndex = new Map<number, SeatRaiseTracker>();
  private lastRaiseByIndex = new Map<number, SeatRaiseUpdate>();
  private scoutHold: ScoutHoldState<PoseFrame> = createScoutHoldState();
  private running = false;

  constructor(opts: BackgroundRaiseOptions, callbacks: BackgroundRaiseCallbacks = {}) {
    this.video = opts.video;
    this.expectedCount = Math.min(6, Math.max(1, opts.expectedCount ?? 1));
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
      minPoseDetectionConfidence: 0.3,
      minPosePresenceConfidence: 0.3,
      minTrackingConfidence: 0.3,
    });
    this.cb.onStatus?.("正在打开相机（后台检测）…");
    this.camera = await startCamera(this.video);
    await this.waitForVideo();
    this.running = true;
    this.clearLock(false);
    this.lastTs = 0;
    this.cb.onStatus?.(`后台检测中 · 等待 ${this.expectedCount} 人稳定后锁定`);
    this.raf = requestAnimationFrame((t) => void this.loop(t));
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
    this.raf = 0;
    this.running = false;
    this.camera?.stop();
    this.camera = null;
    this.landmarker?.close();
    this.landmarker = null;
    this.clearLock(true);
    this.cb.onStatus?.("后台检测已停止");
  }

  private clearLock(announce: boolean): void {
    this.countLock = unlockCountLock(this.countLock);
    this.seatAnchors = [];
    this.seatRaiseByIndex = new Map();
    this.lastRaiseByIndex = new Map();
    this.scoutHold = createScoutHoldState();
    this.lockInFlight = false;
    if (announce) this.cb.onCleared?.();
  }

  private scoutPosesRaw() {
    if (!this.landmarker) return [];
    const raw = detectPosesMultiBand(
      this.landmarker,
      this.video,
      this.frameCanvas,
      this.bandCanvas,
      NUMBERING_SCOUT_BANDS,
    );
    return dedupePosesByTorso(raw, {
      minDistance: 0.085,
      minSeparationX: 0.04,
      yWeight: 0.4,
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
    numbered: { index: number; x: number; y: number; landmarks: readonly PoseLandmark[] }[],
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
          smoothAlpha: 0.4,
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
      `后台已锁定 ${numbered.length} 人 · 读题倒计时后判定抢答`,
    );
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
      const c = torsoCenter(p.landmarks);
      const nose = p.landmarks[POSE.NOSE];
      const vis = nose?.visibility ?? 1;
      const x = nose && vis >= 0.25 ? nose.x : c.x;
      const y = nose && vis >= 0.25 ? nose.y : Math.max(0, c.y - 0.1);
      out.push({ index, x, y, landmarks: p.landmarks });
    }
    return out;
  }

  private updateRaises(nowMs: number): RaiseRaceObservation[] {
    const frame = framePixelsFromCanvas(this.frameCanvas);
    const withLm = this.seatAnchors.filter((s) => s.landmarks);
    for (const seat of this.seatAnchors) {
      const tracker = this.seatRaiseByIndex.get(seat.index);
      if (!tracker) continue;
      const neighborLms = withLm
        .filter((s) => s.index !== seat.index)
        .map((s) => s.landmarks!);
      const upd = tracker.update(seat.landmarks, nowMs, {
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

  private async loop(nowMs: number): Promise<void> {
    this.raf = requestAnimationFrame((t) => void this.loop(t));
    if (!this.running || !this.landmarker || this.video.readyState < 2) return;
    const interval = this.countLock.locked ? DETECT_INTERVAL_LOCKED_MS : DETECT_INTERVAL_MS;
    if (nowMs - this.lastTs < interval) return;
    this.lastTs = nowMs;
    if (this.detectInFlight) return;
    this.detectInFlight = true;
    try {
      if (!this.countLock.locked) {
        const scout = this.scoutPoses();
        const numbered = numberPosesLeftToRight(scout, this.expectedCount);
        const observed = observePersonCount(this.countLock, numbered.length, {
          expectedCount: this.expectedCount,
          minStableFrames: LOCK_STABLE_FRAMES,
          maxGapFrames: LOCK_GAP_FRAMES,
        });
        this.countLock = observed.state;
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
          const locked = take.map((p) => byIndex.get(p.index) ?? p);
          this.applyLock(locked);
          this.scoutHold = createScoutHoldState();
          this.lockInFlight = false;
        } else {
          this.cb.onStatus?.(
            `后台检测 ${numbered.length}/${this.expectedCount} · 稳定后锁定编号`,
          );
        }
        return;
      }

      // Prefer full-frame scout (more reliable for 1-person / dim PIP preview),
      // then refill with per-seat crops when available.
      let indexedPoses = numberPosesLeftToRight(this.scoutPosesRaw(), this.expectedCount);
      if (indexedPoses.length < this.seatAnchors.length) {
        const boxes = personBoxesFromSeats(this.seatAnchors);
        const cascade = runMpOnPersonBoxes({
          landmarker: this.landmarker,
          frameCanvas: this.frameCanvas,
          cropCanvas: this.cropCanvas,
          source: this.video,
          boxes,
        });
        indexedPoses = mergeCropPosesWithScout(
          this.seatAnchors.map((s) => ({ index: s.index, x: s.x, y: s.y })),
          this.indexedFromCascade(cascade.poses),
          this.scoutPosesRaw(),
          0.2,
        );
      }
      this.seatAnchors = bindPosesToSeatsByIndex(this.seatAnchors, indexedPoses, {
        maxMissed: TRACK_MAX_MISSED,
      });
      void seatsToNumberingSlots(this.seatAnchors);
      const people = this.updateRaises(nowMs);
      this.cb.onFrame?.(people, nowMs);
    } finally {
      this.detectInFlight = false;
    }
  }
}
