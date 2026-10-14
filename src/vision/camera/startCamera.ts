/**
 * USB / UVC camera via getUserMedia.
 */

export type CameraHandle = {
  stream: MediaStream;
  video: HTMLVideoElement;
  stop: () => void;
};

type ExposureCaps = MediaTrackCapabilities & {
  exposureMode?: string[];
  exposureCompensation?: { min: number; max: number; step?: number };
};

/**
 * Prefer continuous AE and a mild negative exposure bias so bright windows
 * / lamps are less likely to wash out faces during numbering.
 */
async function preferClassroomExposure(stream: MediaStream): Promise<void> {
  const track = stream.getVideoTracks()[0];
  if (!track?.getCapabilities) return;
  try {
    const caps = track.getCapabilities() as ExposureCaps;
    const advanced: MediaTrackConstraintSet[] = [];
    if (caps.exposureMode?.includes("continuous")) {
      advanced.push({ exposureMode: "continuous" } as MediaTrackConstraintSet);
    }
    if (caps.exposureCompensation) {
      const { min, max } = caps.exposureCompensation;
      // Slightly darker; clamp into device range.
      const target = Math.max(min, Math.min(max, -0.6));
      advanced.push({ exposureCompensation: target } as MediaTrackConstraintSet);
    }
    if (advanced.length === 0) return;
    await track.applyConstraints({ advanced });
  } catch {
    /* device may ignore advanced constraints */
  }
}

export async function startCamera(
  video: HTMLVideoElement,
  constraints: MediaStreamConstraints = {
    audio: false,
    video: {
      facingMode: "user",
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  },
): Promise<CameraHandle> {
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  await preferClassroomExposure(stream);
  video.srcObject = stream;
  await video.play();

  return {
    stream,
    video,
    stop: () => {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      video.srcObject = null;
    },
  };
}
