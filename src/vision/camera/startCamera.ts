/**
 * USB / UVC camera via getUserMedia.
 */

export type CameraHandle = {
  stream: MediaStream;
  video: HTMLVideoElement;
  stop: () => void;
};

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
