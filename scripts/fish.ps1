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
#   pwsh -File fish.ps1 down-main          关闭主 dsh（还在跑的小鱼继续跑）
#   pwsh -File fish.ps1 doctor             体检（现在只对配置里那条鱼）
#   pwsh -File fish.ps1 help
#
# 选项：-Window（开窗起；默认无人值守） -NoBrowser（强制不开） -BrowserMainOnly（只给主 dsh 开窗） -Yes（不停下来问）
#       -By/-Why（记账用） -Port（覆盖端口）
#
# 两种"在跑"：
#   unattended = 无窗起，会话由插件调 sessionController 自己挂上（PRD A.45 / A.54）
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
  [switch]$Console
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

if ($env:DSH_LAUNCH_NO_BROWSER -eq '1') { $NoBrowser = $true }

# ---------- 名册 ----------
# 真源是 pool\members.json（PRD A.25）。文件不在就退回配置里那两条 —— 能跑，但只有两条。
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
        }
      }
    } catch {
      Write-Warning "名册读不了（$file）：$($_.Exception.Message) —— 退回配置里的两条"
    }
  }
  if ($out.Count -eq 0) {
    $out['lee'] = [pscustomobject]@{ Key = 'lee'; Label = '大肥鱼'; Kind = 'fish'; Role = 'watcher'; Home = $Cfg.LeeHome; DshHome = $Cfg.LeeHome; Profile = $Cfg.LeeProfile; Port = $Cfg.LeePort; Cwd = $Cfg.LeeStartCwd }
    $out['whale'] = [pscustomobject]@{ Key = 'whale'; Label = '小肥鱼'; Kind = 'fish'; Role = 'member'; Home = $Cfg.HerHome; DshHome = $Cfg.HerDshHome; Profile = $Cfg.WhaleProfile; Port = $Cfg.HerPort; Cwd = $Cfg.WhaleCwd }
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
  Start-Process -FilePath 'pwsh' `
    -ArgumentList '-NoLogo', '-NoProfile', '-Command', $Command `
    -WorkingDirectory $WorkingDirectory -WindowStyle Hidden `
    -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog | Out-Null
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
# 第二个拿到的是 session/writer-held（PRD A.47）。端口只是"有没有人监听"，
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
  $rows = @()
  foreach ($m in ($MEMBERS.Values | Where-Object { $_.Kind -eq 'fish' })) {
    $fishPort = Get-PortOf $m
    $up = Test-Port $fishPort
    $rows += [pscustomobject]@{
      '名字' = $m.Label
      '键'   = $m.Key
      '端口' = $fishPort
      '状态' = if ($up) { '在跑' } else { '没开' }
      '心跳' = if ($up) { Get-Heartbeat $m } else { '-' }
      '模式' = if ($up) { $md = Get-Mode $m; if ($md) { $md.mode } else { '?' } } else { '-' }
      '角色' = $m.Role
      '家'   = $m.Home
    }
  }
  $rows | Format-Table -AutoSize | Out-String | Write-Host
  Write-Host ("名册：{0}" -f $(if ($Cfg.MembersFile) { $Cfg.MembersFile } else { Join-Path $Cfg.PoolDir 'members.json' }))
  Write-Host '用法：fish.ps1 up <名字|all> / down <名字|all> / doctor'
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
      Write-Host ("主 dsh 没在跑（{0} 不通）—— 先启动主 dsh（scripts\bin\Run DSH.cmd），再开小鱼。" -f (Get-PortOf $main))
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
    "${cfgLine}`$env:DSH_HOME='$($member.DshHome)'; dsh --profile $($member.Profile) --port $fishPort --no-open"
  }
  if ($openWindow -and $Console) {
    Start-Visible -Command $command -WorkingDirectory $cwd -OutLog $out
  } else {
    Start-Hidden -Command $command -WorkingDirectory $cwd -OutLog $out -ErrLog $err
  }
  if (-not (Wait-Port $fishPort)) {
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
  & node $script --workspace $fishHome --profile $member.Profile --pool-dir $Cfg.PoolDir --her-port $member.Port
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
  pwsh -File fish.ps1 up all           全开（小鱼无人值守，只有主 dsh 开窗）
  pwsh -File fish.ps1 up all -BrowserMainOnly  同上（兼容旧写法）
  pwsh -File fish.ps1 down whale       停一条
  pwsh -File fish.ps1 down all -Yes    全停（含主 dsh）
  pwsh -File fish.ps1 up-main          启动主 dsh（已在跑就打开它的 WebUI）
  pwsh -File fish.ps1 down-main        关闭主 dsh（还在跑的小鱼继续跑）
  pwsh -File fish.ps1 doctor           体检
  pwsh -File fish.ps1 refresh whale    重新生成环境.md（模板/名册/工具变了以后）
  pwsh -File fish.ps1 maintain whale   检修：先停，再开窗（看完关窗 → restore）
  pwsh -File fish.ps1 restore whale    回无人值守（无窗起，会话由 host 自己挂上）
  pwsh -File fish.ps1 help

选项：-NoBrowser -Window -BrowserMainOnly -Console -Yes -By <谁> -Why <为什么> -Port <n>
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
# 检修 = 先停掉无人值守的那份，再开一扇窗让人看（PRD A.47）。
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

# 回无人值守：无窗起，会话由 host 自己挂上（A.45）。
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
    'maintain' { if (-not (Invoke-Maintain $Name)) { $ok = $false } }
    'restore'  { if (-not (Invoke-Restore $Name)) { $ok = $false } }
    'unattended' { if (-not (Invoke-Restore $Name)) { $ok = $false } }
    'up-main' {
      $m = Get-MainFish
      if (-not $m) { throw '名册里没有巡守那条鱼（lee）' }
      $wasRunning = Test-Port (Get-PortOf $m)
      if (-not (Start-Fish $m)) { $ok = $false }
      elseif ($wasRunning -and -not $NoBrowser) {
        # 已经在跑：Start-Fish 只打印地址；但用户点的是"启动 dsh"，该把窗口给他打开。
        Start-Process (Get-Url $m) | Out-Null
        Write-Host '已经开着，帮你把 WebUI 打开了。'
      }
    }
    'down-main' {
      # 只关主 dsh，小鱼继续跑（Fabian 2026-11-13 12:24：缺的正是这个方式）。
      # 以前这里会拒绝并要求 -Force，但用户没有地方敲 -Force —— 那就等于没有这条路。
      $m = Get-MainFish
      if (-not $m) { throw '名册里没有巡守那条鱼（role=watcher）—— 检查 pool\members.json' }
      $runningFish = @($MEMBERS.Values | Where-Object {
        $_.Kind -eq 'fish' -and $_.Role -ne 'watcher' -and (Test-Port (Get-PortOf $_))
      })
      if ($runningFish.Count -gt 0) {
        Write-Host ('注意：还有 {0} 条鱼在跑（{1}），这次只关主 dsh，它们继续跑。' -f $runningFish.Count, (($runningFish | ForEach-Object { $_.Label }) -join '、'))
        Write-Host '要连鱼一起关：scripts\bin\Stop All Whales.cmd（或鱼塘里点「全部休眠」）。'
      }
      # 用户点的是快捷方式（或鱼塘按钮）——那一下就是确认，不要再弹 Read-Host。
      # 2026-11-13 17:59 实测：down-main 没传 -Yes，Stop-Fish 在非交互里 Read-Host 拿到空串就"没停"，
      # 结果 Stop DSH.cmd 双击后什么都没发生（窗口里只有一句"注意…"，看起来像失败又不像）。
      $Yes = $true
      if (-not (Stop-Fish $m)) { $ok = $false }
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
