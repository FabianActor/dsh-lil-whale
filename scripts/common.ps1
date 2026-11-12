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

  # 默认布局：仓库的上一级放她的家
  $herHome = Join-Path (Split-Path $script:WhaleRoot -Parent) 'lil-whale'

  # 配置里有的字段优先；没有的按默认推
  $pick = {
    param($name, $fallback)
    if ($raw -and $raw.PSObject.Properties.Name -contains $name -and $raw.$name) { $raw.$name } else { $fallback }
  }

  $herHome = & $pick 'herHome' $herHome

  [pscustomobject]@{
    ConfigPath  = $path
    ConfigFound = [bool]$raw
    Root        = $script:WhaleRoot
    HerHome     = $herHome
    HerDshHome  = & $pick 'herDshHome' (Join-Path $herHome 'dsh-home')
    PoolDir     = & $pick 'poolDir' (Join-Path (Split-Path $herHome -Parent) 'lil-whale-pool')
  PoolState   = & $pick 'poolStateDir' (Join-Path (& $pick 'poolDir' (Join-Path (Split-Path $herHome -Parent) 'lil-whale-pool')) 'state')
  GroupDir    = & $pick 'groupDir' (Join-Path (& $pick 'poolDir' (Join-Path (Split-Path $herHome -Parent) 'lil-whale-pool')) 'group')
DmDir       = & $pick 'dmDir' (Join-Path (& $pick 'poolDir' (Join-Path (Split-Path $herHome -Parent) 'lil-whale-pool')) 'dm')
    HerWaker    = & $pick 'herWaker' (Join-Path $script:WhaleRoot 'scripts\wake-whale.ps1')
    PwshExe     = & $pick 'pwshExe' 'pwsh.exe'
    WakeMetrics = & $pick 'wakeMetrics' (Join-Path $script:WhaleRoot 'logs\wake-metrics.log')
    WatchmanPid = & $pick 'watchmanPidFile' (Join-Path $herHome 'logs\watchman.pid')
    LeeStartCwd = & $pick 'leeStartCwd' (Join-Path $env:USERPROFILE 'Desktop')
    ChatCwd     = & $pick 'chatCwd' (Split-Path $script:WhaleRoot -Parent)
    LeeCwd      = & $pick 'leeCwd' $script:WhaleRoot
    WhaleCwd    = & $pick 'whaleCwd' $herHome
    LeeHome     = & $pick 'leeHome' (Join-Path $HOME '.dsh')
    LeeProfile  = & $pick 'leeProfile' 'web'
    WhaleProfile= & $pick 'whaleProfile' 'whale'
    HerPort     = & $pick 'herPort' 3082
    LeePort     = & $pick 'leePort' 3080
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
