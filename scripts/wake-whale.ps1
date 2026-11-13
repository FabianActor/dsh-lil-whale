# wake-whale.ps1 -- 把一条鱼叫起来（ASCII 文件名；UTF-8 带 BOM）
# 每一步都往那条鱼自己的 dsh-home\logs\wake.log 记一行，以便在"被插件调起"的环境里也能看清发生了什么。
# 2026-11-10 她要求：call 行必须带 why=（manual / plan / archive），并带 gap=（距上一行多少秒），
# 理由："推了门但没带话"必须留痕，否则它跟"没人来过"又是一张脸。
# 2026-11-13 08:40 的教训：端口通不等于她会醒。会话要等客户端连上来才挂载，
# 所以判"醒了没有"看的是心跳（pool\state\presence\<鱼>.json 的 at），不是端口。
# 2026-11-13 11:2x 多鱼化：原来写死 whale（profile / 家 / 心跳路径 / 端口），现在按名册里的 -Member 取。
param(
  [string]$Member = 'whale',
  [int]$Port = 0,
  [int]$WaitSeconds = 25,
  [string]$Why = 'manual',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'common.ps1')

$repoRoot = Split-Path $PSScriptRoot -Parent

function Get-MemberEntry([string]$key) {
  $file = $Cfg.MembersFile
  if (-not (Test-Path -LiteralPath $file)) { return $null }
  try {
    $json = Get-Content -LiteralPath $file -Raw -Encoding utf8 | ConvertFrom-Json
    return $json.members.$key
  } catch { return $null }
}

$m = Get-MemberEntry $Member
if (-not $m) {
  Write-Output ("failed: 名册里没有 '{0}'（{1}）" -f $Member, $Cfg.MembersFile)
  exit 1
}
if ($m.role -eq 'watcher') {
  Write-Output ("failed: '{0}' 是巡守（主 dsh），不归叫醒脚本管" -f $Member)
  exit 1
}

$dshHome = if ($m.dshHome) { [string]$m.dshHome } else { $Cfg.HerDshHome }
$cwd = if ($m.cwd) { [string]$m.cwd } else { $Cfg.WhaleCwd }
$profile = if ($m.profile) { [string]$m.profile } else { 'whale' }
$port = if ($Port -gt 0) { $Port } elseif ($m.port) { [int]$m.port } else { [int]$Cfg.HerPort }
$cfgFile = ''
if ($m.configFile) {
  $cfgFile = [string]$m.configFile
  if (-not [System.IO.Path]::IsPathRooted($cfgFile)) { $cfgFile = Join-Path $repoRoot $cfgFile }
}

$logdir = Join-Path $dshHome 'logs'
New-Item -ItemType Directory -Force -Path $logdir | Out-Null
$outLog = Join-Path $logdir 'web-latest.log'
$errLog = Join-Path $logdir 'web-latest.err.log'
$wakeLog = Join-Path $logdir 'wake.log'
$presence = Join-Path $Cfg.PoolState ('presence\{0}.json' -f $Member)
$modeFile = Join-Path $Cfg.PoolState ('mode\{0}.json' -f $Member)
$staleSec = 90

