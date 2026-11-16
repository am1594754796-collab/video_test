$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$pythonExe = Join-Path $projectRoot 'python\.venv\Scripts\python.exe'
$dataDir = Join-Path $projectRoot 'python\score_qr\data'
$tunnelLog = Join-Path $dataDir 'cloudflared-public.log'
$tunnelOut = Join-Path $dataDir 'cloudflared-public.out.log'
$tunnel = $null
$localServer = $null
$publicServer = $null
$failed = $false

function Wait-Ready([string]$url) {
    $until = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $until) {
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) { return }
        } catch { }
        Start-Sleep -Milliseconds 300
    }
    throw "服务未启动：$url"
}

function Wait-PublicReady([string]$url, [System.Diagnostics.Process]$tunnelProcess) {
    $until = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $until) {
        if ($tunnelProcess.HasExited) { throw '公网隧道已退出。请检查 cloudflared-public.log。' }
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 8
            if ($response.StatusCode -eq 200 -and $response.Content -match '扫码评分') { return }
        } catch { }
        Start-Sleep -Seconds 2
    }
    throw "公网链接尚未能访问：$url。请检查网络或稍后重新运行。"
}

function Test-PortInUse([int]$port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $result = $client.BeginConnect('127.0.0.1', $port, $null, $null)
        if (-not $result.AsyncWaitHandle.WaitOne(500)) { return $false }
        $client.EndConnect($result)
        return $true
    } catch { return $false } finally { $client.Dispose() }
}

function Get-ListenerPid([int]$port) {
    foreach ($line in (netstat -ano -p tcp)) {
        if ($line -match "^\s*TCP\s+\S+:$port\s+\S+\s+LISTENING\s+(\d+)\s*$") {
            return [int]$Matches[1]
        }
    }
    return $null
}

function Test-ScoreQrService([int]$port) {
    $path = if ($port -eq 8000) { '/live' } else { '/s' }
    try {
        $page = (Invoke-WebRequest "http://127.0.0.1:$port$path" -UseBasicParsing -TimeoutSec 2).Content
        return $page -match '扫码评分|六人扫码评分'
    } catch {
        if ($port -ne 8001) { return $false }
        try {
            $page = (Invoke-WebRequest 'http://127.0.0.1:8001/s/1' -UseBasicParsing -TimeoutSec 2).Content
            return $page -match '打分|评分'
        } catch { return $false }
    }
}

function Stop-OldScoreQrServers {
    $pids = @()
    foreach ($port in 8000, 8001) {
        if (-not (Test-PortInUse $port)) { continue }
        if (-not (Test-ScoreQrService $port)) {
            throw "端口 $port 被其他程序占用，未结束该程序。"
        }
        $listenerPid = Get-ListenerPid $port
        if (-not $listenerPid) { throw "无法识别端口 $port 的进程，未结束该程序。" }
        $pids += $listenerPid
    }
    foreach ($listenerPid in ($pids | Select-Object -Unique)) {
        Stop-Process -Id $listenerPid -Force -ErrorAction Stop
        Write-Host "已结束旧评分服务进程 $listenerPid"
    }
    foreach ($port in 8000, 8001) {
        $until = (Get-Date).AddSeconds(5)
        while ((Get-Date) -lt $until -and (Test-PortInUse $port)) { Start-Sleep -Milliseconds 200 }
        if (Test-PortInUse $port) { throw "端口 $port 尚未释放。" }
    }
}

