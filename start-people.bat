@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ========================================
echo  人物数量页 - 一键启动
echo  ^(Vite + Python 排序服务^)
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [错误] 未检测到 Node.js。
  echo   winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  pause
  exit /b 1
)

where python >nul 2>&1
if errorlevel 1 (
  echo [错误] 未检测到 Python。
  echo   winget install Python.Python.3.12 --accept-package-agreements --accept-source-agreements
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
start "people-sort-api" cmd /c "cd /d "%~dp0python" && .venv\Scripts\uvicorn.exe server:app --host 127.0.0.1 --port 8765"

timeout /t 2 /nobreak >nul

echo 启动网页 : http://localhost:5173/people.html
start "" "http://localhost:5173/people.html"
call npm.cmd run dev

pause
