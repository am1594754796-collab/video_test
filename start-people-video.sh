#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "========================================"
echo " 人物编号 · 视频回放检测（单独启动）"
echo " 仅本页 · 无需 Python"
echo "========================================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未检测到 Node.js"
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "[npm] install ..."
  npm install
fi

echo
echo "打开页面 : http://127.0.0.1:5173/people-video.html"
echo "提示: 不要同时开多个启动脚本（会抢 5173）"
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://127.0.0.1:5173/people-video.html" >/dev/null 2>&1 || true
fi
npm run dev
