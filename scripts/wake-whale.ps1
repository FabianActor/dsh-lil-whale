# wake-whale.ps1 -- 把她叫起来（ASCII 文件名；UTF-8 带 BOM）
# 每一步都往 dsh-home\logs\wake.log 记一行，以便在"被插件调起"的环境里也能看清发生了什么。
param([int]$Port = 3082, [int]$WaitSeconds = 25)

$ErrorActionPreference = 'Stop'

$home_  = 'D:\文档\WorkSpace\lil-whale\dsh-home'
$cwd    = 'D:\文档\WorkSpace\lil-whale'
$logdir = Join-Path $home_ 'logs'
New-Item -ItemType Directory -Force -Path $logdir | Out-Null
$outLog = Join-Path $logdir 'web-latest.log'
$errLog = Join-Path $logdir 'web-latest.err.log'
$wakeLog = Join-Path $logdir 'wake.log'

function Log([string]$msg) {
  $line = "{0} | {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -LiteralPath $wakeLog -Value $line -Encoding utf8
}

function Test-Port([int]$p) {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', $p); return $true } catch { return $false } finally { $c.Dispose() }
}

Log ("call port={0} wait={1}s pid={2}" -f $Port, $WaitSeconds, $PID)

if (Test-Port $Port) {
  Log "already-awake"
  Write-Output "already-awake ($Port)"
  exit 0
}

try {
  $command = "`$env:DSH_HOME='$home_'; dsh --profile whale --port $Port --no-open"
  Start-Process -FilePath 'pwsh' -ArgumentList '-NoLogo', '-NoProfile', '-Command', $command `
    -WorkingDirectory $cwd -WindowStyle Hidden `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog | Out-Null
  Log "spawned"
}
catch {
  Log ("spawn-failed: {0}" -f $_.Exception.Message)
  Write-Output ("spawn-failed: " + $_.Exception.Message)
  exit 1
}

for ($i = 0; $i -lt $WaitSeconds * 2; $i++) {
  Start-Sleep -Milliseconds 500
  if (Test-Port $Port) {
    Log ("awake after {0}ms" -f ($i * 500))
    Write-Output "awake (http://127.0.0.1:$Port)  日志: $outLog"
    exit 0
  }
}

Log "timeout: port still closed"
Write-Output "failed: $Port 没起来，看 $wakeLog 和 $errLog"
exit 1
