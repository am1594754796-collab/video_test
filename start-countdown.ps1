param(
    [switch]$NoBrowser,
    [switch]$Public,
    [int]$Port = 5174
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$localUrl = "http://127.0.0.1:$Port/countdown.html"
$publicLocalUrl = 'http://127.0.0.1:8003/countdown.html'
$pythonExe = Join-Path $projectRoot 'python\.venv\Scripts\python.exe'
if (-not (Test-Path $pythonExe)) {
    $pythonExe = (Get-Command python -ErrorAction SilentlyContinue).Source
}
if (-not $pythonExe) { throw '未找到 Python，无法启动倒计时服务。' }

$server = $null
$publicServer = $null
$tunnel = $null
$tunnelRunId = [guid]::NewGuid().ToString('N').Substring(0, 8)
$tunnelLog = Join-Path $projectRoot "python\data\countdown-tunnel-$tunnelRunId.log"
$tunnelOut = Join-Path $projectRoot "python\data\countdown-tunnel-$tunnelRunId.out.log"

function Wait-HttpReady([string]$url, [int]$seconds) {
    $until = (Get-Date).AddSeconds($seconds)
    do {
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) { return }
        } catch { }
        Start-Sleep -Milliseconds 400
    } while ((Get-Date) -lt $until)
    throw "服务未就绪：$url"
}

try {
    Set-Location $projectRoot
    New-Item -ItemType Directory -Path (Join-Path $projectRoot 'python\data') -Force | Out-Null

    if ($Public) {
        $cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
        if (-not $cloudflared) { throw '找不到 cloudflared，请先安装后再开公网倒计时。' }

        $ready = $false
        try {
            $existing = Invoke-WebRequest -Uri $publicLocalUrl -UseBasicParsing -TimeoutSec 2
            $ready = $existing.StatusCode -eq 200
        } catch { }
        if (-not $ready) {
            Write-Host '启动独立倒计时服务（与课堂无关）…'
            $publicServer = Start-Process -FilePath $pythonExe -ArgumentList 'countdown_public.py' `
                -WorkingDirectory (Join-Path $projectRoot 'python') -WindowStyle Hidden -PassThru
        }
        Wait-HttpReady $publicLocalUrl 15

        Write-Host '创建临时公网隧道…'
        $tunnel = Start-Process -FilePath $cloudflared -ArgumentList @('tunnel', '--url', 'http://127.0.0.1:8003') `
            -RedirectStandardError $tunnelLog -RedirectStandardOutput $tunnelOut -WindowStyle Hidden -PassThru

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

        $publicPage = "$publicBase/countdown.html"
        Wait-HttpReady $publicPage 90
        Write-Host ''
        Write-Host "公网倒计时（独立页面）：$publicPage" -ForegroundColor Green
        Write-Host '把上面链接发给任意电脑即可打开；每人自己点开始，互不影响。'
        Write-Host '本机需保持窗口运行和联网；关掉后公网链接失效。'
        if (-not $NoBrowser) { Start-Process $publicPage }
        Read-Host '使用结束后按 Enter 停止公网倒计时' | Out-Null
        return
    }

    $ready = $false
    try {
        $existing = Invoke-WebRequest -Uri $localUrl -UseBasicParsing -TimeoutSec 2
        $ready = $existing.StatusCode -eq 200
    } catch { }

    if (-not $ready) {
        Write-Host "启动本机倒计时：$localUrl"
        $server = Start-Process -FilePath $pythonExe -ArgumentList @(
            '-m', 'http.server', "$Port", '--bind', '127.0.0.1'
        ) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
        Wait-HttpReady $localUrl 15
    } else {
        Write-Host "已在运行：$localUrl"
    }

    Write-Host "本机网址：$localUrl"
    Write-Host '其他电脑要用公网链接：请运行 start-countdown-public.bat'
    if (-not $NoBrowser) { Start-Process $localUrl }
    if ($server) {
        Write-Host '按 Enter 停止本次倒计时服务。'
        [void][System.Console]::ReadLine()
    }
}
catch {
    Write-Error $_
    exit 1
}
finally {
    foreach ($process in @($tunnel, $publicServer, $server)) {
        if ($process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }
}
