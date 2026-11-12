# launch.ps1 -- 兼容入口：开鱼。ASCII 文件名 + UTF-8 BOM。
#
# 真正的实现在 fish.ps1（名册驱动，鱼多了不用改这里）。这个文件只剩"翻译参数"：
#
#   pwsh -File launch.ps1 -Target all             两条鱼，成功即返回（窗口关掉）
#   pwsh -File launch.ps1 -Target lee             只开大肥鱼（3080）
#   pwsh -File launch.ps1 -Target whale           只开小肥鱼（3082）
#   -NoBrowser                                    不自动开浏览器（守夜脚本用）
#   -Port <n>                                     覆盖被点名那条鱼的端口
#   -WithWatchman                                 另外起一个守夜脚本（只在主 dsh 不常开时用）
#
# 退出码：0 = 都在跑（本来就在跑也算）；1 = 没起来。
param(
  [string]$Target = 'all',  # 任意成员键；由 fish.ps1 校验（以前 ValidateSet 写死 all/lee/whale，新鱼选不到）
  [switch]$NoBrowser,
  [switch]$WithWatchman,
  [int]$Port = 0,
  [string]$By = 'fabian',
  [string]$Why = ''
)

$ErrorActionPreference = 'Stop'

if ($env:DSH_LAUNCH_NO_BROWSER -eq '1') { $NoBrowser = $true }

$fish = Join-Path $PSScriptRoot 'fish.ps1'
if (-not (Test-Path -LiteralPath $fish)) {
  Write-Host 'NEXT: scripts\fish.ps1 不见了 —— 用 git 恢复它（它是现在唯一的启动器实现）。'
  exit 1
}

$fargs = @('up', $Target)
if ($NoBrowser) { $fargs += '-NoBrowser' }
if ($Port -gt 0) { $fargs += @('-Port', [string]$Port) }
if ($By) { $fargs += @('-By', $By) }
if ($Why) { $fargs += @('-Why', $Why) }

& pwsh -NoLogo -NoProfile -File $fish @fargs
$rc = $LASTEXITCODE

if ($WithWatchman) {
  $wm = Join-Path $PSScriptRoot 'watchman.ps1'
  $pidFile = Join-Path $PSScriptRoot '..\logs\watchman.pid'
  if ((Test-Path -LiteralPath $wm) -and -not (Test-Path -LiteralPath $pidFile)) {
    Write-Host '另外起一个守夜脚本……'
    Start-Process -FilePath 'pwsh' -ArgumentList '-NoLogo', '-NoProfile', '-File', $wm -WindowStyle Hidden | Out-Null
  }
}

exit $rc
