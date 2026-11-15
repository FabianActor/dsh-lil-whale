#requires -Version 7.0
# fish.ps1 -- 鱼群唯一的入口。ASCII 文件名 + UTF-8 BOM。
#
# 为什么要有它：鱼一多，"开/停/体检"三件事各有各的脚本，每加一条鱼就多一套参数。
# 这个脚本只做一件事：把命令套到 pool\members.json 里那条鱼身上。
#
#   pwsh -File fish.ps1                    看所有鱼（默认 list）
#   pwsh -File fish.ps1 list
#   pwsh -File fish.ps1 up whale           开一条（开完自动开浏览器）
#   pwsh -File fish.ps1 up all             全开（巡守那条 + 所有鱼，每条鱼各开一个窗）
#   pwsh -File fish.ps1 up all -BrowserMainOnly  全开，但只给主 dsh 开窗（Run All Whales.cmd 用）
#   pwsh -File fish.ps1 down whale         停一条
#   pwsh -File fish.ps1 maintain whale     检修：先停，再开一扇窗（看完关窗，再回无人值守）
#   pwsh -File fish.ps1 restore whale      回无人值守：无窗起（会话由 host 自己挂上）
#   pwsh -File fish.ps1 down all -Yes      全停（含主 dsh；Stop All Whales.cmd 用）
#   pwsh -File fish.ps1 up-main            启动主 dsh（快捷方式用；已在跑就直接开浏览器）
#   pwsh -File fish.ps1 down-main          停整个鱼塘（鱼活不过主进程；先鱼后主，账本写 stopped）
#   pwsh -File fish.ps1 doctor             体检（现在只对配置里那条鱼）
#   pwsh -File fish.ps1 new -Key <键> -Name <名字> -Parent whale   养一条新鱼（查重 → 建家 → 进名册 → 记 birth）
#   pwsh -File fish.ps1 acl-check [whale|all]   查沙箱通行证（文件工具能写、pwsh 不能写 = 缺它）
#   pwsh -File fish.ps1 acl-repair [whale|all]  补沙箱通行证（补完记 pool\state\acl.log）
#   pwsh -File fish.ps1 wake <名字|all> [-By 谁] [-Why 为什么]  家长强行叫醒（睡眠窗里也叫得醒；记 sleep.log）
#   pwsh -File fish.ps1 bind <键> -Session <会话id>   把这段会话钉到那条鱼名下（新鱼第一次开口后由宿主跑）
#   pwsh -File fish.ps1 help
#
# 选项：-Window（开窗起；默认无人值守） -NoBrowser（强制不开） -BrowserMainOnly（只给主 dsh 开窗） -Yes（不停下来问）
#       -By/-Why（记账用） -Port（覆盖端口）
#
# 两种"在跑"：
#   unattended = 无窗起，会话由插件调 sessionController 自己挂上（CHANGELOG A.45 / CHANGELOG A.54）
#   window     = 开着浏览器窗（会话由客户端挂上；一段会话只能一个 writer）
# 模式记在 pool\state\mode\<键>.json —— 不记的话，鱼塘和脚本都只能猜"这扇窗是谁开的"。
#
# 退出码：0 = 都成了；1 = 有一项没成（原因在上面）。
param(
  [Parameter(Position = 0)][string]$Command = 'list',
  [Parameter(Position = 1)][string]$Name = '',
  [switch]$NoBrowser,
  [switch]$Window,
  [switch]$Yes,
  [string]$By = 'fabian',
  [string]$Why = '',
  [int]$Port = 0,
  # 起多条鱼时只给巡守（主 dsh）开浏览器窗，其余鱼后台起。Run All Whales.cmd 用。
  [switch]$BrowserMainOnly,
  # 检修用：起一个可见的控制台窗，日志一边显示一边 Tee 到 web-latest.log（token 在文件里才捞得到）。
  [switch]$Console,
  # new 用（D4-2 养一条新鱼）：成员键 / 名字（-Name 位置参数）/ 父辈成员键 / 只查不做。
  [string]$Key = '',
  [string]$Parent = '',
  [switch]$DryRun,
  # 2026-11-13 他的死命令：API key 只能经过人。默认不碰凭证；只有人明确说"继承某条鱼的 key"时，
  # 才用 -InheritKey <家长键>，并且出生行记 keyInherited=。
  [string]$InheritKey = '',
  # 谁想养的（留痕用）：比如 whale。
  [string]$RequestedBy = '',
  # bind 用：要钉给那条鱼的会话 id（session-xxxxxxxx-…）。
  [string]$Session = '',
  # 人给钥匙用：fish.ps1 key grant <孩子> -From <家长>
  [string]$From = ''
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

# ---------- 起停审计（2026-11-14）----------
# 每次调用都记一行：谁调的（父进程名 + pid）、带的什么参数。
# 起因：10:59:41 主 dsh 被强杀、同一秒又被 fish.ps1 起回来，账上查不出是谁下的手。
# 审计自己出错不许影响主流程 —— 所以整段吞异常。
try {
  $auditDir = Join-Path $Cfg.PoolDir 'state'
  if (Test-Path -LiteralPath $auditDir) {
    $auditParent = ''
    $auditPpid = ''
    try {
      $auditSelf = Get-CimInstance Win32_Process -Filter "ProcessId=$PID" -ErrorAction Stop
      if ($auditSelf) {
        $auditPpid = [string]$auditSelf.ParentProcessId
        if ($auditPpid) {
          $auditP = Get-CimInstance Win32_Process -Filter "ProcessId=$auditPpid" -ErrorAction SilentlyContinue
          if ($auditP) { $auditParent = [string]$auditP.Name }
        }
      }
    } catch { }
    $auditArgs = @($PSBoundParameters.Keys | ForEach-Object { "$_=$($PSBoundParameters[$_])" }) -join ' '
    $auditLine = '{0} | fish.ps1 | fmt=1 pid={1} ppid={2} parent={3} argv=[{4}]' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $PID, $auditPpid, $auditParent, $auditArgs
    Add-Content -LiteralPath (Join-Path $auditDir 'fish.log') -Value $auditLine -Encoding utf8
  }
} catch { }

if ($env:DSH_LAUNCH_NO_BROWSER -eq '1') { $NoBrowser = $true }

# ---------- 名册 ----------
# 真源是 pool\members.json（CHANGELOG A.25）。文件不在就退回配置里那两条 —— 能跑，但只有两条。
function Get-Members {
  # 配置里能指定名册（membersFile）；没有才退回 pool 下的默认位置。
  $file = if ($Cfg.MembersFile) { $Cfg.MembersFile } else { Join-Path $Cfg.PoolDir 'members.json' }
  $out = [ordered]@{}
  if (Test-Path -LiteralPath $file) {
    try {
      $raw = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
      foreach ($p in $raw.members.PSObject.Properties) {
        $m = $p.Value
        $out[$p.Name] = [pscustomobject]@{
          Key     = $p.Name
          Label   = if ($m.name) { [string]$m.name } else { $p.Name }
          Kind    = if ($m.kind) { [string]$m.kind } else { 'fish' }
          Role    = if ($m.role) { [string]$m.role } else { 'member' }
          Home    = if ($m.home) { [string]$m.home } else { $null }
          DshHome = if ($m.dshHome) { [string]$m.dshHome } else { $null }
          Profile = if ($m.profile) { [string]$m.profile } else { $null }
          Port    = if ($m.port) { [int]$m.port } else { 0 }
          Cwd     = if ($m.cwd) { [string]$m.cwd } else { $null }
          ConfigFile = if ($m.configFile) { [string]$m.configFile } else { $null }
          Lifecycle = if ($m.lifecycle) { [string]$m.lifecycle } elseif ([string]$m.status) { if ([string]$m.status -eq 'archived') { 'archived' } else { 'active' } } else { 'active' }
          Parent  = if ($m.parent) { [string]$m.parent } else { $null }
          BornAt  = if ($m.bornAt) { [string]$m.bornAt } else { $null }
        }
      }
    } catch {
      Write-Warning "名册读不了（$file）：$($_.Exception.Message) —— 退回配置里的两条"
    }
  }
  if ($out.Count -eq 0) {
    $out['lee'] = [pscustomobject]@{ Key = 'lee'; Label = '大肥鱼'; Kind = 'fish'; Role = 'watcher'; Home = $Cfg.LeeHome; DshHome = $Cfg.LeeHome; Profile = $Cfg.LeeProfile; Port = $Cfg.LeePort; Cwd = $Cfg.LeeStartCwd; Lifecycle = 'active'; Parent = $null; BornAt = $null }
    $out['whale'] = [pscustomobject]@{ Key = 'whale'; Label = '小肥鱼'; Kind = 'fish'; Role = 'member'; Home = $Cfg.HerHome; DshHome = $Cfg.HerDshHome; Profile = $Cfg.WhaleProfile; Port = $Cfg.HerPort; Cwd = $Cfg.WhaleCwd; Lifecycle = 'active'; Parent = $null; BornAt = $null }
  }
  return $out
}

$MEMBERS = Get-Members

# 端口登记查重（2026-11-13 他要的）：名册里的 port 必须唯一。
# 两条鱼登记同一个口时，后起的会静默起不来，而 fish.ps1 会以为"已经在跑"。
$portOwners = @{}
foreach ($m in $MEMBERS.Values) {
  $registered = [int]$m.Port
  if ($registered -le 0) { continue }
  if ($portOwners.ContainsKey($registered)) {
    Write-Host ("名册里端口重复：{0} 和 {1} 都登记成 {2} —— 改 pool\members.json 里其中一个，再跑。" -f $portOwners[$registered], $m.Key, $registered) -ForegroundColor Red
    exit 1
  }
  $portOwners[$registered] = $m.Key
}

# -Port 只对"点名的那一条鱼"生效；不点名（all）时一律用名册里的端口。
# 注意：PowerShell 变量名不区分大小写，所以这里不能叫 $Port —— 它会和参数 $Port 是同一个变量。
function Get-PortOf($m) {
  if ($Port -gt 0 -and $Name -ne '' -and $Name -ne 'all') { return $Port }
  return $m.Port
}

function Get-Fish([string]$key) {
  if (-not $MEMBERS.Contains($key)) { return $null }
  $m = $MEMBERS[$key]
  if ($m.Kind -ne 'fish') { return $null }
  return $m
}

function Get-MainFish {
  # 名册换键后 'lee' 可能不存在（2026-11-13 扫描 P2#20）：按 role 找，别让主命令直接坏。
  $m = Get-Fish 'lee'
  if ($m) { return $m }
  return ($MEMBERS.Values | Where-Object { $_.Kind -eq 'fish' -and $_.Role -eq 'watcher' } | Select-Object -First 1)
}

function Resolve-Targets([string]$name) {
  if ($name -eq '' -or $name -eq 'all') {
    return @($MEMBERS.Values | Where-Object { $_.Kind -eq 'fish' })
  }
  $one = Get-Fish $name
  if (-not $one) { throw "没有这条鱼：$name（名册里有：$((@($MEMBERS.Keys)) -join ', ')）" }
  return @($one)
}

# ---------- 小工具 ----------
function Test-Port([int]$p) {
  if ($p -le 0) { return $false }
  $c = New-Object System.Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', $p); return $true } catch { return $false } finally { $c.Dispose() }
}

function Show-Tail([string]$path, [int]$lines = 12) {
  if (-not (Test-Path -LiteralPath $path)) { return }
  Write-Host ("---- " + $path + " ----")
  Get-Content -LiteralPath $path -Tail $lines | ForEach-Object { Write-Host ("  " + $_) }
}

function Start-Hidden([string]$Command, [string]$WorkingDirectory, [string]$OutLog, [string]$ErrLog) {
  New-Item -ItemType Directory -Force -Path (Split-Path $OutLog) | Out-Null
  # 2026-11-14：这里原来是 Start-Process 直接起 dsh。坑在句柄继承：
  # 带 -RedirectStandardOutput 时 .NET 会 bInheritHandles=TRUE，于是孙子进程
  # （那条要一直活着的鱼）把调用方的 stdout 管道也继承了 —— 调用方要等鱼退出
  # 才拿到 EOF，表现成 "up 卡住"（复现：嵌套起一个活 45 秒的隐藏进程，外层等 47 秒）。
  # 解法是"双跳"：先起一个不带重定向的启动器（它的 stdout 不是调用方的管道），
  # 再由启动器带重定向起真正的 dsh。启动器一秒内退出，鱼活多久都不影响调用方。
  $stamp = [guid]::NewGuid().ToString('N')
  $inner = Join-Path $env:TEMP ("llw-run-$stamp.ps1")
  $outer = Join-Path $env:TEMP ("llw-launch-$stamp.ps1")
  Set-Content -LiteralPath $inner -Value $Command -Encoding utf8
  $launcher = "Start-Process -FilePath 'pwsh' -ArgumentList '-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File','$inner' -WorkingDirectory '$WorkingDirectory' -WindowStyle Hidden -RedirectStandardOutput '$OutLog' -RedirectStandardError '$ErrLog' | Out-Null"
  Set-Content -LiteralPath $outer -Value $launcher -Encoding utf8
  Start-Process -FilePath 'pwsh' -ArgumentList '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $outer + '"') -WindowStyle Hidden | Out-Null
  return @($inner, $outer)
}


# 检修用的"看得见的窗"：控制台不隐藏、不退出（关窗才结束），输出同时 Tee 到日志。
# 为什么要 Tee：token 只印在启动那行输出里，$OutLog 里没有就拼不出带 token 的地址。
function Start-Visible([string]$Command, [string]$WorkingDirectory, [string]$OutLog) {
  New-Item -ItemType Directory -Force -Path (Split-Path $OutLog) | Out-Null
  $wrapped = $Command + " 2>&1 | Tee-Object -FilePath '" + $OutLog + "'"
  Start-Process -FilePath 'pwsh' `
    -ArgumentList '-NoLogo', '-NoProfile', '-NoExit', '-Command', $wrapped `
    -WorkingDirectory $WorkingDirectory | Out-Null
}

function Wait-Port([int]$p, [int]$Seconds = 120) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Port $p) { return $true }
    Start-Sleep -Milliseconds 400
  }
  return $false
}

