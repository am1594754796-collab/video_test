@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ========================================
echo  语音作答 · 在线识别（单独启动）
echo  Vite + Python · 仅打开本页
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
echo 答案库相对路径: 见 python\data\answers.path （默认 data/answers.json）
if exist "python\data\api.env" (
  echo 线上语义: 已检测到 python\data\api.env
) else (
  echo 线上语义: 复制 deploy\api.env.example 为 python\data\api.env 并填入 LLM_API_KEY
)
call "%~dp0start-python-api.bat"
if errorlevel 1 (
  pause
  exit /b 1
)

timeout /t 3 /nobreak >nul

echo 启动网页 : http://localhost:5173/speech-online.html
echo 提示: 需联网；请用 Chrome / Edge；不要同时开多个 start-*.bat
start "" "http://localhost:5173/speech-online.html"
call npm.cmd run dev

pause
