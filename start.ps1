# 举手行为检测 - 一键启动（PowerShell）
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "========================================"
Write-Host " 举手行为检测 - 一键启动"
Write-Host "========================================"
Write-Host ""

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "[错误] 未检测到 Node.js。" -ForegroundColor Red
  Write-Host ""
  Write-Host "请先安装，推荐执行："
  Write-Host '  winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements'
  Write-Host ""
  Write-Host "或打开官网下载 LTS: https://nodejs.org/"
  Write-Host "安装完成后请重新打开终端再运行。"
  exit 1
}
Write-Host "Node: $(node -v)"

if (-not (Test-Path ".\node_modules")) {
  Write-Host ""
  Write-Host "[1/2] 首次运行，正在 npm install ..."
  & npm.cmd install
  if ($LASTEXITCODE -ne 0) { throw "npm install 失败" }
} else {
  Write-Host "[1/2] 依赖已存在，跳过 install"
}

Write-Host ""
Write-Host "[2/2] 启动开发服务 http://localhost:5173/"
Write-Host "按 Ctrl+C 可停止"
Write-Host ""

Start-Process "http://localhost:5173/"
& npm.cmd run dev