# 带 token 的网址只出现在启动日志里；没有 token 的就用裸地址。
function Get-Url($member) {
  $log = Join-Path $member.DshHome 'logs\web-latest.log'
  try {
    $line = Get-Content -LiteralPath $log -Tail 60 -ErrorAction Stop |
      Where-Object { $_ -match "127\.0\.0\.1:$($member.Port)/\?token=" } | Select-Object -Last 1
    if ($line -match "(http://127\.0\.0\.1:$($member.Port)/\?token=[A-Za-z0-9._~\-]+)") { return $Matches[1] }
  } catch { }
  return "http://127.0.0.1:$($member.Port)"
}

function Get-Heartbeat($member) {
  $file = Join-Path $Cfg.PoolState ("presence\{0}.json" -f $member.Key)
  if (-not (Test-Path -LiteralPath $file)) { return '-' }
  try {
    $j = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $j.at) { return '-' }
    $age = [int](((Get-Date).ToUniversalTime().Subtract([datetimeoffset]::FromUnixTimeMilliseconds([int64]$j.at).UtcDateTime)).TotalMinutes)
    return ("{0}（{1} 分钟前）" -f $j.status, $age)
  } catch { return '?' }
}

# 2026-11-13 08:40 的教训：端口通不等于会话挂上了。
# 会话要等浏览器连上来才挂载，所以"醒着没有"看心跳，不看端口。
function Get-HeartbeatAgeSec($member) {
  $file = Join-Path $Cfg.PoolState ("presence\{0}.json" -f $member.Key)
  if (-not (Test-Path -LiteralPath $file)) { return $null }
  try {
    $j = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $j.at) { return $null }
    $ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - [int64]$j.at
    if ($ms -lt 0) { return 0 }
    return [int]($ms / 1000)
  } catch { return $null }
}

# 模式账：这轮是谁开的、有没有窗。文件不在 = 不知道（旧进程或别人起的）。
function Get-ModeFile($member) {
  return (Join-Path $Cfg.PoolState ("mode\{0}.json" -f $member.Key))
}

