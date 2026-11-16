@echo off
chcp 65001 >nul
cd /d "%~dp0countdown_cloud"

echo ========================================
echo   独立倒计时 - 部署到 Cloudflare Pages
echo ========================================
echo.
echo 部署后得到固定公网地址，电脑可关机，任意设备打开即可。
echo 与课堂举手/计分板无关；每人打开后自己点开始。
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js，请先安装后再运行。
  pause
  exit /b 1
)

if not exist "..\score_qr_cloud\node_modules\wrangler\" (
  if not exist "node_modules\wrangler\" (
    echo 正在安装 wrangler...
    call npm install wrangler@^4.158.0 --no-save
    if errorlevel 1 (
      echo 依赖安装失败。也可先运行「部署扫码评分到云端.bat」装好 wrangler。
      pause
      exit /b 1
    )
  )
)

echo.
echo 正在部署。若尚未登录 Cloudflare，请在弹出的浏览器中完成授权。
echo.
call npm run deploy:cloudflare
if errorlevel 1 (
  echo.
  echo 部署失败。可先执行: cd score_qr_cloud ^&^& npx wrangler login
  pause
  exit /b 1
)
echo.
pause
exit /b 0
