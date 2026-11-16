import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import { DEFAULT_WASM_ROOT, type BandCrop } from "./poseLandmarker";

export type FaceLocation = { x: number; y: number; width: number; height: number; score: number };
export type FaceTrack = { id: number; face: FaceLocation; seen: number; missed: number };
export type FaceTrackState = { nextId: number; tracks: FaceTrack[] };
const FACE_MODEL_URL = "/mediapipe/models/blaze_face_full_range.tflite";

export function createFaceTrackState(): FaceTrackState {
  return { nextId: 1, tracks: [] };
}

/** Stable positions only; a one-frame false face cannot change numbering. */
export function trackFaceLocations(
  state: FaceTrackState,
  detections: readonly FaceLocation[],
  minSeen = 4,
): { state: FaceTrackState; stable: FaceLocation[] } {
  const tracks = state.tracks.map((t) => ({ ...t, face: { ...t.face }, missed: t.missed + 1 }));
  const candidates = detections.filter((f) =>
    f.width >= 0.008 && f.width <= 0.2 && f.height >= 0.008 && f.height <= 0.25 &&
    f.height / f.width >= 0.5 && f.height / f.width <= 3.5);
  const pairs: Array<{ ti: number; fi: number; distance: number }> = [];
  for (let ti = 0; ti < tracks.length; ti++) for (let fi = 0; fi < candidates.length; fi++) {
    const a = tracks[ti]!.face;
    const b = candidates[fi]!;
    const distance = Math.hypot(a.x - b.x, (a.y - b.y) * 0.7);
    if (distance <= Math.max(0.035, Math.min(a.width, b.width) * 1.5)) {
      pairs.push({ ti, fi, distance });
    }
  }
  pairs.sort((a, b) => a.distance - b.distance);
  const usedTracks = new Set<number>();
  const usedFaces = new Set<number>();
  for (const { ti, fi } of pairs) {
    if (usedTracks.has(ti) || usedFaces.has(fi)) continue;
    const track = tracks[ti]!;
    const face = candidates[fi]!;
    const alpha = 0.3;
    track.face = {
      x: track.face.x * (1 - alpha) + face.x * alpha,
      y: track.face.y * (1 - alpha) + face.y * alpha,
      width: track.face.width * (1 - alpha) + face.width * alpha,
      height: track.face.height * (1 - alpha) + face.height * alpha,
      score: face.score,
    };
    track.seen = Math.min(30, track.seen + 1);
    track.missed = 0;
    usedTracks.add(ti);
    usedFaces.add(fi);
  }
  let nextId = state.nextId;
  for (let fi = 0; fi < candidates.length; fi++) {
    if (!usedFaces.has(fi)) tracks.push({ id: nextId++, face: { ...candidates[fi]! }, seen: 1, missed: 0 });
  }
  const live = tracks.filter((t) => t.missed <= 4);
  return {
    state: { nextId, tracks: live },
    stable: live.filter((t) => t.seen >= minSeen && t.missed <= 3)
      .map((t) => t.face).sort((a, b) => a.x - b.x),
  };
}

export async function createFaceDetector(): Promise<FaceDetector> {
  const vision = await FilesetResolver.forVisionTasks(DEFAULT_WASM_ROOT);
  const base = { modelAssetPath: FACE_MODEL_URL };
  try {
    return await FaceDetector.createFromOptions(vision, {
      baseOptions: { ...base, delegate: "GPU" }, runningMode: "IMAGE",
      minDetectionConfidence: 0.45,
    });
  } catch {
    return FaceDetector.createFromOptions(vision, {
      baseOptions: { ...base, delegate: "CPU" }, runningMode: "IMAGE",
      minDetectionConfidence: 0.45,
    });
  }
}

export function dedupeFaceLocations(faces: readonly FaceLocation[]): FaceLocation[] {
  const kept: FaceLocation[] = [];
  for (const face of [...faces].sort((a, b) => b.score - a.score)) {
    const same = kept.some((p) =>
      Math.hypot(face.x - p.x, (face.y - p.y) * 0.65) <
      Math.max(0.03, Math.min(face.width, p.width) * 0.8));
    if (!same) kept.push(face);
  }
  return kept.sort((a, b) => a.x - b.x);
}

/** Face centers in original video coordinates after overlapping stage crops. */
export function locateFaces(
  detector: FaceDetector,
  video: HTMLVideoElement,
  crop: HTMLCanvasElement,
  bands: readonly BandCrop[],
  expectedCount?: number,
): FaceLocation[] {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw < 2 || vh < 2) return [];
  const found: FaceLocation[] = [];
  for (const band of bands) {
    const x0 = Math.floor(band.x0 * vw);
    const y0 = Math.floor((band.y0 ?? 0) * vh);
    const bw = Math.ceil(band.x1 * vw) - x0;
    const bh = Math.ceil((band.y1 ?? 1) * vh) - y0;
    crop.width = Math.max(1, bw);
    crop.height = Math.max(1, bh);
    const ctx = crop.getContext("2d");
    if (!ctx) continue;
    ctx.drawImage(video, x0, y0, bw, bh, 0, 0, bw, bh);
    for (const detection of detector.detect(crop).detections) {
      const b = detection.boundingBox;
      if (!b) continue;
      const x = (x0 + b.originX + b.width / 2) / vw;
      const y = (y0 + b.originY + b.height / 2) / vh;
      if (x < 0 || x > 1 || y < 0 || y > 1) continue;
      found.push({ x, y, width: b.width / vw, height: b.height / vh,
        score: detection.categories[0]?.score ?? 0 });
    }
    // The first wide crop is enough when everyone is already visible. Zoomed
    // crops are a fallback for distant faces, not mandatory extra inferences.
    if (expectedCount && dedupeFaceLocations(found).length >= expectedCount) break;
  }
  return dedupeFaceLocations(found);
}
