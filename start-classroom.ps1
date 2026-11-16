param(
    [switch]$NoBrowser,
    [switch]$ExitAfterReady,
    [switch]$PublicScoreboard,
    [ValidateSet('vision.html', 'vision-face.html')]
    [string]$VisionPage = 'vision.html'
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$apiProcess = $null
$viteProcess = $null
$publicServer = $null
$tunnel = $null
$pythonExe = Join-Path $projectRoot 'python\.venv\Scripts\python.exe'
$apiUrl = 'http://127.0.0.1:8765/api/health'
$bankUrl = 'http://127.0.0.1:8765/api/speech/bank'
$defaultBank = 'data/banks/dividend_insurance/answers.json'
$frontUrl = 'http://127.0.0.1:5173/classroom.html'
$visionUrl = "http://127.0.0.1:5173/$VisionPage"
$scoreUrl = 'http://127.0.0.1:5173/scoreboard.html'
$scoreAdminUrl = 'http://127.0.0.1:5173/scoreboard-admin.html'
$publicScoreUrl = 'http://127.0.0.1:8002/scoreboard.html'
$tunnelRunId = [guid]::NewGuid().ToString('N').Substring(0, 8)
$tunnelLog = Join-Path $projectRoot "python\data\scoreboard-tunnel-$tunnelRunId.log"
$tunnelOut = Join-Path $projectRoot "python\data\scoreboard-tunnel-$tunnelRunId.out.log"

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

function Wait-PublicReady([string]$url, [int]$seconds) {
    $until = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $until) {
        if ($tunnel.HasExited) { throw "公网隧道已退出，请检查 $tunnelLog。" }
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 8
            if ($response.StatusCode -eq 200) { return }
        } catch { }
        Start-Sleep -Seconds 2
    }
    throw "公网计分板未能访问：$url"
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
    $null = Wait-HttpReady $apiUrl 30
    $scoreState = Invoke-RestMethod -Uri 'http://127.0.0.1:8765/api/classroom-scores' -TimeoutSec 3
    if (-not $scoreState.PSObject.Properties['names']) {
        throw '检测到旧版课堂 API。请先关闭旧的课堂启动窗口，再运行本脚本。'
    }
    $bankRequest = @{ path = $defaultBank; persist = $false } | ConvertTo-Json -Compress
    $bank = Invoke-RestMethod -Uri $bankUrl -Method Post -ContentType 'application/json; charset=utf-8' -Body $bankRequest -TimeoutSec 10
    if ($bank.relative_path -ne $defaultBank -or $bank.questions.Count -ne 13) {
        throw "默认题库加载失败：$defaultBank"
    }
    Write-Host "已加载默认题库：$defaultBank（13题）"
    $health = Wait-HttpReady $apiUrl 10
    $healthData = $health.Content | ConvertFrom-Json
    if ($healthData.questions_with_audio -lt 1 -or -not $healthData.has_raise_countdown_audio) {
        throw '缺少题目或举手倒计时音频。请先在 python 目录运行 .venv\Scripts\python.exe -m speech_answer.prebuild_audio。'
    }

    try { $null = Invoke-WebRequest -Uri $frontUrl -UseBasicParsing -TimeoutSec 2 } catch {
        Write-Host '启动 Vite 前端…'
        $viteProcess = Start-Process -FilePath 'cmd.exe' -ArgumentList '/d', '/c', 'npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort' -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
    }
    $null = Wait-HttpReady $frontUrl 30
    $null = Wait-HttpReady $visionUrl 10
    $null = Wait-HttpReady $scoreUrl 10
    $null = Wait-HttpReady $scoreAdminUrl 10

    Write-Host "举手识别：$visionUrl"
    Write-Host "抢答页：$frontUrl"
    Write-Host "计分板：$scoreUrl"
    Write-Host "积分管理：$scoreAdminUrl"
    Write-Host '先在举手识别页允许摄像头并锁定人数；再在抢答页点「开始本题」。'
    if (-not $NoBrowser) {
        Start-Process $visionUrl
        Start-Process $frontUrl
        Start-Process $scoreUrl
    }
    if ($PublicScoreboard) {
        $null = Wait-HttpReady 'http://127.0.0.1:8765/api/classroom-scores' 10
        & npm.cmd exec vite build
        if ($LASTEXITCODE -ne 0) { throw '计分板构建失败。' }
        $cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
        if (-not $cloudflared) { throw '找不到 cloudflared，请先安装。' }
        New-Item -ItemType Directory -Path (Join-Path $projectRoot 'python\data') -Force | Out-Null
        $serverReady = $false
        try {
            $existing = Invoke-WebRequest $publicScoreUrl -UseBasicParsing -TimeoutSec 2
            $serverReady = $existing.StatusCode -eq 200 -and $existing.Content -match '<title>计分板</title>'
        } catch { }
        if (-not $serverReady) {
            $publicServer = Start-Process -FilePath $pythonExe -ArgumentList 'scoreboard_public.py' -WorkingDirectory (Join-Path $projectRoot 'python') -WindowStyle Hidden -PassThru
        }
        $null = Wait-HttpReady $publicScoreUrl 20
        $tunnel = Start-Process -FilePath $cloudflared -ArgumentList @('tunnel', '--url', 'http://127.0.0.1:8002') -RedirectStandardError $tunnelLog -RedirectStandardOutput $tunnelOut -WindowStyle Hidden -PassThru
        $until = (Get-Date).AddSeconds(60)
        $publicBase = $null
        while ((Get-Date) -lt $until -and -not $publicBase) {
            if ($tunnel.HasExited) { throw "公网隧道已退出，请检查 $tunnelLog。" }
            if (Test-Path $tunnelLog) {
                $logText = Get-Content -LiteralPath $tunnelLog -Raw
                if ($logText) {
                    $urlMatch = [regex]::Match($logText, 'https://[a-z0-9-]+\.trycloudflare\.com')
                    if ($urlMatch.Success) { $publicBase = $urlMatch.Value }
                }
            }
            Start-Sleep -Milliseconds 500
        }
        if (-not $publicBase) { throw '未获取到临时公网地址。' }
        Wait-PublicReady "$publicBase/scoreboard.html" 90
        Write-Host ''
        Write-Host "公网实时计分板：$publicBase/scoreboard.html" -ForegroundColor Green
        Write-Host '把上面的链接复制给其他电脑；保持此窗口和电脑联网。'
        Read-Host '使用结束后按 Enter 停止课堂服务和公网计分板' | Out-Null
    } elseif (-not $ExitAfterReady) {
        Read-Host '按 Enter 停止本次启动的服务' | Out-Null
    }
} catch {
    Write-Error $_
    exit 1
} finally {
    foreach ($process in @($tunnel, $publicServer)) {
        if ($process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }
    if ($viteProcess -and -not $viteProcess.HasExited) {
        Stop-Process -Id $viteProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($apiProcess -and -not $apiProcess.HasExited) {
        Stop-Process -Id $apiProcess.Id -Force -ErrorAction SilentlyContinue
    }
}
