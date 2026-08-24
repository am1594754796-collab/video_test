@echo off
rem 启动 python/server.py （127.0.0.1:8765）。由 start-*.bat 调用。
cd /d "%~dp0"

if not exist "python\server.py" (
  echo [错误] 找不到 python\server.py
  exit /b 1
)
if not exist "python\.venv\Scripts\python.exe" (
  echo [错误] 找不到 python\.venv\Scripts\python.exe
  echo   请先创建虚拟环境并安装依赖。
  exit /b 1
)

echo 启动 Python API: python\server.py  →  http://127.0.0.1:8765
start "classroom-api" /D "%~dp0python" "%~dp0python\.venv\Scripts\python.exe" server.py
exit /b 0
