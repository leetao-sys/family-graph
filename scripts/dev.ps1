#Requires -Version 5.1
<#
.SYNOPSIS
    同时启动 family-graph 的后端（FastAPI / uvicorn）与前端（Vite）。

.DESCRIPTION
    默认后端 http://127.0.0.1:8000、前端 http://127.0.0.1:5173，前端 /api 代理到后端。
    启动顺序：检查依赖与端口 → 启动后端并等待 /api/health 就绪 → 启动前端并等待页面就绪。
    任一服务退出或按 Ctrl+C 时，两个服务会一起停止。

    Windows PowerShell 5.1 与 PowerShell 7 均可使用。

.PARAMETER BackendPort
    后端端口，默认 8000。

.PARAMETER FrontendPort
    前端端口，默认 5173。

.PARAMETER BindHost
    后端与前端 dev server 的监听地址，默认 127.0.0.1（只允许本机访问；要让局域网访问可传 0.0.0.0）。

.PARAMETER NoReload
    关闭 uvicorn 的代码热重载（--reload）。

.PARAMETER SkipChecks
    跳过端口占用检查与启动就绪等待（例如系统代理干扰本机 HTTP 探测时）。

.PARAMETER TimeoutSeconds
    等待单个服务就绪的最长秒数，默认 60。

.EXAMPLE
    .\scripts\dev.ps1

.EXAMPLE
    .\scripts\dev.ps1 -BackendPort 8001 -FrontendPort 5191

.EXAMPLE
    .\scripts\dev.ps1 -NoReload
#>
[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$BackendPort = 8000,

    [ValidateRange(1, 65535)]
    [int]$FrontendPort = 5173,

    [string]$BindHost = "127.0.0.1",

    [switch]$NoReload,

    [switch]$SkipChecks,

    [ValidateRange(5, 600)]
    [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $root "backend"
$frontendDir = Join-Path $root "frontend"

# 监听 0.0.0.0 时，本机访问仍用 127.0.0.1 探测和展示
$localHost = $BindHost
if ($BindHost -eq "0.0.0.0" -or $BindHost -eq "::" -or $BindHost -eq "[::]") {
    $localHost = "127.0.0.1"
}
$apiBase = "http://$($localHost):$BackendPort"
$webBase = "http://$($localHost):$FrontendPort"

function Write-Step([string]$Message) {
    Write-Host "[dev] $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
    Write-Host "[dev] $Message" -ForegroundColor Green
}

function Write-Fail([string]$Message) {
    Write-Host "[dev] $Message" -ForegroundColor Red
}

function Write-Note([string]$Message) {
    Write-Host "[dev] $Message" -ForegroundColor Yellow
}

function Get-PythonCandidates {
    $paths = @(
        (Join-Path $backendDir ".venv\Scripts\python.exe"),
        (Join-Path $root ".venv\Scripts\python.exe"),
        (Join-Path $backendDir ".venv\bin\python"),
        (Join-Path $root ".venv\bin\python")
    )
    $result = @()
    foreach ($path in $paths) {
        if (Test-Path -LiteralPath $path -PathType Leaf) { $result += $path }
    }
    $command = Get-Command python -ErrorAction SilentlyContinue
    if ($null -ne $command -and $result -notcontains $command.Source) {
        $result += $command.Source
    }
    return $result
}

function Find-Npm {
    foreach ($name in @("npm.cmd", "npm")) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($null -ne $command -and $command.Source -notlike "*.ps1") { return $command.Source }
    }
    return $null
}

function Test-PortInUse([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(300)) { return $false }
        $client.EndConnect($async)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Wait-ServiceReady {
    param(
        [string]$Url,
        [System.Diagnostics.Process]$Process,
        [int]$TimeoutSeconds
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($Process.HasExited) { return "exited" }
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return "ready" }
        } catch {
            # 服务尚未监听或仍在初始化，继续等待
        }
        Start-Sleep -Milliseconds 300
    }
    return "timeout"
}

