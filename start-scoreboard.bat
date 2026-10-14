@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ========================================
echo  计分板（单独启动 · 仅本页）
echo  视觉 / 语音请另开对应 start 或浏览器标签
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [错误] 未检测到 Node.js。
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [npm] install ...
  call npm.cmd install
)

echo.
echo 打开计分板 : http://localhost:5173/scoreboard.html
echo 联调时请另开 people-fast / speech-online（同源同端口）
echo 提示: 不要同时开多个 start-*.bat（会抢 5173）
start "" "http://localhost:5173/scoreboard.html"
call npm.cmd run dev

pause
