#!/usr/bin/env bash
# 人物编号 · 视频回放检测（Linux）
# 注意：/home/zy/data 挂载了 noexec，请用 /mnt/data 路径启动本脚本。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
VENV="${VIDEO_TEST_VENV:-$HOME/.venvs/video_test}"

cd "$ROOT"

if [[ ! -x "$VENV/bin/python" ]]; then
  echo "[错误] 未找到 Python 环境: $VENV"
  echo "请先: uv venv \"$VENV\" && uv pip install --python \"$VENV/bin/python\" fastapi 'uvicorn[standard]' pydantic httpx python-multipart rapidfuzz pypinyin"
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "[npm] install ..."
  npm install
fi

if [[ ! -f public/mediapipe/models/pose_landmarker_full.task ]]; then
  echo "[mediapipe] 缺少模型，见 public/mediapipe/README.md"
  exit 1
fi

if [[ ! -e public/mediapipe/wasm ]]; then
  ln -sfn ../../node_modules/@mediapipe/tasks-vision/wasm public/mediapipe/wasm
fi

echo "启动 Python API : http://127.0.0.1:8765"
(
  cd "$ROOT/python"
  exec "$VENV/bin/python" -m uvicorn server:app --host 127.0.0.1 --port 8765
) &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT

sleep 1
echo "打开页面 : http://127.0.0.1:5173/people-video.html"
echo "页顶应显示 Python API: 已连接"
exec ./node_modules/.bin/vite --host 127.0.0.1 --port 5173
