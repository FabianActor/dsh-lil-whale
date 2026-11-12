# stop.ps1 -- 停鱼。ASCII 文件名 + UTF-8 BOM。
#
#   pwsh -File stop.ps1 -Target lee     停大肥鱼（3080，会中断他正在看的那一轮）
#   pwsh -File stop.ps1 -Target whale   停小肥鱼（3082）
#   pwsh -File stop.ps1 -Target all     两条都停，顺带停脚本版守夜
#
# 只认命令行里的特征，不按进程名杀：taskkill /IM node.exe 会把别人的 node 一起带走。
#   大肥鱼 = node 跑 @deepseek-ai/dsh 的 bin.js，且是 `web` 那个应用（命令行里没有 --profile）
#   小肥鱼 = node 跑同一个 bin.js，但带 `--profile whale`
#
# 退出码：0 = 都停了（本来就没在跑也算 0）；1 = 还有没停掉的。
param(
  [ValidateSet('all', 'lee', 'whale')][string]$Target = 'all',
  [switch]$Yes,
  [string]$By = 'fabian',
  [string]$Why = ''
)

$ErrorActionPreference = 'Continue'

. (Join-Path $PSScriptRoot 'common.ps1')
$LeePort = $Cfg.LeePort
$HerPort = $Cfg.HerPort

function Test-Port([int]$p) {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', $p); return $true } catch { return $false } finally { $c.Dispose() }
}

# 只认「node.exe 的第一个参数就是 dsh 的 bin.js」的进程。
#
# 为什么不能只搜 "命令行里有 bin.js 和 --profile whale"：
# 排障时敲的那条命令、或者一个正在读这段文字的 pwsh，命令行里也会出现这些字，
# 于是它会被当成"鱼"杀掉。这不是假设 —— 第一版就匹配到了我自己的 shell。
function Get-Roots([string]$kind) {
  @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $cl = $_.CommandLine
      if (-not $cl) { return $false }
      $head = [regex]::Match($cl, '^\s*(?:"[^"]+"|\S+)\s+(?:"([^"]+)"|(\S+))')
      if (-not $head.Success) { return $false }
      $script = if ($head.Groups[1].Success) { $head.Groups[1].Value } else { $head.Groups[2].Value }
      if ($script -notmatch 'bin\.js$') { return $false }
      # 参数只取 bin.js 之后的部分，避免把"后面某段说明文字"也算进判据
      $rest = $cl.Substring($head.Index + $head.Length)
      $isWhale = $rest -match '--profile\s+whale'
      if ($kind -eq 'whale') { return $isWhale }
      # 大肥鱼：同一个 bin.js，但不是 --profile whale 那条
      return (-not $isWhale)
    })
}

function Get-Children($rootIds) {
  @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $rootIds -contains $_.ParentProcessId })
}

function Stop-Kind([string]$kind, [string]$label, [int]$port) {
  $roots = Get-Roots $kind
  if ($roots.Count -eq 0) {
    Write-Host ("{0}：没在跑。" -f $label)
    return $true
  }
  $ids = $roots | ForEach-Object { $_.ProcessId }
  Write-Host ("{0}：找到 {1} 个主进程 —— {2}" -f $label, $roots.Count, ($ids -join ', '))
  $children = Get-Children $ids
  if ($children.Count -gt 0) {
    Write-Host ("  连带子进程 {0} 个：{1}" -f $children.Count, (($children | ForEach-Object { $_.ProcessId }) -join ', '))
  }
  # 先子后主：反过来的话父进程一死，孤儿子进程就找不到归属了
  foreach ($p in @($children) + @($roots)) {
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch { }
  }
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 300
    if (-not (Test-Port $port)) { break }
  }
  if (Test-Port $port) {
    Write-Host ("{0}：端口 {1} 还开着 —— 没停干净。" -f $label, $port)
    return $false
  }
  Write-Host ("{0}：停了（{1} 已关闭）。" -f $label, $port)
  return $true
}

function Stop-Watchman {
  $pidFile = $Cfg.WatchmanPid
  if (-not (Test-Path -LiteralPath $pidFile)) { Write-Host '守夜：没在跑。'; return $true }
  $raw = (Get-Content -LiteralPath $pidFile -Raw -ErrorAction SilentlyContinue)
  if (-not $raw -or $raw.Trim() -notmatch '^\d+$') { Write-Host '守夜：pid 文件坏了，跳过。'; return $true }
  $wid = [int]$raw.Trim()
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$wid" -ErrorAction SilentlyContinue
  if (-not $proc) { Write-Host ("守夜：pid {0} 已经不在（留下了一个旧 pid 文件，删了）。" -f $wid); Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue; return $true }
  if ($proc.CommandLine -notlike '*watchman.ps1*') { Write-Host ("守夜：pid {0} 现在不是守夜了（PID 被复用），不动它。" -f $wid); return $true }
  try { Stop-Process -Id $wid -Force -ErrorAction Stop; Write-Host ("守夜：停了（PID {0}）。" -f $wid) }
  catch { Write-Host ("守夜：停不掉 —— {0}" -f $_.Exception.Message); return $false }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  return $true
}

# 停大肥鱼 = 停掉正在跑这一轮的那个进程。先说清楚，除非已经 -Yes。
if (($Target -eq 'lee' -or $Target -eq 'all') -and -not $Yes) {
  Write-Host '注意：大肥鱼就是你现在用的这个 3080。停掉会中断正在跑的一轮对话和排队的任务。'
  $answer = Read-Host '确定要停？（输入 Y 确认，直接回车取消）'
  if ($answer -ne 'Y' -and $answer -ne 'y') {
    Write-Host '没停。'
    exit 0
  }
}

$ok = $true
switch ($Target) {
  'lee'   { $ok = Stop-Kind 'lee' '大肥鱼' $LeePort }
  'whale' {
    $ok = Stop-Kind 'whale' '小肥鱼' $HerPort
    if ($ok) { Write-WindowLog -Event 'close' -By $By -Why $Why }
  }
  'all' {
    $a = Stop-Kind 'whale' '小肥鱼' $HerPort
    if ($a) { Write-WindowLog -Event 'close' -By $By -Why $Why }
    $b = Stop-Kind 'lee' '大肥鱼' $LeePort
    $c = Stop-Watchman
    $ok = ($a -and $b -and $c)
  }
}

if ($ok) { Write-Host ''; Write-Host '好了。'; exit 0 }
Write-Host ''
Write-Host '有没停干净的 —— 用 netstat -ano | findstr :3080 / :3082 看还占着的是谁。'
exit 1
