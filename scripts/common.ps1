# common.ps1 -- 这台机器的假设，脚本侧的统一入口。
#
# 真源是仓库根目录的 `lil-whale.config.json`（`LIL_WHALE_CONFIG` 环境变量可以指到别处）。
# 每个脚本开头 dot-source 一次：
#
#     . (Join-Path $PSScriptRoot 'common.ps1')
#
# 然后只用 $Cfg.* ，不要自己拼绝对路径。
#
# 为什么要有这个文件：路径写死在八份脚本里，打包给别人时最麻烦的就是这些 ——
# 装上以后跑不起来，报的还是一句含糊的 "找不到文件"，看不出是谁的问题。
#
# 读不到配置时按"标准布局"猜（仓库旁边有个同级的 lil-whale/ 当她的家），
# 这样别人克隆下来、把家放在旁边就能跑；布局不一样才需要那份 JSON。

$script:WhaleRoot = Split-Path $PSScriptRoot -Parent

function Get-WhaleConfig {
  $path = if ($env:LIL_WHALE_CONFIG) { $env:LIL_WHALE_CONFIG } else { Join-Path $script:WhaleRoot 'lil-whale.config.json' }
  $raw = $null
  if (Test-Path -LiteralPath $path) {
    try { $raw = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { Write-Warning "配置读不了（$path）：$($_.Exception.Message)，先按默认布局跑" }
  }

  # 默认布局（鱼塘）：<pond>\app 是仓库，鱼在 <pond>\homes\<键>，共享区在 <pond>\pool。
  $defaultHome = Join-Path (Join-Path (Split-Path $script:WhaleRoot -Parent) 'homes') 'whale'

  # 配置里有的字段优先；没有的按默认推。
  # 旧名字（her* / whale*）仍然认，新名字（self*）优先 —— 单鱼时代写的配置不用改也能跑。
  $pick = {
    param($name, $fallback)
    if ($raw -and $raw.PSObject.Properties.Name -contains $name -and $raw.$name) { $raw.$name } else { $fallback }
  }
  $pickSelf = {
    param($newName, $oldName, $fallback)
    $v = & $pick $newName $null
    if ($v) { return $v }
    if ($oldName) { $v = & $pick $oldName $null; if ($v) { return $v } }
    return $fallback
  }

  $selfHome = & $pickSelf 'selfHome' 'herHome' $defaultHome
  $pondRoot = Split-Path (Split-Path $selfHome -Parent) -Parent
  $poolDir  = & $pick 'poolDir' (Join-Path $pondRoot 'pool')

  [pscustomobject]@{
    ConfigPath   = $path
    ConfigFound  = [bool]$raw
    Root         = $script:WhaleRoot
    # 新名字（多鱼）：这个进程服务的那条鱼。
    SelfHome     = $selfHome
    SelfDshHome  = & $pickSelf 'selfDshHome' 'herDshHome' (Join-Path $selfHome 'dsh-home')
    SelfWaker    = & $pickSelf 'selfWaker' 'herWaker' (Join-Path $script:WhaleRoot 'scripts\wake-fish.ps1')
    SelfPort     = [int](& $pickSelf 'selfPort' 'herPort' 3082)
    SelfProfile  = & $pickSelf 'selfProfile' 'whaleProfile' 'whale'
    SelfCwd      = & $pickSelf 'selfCwd' 'whaleCwd' $selfHome
    # 共享区（在鱼的家之外）。
    PondRoot     = $pondRoot
    PoolDir      = $poolDir
    PoolState    = & $pick 'poolStateDir' (Join-Path $poolDir 'state')
    GroupDir     = & $pick 'groupDir' (Join-Path $poolDir 'group')
    DmDir        = & $pick 'dmDir' (Join-Path $poolDir 'dm')
    MembersFile  = & $pick 'membersFile' (Join-Path $poolDir 'members.json')
    # 别的字段。
    PwshExe      = & $pick 'pwshExe' 'pwsh.exe'
    WakeMetrics  = & $pick 'wakeMetrics' (Join-Path $script:WhaleRoot 'logs\wake-metrics.log')
    WatchmanPid  = & $pick 'watchmanPidFile' (Join-Path $poolDir 'state\watchman.pid')
    LeeStartCwd  = & $pick 'leeStartCwd' (Join-Path $env:USERPROFILE 'Desktop')
    ChatCwd      = & $pick 'chatCwd' (Split-Path $script:WhaleRoot -Parent)
    LeeCwd       = & $pick 'leeCwd' $script:WhaleRoot
    LeeHome      = & $pick 'leeHome' (Join-Path $HOME '.dsh')
    LeeProfile   = & $pick 'leeProfile' 'web'
    LeePort      = [int](& $pick 'leePort' 3080)
    # 兼容别名：旧脚本还在用 Her* / Whale* 这些名字。
    HerHome      = $selfHome
    HerDshHome   = & $pickSelf 'selfDshHome' 'herDshHome' (Join-Path $selfHome 'dsh-home')
    HerWaker     = & $pickSelf 'selfWaker' 'herWaker' (Join-Path $script:WhaleRoot 'scripts\wake-fish.ps1')
    HerPort      = [int](& $pickSelf 'selfPort' 'herPort' 3082)
    WhaleProfile = & $pickSelf 'selfProfile' 'whaleProfile' 'whale'
    WhaleCwd     = & $pickSelf 'selfCwd' 'whaleCwd' $selfHome
  }
}

$Cfg = Get-WhaleConfig

# 窗口的开门/关门记账（小肥鱼 2026-11-12 的规格：关门和开门都记；busy 必须推导，不能人填）。
# 放在她的 logs\close.log：这是"事件"不是"状态"，logs\ 她读不写，正好。
# 判据来自她：只记关门，醒来就不知道睡了多久；人填的"在忙"明天会被当事实读。
function Get-PresenceSnapshot {
  $dir = Join-Path $Cfg.PoolState 'presence'
  $items = @()
  if (Test-Path -LiteralPath $dir) {
    foreach ($file in (Get-ChildItem -LiteralPath $dir -Filter *.json -ErrorAction SilentlyContinue)) {
      try {
        $j = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($j.member -and $j.status) { $items += ("{0}:{1}" -f $j.member, $j.status) }
      } catch { }
    }
  }
  if ($items.Count -eq 0) { return 'unknown' }
  return ($items -join ',')
}

function Write-WindowLog {
  param([string]$Event, [string]$By = 'fabian', [string]$Why = '')
  $dir = Join-Path $Cfg.HerHome 'logs'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $line = "{0} | event={1} | by={2} | busy={3} | why={4}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Event, $By, (Get-PresenceSnapshot), $Why
  Add-Content -LiteralPath (Join-Path $dir 'close.log') -Value $line -Encoding UTF8
}

# ---------- 沙箱通行证（capability SID）：算、查、补 ----------
# 为什么在这里：文件工具能写、pwsh 写不进 = 这只鱼的 workspace 子树缺通行证（CHANGELOG A.67）。
# 算法与 dsh 的 dsh-sandbox-windows-acl 一致：sha256(workspaceRoot) 前 8 字节按小端取两个 uint32，
# 各自 % (2^30-1) + 1，拼成 S-1-4-a-b。
function Get-WorkspaceSid([string]$Path) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Path))
  } finally {
    $sha.Dispose()
  }
  $a = ([BitConverter]::ToUInt32($hash, 0) % 1073741823) + 1
  $b = ([BitConverter]::ToUInt32($hash, 4) % 1073741823) + 1
  return ('S-1-4-{0}-{1}' -f $a, $b)
}

