#requires -Version 7.0
#Requires -Version 7
<#
  verify-pending.ps1 — 重启后验收：把"改了但没生效"的几项一次看完。

  2026-11-13 13:1x 建。起因：这一天的改动大半要重启才生效，
  散在待办第五节的几条里，每次重启都要人一条条去翻日志。

  只读，不改任何东西。退出码：全 PASS 或 INFO = 0；有 WARN = 0；有 FAIL = 1。
#>
[CmdletBinding()]
param([switch]$AsJson)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'common.ps1')

$rows = New-Object System.Collections.Generic.List[object]
function Add-Row([string]$name, [string]$state, [string]$detail) {
  $rows.Add([pscustomobject]@{ 检查 = $name; 结果 = $state; 说明 = $detail })
}

$membersFile = if ($Cfg.MembersFile) { $Cfg.MembersFile } else { Join-Path $Cfg.PoolDir 'members.json' }
$members = @{}
if (Test-Path -LiteralPath $membersFile) {
  $membersJson = Get-Content -LiteralPath $membersFile -Raw -Encoding utf8 | ConvertFrom-Json
  foreach ($p in $membersJson.members.PSObject.Properties) { $members[$p.Name] = $p.Value }
}
$fish = @($members.Keys | Where-Object { $members[$_].kind -eq 'fish' })

# 1) runs 账：started 行里的 member/home/port 是否按鱼自己写
$runsOk = $true; $runsDetail = @()
foreach ($k in $fish) {
  $f = Join-Path $Cfg.PoolState ("runs\{0}.log" -f $k)
  if (-not (Test-Path -LiteralPath $f)) { $runsOk = $false; $runsDetail += "$k:没有账"; continue }
  $line = Get-Content -LiteralPath $f -Encoding utf8 | Where-Object { $_ -match '\| started \|' } | Select-Object -Last 1
  if (-not $line) { $runsOk = $false; $runsDetail += "$k:没有 started"; continue }
  $okMember = $line -match ("member=" + [regex]::Escape($k) + "(\s|$)")
  $wantHome = [string]$members[$k].home
  $okHome = ($wantHome -eq '') -or ($line -match ("home=" + [regex]::Escape($wantHome) + "(\s|$)"))
  $wantPort = [string]$members[$k].port
  $okPort = ($wantPort -eq '') -or ($line -match ("port=" + [regex]::Escape($wantPort) + "(\s|$)"))
  if (-not ($okMember -and $okHome -and $okPort)) {
    $runsOk = $false
    $runsDetail += ("{0}:member={1} home={2} port={3}" -f $k, $okMember, $okHome, $okPort)
  } else {
    $runsDetail += ("{0}:OK" -f $k)
  }
}
Add-Row 'runs 账按鱼写' $(if ($runsOk) { 'PASS' } else { 'FAIL' }) ($runsDetail -join '；')

# 2) 自执行闹钟（B）：watchman.log 里 trigger=self 的行
$wm = Join-Path $Cfg.HerHome 'logs\watchman.log'
$selfRows = @()
if (Test-Path -LiteralPath $wm) { $selfRows = @(Get-Content -LiteralPath $wm -Encoding utf8 -Tail 400 | Where-Object { $_ -match 'trigger=self' }) }
Add-Row '自己的闹钟（B）' 'INFO' $(if ($selfRows.Count -gt 0) { "最近 400 行里有 $($selfRows.Count) 条 trigger=self：$($selfRows[-1])" } else { '还没有 trigger=self（下次闹钟到点前属正常）' })

# 3) gate 里的 hour 是真数（wakeCountsOf 读法修过）
$gateRows = @()
if (Test-Path -LiteralPath $wm) { $gateRows = @(Get-Content -LiteralPath $wm -Encoding utf8 -Tail 400 | Where-Object { $_ -match 'gate=pass\(hour=' }) }
if ($gateRows.Count -eq 0) {
  Add-Row 'gate 的 hour 读数' 'INFO' '最近 400 行没有 wake-try（没有鱼被叫醒过）'
} else {
  $last = $gateRows[-1]
  $hourVal = if ($last -match 'gate=pass\(hour=(\d+)/') { [int]$Matches[1] } else { -1 }
  Add-Row 'gate 的 hour 读数' $(if ($hourVal -ge 0) { 'PASS' } else { 'WARN' }) "最后一条：$last"
}

# 4) 计划逻辑（行为测试，不 grep 源码 —— 改名不误报，注释骗不过去）
$planTest = Join-Path $repo 'scripts\test-plan.mjs'
if (Test-Path -LiteralPath $planTest) {
  $planOut = & node $planTest 2>&1
  $planOk = ($LASTEXITCODE -eq 0)
  Add-Row '计划逻辑（行为测试）' $(if ($planOk) { 'PASS' } else { 'FAIL' }) (($planOut | Select-Object -Last 1))
} else {
  Add-Row '计划逻辑（行为测试）' 'FAIL' 'scripts\test-plan.mjs 不见了'
}

