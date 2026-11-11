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
    GroupDir    = & $pick 'groupDir' (Join-Path $herHome 'group')
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
  }
}

$Cfg = Get-WhaleConfig