function Test-WorkspaceGrant([string]$Path, [string]$Sid) {
  try {
    $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
  } catch {
    return $false
  }
  foreach ($rule in $acl.Access) {
    if ($rule.AccessControlType -ne 'Allow') { continue }
    if ($rule.IdentityReference.Value -ne $Sid) { continue }
    if (($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::Write) -ne 0) { return $true }
  }
  return $false
}

# 返回缺通行证的对象路径（跳过 dsh-home 和 Junction —— 前者故意不给，后者不是她家的东西）
function Get-WorkspaceGrantGaps([object]$Member) {
  $gaps = [System.Collections.Generic.List[string]]::new()
  if (-not $Member -or -not $Member.Home) { return $gaps.ToArray() }
  $homeDir = [string]$Member.Home
  $sid = Get-WorkspaceSid $homeDir
  $stack = [System.Collections.Generic.Stack[string]]::new()
  $stack.Push($homeDir)
  while ($stack.Count -gt 0) {
    $dir = $stack.Pop()
    $children = @()
    try { $children = @(Get-ChildItem -LiteralPath $dir -Force -ErrorAction Stop) } catch { continue }
    foreach ($c in $children) {
      if (($c.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
      if ($c.PSIsContainer -and $dir -eq $homeDir -and $c.Name -eq 'dsh-home') { continue }
      if (-not (Test-WorkspaceGrant $c.FullName $sid)) { $gaps.Add($c.FullName) }
      if ($c.PSIsContainer) { $stack.Push($c.FullName) }
    }
  }
  return $gaps.ToArray()
}

function Repair-WorkspaceGrantGaps([object]$Member) {
  $gaps = Get-WorkspaceGrantGaps $Member
  if ($gaps.Count -eq 0) { return 0 }
  $sid = Get-WorkspaceSid ([string]$Member.Home)
  $sidObj = [System.Security.Principal.SecurityIdentifier]::new($sid)
  $fixed = 0
  foreach ($p in $gaps) {
    try {
      $acl = Get-Acl -LiteralPath $p -ErrorAction Stop
      $inherit = if (Test-Path -LiteralPath $p -PathType Container) { 'ContainerInherit, ObjectInherit' } else { 'None' }
      $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sidObj, 'Write, Delete', $inherit, 'None', 'Allow')
      $acl.AddAccessRule($rule)
      Set-Acl -LiteralPath $p -AclObject $acl -ErrorAction Stop
      $fixed++
    } catch {
      Write-Host ("   ! 补不上：{0}（{1}）" -f $p, $_.Exception.Message)
    }
  }
  return $fixed
}

# 凭证文件的指纹：sha256 前 12 位十六进制。只记指纹、不记值（CHANGELOG A.68）。
function Get-FileFingerprint([string]$Path) {
  if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { return '' }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $hash = $sha.ComputeHash($bytes)
  } finally {
    $sha.Dispose()
  }
  return ([BitConverter]::ToString($hash) -replace '-', '').Substring(0, 12).ToLowerInvariant()
}
