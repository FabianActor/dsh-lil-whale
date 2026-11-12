# fish.ps1 -- 鱼群唯一的入口。ASCII 文件名 + UTF-8 BOM。
#
# 为什么要有它：鱼一多，"开/停/体检"三件事各有各的脚本，每加一条鱼就多一套参数。
# 这个脚本只做一件事：把命令套到 pool\members.json 里那条鱼身上。
#
#   pwsh -File fish.ps1                    看所有鱼（默认 list）
#   pwsh -File fish.ps1 list
#   pwsh -File fish.ps1 up whale           开一条（开完自动开浏览器）
#   pwsh -File fish.ps1 up all             全开（巡守那条 + 所有鱼）
#   pwsh -File fish.ps1 down whale         停一条
#   pwsh -File fish.ps1 down all           全停
#   pwsh -File fish.ps1 doctor             体检（现在只对配置里那条鱼）
#   pwsh -File fish.ps1 help
#
# 选项：-NoBrowser（不开浏览器） -Yes（不停下来问） -By/-Why（记账用） -Port（覆盖端口）
#
# 退出码：0 = 都成了；1 = 有一项没成（原因在上面）。
param(
  [Parameter(Position = 0)][string]$Command = 'list',
  [Parameter(Position = 1)][string]$Name = '',
  [switch]$NoBrowser,
  [switch]$Yes,
  [string]$By = 'fabian',
  [string]$Why = '',
  [int]$Port = 0
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

if ($env:DSH_LAUNCH_NO_BROWSER -eq '1') { $NoBrowser = $true }

# ---------- 名册 ----------
# 真源是 pool\members.json（PRD A.25）。文件不在就退回配置里那两条 —— 能跑，但只有两条。
function Get-Members {
  $file = Join-Path $Cfg.PoolDir 'members.json'
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
    if ($line -match "(http://127\.0\.0\.1:$($member.Port)/\?token=[A-Za-z0-9_\-]+)") { return $Matches[1] }
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

function Write-FishWindowLog($member, [string]$Event) {
  if (-not $member.Home) { return }
  $dir = Join-Path $member.Home 'logs'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $line = "{0} | event={1} | by={2} | busy={3} | why={4}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Event, $By, (Get-PresenceSnapshot), $Why
  Add-Content -LiteralPath (Join-Path $dir 'close.log') -Value $line -Encoding UTF8
}

# ---------- list ----------
function Show-List {
  $rows = @()
  foreach ($m in ($MEMBERS.Values | Where-Object { $_.Kind -eq 'fish' })) {
    $port = Get-PortOf $m
    $up = Test-Port $port
    $rows += [pscustomobject]@{
      '名字' = $m.Label
      '键'   = $m.Key
      '端口' = $port
      '状态' = if ($up) { '在跑' } else { '没开' }
      '心跳' = if ($up) { Get-Heartbeat $m } else { '-' }
      '角色' = $m.Role
      '家'   = $m.Home
    }
  }
  $rows | Format-Table -AutoSize | Out-String | Write-Host
  Write-Host ("名册：{0}" -f (Join-Path $Cfg.PoolDir 'members.json'))
  Write-Host '用法：fish.ps1 up <名字|all> / down <名字|all> / doctor'
}

# ---------- up ----------
function Start-Fish($member) {
  $port = Get-PortOf $member
  if (Test-Port $port) {
    Write-Host ("{0}：已经在跑（{1}）。" -f $member.Label, $port)
    if (-not $NoBrowser) { Start-Process (Get-Url $member) | Out-Null }
    return $true
  }
  if (-not $member.DshHome -or -not (Test-Path -LiteralPath $member.DshHome)) {
    Write-Host ("{0}：DSH_HOME 不存在（{1}）—— 先 install.ps1 建家。" -f $member.Label, $member.DshHome)
    return $false
  }
  $out = Join-Path $member.DshHome 'logs\web-latest.log'
  $err = Join-Path $member.DshHome 'logs\web-latest.err.log'
  $cwd = if ($member.Cwd) { $member.Cwd } else { $member.Home }
  Write-Host ("{0}：开机中（{1}）……" -f $member.Label, $port)
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
    "${cfgLine}`$env:DSH_HOME='$($member.DshHome)'; dsh --profile $($member.Profile) --port $port --no-open"
  }
  Start-Hidden -Command $command -WorkingDirectory $cwd -OutLog $out -ErrLog $err
  if (-not (Wait-Port $port)) {
    Write-Host ("{0}：没起来。" -f $member.Label)
    Show-Tail $err
    return $false
  }
  Write-Host ("{0}：起来了 http://127.0.0.1:{1}" -f $member.Label, $port)
  if (-not $NoBrowser) {
    Start-Process (Get-Url $member) | Out-Null
    Write-FishWindowLog $member 'open'
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
  $port = Get-PortOf $member
  $roots = Get-FishProcesses $member
  if ($roots.Count -eq 0) {
    Write-Host ("{0}：没在跑。" -f $member.Label)
    return $true
  }
  if ($member.Role -eq 'watcher' -and -not $Yes) {
    Write-Host ("注意：{0} 就是你现在用的这个 {1}。停掉会中断正在跑的一轮对话和排队的任务。" -f $member.Label, $port)
    $answer = Read-Host '确定要停？（输入 Y 确认，直接回车取消）'
    if ($answer -ne 'Y' -and $answer -ne 'y') { Write-Host '没停。'; return $true }
  }
  $ids = @($roots | ForEach-Object { $_.ProcessId })
  Write-Host ("{0}：找到 {1} 个主进程 —— {2}" -f $member.Label, $ids.Count, ($ids -join ', '))
  $children = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.ParentProcessId })
  foreach ($p in @($children) + @($roots)) {
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch { }
  }
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 300
    if (-not (Test-Port $port)) { break }
  }
  if (Test-Port $port) {
    Write-Host ("{0}：端口 {1} 还开着 —— 没停干净。" -f $member.Label, $port)
    return $false
  }
  Write-Host ("{0}：停了（{1} 已关闭）。" -f $member.Label, $port)
  Write-FishWindowLog $member 'close'
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
  pwsh -File fish.ps1 up whale         开一条
  pwsh -File fish.ps1 up all           全开
  pwsh -File fish.ps1 down whale       停一条
  pwsh -File fish.ps1 down all         全停
  pwsh -File fish.ps1 doctor           体检
  pwsh -File fish.ps1 refresh whale    重新生成环境.md（模板/名册/工具变了以后）
  pwsh -File fish.ps1 help

