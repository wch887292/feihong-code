# 飞虹 Code (fhcode) Web 控制台 一键启动脚本
# 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
# 用法：
#   .\启动Web控制台.ps1            # 默认端口 8080
#   .\启动Web控制台.ps1 -Port 9000 # 自定义端口
#   .\启动Web控制台.ps1 -NoBuild   # 跳过编译（dist 已是最新时）
[CmdletBinding()]
param(
    [int]$Port = 0,          # 0 = 使用 FH_WEB_PORT 或默认 8080
    [switch]$NoBuild         # 跳过 npm run build
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$env:FH_WEB_PORT = if ($Port -gt 0) { "$Port" } elseif ($env:FH_WEB_PORT) { $env:FH_WEB_PORT } else { '8080' }
$logFile = Join-Path $root 'web-console.log'

# 端口占用检测与自动换端口（避免 EADDRINUSE 导致启动失败）
function Test-PortFree($p) {
    try {
        $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $p)
        $l.Start(); $l.Stop(); return $true
    } catch { return $false }
}
if (-not (Test-PortFree ([int]$env:FH_WEB_PORT))) {
    Write-Warn "端口 $env:FH_WEB_PORT 已被占用，自动寻找空闲端口..."
    $tried = [int]$env:FH_WEB_PORT
    while (-not (Test-PortFree $tried)) { $tried++ }
    $env:FH_WEB_PORT = "$tried"
    Write-Ok "改用端口 $env:FH_WEB_PORT"
}

function Write-Step($n, $msg) { Write-Host "[$n/3] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)       { Write-Host "      [✓] $msg" -ForegroundColor Green }
function Write-Warn($msg)     { Write-Host "      [!] $msg" -ForegroundColor Yellow }

Write-Host "`n============================================" -ForegroundColor DarkCyan
Write-Host "   飞虹 Code (fhcode) Web 控制台 一键启动" -ForegroundColor Magenta
Write-Host "   晋江市飞虹智科技企业管理有限公司" -ForegroundColor DarkGray
Write-Host "============================================" -ForegroundColor DarkCyan

# 1. 编译
if ($NoBuild) {
    Write-Step 1 "跳过编译 (-NoBuild)"
} else {
    Write-Step 1 "正在编译产物 (npm run build)..."
    $buildOut = & npm run build 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "编译失败，请手动运行 'npm run build' 查看错误："
        $buildOut | Select-Object -Last 15 | ForEach-Object { Write-Host "        $_" -ForegroundColor Red }
        exit 1
    }
    Write-Ok "编译完成"
}

# 2. 启动服务（后台，输出到日志）
Write-Step 2 "正在启动 Web 服务 (fhcode serve, 端口 $env:FH_WEB_PORT)..."
if (Test-Path $logFile) { Remove-Item $logFile -Force }
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'cmd.exe'
$psi.Arguments = "/c node dist/cli/index.js serve > `"$logFile`" 2>&1"
$psi.WindowStyle = 'Hidden'
$psi.UseShellExecute = $false
$proc = [System.Diagnostics.Process]::Start($psi)

# 3. 等待就绪 + 打开浏览器
Write-Step 3 "等待服务就绪并打开浏览器..."
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$env:FH_WEB_PORT:/api/health" -UseBasicParsing -TimeoutSec 1
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
    Start-Sleep -Seconds 1
}

if (-not $ready) {
    Write-Warn "服务启动超时，请查看 $logFile"
    if (Test-Path $logFile) { Get-Content $logFile | Select-Object -Last 20 | ForEach-Object { Write-Host "        $_" -ForegroundColor Red } }
    exit 1
}

# 从日志嗅探 token（自动生成的或配置的）
$token = ''
if (Test-Path $logFile) {
    $token = (Select-String -Path $logFile -Pattern 'token[=: ]+([0-9a-f]{10,})' | Select-Object -First 1).Matches.Groups[1].Value
}

$url = "http://127.0.0.1:$env:FH_WEB_PORT/"
Write-Host "`n============================================" -ForegroundColor DarkCyan
Write-Host "   控制台已启动！" -ForegroundColor Green
Write-Host "   地址: $url" -ForegroundColor White
if ($token) {
    Write-Host "   访问令牌 (Bearer): $token" -ForegroundColor Yellow
    Write-Host "   API 调用示例: curl -H `"Authorization: Bearer $token`" $url``api/health" -ForegroundColor DarkGray
} else {
    Write-Host "   令牌: 使用环境变量 FH_WEB_TOKEN 或查看 $logFile" -ForegroundColor DarkGray
}
Write-Host "============================================`n" -ForegroundColor DarkCyan

# 打开浏览器
try { Start-Process $url } catch { Write-Warn "无法自动打开浏览器，请手动访问 $url" }

Write-Host "服务在后台运行。关闭本窗口不会停止服务；停止请结束 fhcode-web 进程 (node dist/cli/index.js serve)。`n" -ForegroundColor DarkGray
Write-Host "按任意键退出此启动器（服务继续运行）..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
