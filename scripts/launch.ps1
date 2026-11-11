# launch.ps1 -- 一键开鱼。ASCII 文件名 + UTF-8 BOM，给 cmd 双击用的入口。
#
#   pwsh -File launch.ps1 -Target all             两条鱼，成功即返回（窗口关掉）
#   pwsh -File launch.ps1 -Target lee             只开大肥鱼（3080）
#   pwsh -File launch.ps1 -Target whale           只开小肥鱼（3082）
#   -NoBrowser                                    不自动开浏览器（守夜脚本用）
#   -Port <n>                                     覆盖小肥鱼的端口
#   -WithWatchman                                 另外起一个守夜脚本（只在主 dsh 不常开时用；平时用不着）
#
# 退出码：0 = 都在跑（本来就在跑也算）；1 = 没起来。
# 失败时会把 .err.log 的尾巴打出来 —— 这就是"窗口该不该留着"的判据：
# 成功就关，失败就别关。
param(
  [ValidateSet('all', 'lee', 'whale')][string]$Target = 'all',
  [switch]$NoBrowser,
  [switch]$WithWatchman,
  [int]$Port = 0
)

$ErrorActionPreference = 'Stop'

$LeeHome = 'C:\Users\Fabian\.dsh'
$HerHome = 'D:\文档\WorkSpace\lil-whale'
$HerDshHome = Join-Path $HerHome 'dsh-home'
$LeePort = 3080
$HerPort = if ($Port -gt 0) { $Port } else { 3082 }

function Test-Port([int]$p) {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', $p); return $true } catch { return $false } finally { $c.Dispose() }
}

function Show-Tail([string]$path, [int]$lines = 12) {
  if (-not (Test-Path -LiteralPath $path)) { return }
  Write-Host ("---- " + $path + " ----")
  Get-Content -LiteralPath $path -Tail $lines | ForEach-Object { Write-Host ("  " + $_) }
}

# 把 pwsh 以"隐藏窗口 + 输出重定向"的方式放走。
# 不用 Start-Job / 不等待：父进程退出后它要能自己活着。
function Start-Hidden([string]$Command, [string]$WorkingDirectory, [string]$OutLog, [string]$ErrLog) {
  New-Item -ItemType Directory -Force -Path (Split-Path $OutLog) | Out-Null
  Start-Process -FilePath 'pwsh' `
    -ArgumentList '-NoLogo', '-NoProfile', '-Command', $Command `
    -WorkingDirectory $WorkingDirectory -WindowStyle Hidden `
    -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog | Out-Null
}

function Wait-Port([int]$p, [int]$Seconds = 120) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Port $p) { return $true }
    Start-Sleep -Milliseconds 400
  }
  return $false
}

# 她的网页要 token，token 只出现在启动日志里 —— 从日志里捞最后一个。
function Get-HerUrl([int]$p) {
  $log = Join-Path $HerDshHome 'logs\web-latest.log'
  try {
    $line = Get-Content -LiteralPath $log -Tail 40 -ErrorAction Stop |
      Where-Object { $_ -match "127\.0\.0\.1:$p/\?token=" } | Select-Object -Last 1
    if ($line -match "(http://127\.0\.0\.1:$p/\?token=[A-Za-z0-9_\-]+)") { return $Matches[1] }
  } catch { }
  return "http://127.0.0.1:$p"
}

function Start-Lee {
  if (Test-Port $LeePort) {
    Write-Host "大肥鱼：已经在跑（$LeePort）。"
    if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$LeePort" }
    return $true
  }
  $out = Join-Path $LeeHome 'logs\web-latest.log'
  $err = Join-Path $LeeHome 'logs\web-latest.err.log'
  Write-Host "大肥鱼：开机中（$LeePort）……"
  Start-Hidden -Command "dsh web" -WorkingDirectory 'C:\Users\Fabian\Desktop' -OutLog $out -ErrLog $err
  if (-not (Wait-Port $LeePort)) {
    Write-Host "大肥鱼：没起来。"
    Show-Tail $err
    return $false
  }
  Write-Host "大肥鱼：起来了 http://127.0.0.1:$LeePort"
  if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$LeePort" }
  return $true
}

function Start-Her {
  if (Test-Port $HerPort) {
    Write-Host "小肥鱼：已经在跑（$HerPort）。"
    if (-not $NoBrowser) { Start-Process (Get-HerUrl $HerPort) }
    return $true
  }
  $out = Join-Path $HerDshHome 'logs\web-latest.log'
  $err = Join-Path $HerDshHome 'logs\web-latest.err.log'
  Write-Host "小肥鱼：开机中（$HerPort）……"
  $command = "`$env:DSH_HOME='$HerDshHome'; dsh --profile whale --port $HerPort --no-open"
  Start-Hidden -Command $command -WorkingDirectory $HerHome -OutLog $out -ErrLog $err
  if (-not (Wait-Port $HerPort)) {
    Write-Host "小肥鱼：没起来。"
    Show-Tail $err
    return $false
  }
  Write-Host "小肥鱼：起来了 $HerPort"
  if (-not $NoBrowser) { Start-Process (Get-HerUrl $HerPort) }
  return $true
}