选项：-NoBrowser -Yes -By <谁> -Why <为什么> -Port <n>
'@ | Write-Host
}

# ---------- 分发 ----------
$ok = $true
try {
  switch ($Command.ToLower()) {
    'list'   { Show-List }
    'ls'     { Show-List }
    'up'     { foreach ($m in (Resolve-Targets $Name)) { if (-not (Start-Fish $m)) { $ok = $false } } }
    'start'  { foreach ($m in (Resolve-Targets $Name)) { if (-not (Start-Fish $m)) { $ok = $false } } }
    'down'   { foreach ($m in (Resolve-Targets $Name)) { if (-not (Stop-Fish $m)) { $ok = $false } } }
    'stop'   { foreach ($m in (Resolve-Targets $Name)) { if (-not (Stop-Fish $m)) { $ok = $false } } }
    'refresh' { foreach ($m in (Resolve-Targets $Name)) { if (-not (Invoke-RefreshEnv $m)) { $ok = $false } } }
    'doctor' { $ok = Invoke-Doctor }
    'help'   { Show-Help }
    default  { Write-Host "不认识的命令：$Command"; Show-Help; $ok = $false }
  }
} catch {
  Write-Host ("没做成：" + $_.Exception.Message)
  $ok = $false
}

if ($ok) { exit 0 }
exit 1
