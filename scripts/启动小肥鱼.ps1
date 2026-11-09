# 启动小肥鱼：双击这个 .cmd / .ps1 就行（也可以建个桌面快捷方式）
#
# 做的事只有三件：
#   1. 设她自己的 DSH_HOME  2. 在 3082 起她的窗  3. 等它起来，打开浏览器
# 已经开着就不再起第二个（免得两个进程抢同一段会话）。

$ErrorActionPreference = 'Stop'

$home_ = 'D:\文档\WorkSpace\lil-whale\dsh-home'
$cwd   = 'D:\文档\WorkSpace\lil-whale'
$port  = 3082
$url   = "http://127.0.0.1:$port"

# 不能用 Get-NetTCPConnection：在本机 sandbox 里它拿不到结果，会误判成"没在听"。
function Test-Port([int]$p) {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', $p); return $true } catch { return $false } finally { $c.Dispose() }
}

if (Test-Port $port) {
  Write-Host "她已经醒着（$url），直接开窗。"
  Start-Process $url
  exit 0
}

# 留一个控制台窗口：里面会打出带 token 的那行 URL，万一浏览器打不开就照抄
$command = "`$env:DSH_HOME='$home_'; dsh --profile whale --port $port"
Start-Process -FilePath 'pwsh' -ArgumentList '-NoExit', '-Command', $command -WorkingDirectory $cwd

Write-Host "正在开机……"
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  if (Test-Port $port) { break }
}

if (Test-Port $port) {
  Write-Host "起来了：$url"
  Start-Process $url
} else {
  Write-Host "没起来。看那个控制台窗口里报了什么。"
}