function Get-Mode($member) {
  $file = Get-ModeFile $member
  if (-not (Test-Path -LiteralPath $file)) { return $null }
  try { return (Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}

function Set-Mode($member, [string]$mode, [int]$fishPort) {
  $file = Get-ModeFile $member
  New-Item -ItemType Directory -Force -Path (Split-Path $file) | Out-Null
  $obj = [ordered]@{ key = $member.Key; mode = $mode; port = $fishPort; at = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') }
  Set-Content -LiteralPath $file -Value ($obj | ConvertTo-Json -Compress) -Encoding UTF8
}

function Clear-Mode($member) {
  Remove-Item -LiteralPath (Get-ModeFile $member) -Force -ErrorAction SilentlyContinue
}

# 同一个 profile 只许一个进程：两个进程会各自去 resume 同一段会话，
# 第二个拿到的是 session/writer-held（CHANGELOG A.47）。端口只是"有没有人监听"，
# 端口没开也可能已经有一个正在启动/换了端口的进程 —— 所以按 profile 找。
function Get-ProfileProcesses($member) {
  if (-not $member.Profile) { return @() }
  $pat = "--profile\s+" + [regex]::Escape($member.Profile) + "(\s|$)"
  @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $cl = $_.CommandLine
    if (-not $cl) { return $false }
    if ($cl -notmatch 'bin\.js') { return $false }
    return ($cl -match $pat)
  })
}

function Write-FishWindowLog($member, [string]$Event) {
  if (-not $member.Home) { return }
  $dir = Join-Path $member.Home 'logs'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $line = "{0} | event={1} | by={2} | busy={3} | why={4}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Event, $By, (Get-PresenceSnapshot), $Why
  Add-Content -LiteralPath (Join-Path $dir 'close.log') -Value $line -Encoding UTF8
}

# ---------- 启动锁 ----------
# 为什么要有：自启动（巡守起来 8 秒后跑一次 up all）和用户手动点「全部唤醒」可能同时发生。
# 两条 up all 都先探端口、都看到"没开"，然后各起一份 —— 那就是一条鱼两个进程。
# 锁只覆盖"批量启动"这一段（单条 up 不抢锁：用户明确点了某条鱼，不该被别人的批量动作挡掉）。
function Enter-UpLock {
  $file = Join-Path $Cfg.PoolState 'up-all.lock'
  New-Item -ItemType Directory -Force -Path (Split-Path $file) | Out-Null
  for ($try = 0; $try -lt 2; $try++) {
    try {
      $fs = [System.IO.File]::Open($file, 'CreateNew', 'Write', 'None')
      $bytes = [System.Text.Encoding]::UTF8.GetBytes("pid=$PID at=$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
      $fs.Write($bytes, 0, $bytes.Length)
      $fs.Close()
      return $true
    } catch {
      # 已有锁：超过 3 分钟当上一轮残留（崩了没来得及删），删掉再抢一次。
      try {
        $age = (Get-Date) - (Get-Item -LiteralPath $file).LastWriteTime
        if ($age.TotalSeconds -gt 180) { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue; continue }
      } catch { }
      return $false
    }
  }
  return $false
}

function Exit-UpLock {
  Remove-Item -LiteralPath (Join-Path $Cfg.PoolState 'up-all.lock') -Force -ErrorAction SilentlyContinue
}

# ---------- list ----------
function Show-List {
  # 睡眠状态只有一份汇总（巡守每 60 秒写 pool\state\sleep-status.json）——这里只读，不自己算。
  $sleepStatus = $null
  try {
    $sleepFile = Join-Path $Cfg.PoolState 'sleep-status.json'
    if (Test-Path -LiteralPath $sleepFile) { $sleepStatus = Get-Content -LiteralPath $sleepFile -Raw -Encoding UTF8 | ConvertFrom-Json }
  } catch { $sleepStatus = $null }
  $rows = @()
  foreach ($m in ($MEMBERS.Values | Where-Object { $_.Kind -eq 'fish' })) {
    $fishPort = Get-PortOf $m
    $up = Test-Port $fishPort
    $sleepLabel = '-'
    if ($sleepStatus -and $sleepStatus.members -and $sleepStatus.members.PSObject.Properties.Name -contains $m.Key) {
      $entry = $sleepStatus.members.($m.Key)
      if ($entry.sleeping) { $sleepLabel = if ($entry.label) { "勿扰（$($entry.label)）" } else { '勿扰' } }
      else { $sleepLabel = '活跃' }
    }
    $rows += [pscustomobject]@{
      '名字' = $m.Label
      '键'   = $m.Key
      '端口' = $fishPort
      '状态' = if ($up) { '在跑' } else { '没开' }
      '心跳' = if ($up) { Get-Heartbeat $m } else { '-' }
      '模式' = if ($up) { $md = Get-Mode $m; if ($md) { $md.mode } else { '?' } } else { '-' }
      '睡眠' = $sleepLabel
      '角色' = $m.Role
      '家'   = $m.Home
    }
  }
  $rows | Format-Table -AutoSize | Out-String | Write-Host
  Write-Host ("名册：{0}" -f $(if ($Cfg.MembersFile) { $Cfg.MembersFile } else { Join-Path $Cfg.PoolDir 'members.json' }))
  Write-Host '用法：fish.ps1 up <名字|all> / down <名字|all> / wake <名字> / doctor'
}

# ---------- 无人值守 ----------
# 2026-11-13 15:3x 改：不再往 profile patch 里写 agent-loop。
# 事故：agent-loop 直接 resume 会话、不经过 session-controller 的 composeAgent，
# 于是 preset 的工具没挂上 —— 小鱼丸被叫醒后手里只剩 group_say 和 working_directory。
# 现在由群插件在进程内调 sessionController.agents.resume(sessionId)（浏览器打开会话走的同一条路）。
# 这里只做一件事：清掉旧 patch 里残留的 agent-loop 块（老版本装过的机器需要）。
function Ensure-Unattended($member) {
  if (-not $member.DshHome -or -not $member.Profile) { return }
  $patch = Join-Path $member.DshHome ("profiles\{0}\cordis.patch.yml" -f $member.Profile)
  if (-not (Test-Path -LiteralPath $patch)) { return }
  $text = Get-Content -LiteralPath $patch -Raw -Encoding UTF8
  if ($text -notmatch 'agent-loop') { return }
  $script = Join-Path $PSScriptRoot 'disable-unattended.mjs'
  if (-not (Test-Path -LiteralPath $script)) { return }
  $out = & node $script --member $member.Key 2>&1
  if ($LASTEXITCODE -eq 0) {
    Write-Host ("{0}：清掉了旧的 agent-loop 块（会话改由插件挂载）。" -f $member.Label)
  } else {
    Write-Host ("{0}：旧 agent-loop 块没清掉 —— {1}" -f $member.Label, ($out -join ' '))
  }
}

# ---------- up ----------
function Start-Fish($member) {
  # 无人值守是默认（Fabian 2026-11-13 拍板）：小鱼起来不开窗，会话由 host 自己挂上。
  # 巡守（主 dsh）例外 —— 它就是那扇窗。要看窗用 maintain，或显式 -Window。
  $openWindow = if ($member.Role -eq 'watcher') { -not $NoBrowser } else { $Window }
  $fishPort = Get-PortOf $member
  # 主 dsh 没在跑就不开小鱼（Fabian 2026-11-13 12:24：关着主 dsh 只开闭小鱼不合逻辑）。
  # 判据用端口：巡守的窗关掉后端口就没了，跟"进程还在不在"一致。
  if ($member.Role -ne 'watcher') {
    $main = Get-MainFish
    if ($main -and -not (Test-Port (Get-PortOf $main))) {
      Write-Host ("主 dsh 没在跑（{0} 不通）—— 先起鱼塘（pwsh -File scripts\fish.ps1 up all -BrowserMainOnly），再开小鱼。" -f (Get-PortOf $main))
      return $false
    }
  }
  if (-not (Test-Port $fishPort)) {
    $others = @(Get-ProfileProcesses $member)
    if ($others.Count -gt 0) {
      $ids = ($others | ForEach-Object { $_.ProcessId }) -join ', '
      Write-Host ("{0}：已经有一个进程在跑（pid={1}，端口可能不是 {2}）—— 同一段会话只能一个 writer，先 down 再 up。" -f $member.Label, $ids, $fishPort)
      return $false
    }
  }
  if (Test-Port $fishPort) {
    $hbAge = Get-HeartbeatAgeSec $member
    if ($null -ne $hbAge -and $hbAge -le 90) {
      # 已经在跑就不再开一次浏览器：重复 `up` 会开出第二个一模一样的窗口，
      # 看着像"一条鱼开了两个 webui"，其实是一条鱼、两扇窗（2026-11-12 他报的）。
      Write-Host ("{0}：已经在跑（{1}）：{2}" -f $member.Label, $fishPort, (Get-Url $member))
      if (-not (Get-Mode $member)) { Set-Mode $member 'unknown' $fishPort }
      return $true
    }
    # 端口通但心跳 stale = 服务活着、会话没挂（08:40 那天的样子）。
    # 这时候"已经在跑"是假的：要开窗，会话才会挂上。
    $hbText = if ($null -eq $hbAge) { '没有心跳' } else { "$hbAge 秒前" }
    Write-Host ("{0}：进程在跑但会话没挂上（心跳：{1}）—— 开窗叫醒。" -f $member.Label, $hbText)
    if ($openWindow) {
      Start-Process (Get-Url $member) | Out-Null
      Write-FishWindowLog $member 'open'
      Set-Mode $member 'window' $fishPort
    } else {
      Write-Host '（无人值守：会话没挂上 —— 用 restore 重起一份，或 maintain 开窗看）'
    }
    return $true
  }
  if (-not $member.DshHome -or -not (Test-Path -LiteralPath $member.DshHome)) {
    Write-Host ("{0}：DSH_HOME 不存在（{1}）—— 先 install.ps1 建家。" -f $member.Label, $member.DshHome)
    return $false
  }
  if ($member.Role -ne 'watcher') { Ensure-Unattended $member }
  $out = Join-Path $member.DshHome 'logs\web-latest.log'
  $err = Join-Path $member.DshHome 'logs\web-latest.err.log'
  $cwd = if ($member.Cwd) { $member.Cwd } else { $member.Home }
  Write-Host ("{0}：开机中（{1}）……" -f $member.Label, $fishPort)
  # 巡守那条（role=watcher）保持老命令 `dsh web`；其余鱼按 profile + 端口起。
  # 巡守那条（role=watcher）保持老命令 `dsh web`；其余鱼按 profile + 端口起，并指到它自己的配置。
  $command = if ($member.Role -eq 'watcher') {
    "dsh web --no-open"
  } else {
    $cfgLine = ''
    if ($member.ConfigFile) {
      $cfgPath = if ([System.IO.Path]::IsPathRooted($member.ConfigFile)) { $member.ConfigFile } else { Join-Path (Split-Path $PSScriptRoot -Parent) $member.ConfigFile }
      $cfgLine = "`$env:LIL_WHALE_CONFIG='$cfgPath'; "
    }
    "${cfgLine}`$env:DSH_HOME='$($member.DshHome)'; `$env:DSH_PROFILE='$($member.Profile)'; dsh --profile $($member.Profile) --port $fishPort --no-open"
  }
  if ($openWindow -and $Console) {
    Start-Visible -Command $command -WorkingDirectory $cwd -OutLog $out
  } else {
    $startScripts = Start-Hidden -Command $command -WorkingDirectory $cwd -OutLog $out -ErrLog $err
  }
  $portOk = Wait-Port $fishPort
  foreach ($s in @($startScripts)) { if ($s -and (Test-Path -LiteralPath $s)) { Remove-Item -LiteralPath $s -Force -ErrorAction SilentlyContinue } }
  if (-not $portOk) {
    Write-Host ("{0}：没起来。" -f $member.Label)
    Show-Tail $err
    return $false
  }
  $url = Get-Url $member
  for ($i = 0; $i -lt 20; $i++) {
    if ($url -match 'token=') { break }
    Start-Sleep -Milliseconds 400
    $url = Get-Url $member
  }
  if ($url -notmatch 'token=') {
    Write-Host ("{0}：起来了 http://127.0.0.1:{1}（日志里还没看到 token，地址可能打不开）" -f $member.Label, $fishPort)
  } else {
    Write-Host ("{0}：起来了 {1}" -f $member.Label, $url)
  }
  if ($openWindow) {
    Start-Process $url | Out-Null
    Write-FishWindowLog $member 'open'
    Set-Mode $member 'window' $fishPort
  } else {
    Set-Mode $member 'unattended' $fishPort
  }
  return $true
}

# ---------- down ----------
# 只认「node.exe 的第一个参数是 dsh 的 bin.js」的进程，再按 bin.js 之后的参数分是谁。
# 不按进程名杀（taskkill /IM node.exe 会把别人的 node 一起带走），也不按"命令行里出现过某段字"杀
# （排障时敲的那条命令、正在读这段文字的这个 pwsh，都会被误认成鱼 —— 第一版真踩过）。
function Get-FishProcesses($member) {
  @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $cl = $_.CommandLine
    if (-not $cl) { return $false }
    $head = [regex]::Match($cl, '^\s*(?:"[^"]+"|\S+)\s+(?:"([^"]+)"|(\S+))')
    if (-not $head.Success) { return $false }
    $script = if ($head.Groups[1].Success) { $head.Groups[1].Value } else { $head.Groups[2].Value }
    if ($script -notmatch 'bin\.js$') { return $false }
    $rest = $cl.Substring($head.Index + $head.Length)
    $profiles = @($MEMBERS.Values | Where-Object { $_.Kind -eq 'fish' -and $_.Role -ne 'watcher' -and $_.Profile } | ForEach-Object { [regex]::Escape($_.Profile) })
    if ($member.Role -eq 'watcher') {
      foreach ($p in $profiles) { if ($rest -match ("--profile\s+" + $p)) { return $false } }
      return $true
    }
    return ($rest -match ("--profile\s+" + [regex]::Escape($member.Profile)))
  })
}

