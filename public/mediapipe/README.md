# Local MediaPipe assets (served by Vite from `/mediapipe/...`)

| Path | Purpose |
|------|---------|
| `wasm/` | Pose WASM runtime (from `@mediapipe/tasks-vision`) |
| `models/pose_landmarker_lite.task` | Single-person debug |
| `models/pose_landmarker_full.task` | Multi-person / video (default) |

## One-click (Windows)

From repo root:

```bat
setup-mediapipe.bat
```

`start-people-fast.bat` / other `start-*.bat` call this automatically via `_dev-open.bat`.

`setup-mediapipe.bat` will:
1. Replace a broken Linux `wasm` symlink file with a real directory copy
2. Download full/lite `.task` models (HF mirror first; Google Storage as fallback)

## Manual

```bat
npm.cmd install
setup-mediapipe.bat
```

Models are gitignored (large binaries). Full model should be ~9MB; if the file is only tens of KB, delete it and re-run `setup-mediapipe.bat`.
