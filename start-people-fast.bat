@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ========================================
echo  人物编号 · 相机快版（单独启动）
echo  仅本页 · 无需 Python
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [错误] 未检测到 Node.js。
  echo   winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [npm] install ...
  call npm.cmd install
)

echo.
echo 启动网页 : http://localhost:5173/people-fast.html
echo 提示: 不要同时开多个 start-*.bat（会抢 5173）
echo 其它页请在浏览器另开标签，勿用本脚本连带打开
start "" "http://localhost:5173/people-fast.html"
call npm.cmd run dev

pause
