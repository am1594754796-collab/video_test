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

/** Remote fallbacks when local `public/mediapipe/models` is missing (prefer CN-reachable mirrors). */
export const REMOTE_LITE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
export const REMOTE_FULL_MODEL_URL =
  "https://hf-mirror.com/spaces/pollen-robotics/red_light_green_light/resolve/main/red_light_green_light/pose_landmarker_full.task";
export const REMOTE_FULL_MODEL_URL_HF =
  "https://huggingface.co/spaces/pollen-robotics/red_light_green_light/resolve/main/red_light_green_light/pose_landmarker_full.task";
export const REMOTE_FULL_MODEL_URL_GCS =
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
  /** Top edge in full-frame normalized y [0,1). Default 0. */
  y0?: number;
  /** Bottom edge in full-frame normalized y (0,1]. Default 1. */
  y1?: number;
};

const DEFAULT_BANDS: BandCrop[] = [
  { x0: 0, x1: 1 },
  { x0: 0, x1: 0.55 },
  { x0: 0.45, x1: 1 },
];

/**
 * Classroom scout: full frame + side strips + desk-row ROI (zoomed).
 * Vertical crops matter when people sit behind a table under a wide lens —
 * horizontal strips alone do not enlarge the person enough for Pose.
 */
export const NUMBERING_SCOUT_BANDS: BandCrop[] = [
  { x0: 0, x1: 1 },
  { x0: 0, x1: 0.55 },
  { x0: 0.45, x1: 1 },
  { x0: 0, x1: 0.5, y0: 0.22, y1: 0.92 },
  { x0: 0, x1: 0.42, y0: 0.28, y1: 0.88 },
  { x0: 0.18, x1: 0.58, y0: 0.28, y1: 0.88 },
  { x0: 0.45, x1: 1, y0: 0.22, y1: 0.92 },
  // Wide stage shots: zoom the seated upper-body row without foreground chairs.
  { x0: 0, x1: 0.36, y0: 0.22, y1: 0.72 },
  { x0: 0.28, x1: 0.65, y0: 0.22, y1: 0.72 },
  { x0: 0.58, x1: 1, y0: 0.22, y1: 0.72 },
];

const MIN_LOCAL_MODEL_BYTES = 1_000_000;

function remoteFallbacksFor(modelAssetPath: string): string[] {
  if (modelAssetPath.includes("pose_landmarker_full")) {
    return [REMOTE_FULL_MODEL_URL, REMOTE_FULL_MODEL_URL_HF, REMOTE_FULL_MODEL_URL_GCS];
  }
  if (modelAssetPath.includes("pose_landmarker_lite")) return [REMOTE_LITE_MODEL_URL];
  if (modelAssetPath.includes("pose_landmarker_heavy")) return [REMOTE_HEAVY_MODEL_URL];
  return [];
}

async function localModelLooksReady(url: string): Promise<boolean> {
  try {
    const head = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (head.ok) {
      const len = Number(head.headers.get("content-length") || 0);
      if (len >= MIN_LOCAL_MODEL_BYTES) return true;
      if (len > 0) return false;
    }
  } catch {
    /* some hosts ignore HEAD — probe with a tiny range GET */
  }
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { Range: "bytes=0-0" },
    });
    if (!(res.ok || res.status === 206)) return false;
    const cr = res.headers.get("content-range"); // e.g. bytes 0-0/9177000
    const total = cr?.split("/")[1];
    if (total && total !== "*") return Number(total) >= MIN_LOCAL_MODEL_BYTES;
    const len = Number(res.headers.get("content-length") || 0);
    return len >= MIN_LOCAL_MODEL_BYTES;
  } catch {
    return false;
  }
}

