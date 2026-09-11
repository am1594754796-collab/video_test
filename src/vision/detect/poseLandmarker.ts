/**
 * MediaPipe Pose Landmarker adapter (Vision Recognition).
 * Setup follows:
 * https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js
 *
 * Models + WASM are vendored under `public/mediapipe/` so the browser does not
 * wait on Google / jsDelivr (often very slow on classroom networks).
 */

import {
  FilesetResolver,
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

/** Local WASM (copied/symlinked from @mediapipe/tasks-vision). */
export const DEFAULT_WASM_ROOT = "/mediapipe/wasm";

/** Local lite model — single-person / low-load. */
export const DEFAULT_MODEL_URL = "/mediapipe/models/pose_landmarker_lite.task";

/** Local full model — multi-person classroom / video (recommended). */
export const FULL_MODEL_URL = "/mediapipe/models/pose_landmarker_full.task";

/**
 * Heavy model — optional; only used if you place the file at this path.
 * Prefer FULL for normal use (heavy is ~30MB and slow to fetch remotely).
 */
export const HEAVY_MODEL_URL = "/mediapipe/models/pose_landmarker_heavy.task";

/** Remote fallbacks (used only if you intentionally pass these paths). */
export const REMOTE_LITE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
export const REMOTE_FULL_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";
export const REMOTE_HEAVY_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task";

export type PoseLandmarkerConfig = {
  numPoses?: number;
  modelAssetPath?: string;
  wasmRoot?: string;
  runningMode?: "VIDEO" | "IMAGE";
  minPoseDetectionConfidence?: number;
  minPosePresenceConfidence?: number;
  minTrackingConfidence?: number;
};

export type PoseFrame = {
  landmarks: NormalizedLandmark[];
};

export type BandCrop = {
  /** Left edge in full-frame normalized x [0,1). */
  x0: number;
  /** Right edge in full-frame normalized x (0,1]. */
  x1: number;
};

const DEFAULT_BANDS: BandCrop[] = [
  { x0: 0, x1: 1 },
  { x0: 0, x1: 0.55 },
  { x0: 0.45, x1: 1 },
];

export async function createPoseLandmarker(
  config: PoseLandmarkerConfig = {},
): Promise<PoseLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(config.wasmRoot ?? DEFAULT_WASM_ROOT);

  const shared = {
    runningMode: (config.runningMode ?? "VIDEO") as "VIDEO" | "IMAGE",
    numPoses: config.numPoses ?? 6,
    minPoseDetectionConfidence: config.minPoseDetectionConfidence ?? 0.65,
    minPosePresenceConfidence: config.minPosePresenceConfidence ?? 0.65,
    minTrackingConfidence: config.minTrackingConfidence ?? 0.6,
  };

  const modelAssetPath = config.modelAssetPath ?? DEFAULT_MODEL_URL;

  try {
    return await PoseLandmarker.createFromOptions(vision, {
      ...shared,
      baseOptions: { modelAssetPath, delegate: "GPU" },
    });
  } catch {
    return PoseLandmarker.createFromOptions(vision, {
      ...shared,
      baseOptions: { modelAssetPath, delegate: "CPU" },
    });
  }
}

export function detectPosesForVideo(
  landmarker: PoseLandmarker,
  video: HTMLVideoElement,
  timestampMs: number,
): PoseFrame[] {
  const result = landmarker.detectForVideo(video, timestampMs);
  const poses = result.landmarks ?? [];
  return poses.map((landmarks) => ({ landmarks }));
}

function mapLandmarksToFullFrame(
  landmarks: NormalizedLandmark[],
  band: BandCrop,
): NormalizedLandmark[] {
  const span = Math.max(1e-6, band.x1 - band.x0);
  return landmarks.map((lm) => ({
    ...lm,
    x: band.x0 + lm.x * span,
  }));
}

/**
 * IMAGE-mode multi-band: full frame + left/right strips.
 * Side strips may add edge people; middle relies on full frame + soft collapse
 * so we do not reintroduce a center crop (that caused +2 phantoms).
 */
