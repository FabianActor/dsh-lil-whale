# stop.ps1 -- 兼容入口：停鱼。ASCII 文件名 + UTF-8 BOM。
#
# 真正的实现在 fish.ps1（名册驱动）。这个文件只剩"翻译参数"：
#
#   pwsh -File stop.ps1 -Target lee     停大肥鱼（3080，会中断他正在看的那一轮，会先问）
#   pwsh -File stop.ps1 -Target whale   停小肥鱼（3082）
#   pwsh -File stop.ps1 -Target all     两条都停，顺带停脚本版守夜
#
# 退出码：0 = 都停了（本来就没在跑也算 0）；1 = 还有没停掉的。
param(
  [ValidateSet('all', 'lee', 'whale')][string]$Target = 'all',
  [switch]$Yes,
  [string]$By = 'fabian',
  [string]$Why = ''
)

$ErrorActionPreference = 'Continue'

$fish = Join-Path $PSScriptRoot 'fish.ps1'
if (-not (Test-Path -LiteralPath $fish)) {
  Write-Host 'NEXT: scripts\fish.ps1 不见了 —— 用 git 恢复它（它是现在唯一的停鱼实现）。'
  exit 1
}

$fargs = @('down', $Target)
if ($Yes) { $fargs += '-Yes' }
if ($By) { $fargs += @('-By', $By) }
if ($Why) { $fargs += @('-Why', $Why) }

& pwsh -NoLogo -NoProfile -File $fish @fargs
$rc = $LASTEXITCODE

# 脚本版守夜（只有 -WithWatchman 起过才会有 pid 文件）。它不在名册里，单独收。
if ($Target -eq 'all') {
  $pidFile = Join-Path $PSScriptRoot '..\logs\watchman.pid'
  if (Test-Path -LiteralPath $pidFile) {
    try {
      $wpid = [int]((Get-Content -LiteralPath $pidFile -Raw).Trim())
      $p = Get-Process -Id $wpid -ErrorAction Stop
      if ($p.ProcessName -eq 'pwsh') {
        Stop-Process -Id $wpid -Force -ErrorAction Stop
        Write-Host ("脚本版守夜也停了（pid {0}）。" -f $wpid)
      }
      Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    } catch {
      Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    }
  }
}

exit $rc
