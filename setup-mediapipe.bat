@echo off
rem Ensure local MediaPipe WASM + pose models for vision pages.
setlocal EnableExtensions
cd /d "%~dp0"

set "WASM_SRC=node_modules\@mediapipe\tasks-vision\wasm"
set "WASM_DST=public\mediapipe\wasm"
set "MODEL_DIR=public\mediapipe\models"
set "FULL=%MODEL_DIR%\pose_landmarker_full.task"
set "LITE=%MODEL_DIR%\pose_landmarker_lite.task"
rem Prefer mirrors reachable in CN; Google Storage is often blocked/slow.
set "FULL_URL1=https://hf-mirror.com/spaces/pollen-robotics/red_light_green_light/resolve/main/red_light_green_light/pose_landmarker_full.task"
set "FULL_URL2=https://huggingface.co/spaces/pollen-robotics/red_light_green_light/resolve/main/red_light_green_light/pose_landmarker_full.task"
set "FULL_URL3=https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task"
set "LITE_URL1=https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
set "LITE_URL2=https://cdn.jsdelivr.net/gh/google-ai-edge/mediapipe-samples@master/examples/pose_landmarker/js/pose_landmarker_lite.task"
rem Full model is ~9MB; reject tiny/corrupt leftovers from failed downloads.
set "MIN_BYTES=1000000"

if not exist "%WASM_SRC%\vision_wasm_internal.wasm" (
  echo [ERROR] Missing %WASM_SRC%
  echo         Run npm.cmd install first.
  exit /b 1
)

rem Replace broken Linux symlink file with a real directory copy.
if exist "%WASM_DST%" (
  if not exist "%WASM_DST%\vision_wasm_internal.wasm" (
    echo [mediapipe] Replacing broken wasm path ...
    rmdir /s /q "%WASM_DST%" 2>nul
    del /f /q "%WASM_DST%" 2>nul
  )
)

if not exist "%WASM_DST%\vision_wasm_internal.wasm" (
  echo [mediapipe] Copying WASM runtime ...
  mkdir "public\mediapipe" 2>nul
  xcopy /E /I /Y "%WASM_SRC%" "%WASM_DST%" >nul
  if errorlevel 1 (
    echo [ERROR] Failed to copy WASM
    exit /b 1
  )
) else (
  echo [mediapipe] WASM OK
)

mkdir "%MODEL_DIR%" 2>nul

call :ensure_model "%FULL%" "full" "%FULL_URL1%" "%FULL_URL2%" "%FULL_URL3%"
if errorlevel 1 exit /b 1

rem Lite is optional for people-fast (uses full). Best-effort download.
call :ensure_model "%LITE%" "lite" "%LITE_URL1%" "%LITE_URL2%"
if errorlevel 1 (
  echo [WARN] lite model missing - index.html single-person debug may need it later.
)

echo [mediapipe] Ready.
exit /b 0

:ensure_model
set "FILE=%~1"
set "LABEL=%~2"
set "SIZE=0"
if exist "%FILE%" (
  for %%A in ("%FILE%") do set "SIZE=%%~zA"
)
if %SIZE% GEQ %MIN_BYTES% (
  echo [mediapipe] model %LABEL% OK ^(%SIZE% bytes^)
  exit /b 0
)
if exist "%FILE%" (
  echo [mediapipe] Removing incomplete %LABEL% model ^(%SIZE% bytes^) ...
  del /f /q "%FILE%" >nul 2>&1
)

where curl >nul 2>&1
if errorlevel 1 (
  echo [ERROR] curl.exe not found. Download manually into %FILE%
  exit /b 1
)

shift
shift
:try_url
if "%~1"=="" goto download_failed
echo [mediapipe] Downloading %LABEL% from:
echo            %~1
curl.exe -L --connect-timeout 20 --max-time 180 --retry 2 --retry-delay 1 -o "%FILE%" "%~1"
if errorlevel 1 goto next_url
set "SIZE=0"
for %%A in ("%FILE%") do set "SIZE=%%~zA"
if %SIZE% GEQ %MIN_BYTES% (
  echo [mediapipe] model %LABEL% downloaded ^(%SIZE% bytes^)
  exit /b 0
)
echo [mediapipe] Got only %SIZE% bytes - trying next mirror ...
del /f /q "%FILE%" >nul 2>&1
:next_url
shift
goto try_url

:download_failed
echo [ERROR] Could not download %LABEL% model from any mirror.
echo         See public\mediapipe\README.md
exit /b 1
