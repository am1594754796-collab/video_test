@echo off
chcp 65001 >nul
cd /d "%~dp0score_qr_cloud"

echo ========================================
echo   扫码评分 - 部署到 Cloudflare Pages
echo ========================================
echo.
echo 部署后得到固定 https://score-qr.pages.dev 地址。
echo 电脑可关机；数据保存在 Cloudflare D1，展示页会实时更新。
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js，请先安装后再运行。
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo 正在安装依赖...
  call npm install
  if errorlevel 1 (
    echo 依赖安装失败。
    pause
    exit /b 1
  )
)

echo.
echo 正在部署。若尚未登录 Cloudflare，请在弹出的浏览器中完成授权。
echo.
call npm run deploy:cloudflare
if errorlevel 1 (
  echo.
  echo 部署失败。可先执行: npx wrangler login
  pause
  exit /b 1
)
echo.
echo 管理口令在 score_qr_cloud\admin-token.txt
pause
exit /b 0
