# stop-whale.ps1 -- 停掉小肥鱼的进程（她的窗口是隐藏的，只能用命令停）
#
# 只认「命令行里带 --profile whale 的 node.exe」。
# 不按进程名杀（taskkill /IM node.exe 会把大肥鱼也杀掉），
# 也不按文档/命令里出现过的字符串杀（会误伤正在跑别的事情的 pwsh）。
param([int]$Port = 3082, [switch]$ListOnly)

$ErrorActionPreference = 'Stop'

function Get-WhaleRoots {
  @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -like '*--profile whale*' })
}

$roots = Get-WhaleRoots
if ($roots.Count -eq 0) {
  Write-Host "没找到她的进程（没有 --profile whale 的 node）—— 她本来就是睡着的。"
  exit 0
}

$rootIds = $roots | ForEach-Object { $_.ProcessId }
$children = @(Get-CimInstance Win32_Process | Where-Object { $rootIds -contains $_.ParentProcessId })

Write-Host ("找到 {0} 个主进程：" -f $roots.Count)
foreach ($r in $roots) {
  $cl = $r.CommandLine.Substring(0, [Math]::Min(110, $r.CommandLine.Length))
  Write-Host ("  PID {0}  {1}" -f $r.ProcessId, $cl)
}
if ($children.Count -gt 0) {
  Write-Host ("附带的子进程 {0} 个（一起停）：{1}" -f $children.Count, (($children | ForEach-Object { $_.ProcessId }) -join ', '))
}

if ($ListOnly) { exit 0 }

foreach ($p in @($children) + @($roots)) {
  try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop }
  catch { }
}

Start-Sleep -Milliseconds 1500

$left = Get-WhaleRoots
if ($left.Count -gt 0) {
  Write-Host "还剩进程没停掉。用 netstat -ano | findstr :$Port 看看。"
  Start-Sleep -Seconds 5
  exit 1
}
Write-Host "停了。她要再醒，双击 启动小肥鱼.cmd。"
Start-Sleep -Seconds 2