# 起停账：进程被 Stop-Process 强杀时自己没机会写 stopped（Cordis 的 dispose 不跑），
# 于是每次正常重启都被下一次启动记成 `resumed reason=unclean`——虽然报警那边用
# "端口在听"挡住了误报，但账本自己说"上次没正常退出"，跟 close.log 打架。
# 2026-11-13 22:1x 查账：close.log 今天 20/37/21 次 close，runs 账里 stopped 是 0。
# 修法：由"停的人"补一行——停止方记账，不指望被杀的进程自己写。
function Write-RunLogStopped($member, $ids) {
  try {
    $dir = Join-Path $Cfg.PoolState 'runs'
    if (-not (Test-Path -LiteralPath $dir)) { return }
    $file = Join-Path $dir ("{0}.log" -f $member.Key)
    $line = '{0} | stopped | fmt=2 reason=stop-script by=fish.ps1 pid={1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), (@($ids) -join ',')
    Add-Content -LiteralPath $file -Value $line -Encoding utf8
  } catch { }
}

function Stop-Fish($member) {
  $fishPort = Get-PortOf $member
  $roots = Get-FishProcesses $member
  if ($roots.Count -eq 0) {
    Write-Host ("{0}：没在跑。" -f $member.Label)
    return $true
  }
  if ($member.Role -eq 'watcher' -and -not $Yes) {
    Write-Host ("注意：{0} 就是你现在用的这个 {1}。停掉会中断正在跑的一轮对话和排队的任务。" -f $member.Label, $fishPort)
    $answer = Read-Host '确定要停？（输入 Y 确认，直接回车取消）'
    if ($answer -ne 'Y' -and $answer -ne 'y') { Write-Host '没停。'; return $true }
  }
  $ids = @($roots | ForEach-Object { $_.ProcessId })
  Write-Host ("{0}：找到 {1} 个主进程 —— {2}" -f $member.Label, $ids.Count, ($ids -join ', '))
  $children = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.ParentProcessId })
  foreach ($p in @($children) + @($roots)) {
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch { }
  }
  # 检修用的控制台窗是 -NoExit 的 pwsh：dsh 退出后窗还留着，得一起收掉，
  # 否则"回无人值守"之后桌面上挂着一个空窗（2026-11-13 11:58 实测）。
  $wrappers = @(Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -and $_.CommandLine -match 'Tee-Object' -and
    ($_.CommandLine -match ('--profile\s+' + [regex]::Escape($member.Profile)) -or $_.CommandLine -match ('--port\s+' + $fishPort + '\b'))
  })
  foreach ($w in $wrappers) {
    try { Stop-Process -Id $w.ProcessId -Force -ErrorAction Stop } catch { }
  }
  # 关窗的账在**杀完进程之后立刻写**，不等端口确认。
  # 这是防御性排序，不是修一个已发生的 bug：18:07 那次 Stop DSH 之后他 13 秒才重启，
  # 端口一直是关的，账正常写下了。但若有人在 6 秒内又把进程拉起来，旧顺序会判
  # "没停干净"并跳过 close.log / Clear-Mode —— 那会让"确实停过"从账上消失。
  # 停的人记账：被强杀的进程自己写不了 stopped。
  Write-RunLogStopped $member $ids
  Write-FishWindowLog $member 'close'
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 300
    if (-not (Test-Port $fishPort)) { break }
  }
  if (Test-Port $fishPort) {
    # 没停干净：进程可能还活着，或刚被别人重新拉起。返回 false —— 调用方不该当成功。
    # mode 账改成 unknown：文件里不能再写着"无人值守在跑"，那是纸面比现场乐观。
    Set-Mode $member 'unknown' $fishPort
    Write-Host ("{0}：端口 {1} 还开着 —— 没停干净（可能是有人马上重启了它）。" -f $member.Label, $fishPort)
    return $false
  }
  Clear-Mode $member
  Write-Host ("{0}：停了（{1} 已关闭）。" -f $member.Label, $fishPort)
  return $true
}