# 4b) 睡眠逻辑（行为测试，2026-11-14 加）：窗口/跨午夜/优先级算错一次，
# 表现就是"她半夜被叫醒"或"该醒的时候还在睡"—— 两种都很难从日志里看出来。
$sleepTest = Join-Path $repo 'scripts\test-sleep.mjs'
if (Test-Path -LiteralPath $sleepTest) {
  $sleepOut = & node $sleepTest 2>&1
  $sleepOk = ($LASTEXITCODE -eq 0)
  Add-Row '睡眠逻辑（行为测试）' $(if ($sleepOk) { 'PASS' } else { 'FAIL' }) (($sleepOut | Select-Object -Last 1))
} else {
  Add-Row '睡眠逻辑（行为测试）' 'FAIL' 'scripts\test-sleep.mjs 不见了'
}

# 4d) 改名逻辑（行为测试，2026-11-14 加）：名字只能由她自己改（A.82）。
# 冷却、重名、曾用名这三种算错一次，表现是"她改不了名"或"历史说不清"。
$renameTest = Join-Path $repo 'scripts\test-rename.mjs'
if (Test-Path -LiteralPath $renameTest) {
  $renameOut = & node $renameTest 2>&1
  $renameOk = ($LASTEXITCODE -eq 0)
  Add-Row '改名逻辑（行为测试）' $(if ($renameOk) { 'PASS' } else { 'FAIL' }) (($renameOut | Select-Object -Last 1))
} else {
  Add-Row '改名逻辑（行为测试）' 'FAIL' 'scripts\test-rename.mjs 不见了'
}

# 4e) 她自己写的条件（wake-on）行为测试，2026-11-14 加。
# 三种 kind、路径白名单、冷却、额度、伪装日程 —— 任何一条算错，
# 表现都是"永远不触发"或者"在盯着别人家"，两种都不会自己报警。
$intentTest = Join-Path $repo 'scripts\test-intent.mjs'
if (Test-Path -LiteralPath $intentTest) {
  $intentOut = & node $intentTest 2>&1
  $intentOk = ($LASTEXITCODE -eq 0)
  Add-Row '条件逻辑（行为测试）' $(if ($intentOk) { 'PASS' } else { 'FAIL' }) (($intentOut | Select-Object -Last 1))
} else {
  Add-Row '条件逻辑（行为测试）' 'FAIL' 'scripts\test-intent.mjs 不见了'
}
# 5) 自启动开关
$settings = Join-Path $Cfg.PoolState 'settings.json'
if (Test-Path -LiteralPath $settings) {
  $s = Get-Content -LiteralPath $settings -Raw -Encoding utf8 | ConvertFrom-Json
  Add-Row '自启动开关' 'PASS' ("autoStartFish=" + $s.autoStartFish)
} else {
  Add-Row '自启动开关' 'WARN' "没有 $settings（默认关）"
}

# 6) 鱼塘接口（在他那条鱼的端口上）
$leePort = 0
foreach ($k in $members.Keys) { if ($members[$k].role -eq 'watcher') { $leePort = [int]$members[$k].port } }
if ($leePort -gt 0) {
  try {
    $r = Invoke-WebRequest -Uri ("http://127.0.0.1:{0}/pond/api/status" -f $leePort) -TimeoutSec 4 -UseBasicParsing
    $st = $r.Content | ConvertFrom-Json
    $all = @($st.fish)
    $up = @($all | Where-Object { $_.portOpen })
    $modes = @($all | ForEach-Object { "{0}:{1}" -f $_.key, $_.mode.mode })
    Add-Row '鱼塘接口' 'PASS' ("鱼 " + $all.Count + " 条、在跑 " + $up.Count + "；模式 " + ($modes -join '，'))
  } catch {
    Add-Row '鱼塘接口' 'WARN' ("http://127.0.0.1:{0}/pond/api/status 不通（主 dsh 没开？）" -f $leePort)
  }
}

# 7) 每条鱼的模式账
$modeDetail = @()
foreach ($k in $fish) {
  $mf = Join-Path $Cfg.PoolState ("mode\{0}.json" -f $k)
  if (Test-Path -LiteralPath $mf) {
    $m = Get-Content -LiteralPath $mf -Raw -Encoding utf8 | ConvertFrom-Json
    $modeDetail += ("{0}:{1}" -f $k, $m.mode)
  } else {
    $modeDetail += ("{0}:没有账" -f $k)
  }
}
Add-Row '模式账' 'INFO' ($modeDetail -join '；')

if ($AsJson) {
  $rows | ConvertTo-Json -Depth 4
} else {
  $rows | Format-Table -AutoSize | Out-String -Width 400 | Write-Output
  $fails = @($rows | Where-Object { $_.结果 -eq 'FAIL' }).Count
  Write-Output ("合计：{0} 项，FAIL {1}" -f $rows.Count, $fails)
}
if (@($rows | Where-Object { $_.结果 -eq 'FAIL' }).Count -gt 0) { exit 1 }
exit 0
