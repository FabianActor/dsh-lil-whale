# wake-whale.ps1 -- 把她叫起来（ASCII 文件名；UTF-8 带 BOM）
# 每一步都往 dsh-home\logs\wake.log 记一行，以便在"被插件调起"的环境里也能看清发生了什么。
# 2026-11-10 她要求：call 行必须带 why=（manual / plan / archive），并带 gap=（距上一行多少秒），
# 理由："推了门但没带话"必须留痕，否则它跟"没人来过"又是一张脸。
# 2026-11-13 08:40 的教训：端口通不等于她会醒。会话要等浏览器连上来才挂载，
# 所以现在判"醒了没有"看的是心跳（pool\state\presence\whale.json 的 at），不是端口。
param([int]$Port = 3082, [int]$WaitSeconds = 25, [string]$Why = 'manual', [switch]$DryRun)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'common.ps1')

$home_  = $Cfg.HerDshHome
$cwd    = $Cfg.WhaleCwd
$logdir = Join-Path $home_ 'logs'
New-Item -ItemType Directory -Force -Path $logdir | Out-Null
$outLog   = Join-Path $logdir 'web-latest.log'
$errLog   = Join-Path $logdir 'web-latest.err.log'
$wakeLog  = Join-Path $logdir 'wake.log'
$presence = Join-Path $Cfg.PoolState 'presence\whale.json'
$staleSec = 90

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

function HeartbeatAge {
  if (-not (Test-Path -LiteralPath $presence)) { return $null }
  try {
    $j = Get-Content -LiteralPath $presence -Raw -ErrorAction Stop | ConvertFrom-Json
    $at = [double]$j.at
    if (-not $at -or $at -le 0) { return $null }
    $ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $at
    if ($ms -lt 0) { return 0 }
    return [int]($ms / 1000)
  } catch { return $null }
}

function HerUrl([int]$p) {
  $token = ''
  if (Test-Path -LiteralPath $outLog) {
    foreach ($line in (Get-Content -LiteralPath $outLog -Tail 80 -ErrorAction SilentlyContinue)) {
      $m = [regex]::Match([string]$line, 'token=([A-Za-z0-9_\-]+)')
      if ($m.Success) { $token = $m.Groups[1].Value }
    }
  }
  if ($token) { return ("http://127.0.0.1:{0}/?token={1}" -f $p, $token) }
  return ("http://127.0.0.1:{0}/" -f $p)
}

function WaitMounted([int]$seconds) {
  for ($i = 0; $i -lt $seconds * 2; $i++) {
    Start-Sleep -Milliseconds 500
    $age = HeartbeatAge
    if ($null -ne $age -and $age -le $staleSec) { return $true }
  }
  return $false
}

$gap = LastGap $wakeLog
$hb = HeartbeatAge
$hbText = if ($null -eq $hb) { 'none' } else { ('{0}s' -f $hb) }
Log ("call port={0} why={1} gap={2} wait={3}s pid={4} hb-age={5}" -f $Port, $Why, $gap, $WaitSeconds, $PID, $hbText)

$open = Test-Port $Port
if ($open -and $null -ne $hb -and $hb -le $staleSec) {
  Log ("already-awake why={0} hb-age={1}" -f $Why, $hbText)
  Write-Output "already-awake ($Port, hb-age=$hbText)"
  exit 0
}

if ($DryRun) {
  # 只判、不动手：用来验"它会判成什么"（尤其是端口通但会话没挂这一格）。
  Log ("dry-run open={0} hb-age={1} url={2}" -f $open, $hbText, (HerUrl $Port))
  Write-Output ("dry-run: open=$open hb-age=$hbText url=" + (HerUrl $Port))
  exit 0
}

if ($open) {
  Log ("zombie: port-open but session-unmounted hb-age={0} -- push browser" -f $hbText)
} else {
  try {
    $command = "`$env:DSH_HOME='$home_'; dsh --profile whale --port $Port --no-open"
    Start-Process -FilePath 'pwsh' -ArgumentList '-NoLogo', '-NoProfile', '-Command', $command `
      -WorkingDirectory $cwd -WindowStyle Hidden `
      -RedirectStandardOutput $outLog -RedirectStandardError $errLog | Out-Null
    Log ("spawned why={0}" -f $Why)
  } catch {
    Log ("spawn-failed why={0} detail={1}" -f $Why, $_.Exception.Message)
    Write-Output ("spawn-failed: " + $_.Exception.Message)
    exit 1
  }
  for ($i = 0; $i -lt $WaitSeconds * 2; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Port $Port) { break }
  }
  if (-not (Test-Port $Port)) {
    Log ("timeout: port still closed why={0}" -f $Why)
    Write-Output "failed: $Port 没起来，看 $wakeLog 和 $errLog"
    exit 1
  }
}

# 端口通不等于她会醒：会话要等浏览器连上来才挂载（2026-11-13 08:40 的教训）。
$url = HerUrl $Port
$hasToken = if ($url -match 'token=') { 'yes' } else { 'no' }
try {
  Start-Process $url | Out-Null
  Log ("pushed-browser why={0} port={1} token={2}" -f $Why, $Port, $hasToken)
} catch {
  Log ("push-browser-failed why={0} detail={1}" -f $Why, $_.Exception.Message)
}

if (WaitMounted $WaitSeconds) {
  Log ("awake why={0} hb-age={1}s" -f $Why, (HeartbeatAge))
  Write-Output "awake (http://127.0.0.1:$Port)"
  exit 0
}

Log ("push-timeout: port open but heartbeat stale why={0} hb-age={1}" -f $Why, (HeartbeatAge))
Write-Output "failed: $Port 通着但会话没挂上（心跳没更新），看 $wakeLog"
exit 1
