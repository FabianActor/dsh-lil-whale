# wake-whale.ps1 -- 把她叫起来（ASCII 文件名；UTF-8 带 BOM）
# 每一步都往 dsh-home\logs\wake.log 记一行，以便在"被插件调起"的环境里也能看清发生了什么。
# 2026-11-10 她要求：call 行必须带 why=（manual / plan / archive），并带 gap=（距上一行多少秒），
# 理由："推了门但没带话"必须留痕，否则它跟"没人来过"又是一张脸。
param([int]$Port = 3082, [int]$WaitSeconds = 25, [string]$Why = 'manual')

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'common.ps1')

$home_  = $Cfg.HerDshHome
$cwd    = $Cfg.WhaleCwd
$logdir = Join-Path $home_ 'logs'
New-Item -ItemType Directory -Force -Path $logdir | Out-Null
$outLog = Join-Path $logdir 'web-latest.log'
$errLog = Join-Path $logdir 'web-latest.err.log'
$wakeLog = Join-Path $logdir 'wake.log'

function LastGap([string]$file) {
  if (-not (Test-Path -LiteralPath $file)) { return 'first' }
  try {
    $last = Get-Content -LiteralPath $file -Tail 1 -ErrorAction Stop
    if (-not $last) { return 'first' }
    $m = [regex]::Match($last, '^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \|')
    if (-not $m.Success) { return 'first' }
    $at = [datetime]::ParseExact($m.Groups[1].Value, 'yyyy-MM-dd HH:mm:ss', $null)
    return ('{0}s' -f [int]([datetime]::Now - $at).TotalSeconds)
  } catch { return 'first' }
}

function Log([string]$msg) {
  $line = "{0} | {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -LiteralPath $wakeLog -Value $line -Encoding utf8
}

function Test-Port([int]$p) {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', $p); return $true } catch { return $false } finally { $c.Dispose() }
}

$gap = LastGap $wakeLog
Log ("call port={0} why={1} gap={2} wait={3}s pid={4}" -f $Port, $Why, $gap, $WaitSeconds, $PID)

if (Test-Port $Port) {
  Log ("already-awake why={0}" -f $Why)
  Write-Output "already-awake ($Port)"
  exit 0
}

try {
  $command = "`$env:DSH_HOME='$home_'; dsh --profile whale --port $Port --no-open"
  Start-Process -FilePath 'pwsh' -ArgumentList '-NoLogo', '-NoProfile', '-Command', $command `
    -WorkingDirectory $cwd -WindowStyle Hidden `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog | Out-Null
  Log ("spawned why={0}" -f $Why)
}
catch {
  Log ("spawn-failed why={0} detail={1}" -f $Why, $_.Exception.Message)
  Write-Output ("spawn-failed: " + $_.Exception.Message)
  exit 1
}

for ($i = 0; $i -lt $WaitSeconds * 2; $i++) {
  Start-Sleep -Milliseconds 500
  if (Test-Port $Port) {
    Log ("awake after {0}ms why={1}" -f ($i * 500), $Why)
    Write-Output "awake (http://127.0.0.1:$Port)  日志: $outLog"
    exit 0
  }
}

Log ("timeout: port still closed why={0}" -f $Why)
Write-Output "failed: $Port 没起来，看 $wakeLog 和 $errLog"
exit 1