# ---------- refresh ----------
# 重新生成 环境.md：模板 + 名册 + 真实工具清单。
# 为什么要有：家目录是**数据**，说明书是**生成的**；代码改了、名册加鱼了、路径搬家了，
# 纸不会自己跟着变（Fabian 2026-11-12 20:10 提："有些描述放在小鱼的目录内"）。
function Invoke-RefreshEnv($member) {
  $script = Join-Path $PSScriptRoot 'render-env.mjs'
  if (-not (Test-Path -LiteralPath $script)) { Write-Host 'render-env.mjs 不见了。'; return $false }
  $fishHome = $member.Home
  if (-not $fishHome) { Write-Host ("{0} 没有家目录，跳过。" -f $member.Label); return $false }
  $envArgs = @($script, '--workspace', $fishHome, '--profile', $member.Profile, '--pool-dir', $Cfg.PoolDir, '--her-port', $member.Port)
  # 每条鱼读自己的配置（额度可能不同）；不传的话 render-env 会读仓库根那份，纸就跟这条鱼对不上。
  if ($member.ConfigFile) {
    $memberCfg = if ([System.IO.Path]::IsPathRooted($member.ConfigFile)) { $member.ConfigFile } else { Join-Path (Split-Path $PSScriptRoot -Parent) $member.ConfigFile }
    $envArgs += @('--config', $memberCfg)
  }
  & node @envArgs
  if ($LASTEXITCODE -ne 0) { return $false }
  Write-Host ("{0}：环境.md 已刷新。" -f $member.Label)
  return $true
}

# ---------- doctor ----------
function Invoke-Doctor {
  $script = Join-Path $PSScriptRoot 'doctor.ps1'
  if (-not (Test-Path -LiteralPath $script)) { Write-Host 'doctor.ps1 不见了。'; return $false }
  & pwsh -NoProfile -File $script
  return ($LASTEXITCODE -eq 0)
}

function Show-Help {
  @'
fish.ps1 -- 鱼群唯一的入口

  pwsh -File fish.ps1                  看所有鱼
  pwsh -File fish.ps1 list
  pwsh -File fish.ps1 up whale         开一条（默认无人值守：无窗，会话由 host 自己挂上）
  pwsh -File fish.ps1 up whale -Window 开一条，并且打开它的浏览器窗
  pwsh -File fish.ps1 up all           起整个鱼塘（主 dsh 开窗，小鱼无人值守）
  pwsh -File fish.ps1 up all -BrowserMainOnly  同上（兼容旧写法）
  pwsh -File fish.ps1 down whale       停一条
  pwsh -File fish.ps1 down all -Yes    停整个鱼塘（先鱼后主）
  pwsh -File fish.ps1 up-main          只起主 dsh（鱼由它 8 秒后自己带起来；勾选关掉＝空鱼塘，调试用）
  pwsh -File fish.ps1 down-main        停整个鱼塘（鱼活不过主进程；先鱼后主，账本写 stopped）
  pwsh -File fish.ps1 doctor           体检
  pwsh -File fish.ps1 new -Key <键> -Name <名字> -Parent whale   养一条新鱼（查重 → 建家 → 进名册 → 记 birth）
  pwsh -File fish.ps1 refresh whale    重新生成环境.md（模板/名册/工具变了以后）
  pwsh -File fish.ps1 maintain whale   检修：先停，再开窗（看完关窗 → restore）
  pwsh -File fish.ps1 restore whale    回无人值守（无窗起，会话由 host 自己挂上）
  pwsh -File fish.ps1 acl-check [whale|all]   查沙箱通行证（文件工具能写、pwsh 不能写 = 缺它）
  pwsh -File fish.ps1 acl-repair [whale|all]  补沙箱通行证（补完记 pool\state\acl.log）
  pwsh -File fish.ps1 wake <名字|all>         家长强行叫醒（睡眠窗里也叫得醒；记 sleep.log）
  pwsh -File fish.ps1 bind <键> -Session <会话id>   把这段会话钉到那条鱼名下（新鱼第一次开口后由宿主跑）
  pwsh -File fish.ps1 help

选项：-NoBrowser -Window -BrowserMainOnly -Console -Yes -By <谁> -Why <为什么> -Port <n>
      new 专用：-Key <成员键> -Parent <父辈键> -DryRun（只查规则，不建东西）
      key 专用：key grant -Key <孩子键> -From <家长键> / key revoke -Key <孩子键>（人执行，见 CHANGELOG A.65）
'@ | Write-Host
}

# ---------- 起/停：谁先谁后、谁开窗 ----------
# 起：巡守先起（它的浏览器窗是唯一会打开的那扇），其余鱼后台起。
# 停：先停小鱼，最后停巡守（关主 dsh 会中断正在跑的对话，放最后）。
function Invoke-Up([string]$name) {
  $targets = @(Resolve-Targets $name)
  $targets = @($targets | Sort-Object -Property @{ Expression = { if ($_.Role -eq 'watcher') { 0 } else { 1 } } })
  $okAll = $true
  foreach ($m in $targets) {
    $saved = $NoBrowser
    if ($BrowserMainOnly -and $m.Role -ne 'watcher') { $NoBrowser = $true }
    try {
      if (-not (Start-Fish $m)) { $okAll = $false }
    } finally {
      $NoBrowser = $saved
    }
  }
  return $okAll
}

function Invoke-Down([string]$name) {
  $targets = @(Resolve-Targets $name)
  $targets = @($targets | Sort-Object -Property @{ Expression = { if ($_.Role -eq 'watcher') { 1 } else { 0 } } })
  $okAll = $true
  foreach ($m in $targets) {
    if (-not (Stop-Fish $m)) { $okAll = $false }
  }
  return $okAll
}

# ---------- 检修 / 回无人值守 ----------
# 检修 = 先停掉无人值守的那份，再开一扇窗让人看（CHANGELOG A.47）。
# 为什么必须"先停"：一段会话只能一个 writer；无人值守已经挂着 agent 时再起第二个进程会被拒。
function Invoke-Maintain([string]$name) {
  $m = Get-Fish $name
  if (-not $m) { throw "没有这条鱼：$name" }
  if ($m.Role -eq 'watcher') { throw '巡守那条就是主 dsh，检修它请直接关窗/重启。' }
  Write-Host ("{0}：检修 —— 先休眠。" -f $m.Label)
  if (-not (Stop-Fish $m)) { return $false }
  $savedWindow = $Window
  $savedConsole = $Console
  $Window = $true
  $Console = $true
  try {
    if (-not (Start-Fish $m)) { return $false }
  } finally {
    $Window = $savedWindow
    $Console = $savedConsole
  }
  Write-Host ''
  Write-Host '日志在那个新开的控制台窗里（关掉窗就是结束）。'
  Write-Host '看完以后：'
  Write-Host ("  关掉窗口 → pwsh -File scripts\fish.ps1 restore {0}" -f $m.Key)
  Write-Host '  或者在鱼塘里点「回无人值守」。'
  return $true
}

# 回无人值守：无窗起，会话由 host 自己挂上（CHANGELOG A.45）。
function Invoke-Restore([string]$name) {
  $m = Get-Fish $name
  if (-not $m) { throw "没有这条鱼：$name" }
  if ($m.Role -eq 'watcher') { throw '巡守那条不适用无人值守。' }
  if (Test-Port (Get-PortOf $m)) {
    $md = Get-Mode $m
    if ($md -and $md.mode -eq 'unattended') {
      Write-Host ("{0}：本来就是无人值守（心跳 {1} 秒前）。" -f $m.Label, (Get-HeartbeatAgeSec $m))
      return $true
    }
    # 窗开着（或不知道是谁起的）：先停，再按无人值守起 —— 一段会话只能一个 writer。
    Write-Host ("{0}：先停掉现在这份（模式：{1}）。" -f $m.Label, $(if ($md) { $md.mode } else { '未知' }))
    if (-not (Stop-Fish $m)) { return $false }
  }
  $savedWindow = $Window
  $Window = $false
  try {
    if (-not (Start-Fish $m)) { return $false }
  } finally {
    $Window = $savedWindow
  }
  if (-not (Test-Port (Get-PortOf $m))) { return $false }
  $age = Get-HeartbeatAgeSec $m
  if ($null -ne $age -and $age -le 90) {
    Write-Host ("{0}：回到无人值守（心跳 {1} 秒前）。" -f $m.Label, $age)
  } else {
    Write-Host ("{0}：进程起来了，但心跳还没挂上（{1}）—— 看 pool\group\plugin.log 里的 session-mount-failed。" -f $m.Label, $(if ($null -eq $age) { '没有心跳' } else { "$age 秒前" }))
  }
  return $true
}