function LastGap([string]$file) {
  if (-not (Test-Path -LiteralPath $file)) { return 'first' }
  try {
    $last = Get-Content -LiteralPath $file -Tail 1 -ErrorAction Stop
    if (-not $last) { return 'first' }
    $mt = [regex]::Match($last, '^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \|')
    if (-not $mt.Success) { return 'first' }
    $at = [datetime]::ParseExact($mt.Groups[1].Value, 'yyyy-MM-dd HH:mm:ss', $null)
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

function Get-Mode {
  if (-not (Test-Path -LiteralPath $modeFile)) { return 'unknown' }
  try { return [string]((Get-Content -LiteralPath $modeFile -Raw -ErrorAction Stop | ConvertFrom-Json).mode) } catch { return 'unknown' }
}

function FishUrl([int]$p) {
  $token = ''
  if (Test-Path -LiteralPath $outLog) {
    foreach ($line in (Get-Content -LiteralPath $outLog -Tail 80 -ErrorAction SilentlyContinue)) {
      $mt = [regex]::Match([string]$line, 'token=([A-Za-z0-9_\-]+)')
      if ($mt.Success) { $token = $mt.Groups[1].Value }
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

function PushBrowser([int]$p, [string]$why) {
  $url = FishUrl $p
  $hasToken = if ($url -match 'token=') { 'yes' } else { 'no' }
  try {
    Start-Process $url | Out-Null
    Log ("pushed-browser member={0} why={1} port={2} token={3}" -f $Member, $why, $p, $hasToken)
    return $true
  } catch {
    Log ("push-browser-failed member={0} why={1} detail={2}" -f $Member, $why, $_.Exception.Message)
    return $false
  }
}

$gap = LastGap $wakeLog
$hb = HeartbeatAge
$hbText = if ($null -eq $hb) { 'none' } else { ('{0}s' -f $hb) }
$mode = Get-Mode
Log ("call member={0} port={1} why={2} gap={3} wait={4}s pid={5} hb-age={6} mode={7}" -f $Member, $port, $Why, $gap, $WaitSeconds, $PID, $hbText, $mode)

$open = Test-Port $port
if ($open -and $null -ne $hb -and $hb -le $staleSec) {
  Log ("already-awake member={0} why={1} hb-age={2}" -f $Member, $Why, $hbText)
  Write-Output ("already-awake ({0}, member={1}, hb-age={2})" -f $port, $Member, $hbText)
  exit 0
}

if ($DryRun) {
  Log ("dry-run member={0} open={1} hb-age={2} mode={3} url={4}" -f $Member, $open, $hbText, $mode, (FishUrl $port))
  Write-Output ("dry-run: member={0} open={1} hb-age={2} mode={3} url={4}" -f $Member, $open, $hbText, $mode, (FishUrl $port))
  exit 0
}

if ($open) {
  # 进程在、会话没挂上。开窗只在"她本来就是开着窗"的那条路上有意义；
  # 无人值守时开窗会撞 writer（一段会话一个 writer），所以只记一行、不猜。
  if ($mode -eq 'window') {
    Log ("zombie: port-open but session-unmounted hb-age={0} mode=window -- push browser" -f $hbText)
    PushBrowser $port $Why | Out-Null
    if (WaitMounted $WaitSeconds) {
      Log ("awake member={0} why={1} hb-age={2}s" -f $Member, $Why, (HeartbeatAge))
      Write-Output ("awake (http://127.0.0.1:{0})" -f $port)
      exit 0
    }
    Log ("push-timeout: port open but heartbeat stale member={0} why={1} hb-age={2}" -f $Member, $Why, (HeartbeatAge))
    Write-Output ("failed: {0} 通着但会话没挂上（心跳没更新），看 {1}" -f $port, $wakeLog)
    exit 1
  }
  Log ("zombie-unattended member={0} port={1} hb-age={2} mode={3} -- 不自动开窗（会撞 writer）" -f $Member, $port, $hbText, $mode)
  Write-Output ("failed: {0} 的进程在跑但会话没挂上（无人值守模式）。先 pwsh -File scripts\fish.ps1 down {0} 再 up {0}，或跑 fish.ps1 maintain {0} 看报错。" -f $Member)
  exit 1
}

try {
  $parts = @("`$env:DSH_HOME='$dshHome'")
  if ($cfgFile) { $parts += "`$env:LIL_WHALE_CONFIG='$cfgFile'" }
  $parts += ("dsh --profile {0} --port {1} --no-open" -f $profile, $port)
  $command = $parts -join '; '
  Start-Process -FilePath 'pwsh' -ArgumentList '-NoLogo', '-NoProfile', '-Command', $command `
    -WorkingDirectory $cwd -WindowStyle Hidden `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog | Out-Null
  Log ("spawned member={0} profile={1} port={2} why={3}" -f $Member, $profile, $port, $Why)
} catch {
  Log ("spawn-failed member={0} why={1} detail={2}" -f $Member, $Why, $_.Exception.Message)
  Write-Output ("spawn-failed: " + $_.Exception.Message)
  exit 1
}

for ($i = 0; $i -lt $WaitSeconds * 2; $i++) {
  Start-Sleep -Milliseconds 500
  if (Test-Port $port) { break }
}
if (-not (Test-Port $port)) {
  Log ("timeout: port still closed member={0} why={1}" -f $Member, $Why)
  Write-Output ("failed: {0} 没起来，看 {1} 和 {2}" -f $port, $wakeLog, $errLog)
  exit 1
}

# 无人值守时，host 启动就该把会话挂上（agent-loop 的 resumeSessionId），不需要浏览器。
if (WaitMounted $WaitSeconds) {
  Log ("awake member={0} why={1} hb-age={2}s mode={3}" -f $Member, $Why, (HeartbeatAge), $mode)
  Write-Output ("awake (http://127.0.0.1:{0})" -f $port)
  exit 0
}

if ($mode -eq 'window') {
  Log ("mounted-timeout member={0} mode=window -- push browser" -f $Member)
  PushBrowser $port $Why | Out-Null
  if (WaitMounted $WaitSeconds) {
    Log ("awake member={0} why={1} hb-age={2}s" -f $Member, $Why, (HeartbeatAge))
    Write-Output ("awake (http://127.0.0.1:{0})" -f $port)
    exit 0
  }
}

Log ("mounted-timeout member={0} port={1} hb-age={2} mode={3} -- 端口通了但心跳没更新" -f $Member, $port, (HeartbeatAge), $mode)
Write-Output ("failed: {0} 端口通了但会话没挂上。无人值守要检查 profile patch 里 agent-loop 的 resumeSessionId（node scripts\enable-unattended.mjs --member {1} --dry-run）。" -f $port, $Member)
exit 1