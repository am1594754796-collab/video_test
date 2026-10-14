@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ========================================
echo  Hand-raise debug (index)
echo ========================================
echo.
echo Page: http://127.0.0.1:5173/
echo Do not run multiple start-*.bat at once (port 5173).
echo.

call "%~dp0_dev-open.bat" ""
if errorlevel 1 (
  pause
  exit /b 1
)
pause