# ---------- 养一条新鱼（D4-2：让一条鱼自己当家长） ----------
# 用法：pwsh -File scripts\fish.ps1 new -Key <成员键> -Name <名字> -Parent <父辈键> [-Port 0] [-DryRun]
# 它做什么：查重（键 / 名字 / 端口 / 鱼数上限）→ 调 install.ps1（-SkipParent，不碰父辈的 profile）→ 记 births.log → 打印还缺什么。
# 它不做什么：不填 API key、不替你开窗、不写第一句话 —— 这三件必须由人或孩子自己完成。
# ---------- 钥匙：人给、人收（死命令，见 CHANGELOG A.65） ----------
# 只有人能跑这两个动作：把某条鱼的 .credentials.yaml 复制给孩子，或者停用它。
function Invoke-KeyCmd($action, $childKey) {
  if (-not $childKey) { Write-Host '用法：fish.ps1 key grant -Key <孩子键> -From <家长键> / key revoke -Key <孩子键>'; return $false }
  $child = $MEMBERS[$childKey]
  if (-not $child -or $child.Kind -ne 'fish') { Write-Host ("xx 名册里没有这条鱼：{0}" -f $childKey); return $false }
  if (-not $child.DshHome) { Write-Host 'xx 这条鱼没有 dshHome，没法谈钥匙。'; return $false }
  $childCred = Join-Path $child.DshHome '.credentials.yaml'
  $keyLog = Join-Path $Cfg.PoolState 'keys.log'
  $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'

  if ($action -eq 'grant') {
    if (-not $From) { Write-Host '用法：fish.ps1 key grant -Key <孩子键> -From <家长键>（人必须点名从谁的钥匙里给）'; return $false }
    $src = $MEMBERS[$From]
    if (-not $src -or $src.Kind -ne 'fish') { Write-Host ("xx 名册里没有这条鱼：{0}" -f $From); return $false }
    if ($src.Key -eq $child.Key) { Write-Host 'xx 不能把钥匙给自己。'; return $false }
    $srcCred = Join-Path $src.DshHome '.credentials.yaml'
    if (-not (Test-Path -LiteralPath $srcCred)) {
      Write-Host ("xx「{0}」家里没有凭证文件，先让它自己填过 key。" -f $src.Label)
      return $false
    }
    if (Test-Path -LiteralPath $childCred) {
      Write-Host ("注意：{0} 家里已经有 .credentials.yaml，这次会覆盖。" -f $child.Label)
    }
    $srcFp = Get-FileFingerprint $srcCred
    Copy-Item -LiteralPath $srcCred -Destination $childCred -Force
    $childFp = Get-FileFingerprint $childCred
    Add-Content -LiteralPath $keyLog -Value ('{0} | key-grant | fmt=2 child={1} from={2} via=fish.ps1 fp={3} from-fp={4}' -f $ts, $child.Key, $src.Key, $childFp, $srcFp) -Encoding utf8
    Write-Host ''
    Write-Host ("!! 已把「{0}」的 API key 复制给「{1}」—— 花的是它的额度（人明确要求的继承）。" -f $src.Label, $child.Label)
    Write-Host '   回收方式：fish.ps1 key revoke <孩子键>（停用它那份），或到平台轮换家长那把 key。'
    return $true
  }

  if ($action -eq 'revoke') {
    if (-not (Test-Path -LiteralPath $childCred)) {
      Write-Host ("xx「{0}」家里没有 .credentials.yaml，本来就没有钥匙。" -f $child.Label)
      return $false
    }
    $fp = Get-FileFingerprint $childCred
    $bak = $childCred + '.revoked-' + (Get-Date -Format 'yyyyMMddHHmmss')
    Move-Item -LiteralPath $childCred -Destination $bak -Force
    Add-Content -LiteralPath $keyLog -Value ('{0} | key-revoke | fmt=2 child={1} kept={2} via=fish.ps1 fp={3}' -f $ts, $child.Key, (Split-Path $bak -Leaf), $fp) -Encoding utf8
    Write-Host ("已停用「{0}」的钥匙：文件改名成 {1}" -f $child.Label, (Split-Path $bak -Leaf))
    Write-Host '   它下一次请求会报 MISSING_CREDENTIAL；真要吊销请到平台轮换那把 key。'
    return $true
  }

  Write-Host ('xx 不认识的 key 动作：{0}' -f $action)
  return $false
}