export function detectPosesMultiBand(
  landmarker: PoseLandmarker,
  video: HTMLVideoElement,
  frameCanvas: HTMLCanvasElement,
  bandCanvas: HTMLCanvasElement,
  bands: BandCrop[] = DEFAULT_BANDS,
): PoseFrame[] {
  const vw = video.videoWidth || 0;
  const vh = video.videoHeight || 0;
  if (vw < 2 || vh < 2) return [];

  if (frameCanvas.width !== vw || frameCanvas.height !== vh) {
    frameCanvas.width = vw;
    frameCanvas.height = vh;
  }
  const fctx = frameCanvas.getContext("2d", { willReadFrequently: true });
  if (!fctx) return [];
  fctx.drawImage(video, 0, 0, vw, vh);

  const out: PoseFrame[] = [];
  for (const band of bands) {
    const isFull = band.x0 <= 0.001 && band.x1 >= 0.999;
    const x0 = Math.floor(band.x0 * vw);
    const x1 = Math.ceil(band.x1 * vw);
    const bw = Math.max(1, x1 - x0);
    if (bandCanvas.width !== bw || bandCanvas.height !== vh) {
      bandCanvas.width = bw;
      bandCanvas.height = vh;
    }
    const bctx = bandCanvas.getContext("2d", { willReadFrequently: true });
    if (!bctx) continue;
    bctx.clearRect(0, 0, bw, vh);
    bctx.drawImage(frameCanvas, x0, 0, bw, vh, 0, 0, bw, vh);
    const result = landmarker.detect(bandCanvas);
    for (const landmarks of result.landmarks ?? []) {
      const mapped =
        isFull ? landmarks : mapLandmarksToFullFrame(landmarks, band);
      if (!isFull) {
        const cx =
          ((mapped[11]?.x ?? 0.5) + (mapped[12]?.x ?? 0.5)) / 2;
        // Slightly wider than before so person #2 / #5 near sides can be recovered.
        if (band.x1 <= 0.6 && cx > 0.48) continue;
        if (band.x0 >= 0.4 && cx < 0.52) continue;
      }
      out.push({ landmarks: mapped });
    }
  }
  return out;
}

export type SeatCropHint = {
  x: number;
  y: number;
};

export type SeatCropOptions = {
  /** Half-width of crop (normalized). */
  halfW?: number;
  /** Half-height below center (normalized). */
  halfH?: number;
  /** Extra top padding for raised hands (normalized). */
  padTop?: number;
  /** Reject poses whose torso is farther than this from the seat. */
  maxTorsoDist?: number;
};

/**
 * Re-run Pose on a tight crop around one seat. Larger person in-frame → stabler shoulders/wrists.
 * `frameCanvas` must already contain the current video frame.
 */
export function detectPoseInSeatCrop(
  landmarker: PoseLandmarker,
  frameCanvas: HTMLCanvasElement,
  cropCanvas: HTMLCanvasElement,
  seat: SeatCropHint,
  options: SeatCropOptions = {},
): PoseFrame | null {
  const vw = frameCanvas.width;
  const vh = frameCanvas.height;
  if (vw < 2 || vh < 2) return null;

  const halfW = options.halfW ?? 0.11;
  const halfH = options.halfH ?? 0.2;
  const padTop = options.padTop ?? 0.22;
  const maxTorsoDist = options.maxTorsoDist ?? 0.16;

  const x0n = Math.max(0, seat.x - halfW);
  const x1n = Math.min(1, seat.x + halfW);
  const y0n = Math.max(0, seat.y - halfH - padTop);
  const y1n = Math.min(1, seat.y + halfH);
  const x0 = Math.floor(x0n * vw);
  const y0 = Math.floor(y0n * vh);
  const bw = Math.max(8, Math.ceil(x1n * vw) - x0);
  const bh = Math.max(8, Math.ceil(y1n * vh) - y0);

  if (cropCanvas.width !== bw || cropCanvas.height !== bh) {
    cropCanvas.width = bw;
    cropCanvas.height = bh;
  }
  const ctx = cropCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.clearRect(0, 0, bw, bh);
  ctx.drawImage(frameCanvas, x0, y0, bw, bh, 0, 0, bw, bh);

  const result = landmarker.detect(cropCanvas);
  const poses = result.landmarks ?? [];
  if (!poses.length) return null;

  const spanX = Math.max(1e-6, x1n - x0n);
  const spanY = Math.max(1e-6, y1n - y0n);

  let best: NormalizedLandmark[] | null = null;
  let bestDist = Infinity;
  for (const lm of poses) {
    const mapped = lm.map((p) => ({
      ...p,
      x: x0n + p.x * spanX,
      y: y0n + p.y * spanY,
    }));
    const ls = mapped[11];
    const rs = mapped[12];
    const cx = ls && rs ? (ls.x + rs.x) / 2 : mapped[0]?.x ?? 0.5;
    const cy = ls && rs ? (ls.y + rs.y) / 2 : mapped[0]?.y ?? 0.5;
    const d = Math.hypot(cx - seat.x, (cy - seat.y) * 0.5);
    if (d < bestDist) {
      bestDist = d;
      best = mapped;
    }
  }
  if (!best || bestDist > maxTorsoDist) return null;
  return { landmarks: best };
}

/**
 * Refine every seat with a per-person crop. Prefer crop pose when found.
 */
export function refineSeatsWithCrops(
  landmarker: PoseLandmarker,
  frameCanvas: HTMLCanvasElement,
  cropCanvas: HTMLCanvasElement,
  seats: readonly SeatCropHint[],
  options: SeatCropOptions = {},
): Array<PoseFrame | null> {
  return seats.map((s) => detectPoseInSeatCrop(landmarker, frameCanvas, cropCanvas, s, options));
}

