# start-whale.ps1 -- 给小肥鱼开机，专供巡守脚本调用（它不是给人双击的）。
#
# 契约（watchman.ps1 靠这几个词判断成败）：
#   已经在跑  -> 输出 already-awake
#   开起来了  -> 输出 awake
#   没起来    -> 输出 failed（并带着日志尾巴）
#
# 人用的入口是 启动小肥鱼.cmd / 启动小肥鱼-检修.cmd，它们调 launch.ps1。
param([int]$Port = 3082)

$ErrorActionPreference = 'Stop'
$launch = Join-Path $PSScriptRoot 'launch.ps1'

function Test-Port([int]$p) {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', $p); return $true } catch { return $false } finally { $c.Dispose() }
}

if (Test-Port $Port) {
  Write-Output "already-awake http://127.0.0.1:$Port"
  exit 0
}

try {
  & $launch -Target whale -Port $Port -NoBrowser | Out-Null
  $code = $LASTEXITCODE
} catch {
  Write-Output ("failed " + $_.Exception.Message)
  exit 1
}

if ($code -eq 0 -and (Test-Port $Port)) {
  Write-Output "awake http://127.0.0.1:$Port"
  exit 0
}
Write-Output 'failed'
exit 1