function Invoke-NewFish {
  $repoRoot = Split-Path $PSScriptRoot -Parent
  $pondRoot = Split-Path $repoRoot -Parent
  if ((Split-Path $repoRoot -Leaf) -ne 'app' -or -not (Test-Path -LiteralPath (Join-Path $pondRoot 'pool'))) {
    Write-Host 'xx new 只在鱼塘布局里用（仓库要在 <鱼塘>\app\，旁边要有 pool\）。'
    Write-Host 'NEXT: 单克隆布局没有加一条鱼这条路 —— 用 install.ps1 装一个新的鱼塘。'
    return $false
  }
  $key = ([string]$Key).Trim()
  $childName = ([string]$Name).Trim()
  $parentKey = ([string]$Parent).Trim()
  $reserved = @('lee', 'whale', 'fishball', 'fabian', 'all', 'main', 'app', 'pool', 'homes', 'acl', 'dsh')
  if ($key -cnotmatch '^[a-z][a-z0-9-]{1,15}$') {
    Write-Host ("xx 成员键「{0}」不合规：小写字母开头，后面是小写字母/数字/短横线，2-16 位。" -f $key)
    Write-Host 'NEXT: 换个键（比如 xiaoxingxing）；名字放 -Name，键只用来认人。'
    return $false
  }
  if ($MEMBERS.Contains($key)) {
    Write-Host ("xx 名册里已经有「{0}」了 —— 加鱼不是改鱼。" -f $key)
    return $false
  }
  if ($reserved -contains $key) {
    Write-Host ("xx 「{0}」是保留键（脚本和布局在用）。" -f $key)
    return $false
  }
  if ($childName -eq '') {
    Write-Host 'xx 得先有名字：-Name <名字>。'
    Write-Host 'NEXT: 名字由当家长的那条鱼起，别用占位符。'
    return $false
  }
  if ($childName.Length -gt 16) {
    Write-Host 'xx 名字太长（16 个字以内）。'
    return $false
  }
  $sameName = @($MEMBERS.Values | Where-Object { $_.Kind -eq 'fish' -and $_.Label -eq $childName })
  if ($sameName.Count -gt 0) {
    Write-Host ("xx 已经有鱼叫「{0}」了（{1}）。" -f $childName, $sameName[0].Key)
    Write-Host 'NEXT: 名字在群里认人，重名会叫错人。'
    return $false
  }
  if ($parentKey -eq '') {
    Write-Host 'xx 得说清是谁在养：-Parent <父辈成员键>。'
    return $false
  }
  $parent = Get-Fish $parentKey
  if (-not $parent) {
    Write-Host ("xx 名册里没有「{0}」这条鱼。" -f $parentKey)
    return $false
  }
  if ($parent.Lifecycle -eq 'archived') {
    # 2026-11-15：status 不再表示身份；"归档连带"只由 archive-fish --subtree 决定，
    # 所以这里不是提醒，而是一条拦截：归档的鱼不能再当家长。
    Write-Host ("  xx 家长「{0}」已经归档了 —— 归档的鱼不能再养新的。" -f $parent.Label)
    return $false
  }
  $fishCount = @($MEMBERS.Values | Where-Object { $_.Kind -eq 'fish' }).Count
  $maxFish = 5
  $settingsFile = Join-Path $Cfg.PoolState 'settings.json'
  if (Test-Path -LiteralPath $settingsFile) {
    try {
      $st = Get-Content -LiteralPath $settingsFile -Raw -Encoding utf8 | ConvertFrom-Json
      if ($st.maxFish) { $maxFish = [int]$st.maxFish }
    } catch { }
  }
  if ($fishCount -ge $maxFish) {
    Write-Host ("xx 鱼已经 {0} 条，到了上限 {1} 条（pool\state\settings.json 的 maxFish）。" -f $fishCount, $maxFish)
    Write-Host 'NEXT: 先归档一条不用的鱼（scripts\archive-fish.ps1），或者改上限。'
    return $false
  }
  $planInherit = ''
  if ($InheritKey) {
    if ($InheritKey -eq $key) {
      Write-Host 'xx -InheritKey 不能指它自己。'
      return $false
    }
    $srcMember = $MEMBERS[$InheritKey]
    if (-not $srcMember) {
      Write-Host ("xx 名册里没有「{0}」，没法继承它的 key。" -f $InheritKey)
      return $false
    }
    if ($srcMember.Kind -ne 'fish') {
      Write-Host ("xx 「{0}」不是鱼，没有 key 可继承。" -f $srcMember.Label)
      return $false
    }
    $srcCred = Join-Path $srcMember.DshHome '.credentials.yaml'
    if (-not (Test-Path -LiteralPath $srcCred)) {
      Write-Host ("xx 「{0}」的家还没有凭证文件 —— 先让它自己填过 key，再继承。" -f $srcMember.Label)
      return $false
    }
    $planInherit = $InheritKey
  }
  $childHome = Join-Path (Join-Path $pondRoot 'homes') $key
  $portText = if ($Port -gt 0) { [string]$Port } else { '自动挑一个空口' }
  Write-Host ''
  Write-Host ('  养一条新鱼：{0}（{1}）' -f $childName, $key)
  Write-Host ('  家长        {0}（{1}）' -f $parent.Label, $parent.Key)
  Write-Host ('  她的家      {0}' -f $childHome)
  Write-Host ('  端口        {0}' -f $portText)
  Write-Host ('  现在鱼数    {0} / {1}' -f $fishCount, $maxFish)
  if ($planInherit) { Write-Host ('  钥匙        继承自「{0}」（花它的额度）' -f $MEMBERS[$planInherit].Label) }
  if ($DryRun) {
    Write-Host ''
    Write-Host '（-DryRun：只查了规则，什么都没建。）'
    Write-Host '去掉 -DryRun 才会真的建家、装 profile、写名册、记 birth。'
    return $true
  }
  Write-Host ''
  $install = Join-Path $PSScriptRoot 'install.ps1'
  if (-not (Test-Path -LiteralPath $install)) {
    Write-Host 'xx 找不到 install.ps1（new 只是它的套壳）。'
    return $false
  }
  & pwsh -NoProfile -File $install -ChildName $childName -ChildMemberId $key -ParentMemberId $parent.Key -ChildProfile $key -SkipParent -ChildPort $Port
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'xx 安装没成（原因在上面）。什么都没记账。'
    Write-Host ('NEXT: 修掉上面那条，再跑 pwsh -File scripts\fish.ps1 new -Key {0} -Name {1} -Parent {2}' -f $key, $childName, $parent.Key)
    return $false
  }
  $realPort = $Port
  try {
    $fresh = Get-Content -LiteralPath $Cfg.MembersFile -Raw -Encoding utf8 | ConvertFrom-Json
    $realPort = [int]$fresh.members.$key.port
  } catch { }
  # API key 是人的东西：只有上面 -InheritKey 明确给了，才在这里复制一份；脚本自己从不"顺手"找 key。
  $keyInherited = ''
  if ($planInherit) {
    $srcCred = Join-Path $MEMBERS[$planInherit].DshHome '.credentials.yaml'
    $dstCred = $null
    try {
      $freshHome = (Get-Content -LiteralPath $Cfg.MembersFile -Raw -Encoding utf8 | ConvertFrom-Json).members.$key.dshHome
      if ($freshHome) { $dstCred = Join-Path ([string]$freshHome) '.credentials.yaml' }
    } catch { }
    if (-not $dstCred) {
      Write-Host 'xx 名册里读不到新鱼的家，凭证没复制 —— 请人工填 key。'
    } else {
      try {
        Copy-Item -LiteralPath $srcCred -Destination $dstCred -Force
        # 2026-11-15 补：继承也是钥匙的一次变动，必须进 keys.log（以前只复制、不记账）
        try {
          $inheritFp = Get-FileFingerprint $dstCred
          $sourceFp = Get-FileFingerprint $srcCred
          $keyLog = Join-Path $Cfg.PoolState 'keys.log'
          Add-Content -LiteralPath $keyLog -Value ('{0} | key-inherit | fmt=2 child={1} from={2} via=fish.ps1 fp={3} from-fp={4} requestedBy={5}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $key, $planInherit, $inheritFp, $sourceFp, $RequestedBy) -Encoding utf8
        } catch { Write-Host ('!! keys.log 没记上：{0}' -f $_.Exception.Message) }
        $keyInherited = $planInherit
        Write-Host ''
        Write-Host ("!! 已把「{0}」的 API key 复制给「{1}」—— 花的是它的额度（人明确要求的继承）。" -f $MEMBERS[$planInherit].Label, $childName)
        Write-Host '   回收方式：删掉新鱼家里的 .credentials.yaml，或轮换家长那把 key。'
      } catch {
        Write-Host ('xx 凭证复制失败（{0}）—— 请人工填 key。' -f $_.Exception.Message)
      }
    }
  }
  $birthLog = Join-Path $Cfg.PoolState 'births.log'
  $parentLifecycle = if ($parent.Lifecycle) { $parent.Lifecycle } else { 'active' }
  $keyPart = if ($keyInherited) { ' keyInherited=' + $keyInherited } else { '' }
  $line = '{0} | birth | fmt=2 key={1} name={2} parent={3} by={4} port={5} parentLifecycle={6} requestedBy={7}{8}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $key, $childName, $parent.Key, $By, $realPort, $parentLifecycle, $RequestedBy, $keyPart
  try { Add-Content -LiteralPath $birthLog -Value $line -Encoding utf8 } catch { Write-Host ('!! birth 没记上：{0}' -f $_.Exception.Message) }
  Write-Host ''
  Write-Host ('{0} 出生了：{1}（{2}），端口 {3}。' -f $parent.Label, $childName, $key, $realPort)
  Write-Host ''
  if ($keyInherited) {
    Write-Host '还缺两步（钥匙已经继承了；最后一步是给它第一句话）：'
    Write-Host ('  1) 回无人值守：pwsh -File scripts\fish.ps1 restore {0}' -f $key)
    Write-Host '  2) 在群里对它说第一句话 —— 它会从这句话开始记事。'
    Write-Host ('  3) 看它起没起来：pwsh -File scripts\fish.ps1 list')
  } else {
    Write-Host '还缺三步（前两步得有人做，第三步是给它第一句话）：'
    Write-Host ('  1) 给它一把钥匙：pwsh -File scripts\fish.ps1 maintain {0}' -f $key)
    Write-Host '     在弹出的窗里进 设置 → Models，填它自己的 API key；填完关窗。'
    Write-Host ('  2) 回到无人值守：pwsh -File scripts\fish.ps1 restore {0}' -f $key)
    Write-Host '  3) 在群里对它说第一句话 —— 它会从这句话开始记事。'
    Write-Host '  4) 看它起没起来：pwsh -File scripts\fish.ps1 list'
  }
  return $true
}

# ---------- 把"这段会话"钉给某条鱼（CHANGELOG A.104） ----------
# 为什么要有这一条：新鱼的家是空的，第一段会话由宿主在网页里建；建完那一刻
# 名册（pins.json）里没有她 —— 群里不认她，她说的第一句话会被拒。
# 这一步是宿主的活（名册只有宿主能写），所以做成一条命令，别让鱼自己改文件。
function Invoke-Bind([string]$key, [string]$sessionId) {
  if ($key -eq '') { Write-Host 'xx 要指名哪条鱼：bind <键> -Session <会话id>（例：bind xiaoman -Session session-4e31957c-…）'; return $false }
  if ($sessionId -eq '') { Write-Host 'xx 要给出会话 id：-Session session-xxxxxxxx-…（在她家的 sessions 目录里能看到）'; return $false }
  if ($sessionId -notmatch '^session-[0-9a-f-]{20,}$') { Write-Host ("xx 会话 id 形状不对：{0}" -f $sessionId); return $false }
  $m = Get-Fish $key
  if (-not $m) { Write-Host ("xx 名册里没有这条鱼：{0}" -f $key); return $false }
  if ($m.Role -eq 'watcher') { Write-Host 'xx 巡守的会话在它自己的 HOME 里，不走这条命令。'; return $false }
  if (-not $m.DshHome) { Write-Host ("xx 名册里没有 {0} 的家（dshHome）" -f $m.Label); return $false }
  # 会话必须真的在那个家里：否则"绑"就成了把别人的会话顶到她的名字下（叫错人比叫不动更糟）。
  $found = $false
  $sessionsRoot = Join-Path ([string]$m.DshHome) 'sessions'
  if (Test-Path -LiteralPath $sessionsRoot) {
    $found = @(Get-ChildItem -LiteralPath $sessionsRoot -Recurse -File -Force -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -like ('*' + $sessionId + '*') }).Count -gt 0
  }
  if (-not $found) {
    Write-Host ("xx 在 {0} 的会话目录里找不到 {1} —— 拒绝绑定（先让她在网页里建一段会话）" -f $m.Label, $sessionId)
    Write-Host ("   看的目录：{0}" -f $sessionsRoot)
    return $false
  }
  & node (Join-Path $Cfg.Root 'scripts/bind-member.mjs') --member $key --id $sessionId
  if ($LASTEXITCODE -ne 0) { Write-Host 'xx 写名册失败（看上面的 NEXT）'; return $false }
  Write-Host ("✓ {0} 已钉住这段会话：{1}" -f $m.Label, $sessionId)
  Write-Host 'NEXT: 在群里跟她说话，或者让她跑一句 group_say 试试；doctor 的「会话绑定」这一格现在该是 OK。'
  return $true
}