# 守夜不是鱼，但"所有鱼"要能自己醒就得有它。已经在跑就不重复开。
# 守夜自己在 logs\watchman.pid 里写 PID —— 用命令行里出现过 watchman.ps1 来判断不可靠：
# 任何一个正在读这个字符串的 pwsh（包括排障时敲的命令）都会被误认成守夜。
function Get-WatchmanPid {
  # 只认 pid 文件，**不做命令行扫描**。教训：按"命令行里出现 watchman.ps1"来认，
  # 会把任何一个正在读这句话的 pwsh（包括排障时敲的那条命令）当成守夜。
  $pidFile = 'D:\文档\WorkSpace\lil-whale\logs\watchman.pid'
  if (-not (Test-Path -LiteralPath $pidFile)) { return 0 }
  $raw = (Get-Content -LiteralPath $pidFile -Raw -ErrorAction SilentlyContinue)
  if (-not $raw -or $raw.Trim() -notmatch '^\d+$') { return 0 }
  $wid = [int]$raw.Trim()
  if (-not (Get-Process -Id $wid -ErrorAction SilentlyContinue)) { return 0 }
  # PID 会被复用，最后再核一次它确实还是那个脚本
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$wid" -ErrorAction SilentlyContinue
  if (-not $proc -or -not $proc.CommandLine -or $proc.CommandLine -notlike '*watchman.ps1*') { return 0 }
  return $wid
}

function Start-Watchman {
  $wid = Get-WatchmanPid
  if ($wid -gt 0) {
    Write-Host ("守夜：已经在跑（PID " + $wid + "）。")
    return $true
  }
  $logDir = Join-Path 'D:\文档\WorkSpace\dsh-lil-whale\logs' ''
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  Write-Host "守夜：开机中……"
  # 注意别再套一层 pwsh：`-Command "pwsh -File ..."` 会变成两个进程，多出来的那个没人管。
  Start-Hidden -Command "& 'D:\文档\WorkSpace\dsh-lil-whale\scripts\watchman.ps1'" `
    -WorkingDirectory 'D:\文档\WorkSpace\dsh-lil-whale' `
    -OutLog (Join-Path $logDir 'watchman-console.log') `
    -ErrLog (Join-Path $logDir 'watchman-console.err.log')
  $ok = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 300
    if ((Get-WatchmanPid) -gt 0) { $ok = $true; break }
  }
  if ($ok) { Write-Host "守夜：在看了。" } else {
    Write-Host "守夜：没起来。"
    Show-Tail (Join-Path $logDir 'watchman-console.err.log')
  }
  return $ok
}

$allOk = $true
switch ($Target) {
  'lee'   { $allOk = Start-Lee }
  'whale' { $allOk = Start-Her }
  'all' {
    $a = Start-Lee
    $b = Start-Her
    # 守夜现在住在主 dsh 的插件定时器里（每 60 秒看一次），不需要另起进程。
    # 只有主 dsh 不常开、想留个手脚推门时才加 -WithWatchman。
    $c = if ($WithWatchman) { Start-Watchman } else { $true }
    $allOk = ($a -and $b -and $c)
  }
}

if ($allOk) {
  Write-Host ''
  Write-Host '好了。日志在：'
  Write-Host '  大肥鱼  C:\Users\Fabian\.dsh\logs\web-latest.log'
  Write-Host '  小肥鱼  D:\文档\WorkSpace\lil-whale\dsh-home\logs\web-latest.log'
  Write-Host '  守夜    D:\文档\WorkSpace\dsh-lil-whale\logs\watchman.log'
  exit 0
}

Write-Host ''
Write-Host '有一项没起来 —— 上面有日志尾巴。'
exit 1
