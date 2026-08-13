@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ========================================
echo  计分板 - 举手闪烁 + 语音加分
echo  ^(Vite + Python API^)
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
start "scoreboard-api" cmd /c "cd /d "%~dp0python" && .venv\Scripts\uvicorn.exe server:app --host 127.0.0.1 --port 8765"

timeout /t 2 /nobreak >nul

echo 启动网页 : http://localhost:5173/scoreboard.html
start "" "http://localhost:5173/scoreboard.html"
call npm.cmd run dev

pause