/** Prefer local vendored model; otherwise first remote mirror (browser will fetch). */
async function resolveModelAssetPath(preferred: string): Promise<string> {
  if (/^https?:\/\//i.test(preferred)) return preferred;
  if (await localModelLooksReady(preferred)) return preferred;
  const remotes = remoteFallbacksFor(preferred);
  if (remotes.length === 0) {
    throw new Error(
      `MediaPipe 模型不可用: ${preferred}。请运行 setup-mediapipe.bat 下载模型。`,
    );
  }
  return remotes[0]!;
}

async function createWithDelegate(
  vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
  shared: {
    runningMode: "VIDEO" | "IMAGE";
    numPoses: number;
    minPoseDetectionConfidence: number;
    minPosePresenceConfidence: number;
    minTrackingConfidence: number;
  },
  modelAssetPath: string,
): Promise<PoseLandmarker> {
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

export async function createPoseLandmarker(
  config: PoseLandmarkerConfig = {},
): Promise<PoseLandmarker> {
  const wasmRoot = config.wasmRoot ?? DEFAULT_WASM_ROOT;
  let vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;
  try {
    vision = await FilesetResolver.forVisionTasks(wasmRoot);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `MediaPipe WASM 加载失败 (${wasmRoot})。请运行 setup-mediapipe.bat。${detail}`,
    );
  }

  const shared = {
    runningMode: (config.runningMode ?? "VIDEO") as "VIDEO" | "IMAGE",
    numPoses: config.numPoses ?? 6,
    minPoseDetectionConfidence: config.minPoseDetectionConfidence ?? 0.65,
    minPosePresenceConfidence: config.minPosePresenceConfidence ?? 0.65,
    minTrackingConfidence: config.minTrackingConfidence ?? 0.6,
  };

  const preferred = config.modelAssetPath ?? DEFAULT_MODEL_URL;
  const modelAssetPath = await resolveModelAssetPath(preferred);

  try {
    return await createWithDelegate(vision, shared, modelAssetPath);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `MediaPipe Pose 模型加载失败。请运行 setup-mediapipe.bat 或检查网络。${detail}`,
    );
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

function bandY0(band: BandCrop): number {
  return band.y0 ?? 0;
}

function bandY1(band: BandCrop): number {
  return band.y1 ?? 1;
}

export function mapLandmarksToFullFrame(
  landmarks: NormalizedLandmark[],
  band: BandCrop,
): NormalizedLandmark[] {
  const xSpan = Math.max(1e-6, band.x1 - band.x0);
  const y0 = bandY0(band);
  const ySpan = Math.max(1e-6, bandY1(band) - y0);
  return landmarks.map((lm) => ({
    ...lm,
    x: band.x0 + lm.x * xSpan,
    y: y0 + lm.y * ySpan,
  }));
}

/**
 * A lone full-frame person can be rediscovered by every scout strip.
 * Ignore strip poses on that same torso; keep distant strip-only people.
 * For crowded full-frame scenes, leave the existing row dedupe in charge.
 */
export function stripDuplicatesOfLoneFullPose<T extends PoseFrame>(
  full: readonly T[],
  strips: readonly T[],
  maxDx = 0.1,
): T[] {
  if (full.length !== 1) return [...strips];
  const shoulders = full[0]!.landmarks;
  const left = shoulders[11];
  const right = shoulders[12];
  if (!left || !right) return [...strips];
  const cx = (left.x + right.x) / 2;
  const cy = (left.y + right.y) / 2;
  return strips.filter((pose) => {
    const ls = pose.landmarks[11];
    const rs = pose.landmarks[12];
    if (!ls || !rs) return true;
    const x = (ls.x + rs.x) / 2;
    const y = (ls.y + rs.y) / 2;
    return Math.abs(x - cx) > maxDx || Math.abs(y - cy) > 0.12;
  });
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

  const fullPoses: PoseFrame[] = [];
  const stripPoses: PoseFrame[] = [];
  for (const band of bands) {
    const y0n = bandY0(band);
    const y1n = bandY1(band);
    const isFull =
      band.x0 <= 0.001 && band.x1 >= 0.999 && y0n <= 0.001 && y1n >= 0.999;
    const x0 = Math.floor(band.x0 * vw);
    const x1 = Math.ceil(band.x1 * vw);
    const y0 = Math.floor(y0n * vh);
    const y1 = Math.ceil(y1n * vh);
    const bw = Math.max(1, x1 - x0);
    const bh = Math.max(1, y1 - y0);
    // Upscale narrow / short ROIs so distant seated people fill Pose's sweet spot.
    const xSpan = Math.max(1e-6, band.x1 - band.x0);
    const ySpan = Math.max(1e-6, y1n - y0n);
    const scale = Math.min(2.8, Math.max(1, 0.92 / Math.max(xSpan, ySpan)));
    const tw = Math.max(bw, Math.round(bw * scale));
    const th = Math.max(bh, Math.round(bh * scale));
    if (bandCanvas.width !== tw || bandCanvas.height !== th) {
      bandCanvas.width = tw;
      bandCanvas.height = th;
    }
    const bctx = bandCanvas.getContext("2d", { willReadFrequently: true });
    if (!bctx) continue;
    bctx.clearRect(0, 0, tw, th);
    bctx.drawImage(frameCanvas, x0, y0, bw, bh, 0, 0, tw, th);
    const result = landmarker.detect(bandCanvas);
    for (const landmarks of result.landmarks ?? []) {
      const mapped =
        isFull ? landmarks : mapLandmarksToFullFrame(landmarks, band);
      if (!isFull) {
        const cx =
          ((mapped[11]?.x ?? 0.5) + (mapped[12]?.x ?? 0.5)) / 2;
        const cy =
          ((mapped[11]?.y ?? 0.5) + (mapped[12]?.y ?? 0.5)) / 2;
        // Keep strip hits inside their horizontal band (with margin).
        if (band.x1 <= 0.6 && cx > Math.min(0.58, band.x1 + 0.08)) continue;
        if (band.x0 >= 0.4 && cx < Math.max(0.42, band.x0 - 0.08)) continue;
        if (cy < y0n - 0.06 || cy > y1n + 0.06) continue;
      }
      (isFull ? fullPoses : stripPoses).push({ landmarks: mapped });
    }
  }
  return [...fullPoses, ...stripDuplicatesOfLoneFullPose(fullPoses, stripPoses)];
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

