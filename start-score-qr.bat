@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ========================================
echo  扫码打分（独立服务，不占用 5173）
echo  六个二维码，各自对应一个编号
echo ========================================
echo.

if not exist "python\.venv\Scripts\python.exe" (
  echo [错误] 找不到 python\.venv\Scripts\python.exe
  echo 请先安装 Python 3，然后在 python 目录执行：
  echo   python -m venv .venv
  echo   .venv\Scripts\python.exe -m pip install -r score_qr\requirements.txt
  pause
  exit /b 1
)

cd python
.venv\Scripts\python.exe -c "import flask, qrcode, PIL" >nul 2>&1
if errorlevel 1 (
  echo 正在安装 Flask 与二维码依赖...
  .venv\Scripts\python.exe -m pip install -r score_qr\requirements.txt
  if errorlevel 1 (
    echo [错误] 依赖安装失败。
    pause
    exit /b 1
  )
)

echo 管理页: http://127.0.0.1:8000
echo 按编号查询: http://127.0.0.1:8000/api/summary/编号
echo.
.venv\Scripts\python.exe -m score_qr
if errorlevel 1 (
  pause
  exit /b 1
)
pause
