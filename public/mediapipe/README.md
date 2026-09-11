# Local MediaPipe assets (served by Vite from `/mediapipe/...`)

| Path | Purpose |
|------|---------|
| `wasm/` | Pose WASM runtime (from `@mediapipe/tasks-vision`) |
| `models/pose_landmarker_lite.task` | Single-person debug |
| `models/pose_landmarker_full.task` | Multi-person / video (default) |

Download models once (from a machine that can reach Google):

```bash
mkdir -p public/mediapipe/models
curl -L -o public/mediapipe/models/pose_landmarker_full.task \
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task"
curl -L -o public/mediapipe/models/pose_landmarker_lite.task \
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
```

WASM: copy or symlink from `node_modules/@mediapipe/tasks-vision/wasm` → `public/mediapipe/wasm`.
