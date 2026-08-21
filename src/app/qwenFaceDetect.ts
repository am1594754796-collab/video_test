/**
 * Capture a video frame and ask Python (Qwen-VL) for face boxes.
 * Replaces MediaPipe Face Detector (broken/404 model URL).
 */

import type { FaceBox } from "../vision/detect/faceDetector";

export type QwenFaceStatus = {
  mode: string;
  configured: boolean;
  model?: string | null;
  base_url?: string | null;
};

let lastStatus: QwenFaceStatus | null = null;

export async function fetchQwenFaceStatus(): Promise<QwenFaceStatus> {
  const res = await fetch("/api/vision/face-status", { cache: "no-store" });
  if (!res.ok) throw new Error(`face-status HTTP ${res.status}`);
  lastStatus = (await res.json()) as QwenFaceStatus;
  return lastStatus;
}

export function getCachedQwenFaceStatus(): QwenFaceStatus | null {
  return lastStatus;
}

function captureFrameBase64(
  video: HTMLVideoElement,
  opts?: { maxWidth?: number; quality?: number },
): { base64: string; mime: string } | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  const maxWidth = opts?.maxWidth ?? 960;
  const scale = Math.min(1, maxWidth / vw);
  const w = Math.max(1, Math.round(vw * scale));
  const h = Math.max(1, Math.round(vh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  const dataUrl = canvas.toDataURL("image/jpeg", opts?.quality ?? 0.72);
  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1]! : dataUrl;
  return { base64, mime: "image/jpeg" };
}

export async function detectFacesViaQwen(
  video: HTMLVideoElement,
  opts?: { maxFaces?: number },
): Promise<FaceBox[]> {
  const shot = captureFrameBase64(video);
  if (!shot) return [];

  const res = await fetch("/api/vision/detect-faces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_base64: shot.base64,
      mime: shot.mime,
      max_faces: opts?.maxFaces ?? 6,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    faces?: Array<{
      x_min: number;
      y_min: number;
      width: number;
      height: number;
      score?: number;
      cx?: number;
      cy?: number;
    }>;
    detail?: string;
  };
  if (!res.ok) {
    throw new Error(body.detail || `detect-faces HTTP ${res.status}`);
  }

  return (body.faces ?? []).map((f) => ({
    xMin: f.x_min,
    yMin: f.y_min,
    width: f.width,
    height: f.height,
    score: f.score ?? 0.9,
    cx: f.cx ?? f.x_min + f.width / 2,
    cy: f.cy ?? f.y_min + f.height / 2,
  }));
}
