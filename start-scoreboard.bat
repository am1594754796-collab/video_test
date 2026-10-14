@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ========================================
echo  Scoreboard (this page only)
echo  Open vision / speech in other tabs
echo ========================================
echo.
echo Page: http://127.0.0.1:5173/scoreboard.html
echo Do not run multiple start-*.bat at once (port 5173).
echo.

call "%~dp0_dev-open.bat" "scoreboard.html"
if errorlevel 1 (
  pause
  exit /b 1
)
pause
