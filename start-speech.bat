@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ========================================
echo  语音作答测试 - 一键启动
echo  ^(Vite + Python · 按下录音 · 离线匹配^)
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [错误] 未检测到 Node.js。
  pause
  exit /b 1
)

where python >nul 2>&1
if errorlevel 1 (
  echo [错误] 未检测到 Python。
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [npm] install ...
  call npm.cmd install
)

if not exist "python\.venv\" (
  echo [python] 创建虚拟环境并安装依赖 ...
  python -m venv python\.venv
  call python\.venv\Scripts\python.exe -m pip install -r python\requirements.txt
) else (
  call python\.venv\Scripts\python.exe -m pip install -r python\requirements.txt -q
)

echo.
echo 启动 Python API : http://127.0.0.1:8765
echo 提示: 首次语音识别会下载 Whisper 模型，请耐心等待
start "speech-api" cmd /c "cd /d "%~dp0python" && set SPEECH_WHISPER_MODEL=base&& .venv\Scripts\uvicorn.exe server:app --host 127.0.0.1 --port 8765"

timeout /t 2 /nobreak >nul

echo 启动网页 : http://localhost:5173/speech.html
start "" "http://localhost:5173/speech.html"
call npm.cmd run dev

pause
