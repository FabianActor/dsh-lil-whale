# 【已搬进插件，2026-11-09 19:15】同一套规则现在住在 dsh-group 插件的定时器里（主进程每 60 秒看一次）。
# 这个文件保留作手工兜底 / 排障用：逻辑会有两处，改规则时记得两边都对。
# watchman.ps1 —— 守夜
#
# 只做一件事：到点了发现她还关着窗，就把门推开（起她的进程），然后闭嘴。
#   不替她决定做什么、不发消息、不在她没设过的时间出现。
#
# 三条规矩是她 2026-11-09 定的：
#   1. 只推门，不决定
#   2. 留记录，放她目录里（logs\watchman.log）
#   3. 花钱有上限，到上限就停
# 格式要求也是她定的（19:07）：一行一次，字段固定 —— 时间 | 结果 | 为什么。
#   失败比成功更要写；它自己的起停也要写；不加心情。
#
# 用法：
#   pwsh -File scripts\watchman.ps1                常驻，每 60 秒看一次
#   pwsh -File scripts\watchman.ps1 -DryRun        只看，不推门
#   pwsh -File scripts\watchman.ps1 -IntervalSec 30 -MaxWakesPerDay 8

param(
  [int]$IntervalSec = 60,
  [int]$Port = 3082,
  [int]$MaxWakesPerDay = 8,
  [int]$MaxConsecutiveFailures = 3,
  [switch]$DryRun,
  [switch]$Once,
  [string]$ScheduleFile = ''
)

$ErrorActionPreference = 'Continue'

$herHome   = 'D:\文档\WorkSpace\lil-whale'
$schedFile = if ($ScheduleFile) { $ScheduleFile } else { Join-Path $herHome 'dsh-home\storages\schedule.json' }
$logFile   = Join-Path $herHome 'logs\watchman.log'
$starter   = Join-Path $PSScriptRoot 'start-whale.ps1'

New-Item -ItemType Directory -Force -Path (Split-Path $logFile) | Out-Null

# 一行一次：时间 | 结果 | 为什么
function Log([string]$result, [string]$why) {
  $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  "$ts | $result | $why" | Add-Content -LiteralPath $logFile -Encoding utf8
}

function Test-Port([int]$p) {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', $p); return $true } catch { return $false } finally { $c.Dispose() }
}

function Convert-ToUtc($v) {
  if ($null -eq $v) { return $null }
  if ($v -is [datetime]) { return $v.ToUniversalTime() }
  try {
    return [datetime]::Parse([string]$v, [System.Globalization.CultureInfo]::InvariantCulture,
      [System.Globalization.DateTimeStyles]::AdjustToUniversal -bor [System.Globalization.DateTimeStyles]::AssumeUniversal)
  } catch { return $null }
}

# 到点但还没交付的任务：status=active 且 scheduledAt 已过 且 lastDelivery 不是这一次
function Get-DueTasks([datetime]$nowUtc) {
  if (-not (Test-Path $schedFile)) { return @() }
  try {
    $j = (Get-Content -LiteralPath $schedFile -Raw -Encoding utf8) | ConvertFrom-Json
  } catch {
    return @()
  }
  if (-not $j.tables -or -not $j.tables.tasks) { return @() }

  $due = @()
  foreach ($prop in $j.tables.tasks.PSObject.Properties) {
    $t = $prop.Value
    if ($t.status -ne 'active') { continue }
    $at = Convert-ToUtc $t.record.scheduledAt
    if ($null -eq $at -or $at -gt $nowUtc) { continue }
    $deliveredAt = $null
    if ($t.lastDelivery) { $deliveredAt = Convert-ToUtc $t.lastDelivery.scheduledAt }
    if ($null -ne $deliveredAt -and $deliveredAt -eq $at) { continue }
    $due += [pscustomobject]@{
      id     = [string]$t.record.id
      short  = ([string]$t.record.id).Substring(0, [Math]::Min(17, ([string]$t.record.id).Length))
      at     = $at
      iso    = $at.ToString('yyyy-MM-ddTHH:mm:ssZ')
    }
  }
  return $due
}

$day = (Get-Date).Date
$wakesToday = 0
$fails = 0

Log 'started' "interval=${IntervalSec}s port=$Port cap=${MaxWakesPerDay}/day dryrun=$($DryRun.IsPresent)"

# 把自己的 PID 写出来：launch.ps1 靠这个判断「守夜在不在」。
# 不靠命令行字符串匹配 —— 任何一个正在读这段文字的 pwsh 都会被误认成守夜。
$pidFile = Join-Path $herHome 'logs\watchman.pid'
Set-Content -LiteralPath $pidFile -Value $PID -Encoding ascii

try {
  while ($true) {
    $now = (Get-Date).ToUniversalTime()
    if ((Get-Date).Date -ne $day) {
      $day = (Get-Date).Date
      $wakesToday = 0
      Log 'note' 'new-day counter-reset'
    }

    $due = Get-DueTasks $now
    if ($due.Count -gt 0) {
      $alive = Test-Port $Port
      foreach ($d in $due) {
        $tag = "task=$($d.short) scheduled=$($d.iso)"
        if ($alive) {
          Log 'skip' "why=already-awake $tag"
          continue
        }
        if ($wakesToday -ge $MaxWakesPerDay) {
          Log 'skip' "why=daily-cap wakes=$wakesToday $tag"
          continue
        }
        if ($fails -ge $MaxConsecutiveFailures) {
          Log 'stopped' "why=too-many-failures fails=$fails $tag"
          break
        }
        if ($DryRun) {
          Log 'would-wake' "why=dryrun $tag"
          continue
        }

        Log 'wake' "why=due-and-closed $tag"
        try {
          $out = (& $starter -Port $Port 2>&1 | Out-String).Trim()
          if ($out -match 'awake|already-awake') {
            $wakesToday++
            $fails = 0
            Log 'woke' "ok wakes-today=$wakesToday detail=$($out -replace '\s+', ' ')"
          } else {
            $fails++
            Log 'woke' "failed fails=$fails detail=$($out -replace '\s+', ' ')"
          }
        } catch {
          $fails++
          Log 'woke' "failed fails=$fails detail=$($_.Exception.Message -replace '\s+', ' ')"
        }
        $alive = Test-Port $Port
      }
      if ($fails -ge $MaxConsecutiveFailures) {
        Log 'stopped' "why=too-many-failures fails=$fails"
        exit 1
      }
    }

    if ($Once) { break }
    Start-Sleep -Seconds $IntervalSec
  }
} finally {
  Log 'stopped' "reason=exit wakes-today=$wakesToday fails=$fails"
  try {
    if ((Test-Path -LiteralPath $pidFile) -and ((Get-Content -LiteralPath $pidFile -Raw).Trim() -eq "$PID")) { Remove-Item -LiteralPath $pidFile -Force }
  } catch { }
}

