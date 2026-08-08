@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ========================================
echo  举手行为检测 - 一键启动
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [错误] 未检测到 Node.js。
  echo.
  echo 请先安装，推荐在 PowerShell / CMD 执行：
  echo   winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  echo.
  echo 或打开官网下载 LTS: https://nodejs.org/
  echo 安装完成后请重新打开本窗口再运行 start.bat
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do echo Node: %%v

if not exist "node_modules\" (
  echo.
  echo [1/2] 首次运行，正在 npm install ...
  call npm.cmd install
  if errorlevel 1 (
    echo [错误] npm install 失败
    pause
    exit /b 1
  )
) else (
  echo [1/2] 依赖已存在，跳过 install
)

echo.
echo [2/2] 启动开发服务 http://localhost:5173/
echo 按 Ctrl+C 可停止
echo.

start "" "http://localhost:5173/"
call npm.cmd run dev

pause
