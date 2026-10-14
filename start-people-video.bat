@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ========================================
echo  People Video - playback (this page only)
echo  Node only - no Python
echo ========================================
echo.
echo Page: http://127.0.0.1:5173/people-video.html
echo Do not run multiple start-*.bat at once (port 5173).
echo.

call "%~dp0_dev-open.bat" "people-video.html"
if errorlevel 1 (
  pause
  exit /b 1
)
pause
