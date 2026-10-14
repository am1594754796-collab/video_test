@echo off
rem Shared helper: ensure Vite on 127.0.0.1:5173, then open a page.
rem Usage: call "%~dp0_dev-open.bat" "people-fast.html"
rem        call "%~dp0_dev-open.bat" ""
setlocal
cd /d "%~dp0"

set "PAGE=%~1"
set "URL=http://127.0.0.1:5173/"
if not "%PAGE%"=="" set "URL=http://127.0.0.1:5173/%PAGE%"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo   winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  exit /b 1
)

if not exist "node_modules\" (
  echo [npm] install ...
  call npm.cmd install
  if errorlevel 1 (
    echo [ERROR] npm install failed
    exit /b 1
  )
)

rem Vision pages need local MediaPipe WASM + .task models.
call "%~dp0setup-mediapipe.bat"
if errorlevel 1 (
  echo [WARN] MediaPipe assets incomplete. Camera / video detect may fail until fixed.
)

rem Already listening on 5173? Just open the page (do not start a second Vite).
netstat -ano | findstr /R /C:":5173 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [OK] Port 5173 already in use. Opening page only:
  echo      %URL%
  start "" "%URL%"
  exit /b 0
)

echo [OK] Starting Vite, then open:
echo      %URL%
echo Tip: keep this window open. Ctrl+C stops the server.
echo.

rem Open browser after Vite has a moment to bind (avoids blank/error tab).
start "" powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process '%URL%'"

call npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
set "ERR=%ERRORLEVEL%"
if not "%ERR%"=="0" (
  echo.
  echo [ERROR] Vite failed to start on 127.0.0.1:5173 (exit %ERR%^)
  echo         Another process may be using the port, or Node/Vite is broken.
)
exit /b %ERR%
