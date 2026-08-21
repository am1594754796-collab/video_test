/**
 * Lightweight session face descriptors from face crops (not a biometric gallery).
 * Used only to keep seat numbers sticky after trackId changes within one lock cycle.
 */

import type { FaceBox } from "./faceDetector";

export const FACE_DESC_SIZE = 16;
export const FACE_DESC_DIM = FACE_DESC_SIZE * FACE_DESC_SIZE; // grayscale

export type FaceDescriptor = number[];

let scratchCanvas: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;

function ensureScratch(): CanvasRenderingContext2D {
  if (!scratchCanvas) {
    scratchCanvas = document.createElement("canvas");
    scratchCanvas.width = FACE_DESC_SIZE;
    scratchCanvas.height = FACE_DESC_SIZE;
  }
  if (!scratchCtx) {
    scratchCtx = scratchCanvas.getContext("2d", { willReadFrequently: true });
  }
  if (!scratchCtx) throw new Error("2d context unavailable for face descriptor");
  return scratchCtx;
}

/**
 * Build an L2-normalized grayscale descriptor from a face box on the video frame.
 */
export function extractFaceDescriptor(
  video: HTMLVideoElement,
  face: FaceBox,
): FaceDescriptor | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  const pad = 0.08;
  const x0 = Math.max(0, Math.floor((face.xMin - pad * face.width) * vw));
  const y0 = Math.max(0, Math.floor((face.yMin - pad * face.height) * vh));
  const x1 = Math.min(vw, Math.ceil((face.xMin + face.width * (1 + pad)) * vw));
  const y1 = Math.min(vh, Math.ceil((face.yMin + face.height * (1 + pad)) * vh));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 8 || h < 8) return null;

  const ctx = ensureScratch();
  ctx.clearRect(0, 0, FACE_DESC_SIZE, FACE_DESC_SIZE);
  ctx.drawImage(video, x0, y0, w, h, 0, 0, FACE_DESC_SIZE, FACE_DESC_SIZE);
  const { data } = ctx.getImageData(0, 0, FACE_DESC_SIZE, FACE_DESC_SIZE);

  const vec = new Array<number>(FACE_DESC_DIM);
  let sumSq = 0;
  for (let i = 0, p = 0; i < FACE_DESC_DIM; i++, p += 4) {
    const g = (data[p]! * 0.299 + data[p + 1]! * 0.587 + data[p + 2]! * 0.114) / 255;
    vec[i] = g;
    sumSq += g * g;
  }
  const norm = Math.sqrt(sumSq) || 1;
  for (let i = 0; i < FACE_DESC_DIM; i++) vec[i]! /= norm;
  return vec;
}

export function cosineSimilarity(a: FaceDescriptor, b: FaceDescriptor): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!;
  return dot;
}

export type HeadAnchor = { x: number; y: number };

/**
 * Pick the face whose center is nearest to the head anchor (nose / upper torso).
 * Prefers faces not far below the anchor (faces are above torso).
 */
export function pickFaceForPerson(
  faces: readonly FaceBox[],
  head: HeadAnchor,
  options: { maxDistance?: number } = {},
): FaceBox | null {
  const maxDistance = options.maxDistance ?? 0.28;
  let best: FaceBox | null = null;
  let bestD = Infinity;
  for (const f of faces) {
    // Face should be near or above the torso/head anchor.
    if (f.cy > head.y + 0.12) continue;
    const d = Math.hypot(f.cx - head.x, f.cy - head.y);
    if (d < bestD && d <= maxDistance) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

export type PersonHead = {
  trackId: number;
  x: number;
  y: number;
};

/**
 * Greedy 1:1 assign faces → tracks by head distance, then extract descriptors.
 */
export function assignFaceDescriptorsToTracks(
  video: HTMLVideoElement,
  people: readonly PersonHead[],
  faces: readonly FaceBox[],
  options: { maxDistance?: number } = {},
): Map<number, FaceDescriptor> {
  const maxDistance = options.maxDistance ?? 0.28;
  type Cand = { trackId: number; fi: number; d: number };
  const cands: Cand[] = [];
  for (const p of people) {
    for (let fi = 0; fi < faces.length; fi++) {
      const f = faces[fi]!;
      if (f.cy > p.y + 0.12) continue;
      const d = Math.hypot(f.cx - p.x, f.cy - p.y);
      if (d <= maxDistance) cands.push({ trackId: p.trackId, fi, d });
    }
  }
  cands.sort((a, b) => a.d - b.d);
  const usedTracks = new Set<number>();
  const usedFaces = new Set<number>();
  const out = new Map<number, FaceDescriptor>();
  for (const { trackId, fi } of cands) {
    if (usedTracks.has(trackId) || usedFaces.has(fi)) continue;
    const desc = extractFaceDescriptor(video, faces[fi]!);
    if (!desc) continue;
    out.set(trackId, desc);
    usedTracks.add(trackId);
    usedFaces.add(fi);
  }
  return out;
}
