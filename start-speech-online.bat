@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ========================================
echo  Speech online (this page only)
echo  Vite + Python API
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  pause
  exit /b 1
)

where python >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python not found. Install Python 3 from https://www.python.org/
  echo         Do not use the Microsoft Store placeholder.
  pause
  exit /b 1
)

python -c "import sys; raise SystemExit(0 if sys.version_info[0]>=3 else 1)" >nul 2>&1
if errorlevel 1 (
  echo [ERROR] "python" is not a real interpreter (Store stub?).
  echo         Install Python 3 and ensure "Add to PATH" is checked.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [npm] install ...
  call npm.cmd install
)

if not exist "python\.venv\" (
  echo [python] creating venv and installing deps ...
  python -m venv python\.venv
  if errorlevel 1 (
    echo [ERROR] python -m venv failed
    pause
    exit /b 1
  )
  call python\.venv\Scripts\python.exe -m pip install -r python\requirements.txt
) else (
  call python\.venv\Scripts\python.exe -m pip install -r python\requirements.txt -q
)

echo.
echo Answers path: python\data\answers.path (default data/answers.json)
if exist "python\data\api.env" (
  echo LLM: found python\data\api.env
) else (
  echo LLM: copy deploy\api.env.example to python\data\api.env and set LLM_API_KEY
)

call "%~dp0start-python-api.bat"
if errorlevel 1 (
  pause
  exit /b 1
)

timeout /t 2 /nobreak >nul

echo.
echo Page: http://127.0.0.1:5173/speech-online.html
echo Need network + Chrome/Edge. Do not run multiple start-*.bat at once.
echo.

call "%~dp0_dev-open.bat" "speech-online.html"
if errorlevel 1 (
  pause
  exit /b 1
)
pause
