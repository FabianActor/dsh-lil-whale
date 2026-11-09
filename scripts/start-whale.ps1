# start-whale.ps1 -- 启动小肥鱼（ASCII 文件名，避免 cmd 里编码出错）
# 用 UTF-8 BOM 存盘，这样 Windows PowerShell 5.1 双击/右键运行时也不会读成乱码。
$ErrorActionPreference = 'Stop'

$home_ = 'D:\文档\WorkSpace\lil-whale\dsh-home'
$cwd   = 'D:\文档\WorkSpace\lil-whale'
$port  = 3082
$url   = "http://127.0.0.1:$port"

function Test-Port([int]$p) {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', $p); return $true } catch { return $false } finally { $c.Dispose() }
}

if (Test-Port $port) {
  Write-Host "她已经在跑了，直接开窗。"
  Start-Process $url
  exit 0
}

$logdir = Join-Path $home_ 'logs'
New-Item -ItemType Directory -Force -Path $logdir | Out-Null
$command = "`$env:DSH_HOME='$home_'; dsh --profile whale --port $port --no-open"
Start-Process -FilePath 'pwsh' -ArgumentList '-NoLogo','-NoProfile','-Command',$command `
  -WorkingDirectory $cwd -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logdir 'web-latest.log') `
  -RedirectStandardError  (Join-Path $logdir 'web-latest.err.log') | Out-Null

Write-Host "正在开机……"
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 500
  if (Test-Port $port) { break }
}

if (Test-Port $port) {
  Write-Host "起来了：$url"
  Start-Process $url
} else {
  Write-Host "没起来。看日志：$logdir\web-latest.err.log"
  Start-Sleep -Seconds 8
}