# ---------- 沙箱通行证：查、补（CHANGELOG A.67） ----------
# 判据：同一路径、同样内容，文件工具能写而 pwsh 不能写 —— 是"手"缺通行证，不是语法问题。
function Invoke-AclCmd([string]$action, [string]$name) {
  $members = @(Resolve-Targets $name | Where-Object { $_.Kind -eq 'fish' -and $_.Role -ne 'watcher' -and $_.Home })
  if ($members.Count -eq 0) { Write-Host 'xx 没有可查的鱼。'; return $false }
  $ok = $true
  foreach ($m in $members) {
    $sid = Get-WorkspaceSid ([string]$m.Home)
    # 2026-11-15：沙箱给 workspace 贴通行证需要家根上的 WRITE_OWNER。
    # 缺这条时，鱼第一次调 pwsh 就会失败（Win32 5），外观是"这条鱼坏了"。
    if (-not (Test-WorkspaceProvisionRights ([string]$m.Home))) {
      if ($action -eq 'check') {
        Write-Host ("{0}：家根缺当前用户的完全控制（沙箱贴通行证要 WRITE_OWNER；鱼会连 pwsh 都起不来）" -f $m.Label)
        Write-Host ("NEXT: pwsh -File scripts/fish.ps1 acl-repair {0}" -f $m.Key)
        $ok = $false
        continue
      }
      if (Repair-WorkspaceProvisionRights ([string]$m.Home)) {
        Write-Host ("   补上了家根权限：{0}" -f [System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
      } else {
        Write-Host 'xx 家根权限补不上（需要所有者/管理员权限）'
        $ok = $false
        continue
      }
    }
    $gaps = Get-WorkspaceGrantGaps $m
    if ($gaps.Count -eq 0) {
      Write-Host ("{0}：通行证齐全（{1}）" -f $m.Label, $sid)
      continue
    }
    if ($action -eq 'check') {
      Write-Host ("{0}：{1} 个对象缺通行证（{2}）" -f $m.Label, $gaps.Count, $sid)
      $gaps | Select-Object -First 8 | ForEach-Object { Write-Host ("   - {0}" -f $_) }
      if ($gaps.Count -gt 8) { Write-Host ("   … 还有 {0} 个" -f ($gaps.Count - 8)) }
      Write-Host ("NEXT: pwsh -File scripts\fish.ps1 acl-repair {0}" -f $m.Key)
      $ok = $false
      continue
    }
    $fixed = Repair-WorkspaceGrantGaps $m
    $left = @(Get-WorkspaceGrantGaps $m)
    if ($left.Count -gt 0) {
      # Set-Acl 之后立刻读 ACL 有时还是旧快照（不是没补上）——等 300ms 再读一次
      Start-Sleep -Milliseconds 300
      $left = @(Get-WorkspaceGrantGaps $m)
    }
    if ($left.Count -gt 0) {
      Write-Host ("xx {0}：补了 {1} 个，还剩 {2} 个补不上（看上面的 ! 行）" -f $m.Label, $fixed, $left.Count)
      $ok = $false
    } else {
      Write-Host ("{0}：补了 {1} 个，现在齐全（{2}）" -f $m.Label, $fixed, $sid)
      Add-Content -LiteralPath (Join-Path $Cfg.PoolState 'acl.log') -Value ('{0} | acl-repair | fmt=1 member={1} fixed={2} sid={3}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m.Key, $fixed, $sid) -Encoding utf8
    }
  }
  return $ok
}

# ---------- 强行叫醒（CHANGELOG A.73） ----------
# 她可以自己睡（工具 sleep），但上级家长有权利把她叫醒。
# 判断窗口/跨午夜/优先级全在 sleep-core.js 一份实现里，这里只调 sleep-cli.mjs，不自己算。
function Invoke-Wake([string]$name, [string]$by = 'fish.ps1', [string]$why = '') {
  $members = @(Resolve-Targets $name | Where-Object { $_.Kind -eq 'fish' -and $_.Role -ne 'watcher' })
  if ($members.Count -eq 0) { Write-Host 'xx 没有可叫醒的鱼。'; return $false }
  $ok = $true
  foreach ($m in $members) {
    $reason = if ([string]::IsNullOrWhiteSpace($why)) { '未写原因' } else { $why }
    $out = & node (Join-Path $PSScriptRoot 'sleep-cli.mjs') wake $m.Key "--by=$by" "--why=$reason" 2>&1
    if ($LASTEXITCODE -eq 0) {
      $parsed = $null
      try { $parsed = ($out -join '') | ConvertFrom-Json } catch { $parsed = $null }
      $label = if ($parsed -and $parsed.changed -eq $false -and $parsed.message) { $parsed.message } elseif ($parsed -and $parsed.label) { $parsed.label } else { '已叫醒' }
      Write-Host ("{0}：{1}" -f $m.Label, $label)
    } else {
      Write-Host ("xx {0}：叫醒失败 —— {1}" -f $m.Label, ($out -join ' '))
      $ok = $false
    }
  }
  return $ok
}

# ---------- 分发 ----------
$ok = $true
$locked = $false
$cmd = $Command.ToLower()
$targetsAll = ($Name -eq '' -or $Name -eq 'all')
if (($cmd -eq 'up' -or $cmd -eq 'start') -and $targetsAll) {
  if (-not (Enter-UpLock)) {
    Write-Host '另一个批量启动正在进行（pool\state\up-all.lock）—— 结果：跳过（没有做事，不是失败）。'
    exit 0
  }
  $locked = $true
}
try {
  switch ($cmd) {
    'list'   { Show-List }
    'ls'     { Show-List }
    'up'     { if (-not (Invoke-Up $Name)) { $ok = $false } }
    'start'  { if (-not (Invoke-Up $Name)) { $ok = $false } }
    'down'   { if (-not (Invoke-Down $Name)) { $ok = $false } }
    'stop'   { if (-not (Invoke-Down $Name)) { $ok = $false } }
    'refresh' {
      foreach ($m in (Resolve-Targets $Name)) {
        # 巡守不是 install 装的，它家的 环境.md 是他自己的 DSH 文档 —— 别替他写（2026-11-13 扫描 P2#27）。
        if ($m.Role -eq 'watcher') { Write-Host ("{0}：巡守不生成 环境.md（那不是 install 装的）。" -f $m.Label); continue }
        if (-not (Invoke-RefreshEnv $m)) { $ok = $false }
      }
    }
    'new'    { if (-not (Invoke-NewFish)) { $ok = $false } }
    'key'    { if (-not (Invoke-KeyCmd $Name $Key)) { $ok = $false } }
    'acl-check'  { if (-not (Invoke-AclCmd 'check' $Name)) { $ok = $false } }
    'acl-repair' { if (-not (Invoke-AclCmd 'repair' $Name)) { $ok = $false } }
    'wake'       { if (-not (Invoke-Wake $Name $By $Why)) { $ok = $false } }
    'bind'       { $bindKey = if ($Name) { $Name } else { $Key }; if (-not (Invoke-Bind $bindKey $Session)) { $ok = $false } }
    'maintain' { if (-not (Invoke-Maintain $Name)) { $ok = $false } }
    'restore'  { if (-not (Invoke-Restore $Name)) { $ok = $false } }
    'unattended' { if (-not (Invoke-Restore $Name)) { $ok = $false } }
    'up-main' {
      # 只起主 dsh。鱼由巡守起来 8 秒后自己带起来（鱼塘里那个勾选；关掉就是空鱼塘，调试用）。
      $m = Get-MainFish
      if (-not $m) { throw '名册里没有巡守那条鱼（lee）' }
      $wasRunning = Test-Port (Get-PortOf $m)
      if (-not (Start-Fish $m)) { $ok = $false }
      elseif ($wasRunning -and -not $NoBrowser) {
        # 已经在跑：Start-Fish 只打印地址；但用户点的是"启动 dsh"，该把窗口给他打开。
        Start-Process (Get-Url $m) | Out-Null
        Write-Host '已经开着，帮你把 WebUI 打开了。'
      }
      Write-Host '巡守起来 8 秒后会把鱼带起来（鱼塘里「起主 dsh 时把鱼也带起来」勾选关掉的话不会带）。'
    }
    'down-main' {
      # 2026-11-14 起：鱼活不过主进程（它们在主 dsh 的作业对象里，主进程一死 Windows 把整棵树收掉）。
      # 所以"只关主 dsh"实际上就是"关整个鱼塘"——但如果直接杀主进程，鱼会被 job 带走、账本记成 unclean。
      # 那就先把鱼正常停掉（写 stopped），最后再停主 dsh。这样"重启 dsh"不再留下假崩溃。
      Write-Host '鱼活不过主进程（它们在主 dsh 的作业对象里），所以这次会停整个鱼塘：先停鱼、最后停主 dsh。'
      Write-Host '只想起主 dsh 不要鱼：up-main（空鱼塘）；只想停某一条：down <名字> -Yes。'
      if (-not (Invoke-Down 'all')) { $ok = $false }
    }
    'doctor' { $ok = Invoke-Doctor }
    'help'   { Show-Help }
    default  { Write-Host "不认识的命令：$Command"; Show-Help; $ok = $false }
  }
} catch {
  Write-Host ("没做成：" + $_.Exception.Message)
  $ok = $false
} finally {
  if ($locked) { Exit-UpLock }
}

if ($ok) { exit 0 }
exit 1
