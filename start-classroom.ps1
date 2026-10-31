param(
    [switch]$NoBrowser,
    [switch]$ExitAfterReady
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$apiProcess = $null
$viteProcess = $null
$pythonExe = Join-Path $projectRoot 'python\.venv\Scripts\python.exe'
$apiUrl = 'http://127.0.0.1:8765/api/health'
$frontUrl = 'http://127.0.0.1:5173/classroom.html'
$scoreUrl = 'http://127.0.0.1:5173/scoreboard.html'

function Wait-HttpReady([string]$url, [int]$seconds) {
    $until = (Get-Date).AddSeconds($seconds)
    do {
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) { return $response }
        } catch { }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $until)
    throw "服务未就绪：$url"
}

try {
    Set-Location $projectRoot
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw '未找到 Node.js。' }
    if (-not (Test-Path 'node_modules\vite\bin\vite.js')) {
        Write-Host '安装前端依赖…'
        & npm.cmd install
        if ($LASTEXITCODE -ne 0) { throw 'npm install 失败。' }
    }
    if (-not (Test-Path $pythonExe)) {
        if (-not (Get-Command python -ErrorAction SilentlyContinue)) { throw '未找到 Python 3。' }
        Write-Host '创建 Python 虚拟环境…'
        & python -m venv 'python\.venv'
        if ($LASTEXITCODE -ne 0) { throw '创建 Python 虚拟环境失败。' }
        & $pythonExe -m pip install -r 'python\requirements.txt'
        if ($LASTEXITCODE -ne 0) { throw '安装 Python 依赖失败。' }
    }
    & "$projectRoot\setup-mediapipe.bat"
    if ($LASTEXITCODE -ne 0) { throw 'MediaPipe 模型或 WASM 未准备好。' }

    try { $null = Invoke-WebRequest -Uri $apiUrl -UseBasicParsing -TimeoutSec 2 } catch {
        Write-Host '启动 Python API…'
        $apiProcess = Start-Process -FilePath $pythonExe -ArgumentList 'server.py' -WorkingDirectory (Join-Path $projectRoot 'python') -WindowStyle Hidden -PassThru
    }
    $health = Wait-HttpReady $apiUrl 30
    $healthData = $health.Content | ConvertFrom-Json
    if ($healthData.questions_with_audio -lt 1 -or -not $healthData.has_raise_countdown_audio) {
        throw '缺少题目或举手倒计时音频。请先在 python 目录运行 .venv\Scripts\python.exe -m speech_answer.prebuild_audio。'
    }

    try { $null = Invoke-WebRequest -Uri $frontUrl -UseBasicParsing -TimeoutSec 2 } catch {
        Write-Host '启动 Vite 前端…'
        $viteProcess = Start-Process -FilePath 'cmd.exe' -ArgumentList '/d', '/c', 'npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort' -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
    }
    $null = Wait-HttpReady $frontUrl 30
    $null = Wait-HttpReady $scoreUrl 10

    Write-Host "抢答页：$frontUrl"
    Write-Host "计分板：$scoreUrl"
    Write-Host '等待视觉编号锁定后，第一题点「开始本题」；后续题自动继续。'
    if (-not $NoBrowser) {
        Start-Process $frontUrl
        Start-Process $scoreUrl
    }
    if (-not $ExitAfterReady) {
        Read-Host '按 Enter 停止本次启动的服务' | Out-Null
    }
} catch {
    Write-Error $_
    exit 1
} finally {
    if ($viteProcess -and -not $viteProcess.HasExited) {
        Stop-Process -Id $viteProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($apiProcess -and -not $apiProcess.HasExited) {
        Stop-Process -Id $apiProcess.Id -Force -ErrorAction SilentlyContinue
    }
}