function Stop-ServiceTree {
    param(
        [System.Diagnostics.Process]$Process,
        [string]$Name
    )
    if ($null -eq $Process) { return }
    try { $Process.Refresh() } catch { }
    if ($Process.HasExited) { return }
    Write-Step "停止$Name（PID $($Process.Id)）"
    & taskkill.exe /PID $Process.Id /T /F 1>$null 2>$null
    if ($LASTEXITCODE -ne 0 -and -not $Process.HasExited) {
        Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------- 环境检查

if ($PSVersionTable.PSEdition -eq "Core" -and -not $IsWindows) {
    Write-Fail "该脚本面向 Windows；Linux / macOS 请按 README 的「本地开发」手动启动。"
    exit 1
}

Write-Host ""
Write-Host "family-graph 本地开发" -ForegroundColor White
Write-Host "前端 + 后端一起启动，Ctrl+C 一起停止" -ForegroundColor DarkGray
Write-Host ""

if (-not (Test-Path -LiteralPath $backendDir -PathType Container)) {
    Write-Fail "找不到后端目录：$backendDir"
    exit 1
}
if (-not (Test-Path -LiteralPath $frontendDir -PathType Container)) {
    Write-Fail "找不到前端目录：$frontendDir"
    exit 1
}

# 依次探测 backend/.venv、根目录 .venv、PATH 中的 python，选用依赖完整的那一个
$importProbe = @'
import sys

modules = ["fastapi", "uvicorn", "sqlalchemy", "alembic", "pydantic", "jwt", "PIL", "multipart", "lunardate"]
missing = []
for name in modules:
    try:
        __import__(name)
    except Exception:
        missing.append(name)

if missing:
    print(", ".join(missing))
    sys.exit(1)
sys.exit(0)
'@
$candidates = @(Get-PythonCandidates)
if ($candidates.Count -eq 0) {
    Write-Fail "没有找到 Python。请先创建后端虚拟环境并安装依赖："
    Write-Host "  cd backend"
    Write-Host "  python -m venv .venv"
    Write-Host "  .venv\Scripts\pip install -r requirements.txt"
    exit 1
}

$python = $null
$skipped = @()
foreach ($candidate in $candidates) {
    $missing = $importProbe | & $candidate - 2>$null
    if ($LASTEXITCODE -eq 0) {
        $python = $candidate
        break
    }
    $skipped += [pscustomobject]@{
        Path = $candidate
        Missing = (($missing | Where-Object { $_ -ne "" }) -join ", ")
    }
}

if ($null -eq $python) {
    Write-Fail "找到的 Python 都缺少后端依赖："
    foreach ($item in $skipped) {
        Write-Host "  $($item.Path)  缺少：$($item.Missing)"
    }
    Write-Host "  请安装依赖后重试："
    Write-Host "  cd backend"
    Write-Host "  .venv\Scripts\pip install -r requirements.txt"
    exit 1
}
foreach ($item in $skipped) {
    Write-Note "跳过依赖不完整的环境：$($item.Path)（缺少 $($item.Missing)）"
}
Write-Step "后端解释器：$python"

$npm = Find-Npm
if ($null -eq $npm) {
    Write-Fail "没有找到 npm。请安装 Node.js 20+ 后重试。"
    exit 1
}
if (-not (Test-Path -LiteralPath (Join-Path $frontendDir "node_modules\vite") -PathType Container)) {
    Write-Fail "前端依赖尚未安装，请先执行："
    Write-Host "  cd frontend"
    Write-Host "  npm install"
    exit 1
}
Write-Step "前端启动器：$npm"

if ($BackendPort -eq $FrontendPort) {
    Write-Fail "后端与前端不能使用同一个端口（当前都是 $BackendPort）。"
    exit 1
}

if (-not $SkipChecks) {
    if (Test-PortInUse $BackendPort) {
        Write-Fail "端口 $BackendPort 已被占用（后端）。请先停止占用进程，或用 -BackendPort 指定其他端口。"
        exit 1
    }
    if (Test-PortInUse $FrontendPort) {
        Write-Fail "端口 $FrontendPort 已被占用（前端）。请先停止占用进程，或用 -FrontendPort 指定其他端口。"
        exit 1
    }
}

New-Item -ItemType Directory -Force -Path (Join-Path $backendDir "data") | Out-Null

# ---------------------------------------------------------------- 启动服务

$apiProcess = $null
$webProcess = $null
$exitCode = 0

try {
    $apiArgs = @("-m", "uvicorn", "app.main:app", "--host", $BindHost, "--port", [string]$BackendPort)
    if (-not $NoReload) {
        $apiArgs += @("--reload", "--reload-dir", "app")
        $reloadText = "热重载 app/"
    } else {
        $reloadText = "不热重载"
    }

    Write-Step "启动后端：$BindHost`:$BackendPort（$reloadText）"
    Push-Location $backendDir
    try {
        $apiProcess = Start-Process -FilePath $python -ArgumentList $apiArgs -NoNewWindow -PassThru
    } finally {
        Pop-Location
    }

    if (-not $SkipChecks) {
        Write-Step "等待后端就绪：$apiBase/api/health"
        $state = Wait-ServiceReady -Url "$apiBase/api/health" -Process $apiProcess -TimeoutSeconds $TimeoutSeconds
        if ($state -eq "exited") {
            throw "后端进程启动后立即退出，请查看上面的错误日志。"
        }
        if ($state -eq "timeout") {
            throw "后端在 $TimeoutSeconds 秒内没有就绪。可加大 -TimeoutSeconds，或用 -SkipChecks 跳过等待。"
        }
        Write-Ok "后端已就绪"
    }

    # 前端 dev server 的 /api 代理目标，让自定义端口也能正确转发
    $env:API_TARGET = $apiBase
    Write-Step "启动前端：$webBase（/api -> $apiBase）"
    $webArgs = @("run", "dev", "--", "--host", $BindHost, "--port", [string]$FrontendPort, "--strictPort")
    Push-Location $frontendDir
    try {
        $webProcess = Start-Process -FilePath $npm -ArgumentList $webArgs -NoNewWindow -PassThru
    } finally {
        Pop-Location
    }

    if (-not $SkipChecks) {
        Write-Step "等待前端就绪：$webBase"
        $state = Wait-ServiceReady -Url "$webBase/" -Process $webProcess -TimeoutSeconds $TimeoutSeconds
        if ($state -eq "exited") {
            throw "前端进程启动后立即退出，请查看上面的错误日志。"
        }
        if ($state -eq "timeout") {
            throw "前端在 $TimeoutSeconds 秒内没有就绪。可加大 -TimeoutSeconds，或用 -SkipChecks 跳过等待。"
        }
        Write-Ok "前端已就绪"
    }

    Write-Host ""
    Write-Ok "两个服务都已启动"
    Write-Host "  前端页面：$webBase"
    Write-Host "  后端接口：$apiBase/api/health    文档：$apiBase/api/docs"
    Write-Host "  接口代理：/api -> $apiBase"
    if ($localHost -ne $BindHost) {
        Write-Host "  监听地址：$BindHost（局域网用本机 IP 访问）"
    }
    Write-Host "  停止服务：Ctrl+C"
    Write-Host ""

    while ($true) {
        if ($apiProcess.HasExited) {
            Write-Fail "后端进程已退出（退出码 $($apiProcess.ExitCode)）。"
            $exitCode = if ($apiProcess.ExitCode -ne 0) { $apiProcess.ExitCode } else { 1 }
            break
        }
        if ($webProcess.HasExited) {
            Write-Fail "前端进程已退出（退出码 $($webProcess.ExitCode)）。"
            $exitCode = if ($webProcess.ExitCode -ne 0) { $webProcess.ExitCode } else { 1 }
            break
        }
        Start-Sleep -Milliseconds 500
    }
} catch {
    Write-Fail $_.Exception.Message
    $exitCode = 1
} finally {
    Stop-ServiceTree -Process $webProcess -Name "前端"
    Stop-ServiceTree -Process $apiProcess -Name "后端"
}

exit $exitCode