try {
    if (-not (Test-Path $pythonExe)) {
        if (-not (Get-Command python -ErrorAction SilentlyContinue)) { throw '找不到 Python 3。请先安装 Python。' }
        & python -m venv (Join-Path $projectRoot 'python\.venv')
        if ($LASTEXITCODE -ne 0) { throw '创建 Python 环境失败。' }
    }
    & $pythonExe -c 'import flask, qrcode, PIL'
    if ($LASTEXITCODE -ne 0) {
        & $pythonExe -m pip install -r (Join-Path $projectRoot 'python\score_qr\requirements.txt')
        if ($LASTEXITCODE -ne 0) { throw '扫码评分依赖安装失败。' }
    }
    $cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
    if (-not $cloudflared) { throw '找不到 cloudflared。请先从 Cloudflare 官网安装 cloudflared。' }
    Stop-OldScoreQrServers
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    Remove-Item -LiteralPath $tunnelLog, $tunnelOut -ErrorAction SilentlyContinue
    $tunnel = Start-Process -FilePath $cloudflared -ArgumentList @('tunnel', '--url', 'http://127.0.0.1:8001') -RedirectStandardError $tunnelLog -RedirectStandardOutput $tunnelOut -WindowStyle Hidden -PassThru
    $until = (Get-Date).AddSeconds(45)
    $publicBase = $null
    while ((Get-Date) -lt $until -and -not $publicBase) {
        if ($tunnel.HasExited) {
            $detail = if (Test-Path $tunnelLog) { Get-Content -LiteralPath $tunnelLog -Tail 1 } else { '没有生成日志。' }
            throw "公网连接启动失败：$detail"
        }
        if (Test-Path $tunnelLog) {
            $logText = Get-Content -LiteralPath $tunnelLog -Raw
            if ($logText) {
                $match = [regex]::Match($logText, 'https://[a-z0-9-]+\.trycloudflare\.com')
                if ($match.Success) { $publicBase = $match.Value }
            }
        }
        Start-Sleep -Milliseconds 400
    }
    if (-not $publicBase) { throw '未能获取公网地址。请检查 cloudflared-public.log。' }

    $env:SCORE_QR_PUBLIC_BASE = $publicBase
    $env:SCORE_QR_NO_BROWSER = '1'
    $env:SCORE_QR_PUBLIC_ONLY = '1'
    $env:SCORE_QR_PORT = '8001'
    $publicServer = Start-Process -FilePath $pythonExe -ArgumentList '-m', 'score_qr' -WorkingDirectory (Join-Path $projectRoot 'python') -WindowStyle Hidden -PassThru
    Wait-Ready 'http://127.0.0.1:8001/s/1'
    Remove-Item Env:SCORE_QR_PUBLIC_ONLY, Env:SCORE_QR_PORT
    $localServer = Start-Process -FilePath $pythonExe -ArgumentList '-m', 'score_qr' -WorkingDirectory (Join-Path $projectRoot 'python') -WindowStyle Hidden -PassThru
    Remove-Item Env:SCORE_QR_PUBLIC_BASE, Env:SCORE_QR_NO_BROWSER

    Wait-Ready 'http://127.0.0.1:8000/live'
    $connectedUntil = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $connectedUntil) {
        if ($tunnel.HasExited) { throw '公网连接已断开。请检查 cloudflared-public.log。' }
        if ((Get-Content -LiteralPath $tunnelLog -Raw -ErrorAction SilentlyContinue) -match 'Registered tunnel connection') { break }
        Start-Sleep -Milliseconds 400
    }
    if ((Get-Content -LiteralPath $tunnelLog -Raw -ErrorAction SilentlyContinue) -notmatch 'Registered tunnel connection') {
        throw '公网隧道未连接成功。请检查 cloudflared-public.log。'
    }
    if ($tunnel.HasExited) { throw '公网连接已断开。请检查 cloudflared-public.log。' }
    Write-Host '正在确认公网评分页面可以访问…'
    Wait-PublicReady "$publicBase/s/1" $tunnel
    Write-Host ''
    Write-Host '本次公网链接（复制到浏览器即可打开）：' -ForegroundColor Green
    Write-Host "六人平均分：$publicBase/live"
    Write-Host "单人展示：$publicBase/person?slot=1"
    Write-Host "二维码展示：$publicBase/qrs"
    foreach ($slot in 1..6) { Write-Host "${slot}号评分：$publicBase/s/$slot" }
    Write-Host ''
    Write-Host '本机管理页：http://127.0.0.1:8000/'
    Write-Host '评分保存在本机。保持此窗口和电脑联网；每次重启会得到新链接。'
    Read-Host '评分结束后按 Enter 关闭公网连接' | Out-Null
} catch {
    $failed = $true
    Write-Host "启动失败：$_" -ForegroundColor Red
    Read-Host '按 Enter 退出' | Out-Null
} finally {
    foreach ($process in @($localServer, $publicServer, $tunnel)) {
        if ($process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item Env:SCORE_QR_PUBLIC_BASE, Env:SCORE_QR_PUBLIC_ONLY, Env:SCORE_QR_PORT, Env:SCORE_QR_NO_BROWSER -ErrorAction SilentlyContinue
}
if ($failed) { exit 1 }
