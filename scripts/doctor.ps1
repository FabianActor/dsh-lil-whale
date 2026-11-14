#requires -Version 7.0
# doctor.ps1 -- 一条鱼还活着吗？
#
# 用法：
#   pwsh -File scripts\doctor.ps1                只看她
#   pwsh -File scripts\doctor.ps1 -IncludeLee    连他的窗一起看
#
# 为什么要有这个脚本：装完先验那四件（README / docs\出生流程.md）是手工敲的，
# 而"巡守死了没人告诉你""工具没注册但进程活着"这两类失败**长得跟正常一样**——
# 只能靠一条一条去问，还得每次都问同样的话。
#
# 规矩：
#   - 每条检查都给**证据**（文件里的那一行、端口通不通、心跳多久没动），不给"正常/异常"四个字。
#   - FAIL 才算坏；WARN 是"能跑但不对劲"。
#   - 不改任何东西，只读。要修，看它打印的 NEXT: 行。
#
# 退出码：全过 0；有 FAIL 1。

param(
  [switch]$IncludeLee
)

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'common.ps1')

$rows = @()
$fails = 0
$warns = 0

function Add-Row([string]$name, [string]$state, [string]$evidence, [string]$next = '') {
  $script:rows += [pscustomobject]@{ Check = $name; State = $state; Evidence = $evidence }
  if ($state -eq 'FAIL') { $script:fails++; if ($next) { $script:nexts += $next } }
  elseif ($state -eq 'WARN') { $script:warns++ }
}
$script:nexts = @()

function Test-Port([int]$p) {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', $p); return $true } catch { return $false } finally { $c.Dispose() }
}

function Age-OfFile([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  return ((Get-Date) - (Get-Item -LiteralPath $path).LastWriteTime)
}

function Format-Age($span) {
  if ($null -eq $span) { return '不存在' }
  if ($span.TotalMinutes -lt 1) { return ('{0:N0} 秒前' -f $span.TotalSeconds) }
  if ($span.TotalHours -lt 1) { return ('{0:N0} 分钟前' -f $span.TotalMinutes) }
  return ('{0:N1} 小时前' -f $span.TotalHours)
}

function Tail-Line([string]$path, [int]$n = 1) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  $tail = Get-Content -LiteralPath $path -Tail $n -ErrorAction SilentlyContinue
  if (-not $tail) { return $null }
  return ($tail | Select-Object -Last 1)
}

# 0. 配置：读不到也能按标准布局猜，但那说明"打包出去"这件事没做成
if ($Cfg.ConfigFound) {
  Add-Row '配置' 'OK' $Cfg.ConfigPath
} else {
  Add-Row '配置' 'WARN' '没读到 lil-whale.config.json，按标准布局猜的' 'NEXT: 检查仓库根目录的 lil-whale.config.json（或用 LIL_WHALE_CONFIG 指到别处）'
}

# 1. 主 dsh（巡守）的端口。每条鱼各自的端口在「全鱼」那一组里看 ——
# 2026-11-13 19:xx 修：这里原来只看 $Cfg.HerPort（第一条鱼），多鱼之后等于没看主 dsh。
$watcherPort = 3080
if ($Cfg.PSObject.Properties['LeePort'] -and $Cfg.LeePort) { $watcherPort = [int]$Cfg.LeePort }
if ($Cfg.MembersFile -and (Test-Path -LiteralPath $Cfg.MembersFile)) {
  try {
    $mjW0 = Get-Content -LiteralPath $Cfg.MembersFile -Raw -Encoding utf8 | ConvertFrom-Json
    $w0 = @($mjW0.members | Where-Object { $_.role -eq 'watcher' }) | Select-Object -First 1
    if ($w0 -and $w0.port) { $watcherPort = [int]$w0.port }
  } catch { }
}
if (Test-Port $watcherPort) {
  Add-Row '主 dsh 端口' 'OK' ("127.0.0.1:{0} 通" -f $watcherPort)
} else {
  Add-Row '主 dsh 端口' 'FAIL' ("127.0.0.1:{0} 不通" -f $watcherPort) 'NEXT: 起鱼塘：pwsh -File scripts\fish.ps1 up all -BrowserMainOnly'
}

if ($IncludeLee) {
  if (Test-Port $Cfg.LeePort) { Add-Row '他的端口' 'OK' ("127.0.0.1:{0} 通" -f $Cfg.LeePort) }
  else { Add-Row '他的端口' 'FAIL' ("127.0.0.1:{0} 不通" -f $Cfg.LeePort) 'NEXT: 起他自己的窗（dsh web）' }
}

# 2. 心跳：进程活着 ≠ 她会醒（11-09 踩过：进程起来但会话没被打开）
$presenceFile = Join-Path $Cfg.PoolState 'presence\whale.json'
if (Test-Path -LiteralPath $presenceFile) {
  try {
    $p = Get-Content -LiteralPath $presenceFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $at = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$p.at)
    $age = (Get-Date) - $at.LocalDateTime
    $state = if ($age.TotalHours -gt 24) { 'WARN' } else { 'OK' }
    Add-Row '她的心跳' $state ("status={0}，最后心跳 {1}" -f $p.status, (Format-Age $age))
    if ($state -eq 'WARN') { Add-Row '她的心跳（说明）' 'WARN' '心跳超过 24 小时没动：可能只是没人叫她（她不是常驻的），也可能是会话没被打开' }
  } catch {
    Add-Row '她的心跳' 'FAIL' ("pool\state\presence\whale.json 读不了：{0}" -f $_.Exception.Message) 'NEXT: 看 state\presence\ 下的文件是不是坏 JSON'
  }
} else {
  Add-Row '她的心跳' 'FAIL' 'pool\state\presence\whale.json 不存在' 'NEXT: 她的会话从没被打开过——开窗后要在网页里进那段会话'
}

# 3. 工具注册：哑 8 小时那次的判据（有 host-resolve 却没有 group_say-registered）
$pluginLog = Join-Path $Cfg.GroupDir 'plugin.log'
$lastBoot = Tail-Line (Join-Path $Cfg.Root 'logs\plugin-boot.log')
if (Test-Path -LiteralPath $pluginLog) {
  $hit = Select-String -LiteralPath $pluginLog -Pattern 'group_say-registered' -SimpleMatch | Select-Object -Last 1
  if ($hit) {
    Add-Row '工具注册' 'OK' ('plugin.log 里有：' + $hit.Line.Trim())
  } else {
    Add-Row '工具注册' 'FAIL' 'plugin.log 里没有 group_say-registered' 'NEXT: 重启她的窗；若还不行，看 plugin.log 有没有 host-resolve（有 host-resolve 没注册 = 又回到异步注册那个坑）'
  }
} else {
  Add-Row '工具注册' 'WARN' 'group\plugin.log 不存在（可能还没发过言）'
}

  # 3b. 睡眠工具：裸 spec 少了 output.render 时会整组注册失败（2026-11-14 10:59 踩过：
  #     "tool \"sleep\" must declare output { schema, render, presentationMeta? }"，
  #     结果她的 sleep/wake_up 两个工具静悄悄地没有，只有 group_say 活着）。
  $sleepOk = Select-String -LiteralPath $pluginLog -Pattern 'sleep-tools-registered' -SimpleMatch | Select-Object -Last 1
  $sleepBad = Select-String -LiteralPath $pluginLog -Pattern 'sleep-tools-register-failed' -SimpleMatch | Select-Object -Last 1
  if ($sleepBad -and (-not $sleepOk -or $sleepBad.LineNumber -gt $sleepOk.LineNumber)) {
    Add-Row '睡眠工具' 'FAIL' ('plugin.log 里最近一次是注册失败：' + $sleepBad.Line.Trim()) 'NEXT: 看 index.js 里 sleep/wake_up 的 output 有没有 render；改完重启'
  } elseif ($sleepOk) {
    Add-Row '睡眠工具' 'OK' ('plugin.log 里有：' + $sleepOk.Line.Trim())
  } else {
    Add-Row '睡眠工具' 'WARN' 'plugin.log 里还没有 sleep-tools-registered（旧代码或还没重启）'
  }

  # 3c. 她自己的条件（wake-on）：形状坏了就永远不会触发；"没触发"和"没写"在纸上一样。
  if ($Cfg.MembersFile -and (Test-Path -LiteralPath $Cfg.MembersFile)) {
    try {
      $mjOn = Get-Content -LiteralPath $Cfg.MembersFile -Raw -Encoding utf8 | ConvertFrom-Json
      foreach ($p in $mjOn.members.PSObject.Properties) {
        if ($p.Value.role -eq 'watcher' -or $p.Value.kind -ne 'fish') { continue }
        if (-not $p.Value.home) { continue }
        $wakeOn = Join-Path $p.Value.home 'plan\wake-on.json'
        if (-not (Test-Path -LiteralPath $wakeOn)) { continue }
        $onLabel = $p.Value.name
        try {
          $raw = Get-Content -LiteralPath $wakeOn -Raw -Encoding utf8 | ConvertFrom-Json
          $list = if ($raw -is [array]) { @($raw) } elseif ($null -ne $raw.items) { @($raw.items) } else { $null }
          if ($null -eq $list) {
            Add-Row ('条件（' + $onLabel + '）') 'FAIL' 'wake-on.json 形状不对（要数组或 {items:[...]}）' 'NEXT: 让她改写成数组'
          } else {
            $bad = @($list | Where-Object { -not $_.why -or -not $_.kind })
            if ($bad.Count -gt 0) { Add-Row ('条件（' + $onLabel + '）') 'WARN' ('有 ' + $bad.Count + ' 条缺 why/kind，不会触发') }
            else { Add-Row ('条件（' + $onLabel + '）') 'OK' ($list.Count.ToString() + ' 条，形状正常') }
          }
        } catch {
          Add-Row ('条件（' + $onLabel + '）') 'FAIL' ('wake-on.json 读不了：' + $_.Exception.Message)
        }
      }
    } catch {
      # 名册读不了由别处报，这里不重复
    }
  }
  # 3d. 名册 vs 家 vs pins：谁会被巡守遍历到，谁只是"家还在"（2026-11-14，小肥鱼的刺）
  try {
    $rosterFish = @()
    if ($Cfg.MembersFile -and (Test-Path -LiteralPath $Cfg.MembersFile)) {
      $mjR = Get-Content -LiteralPath $Cfg.MembersFile -Raw -Encoding utf8 | ConvertFrom-Json
      $rosterFish = @($mjR.members.PSObject.Properties | Where-Object { $_.Value.kind -eq 'fish' } | ForEach-Object { $_.Name })
    }
    $homesDir3 = Join-Path $Cfg.PoolDir '..\homes'
    $homeKeys = @()
    if (Test-Path -LiteralPath $homesDir3) {
      $homeKeys = @(Get-ChildItem -LiteralPath $homesDir3 -Directory | ForEach-Object { $_.Name })
    }
    $pinsFile3 = Join-Path $Cfg.GroupDir 'pins.json'
    $pinKeys = @()
    if (Test-Path -LiteralPath $pinsFile3) {
      $pinKeys = @((Get-Content -LiteralPath $pinsFile3 -Raw -Encoding utf8 | ConvertFrom-Json).PSObject.Properties.Name)
    }
    $rosterHomed = @($mjR.members.PSObject.Properties | Where-Object { $_.Value.kind -eq 'fish' -and $_.Value.role -ne 'watcher' } | ForEach-Object { $_.Name })
    $homeWithoutRoster = @($homeKeys | Where-Object { $rosterFish -notcontains $_ })
    $rosterWithoutHome = @($rosterHomed | Where-Object { $homeKeys -notcontains $_ })
    $pinWithoutRoster = @($pinKeys | Where-Object { $rosterFish -notcontains $_ })
    if ($homeWithoutRoster.Count -gt 0) {
      Add-Row '名册与家' 'FAIL' ('家里有但名册没有：' + ($homeWithoutRoster -join '、') + ' —— 这条鱼不会被巡守遍历到，也不会收到条件提醒') 'NEXT: 要么加回名册（members-add.mjs），要么归档（archive-fish.mjs）'
    } elseif ($rosterWithoutHome.Count -gt 0) {
      Add-Row '名册与家' 'FAIL' ('名册有但家里没有：' + ($rosterWithoutHome -join '、')) 'NEXT: 名册那条是坏的；修名册或恢复家'
    } elseif ($pinWithoutRoster.Count -gt 0) {
      Add-Row '名册与家' 'WARN' ('pins.json 里有名册外的键：' + ($pinWithoutRoster -join '、')) 'NEXT: 旧会话残留；确认后从 pins 里删'
    } else {
      Add-Row '名册与家' 'OK' ('名册 ' + $rosterFish.Count + ' 条、家 ' + $homeKeys.Count + ' 个、pins ' + $pinKeys.Count + ' 个，对得上')
    }
  } catch {
    Add-Row '名册与家' 'WARN' ('自检跑不了：' + $_.Exception.Message)
  }

  # 3e. 名册自检的账：文件不存在 = 还没跑过，不是"跑了没问题"（2026-11-14，小肥鱼）
  $auditLog = Join-Path $Cfg.PoolState 'roster-audit.log'
  if (Test-Path -LiteralPath $auditLog) {
    $lastAudit = (Get-Content -LiteralPath $auditLog -Tail 1 -Encoding utf8)
    if ($lastAudit -match 'roster-mismatch') {
      Add-Row '名册自检' 'FAIL' ('最近一次对不上：' + $lastAudit.Trim()) 'NEXT: 看 pool\state\roster-audit.log'
    } else {
      Add-Row '名册自检' 'OK' ('最近一次：' + $lastAudit.Trim())
    }
  } else {
    Add-Row '名册自检' 'WARN' 'roster-audit.log 不存在——只说明还没跑过（1.5.x 未进进程？），不说明没问题' 'NEXT: 重启 3080 后等第一拍'
  }

# 4. 名册：群认会话不认名字；登记错了 = 叫错人
$pinsFile = Join-Path $Cfg.GroupDir 'pins.json'
if (Test-Path -LiteralPath $pinsFile) {
  try {
    $pins = Get-Content -LiteralPath $pinsFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $whaleIds = @($pins.whale)
    if ($whaleIds.Count -eq 0) {
      Add-Row '名册' 'FAIL' 'pins.json 里 whale 是空的' 'NEXT: 开她的窗 → 侧边栏复制 Session ID → node scripts\pins.mjs --member whale --id <id>'
    } else {
      $sessionsDir = Join-Path $Cfg.HerDshHome 'sessions'
      $missing = @()
      foreach ($id in $whaleIds) {
        $found = Get-ChildItem -LiteralPath $sessionsDir -Directory -ErrorAction SilentlyContinue |
          ForEach-Object { Join-Path $_.FullName $id } |
          Where-Object { Test-Path -LiteralPath $_ }
        if (-not $found) { $missing += $id }
      }
      if ($missing.Count -eq 0) {
        Add-Row '名册' 'OK' ("whale = " + ($whaleIds -join ', ') + "（会话目录都在）")
      } else {
        Add-Row '名册' 'FAIL' ("whale 里有会话找不到：" + ($missing -join ', ')) 'NEXT: 那段会话可能已被删/换段——用 node scripts\pins.mjs --member whale --id <新id> 换掉'
      }
      if ($whaleIds.Count -gt 1) {
        Add-Row '名册（说明）' 'WARN' '同一时刻只该有一段会话在群里：两条 id = 可能两段都算她' 'NEXT: 搬段完成后只留一条'
      }
    }
  } catch {
    Add-Row '名册' 'FAIL' ("pins.json 读不了：{0}" -f $_.Exception.Message) 'NEXT: 它必须是合法 JSON；别手改到一半'
  }
} else {
  Add-Row '名册' 'FAIL' 'group\pins.json 不存在' 'NEXT: 群不认人：她说的每句话都会被守门拒掉'
}

# 4c. 名册（全鱼）：members.json 里每条鱼都该在 pins.json 里有会话
#     只查 whale 不够 —— 装第二条鱼时 install.ps1 曾把 pins 整份抹成空数组，
#     两个老成员同时"不在群里"；只查一条的检查也会红，但看不出是"谁少了"。
try {
  $membersFile = $Cfg.MembersFile
  if ($membersFile -and (Test-Path -LiteralPath $membersFile)) {
    $mj = Get-Content -LiteralPath $membersFile -Raw -Encoding utf8 | ConvertFrom-Json
    $pinsObj = Get-Content -LiteralPath (Join-Path $Cfg.GroupDir 'pins.json') -Raw -Encoding utf8 | ConvertFrom-Json
    $fishKeys = @($mj.members.PSObject.Properties | Where-Object { $_.Value.kind -eq 'fish' } | ForEach-Object { $_.Name })
    $missing = @()
    foreach ($k in $fishKeys) {
      $ids = @()
      if ($pinsObj.PSObject.Properties.Name -contains $k) { $ids = @($pinsObj.$k) }
      if ($ids.Count -eq 0) { $missing += $k }
    }
    if ($missing.Count) {
      Add-Row '名册（全鱼）' 'FAIL' ('这些鱼在 pins.json 里没有会话：' + ($missing -join '、')) ('NEXT: node scripts\pins.mjs --member <键> --id <会话id>（鱼有 ' + ($fishKeys -join '/') + '）')
    } else {
      Add-Row '名册（全鱼）' 'OK' ('每条鱼都有会话：' + ($fishKeys -join '、'))
    }
  }
} catch {
  Add-Row '名册（全鱼）' 'WARN' ("读不了名册或 pins：{0}" -f $_.Exception.Message) 'NEXT: 看 pool\members.json 与 pool\group\pins.json 是不是合法 JSON'
}
# 4c2. 端口登记：名册里的 port 必须唯一（2026-11-13 他要的）
try {
  if ($Cfg.MembersFile -and (Test-Path -LiteralPath $Cfg.MembersFile)) {
    $mjPort = Get-Content -LiteralPath $Cfg.MembersFile -Raw -Encoding utf8 | ConvertFrom-Json
    $byPort = @{}
    $dup = @()
    foreach ($p in $mjPort.members.PSObject.Properties) {
      if ($p.Value.kind -ne 'fish' -or -not $p.Value.port) { continue }
      $portKey = [int]$p.Value.port
      if ($byPort.ContainsKey($portKey)) { $dup += ("$portKey（" + $byPort[$portKey] + '、' + $p.Name + '）') }
      else { $byPort[$portKey] = $p.Name }
    }
    if ($dup.Count) {
      Add-Row '端口登记' 'FAIL' ('名册里端口重复：' + ($dup -join '；')) 'NEXT: 改 pool\members.json，让每条鱼的 port 不同（再跑 fish.ps1 list 看）'
    } else {
      Add-Row '端口登记' 'OK' ('每条鱼一个端口：' + (($byPort.GetEnumerator() | Sort-Object Value | ForEach-Object { $_.Value + '=' + $_.Key }) -join '、'))
    }
  } else {
    Add-Row '端口登记' 'WARN' '没有 members.json，跳过了端口查重' 'NEXT: 先装一次（install.ps1）或用 migrate-members.mjs 生成名册'
  }
} catch {
  Add-Row '端口登记' 'WARN' ("名册读不了：{0}" -f $_.Exception.Message) 'NEXT: 看 pool\members.json 是不是合法 JSON'
}

# 4d. 环境说明：每条鱼的 环境.md 是不是当前模板生成的
#     家目录是数据、说明书是生成的：模板改了、名册加鱼了、路径搬家了，纸不会自己变。
#     判据用文件末尾那行机器指纹 `<!-- env: template=<sha8> -->`，不用"看起来像新的"。
$envTemplate = Join-Path (Split-Path $PSScriptRoot -Parent) 'templates\环境.md.tpl'
if (Test-Path -LiteralPath $envTemplate) {
  try {
    $tplSha = (Get-FileHash -LiteralPath $envTemplate -Algorithm SHA256).Hash.Substring(0, 8).ToLowerInvariant()
    $mjEnv = if ($Cfg.MembersFile -and (Test-Path -LiteralPath $Cfg.MembersFile)) { Get-Content -LiteralPath $Cfg.MembersFile -Raw -Encoding utf8 | ConvertFrom-Json } else { $null }
    $stale = @(); $missingEnv = @(); $envOk = 0
    if ($mjEnv) {
      foreach ($p in $mjEnv.members.PSObject.Properties) {
        $m = $p.Value
        # 巡守那条鱼（lee）不是 install.ps1 装出来的，没有 环境.md —— 它不在这个检查的范围里。
        if ($m.kind -ne 'fish' -or -not $m.home -or $m.role -eq 'watcher') { continue }
        $envFile = Join-Path ([string]$m.home) '环境.md'
        if (-not (Test-Path -LiteralPath $envFile)) { $missingEnv += $p.Name; continue }
        $txt = Get-Content -LiteralPath $envFile -Raw -Encoding utf8
        $hit = [regex]::Match($txt, '<!-- env: template=([0-9a-f]{8})')
        if (-not $hit.Success) { $stale += ($p.Name + '(没有指纹)'); continue }
        if ($hit.Groups[1].Value -ne $tplSha) { $stale += ($p.Name + '(' + $hit.Groups[1].Value + ')'); continue }
        $envOk++
      }
    }
    if ($stale.Count) {
      Add-Row '环境说明' 'WARN' ('环境.md 是旧模板生成的：' + ($stale -join '、') + '（当前模板 ' + $tplSha + '）') 'NEXT: pwsh -File scripts\fish.ps1 refresh all（或点名某条鱼）'
    } elseif ($missingEnv.Count) {
      Add-Row '环境说明' 'WARN' ('没有 环境.md：' + ($missingEnv -join '、')) 'NEXT: pwsh -File scripts\fish.ps1 refresh <鱼>'
    } else {
      Add-Row '环境说明' 'OK' ('每条鱼的 环境.md 都是当前模板（' + $tplSha + '），共 ' + $envOk + ' 条')
    }
  } catch {
    Add-Row '环境说明' 'WARN' ('核不了：' + $_.Exception.Message)
  }
}

# 4e. writer 唯一：一段会话只能一个进程写（PRD A.47）
#     两个进程各自 resume 同一段会话，第二个会拿到 session/writer-held —— 它不会炸 host，
#     但会静默地"起不来"，看起来像"点了唤醒没反应"。判据两样：
#       ①同一个 profile 出现两个以上 node 进程（进程级的抢写）；
#       ②日志里出现过 session/writer-held（历史证据，可能是刚才那次）。
try {
  $dupes = @()
  $byProfile = @{}
  $nodeProcs = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'bin\.js' })
  foreach ($proc in $nodeProcs) {
    if ($proc.CommandLine -match '--profile\s+(\S+)') {
      $p = $Matches[1]
      if (-not $byProfile.ContainsKey($p)) { $byProfile[$p] = @() }
      $byProfile[$p] = @($byProfile[$p]) + $proc.ProcessId
    }
  }
  foreach ($k in $byProfile.Keys) {
    if (@($byProfile[$k]).Count -gt 1) { $dupes += ('{0}×{1}' -f $k, @($byProfile[$k]).Count) }
  }
  $held = @()
  if ($Cfg.MembersFile -and (Test-Path -LiteralPath $Cfg.MembersFile)) {
    $mjW = Get-Content -LiteralPath $Cfg.MembersFile -Raw -Encoding utf8 | ConvertFrom-Json
    foreach ($p in $mjW.members.PSObject.Properties) {
      $m = $p.Value
      if (-not $m.dshHome) { continue }
      $logDir = Join-Path ([string]$m.dshHome) 'logs'
      if (-not (Test-Path -LiteralPath $logDir)) { continue }
      foreach ($logFile in @(Get-ChildItem -LiteralPath $logDir -Filter '*.log' -File -ErrorAction SilentlyContinue | Select-Object -First 8)) {
        $hit = Select-String -LiteralPath $logFile.FullName -Pattern 'writer-held' -SimpleMatch -ErrorAction SilentlyContinue | Select-Object -Last 1
        if ($hit) { $held += ('{0}/{1}' -f $p.Name, $logFile.Name) }
      }
    }
  }
  if ($dupes.Count) {
    Add-Row 'writer 唯一' 'FAIL' ('同一个 profile 有多个进程：' + ($dupes -join '、')) 'NEXT: fish.ps1 down <键> 再 up；两个进程抢同一段会话会报 session/writer-held'
  } elseif ($held.Count) {
    Add-Row 'writer 唯一' 'WARN' ('日志里出现过 writer-held：' + (($held | Select-Object -Unique) -join '、')) 'NEXT: 一次只起一份（fish.ps1 或鱼塘）；别同时开两个窗口连同一段会话'
  } else {
    Add-Row 'writer 唯一' 'OK' '每个 profile 只有一个进程，日志里没有 writer-held'
  }
} catch {
  Add-Row 'writer 唯一' 'WARN' ('核不了：' + $_.Exception.Message)
}

# 4b. 旧段：不在名册里、却还在被写的会话
#     搬段之后最容易出的不是丢数据，是"旧标签页还开着"——他在那儿打字，话进了退休的那一段。
#     那段现在既发不出群消息（group_say 要名册里有）、也唤不醒（tick 只叫名册里的），
#     但**人不知道**。判据：文件还在被写 = 有人或有东西还在用它。
$allPinned = @()
if ($pins) { foreach ($p in $pins.PSObject.Properties) { $allPinned += @($p.Value) } }
$sessionsRoot = Join-Path $Cfg.HerDshHome 'sessions'
if (Test-Path -LiteralPath $sessionsRoot) {
  $stale = @()
  Get-ChildItem -LiteralPath $sessionsRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    Get-ChildItem -LiteralPath $_.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object {
      $sid = $_.Name
      if ($sid -notlike 'session-*') { return }
      if ($allPinned -contains $sid) { return }
      $log = Join-Path $_.FullName 'session.v4.jsonl.zstd'
      if (-not (Test-Path -LiteralPath $log)) { return }
      $age = (Get-Date) - (Get-Item -LiteralPath $log).LastWriteTime
      if ($age.TotalMinutes -lt 120) {
        $stale += ('{0}（{1}被写过）' -f $sid.Substring(0, [Math]::Min(17, $sid.Length)), (Format-Age $age))
      }
    }
  }
  if ($stale.Count -eq 0) {
    Add-Row '旧段' 'OK' '名册外的会话近两小时都没有被写过'
  } else {
    Add-Row '旧段' 'WARN' ('名册外的会话近两小时被写过：' + ($stale -join '；')) 'NEXT: 先看她的窗里是不是还开着旧标签页——有就关掉。旧段现在发不出群消息、也唤不醒；也可能只是标题在后台重算，看一眼就能排除'
  }
}

# 5. 启动痕迹：版本号与家，能分辨"哪个进程、哪份代码"
if ($lastBoot) {
  try {
    $b = $lastBoot | ConvertFrom-Json
    $age = (Get-Date).ToUniversalTime() - [datetime]::Parse($b.at, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AdjustToUniversal -bor [System.Globalization.DateTimeStyles]::AssumeUniversal)
    Add-Row '启动痕迹' 'OK' ("pkg={0} pid={1} home={2}（{3}）" -f $b.pkg, $b.pid, $b.home, (Format-Age $age))
  } catch {
    Add-Row '启动痕迹' 'WARN' ('logs\plugin-boot.log 最后一行不是 JSON：' + $lastBoot)
  }
} else {
  Add-Row '启动痕迹' 'WARN' 'logs\plugin-boot.log 不存在或为空' 'NEXT: 这个文件是"按代码位置写"的那条日志——配置坏了它还在；没有它说明插件根本没被加载'
}

# 5b. 版本一致：启动痕迹说的版本，必须和磁盘上那份 package.json 一样
#     （11-12 踩过：PKG_VERSION 写死 '1.0.0'，而代码已是 1.1.0。我当时正拿这行判断"新代码有没有生效"——
#      它说了假话，而假话跟真话长得一样。A.17 之后版本号只有 package.json 一个出处，这里就核这一条。）
if ($lastBoot) {
  try {
    $bootObj = $lastBoot | ConvertFrom-Json
    $pkgPath = Join-Path $Cfg.Root 'plugin\dsh-lil-whale-group\package.json'
    if ($bootObj.pkg -and (Test-Path -LiteralPath $pkgPath)) {
      $diskVer = (Get-Content -LiteralPath $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json).version
      $bootVer = ([string]$bootObj.pkg -replace '^.*@', '')
      if ($bootVer -eq $diskVer) {
        Add-Row '版本一致' 'OK' ("启动痕迹 {0} = package.json {1}" -f $bootVer, $diskVer)
      } else {
        Add-Row '版本一致' 'WARN' ("启动痕迹 {0} ≠ 磁盘 {1}（进程里跑的是旧代码）" -f $bootVer, $diskVer) 'NEXT: 重启她的窗（以及你的），让进程加载新版本'
      }
    } else {
      Add-Row '版本一致' 'WARN' '启动痕迹里没有 pkg，或找不到 plugin\dsh-lil-whale-group\package.json'
    }
  } catch {
    Add-Row '版本一致' 'WARN' ('核不了：' + $_.Exception.Message)
  }
}

# 6. 投递账本：同一条递两次 vs 叫了两次
$deliverLog = Join-Path $Cfg.Root 'logs\wake-deliver.log'
$lastDeliver = Tail-Line $deliverLog
if ($lastDeliver) {
  Add-Row '投递账本' 'OK' ('最近一次：' + $lastDeliver)
} else {
  Add-Row '投递账本' 'WARN' 'logs\wake-deliver.log 还不存在（今天没递过唤醒，或那版代码没生效）'
}

# 7. 群投影：群.md 落后于 messages.jsonl = 她读到的不是最新的
$msgFile = Join-Path $Cfg.GroupDir 'messages.jsonl'
$mdFile = Join-Path $Cfg.GroupDir '群.md'
$msgAge = Age-OfFile $msgFile
$mdAge = Age-OfFile $mdFile
if ($null -ne $msgAge -and $null -ne $mdAge) {
  $lagMin = ($mdAge.TotalSeconds - $msgAge.TotalSeconds) / 60
  if ($lagMin -gt 5) {
    Add-Row '群投影' 'WARN' ("群.md 比 messages.jsonl 旧 {0:N0} 分钟（投影可能没写）" -f $lagMin)
  } else {
    Add-Row '群投影' 'OK' ("群.md 与 messages.jsonl 同步（差 {0:N1} 分钟）" -f $lagMin)
  }
} else {
  Add-Row '群投影' 'WARN' 'messages.jsonl 或 群.md 不存在（群还没开张）'
}

# 7b. 私聊可读版：dm\*.jsonl 比 私聊-*.md 新 = 可读版没跟上（她 11-12 提的：只有 jsonl 一层，人读不了）
$dmDir = if ($Cfg.PoolDir) { Join-Path $Cfg.PoolDir 'dm' } else { Join-Path $Cfg.GroupDir 'dm' }
if (Test-Path -LiteralPath $dmDir) {
  $staleDm = @()
  Get-ChildItem -LiteralPath $dmDir -Filter '*.jsonl' -File -ErrorAction SilentlyContinue | ForEach-Object {
    $pair = $_.BaseName
    $mdPath = Join-Path $dmDir ("私聊-{0}.md" -f $pair)
    if (-not (Test-Path -LiteralPath $mdPath)) {
      $staleDm += ("{0}（没有 .md）" -f $pair)
    } else {
      $lagMin = ((Get-Item -LiteralPath $mdPath).LastWriteTime - $_.LastWriteTime).TotalMinutes
      if ($lagMin -lt -5) { $staleDm += ("{0}（.md 旧 {1:N0} 分钟）" -f $pair, -$lagMin) }
    }
  }
  if ($staleDm.Count -eq 0) {
    Add-Row '私聊可读版' 'OK' '每个 dm\*.jsonl 都有跟得上的 私聊-*.md'
  } else {
    Add-Row '私聊可读版' 'WARN' ($staleDm -join '；') 'NEXT: 重启她的窗让新消息自动追加；历史缺口用 node scripts\rebuild-group-md.mjs 重建'
  }
} else {
  Add-Row '私聊可读版' 'WARN' '私聊目录不存在（还没私聊过）'
}

# 8. 窗口留痕：开门/关门都记（B2）
$closeLog = Join-Path $Cfg.HerHome 'logs\close.log'
if (Test-Path -LiteralPath $closeLog) {
  $last = Tail-Line $closeLog
  Add-Row '窗口留痕' 'OK' ('close.log 最近：' + $last)
} else {
  Add-Row '窗口留痕' 'WARN' 'logs\close.log 不存在（开门/关门的账还没记过：fish.ps1 只在真开窗/真停时才记 open/close）'
}

# 8e. 沙箱通行证 & 钥匙指纹（2026-11-14 A.67 / A.68）
#     "文件工具能写、pwsh 写不进"= 这只鱼的 workspace 子树缺 capability SID；
#     "人从 UI 改了 key"不会进 keys.log —— 只能靠指纹对一下，报出来但不拦（换 key 是正常操作）。
try {
  if ($Cfg.MembersFile -and (Test-Path -LiteralPath $Cfg.MembersFile)) {
    $rosterAcl = (Get-Content -LiteralPath $Cfg.MembersFile -Raw -Encoding utf8 | ConvertFrom-Json).members
    $keyLog = Join-Path $Cfg.PoolState 'keys.log'
    $lastKeyLine = @{}
    if (Test-Path -LiteralPath $keyLog) {
      foreach ($line in (Get-Content -LiteralPath $keyLog -Encoding utf8)) {
        if ($line -match 'child=([a-z0-9-]+)') { $lastKeyLine[$Matches[1]] = $line }
      }
    }
    foreach ($prop in $rosterAcl.PSObject.Properties) {
      $m = $prop.Value
      if ($m.kind -ne 'fish' -or $m.role -eq 'watcher' -or -not $m.home) { continue }
      $fishName = if ($m.name) { [string]$m.name } else { $prop.Name }
      $probe = [pscustomobject]@{ Key = $prop.Name; Label = $fishName; Home = [string]$m.home }
      $gaps = @(Get-WorkspaceGrantGaps $probe)
      if ($gaps.Count -gt 0) {
        Add-Row ('通行证（' + $fishName + '）') 'WARN' ("{0} 个对象缺 capability SID（文件工具能写、pwsh 不能写）" -f $gaps.Count) ('NEXT: pwsh -File scripts\fish.ps1 acl-repair ' + $prop.Name)
      } else {
        Add-Row ('通行证（' + $fishName + '）') 'OK' ('workspace 子树都有 ' + (Get-WorkspaceSid ([string]$m.home)))
      }
      if ($m.dshHome) {
        $cred = Join-Path ([string]$m.dshHome) '.credentials.yaml'
        if (Test-Path -LiteralPath $cred) {
          $fp = Get-FileFingerprint $cred
          $rec = $lastKeyLine[$prop.Name]
          if (-not $rec) {
            Add-Row ('钥匙（' + $fishName + '）') 'OK' ("指纹 {0}（没有账本记录：人自己填的，正常）" -f $fp)
          } elseif ($rec -match 'fp=([0-9a-f]{12})' -and $Matches[1] -ne $fp) {
            Add-Row ('钥匙（' + $fishName + '）') 'WARN' ("指纹和上次记账不一样（{0} → {1}）：有人在 UI 里换过 key" -f $Matches[1], $fp)
          } else {
            Add-Row ('钥匙（' + $fishName + '）') 'OK' ("指纹 {0}，与上次记账一致" -f $fp)
          }
        }
      }
    }
  }
} catch {
  Add-Row '通行证' 'WARN' ('查不了：' + $_.Exception.Message)
}

# 9. 全鱼：每条鱼一行（端口 / 心跳 / 启动痕迹 / 名册）
#    为什么单独一段：上面那些检查只盯"她"（whale）。鱼多了以后，
#    "第二条鱼没起""她的日志写成了第一条鱼的"这类错，单独看她那张表是看不出来的。
if (Test-Path -LiteralPath $Cfg.MembersFile) {
  try {
    $roster = (Get-Content -LiteralPath $Cfg.MembersFile -Raw -Encoding utf8 | ConvertFrom-Json).members
    $bootLines = @()
    $bootPath = Join-Path $PSScriptRoot '..\logs\plugin-boot.log'
    if (Test-Path -LiteralPath $bootPath) {
      $bootLines = @(Get-Content -LiteralPath $bootPath -Encoding utf8 | ForEach-Object {
        try { $_ | ConvertFrom-Json } catch { $null }
      } | Where-Object { $_ })
    }
    $pinsFile = Join-Path $Cfg.GroupDir 'pins.json'
    $pins = $null
    if (Test-Path -LiteralPath $pinsFile) { try { $pins = Get-Content -LiteralPath $pinsFile -Raw -Encoding utf8 | ConvertFrom-Json } catch { $pins = $null } }

    foreach ($prop in $roster.PSObject.Properties) {
      $key = $prop.Name
      $m = $prop.Value
      if ($m.kind -ne 'fish') { continue }
      $name = if ($m.name) { [string]$m.name } else { $key }
      $portOk = if ($m.port) { Test-Port ([int]$m.port) } else { $false }
      $portText = if ($m.port) { ('{0} {1}' -f $m.port, $(if ($portOk) { '通' } else { '不通' })) } else { '没配端口' }

      $presenceText = '没有心跳文件'
      if ($m.key -or $key) {
        $presenceFile = Join-Path $Cfg.PoolState ('presence\{0}.json' -f $key)
        $age = Age-OfFile $presenceFile
        if ($null -ne $age) {
          $presenceText = ('心跳 {0}' -f (Format-Age $age))
        }
      }

      $bootText = '没有启动痕迹'
      if ($m.home) {
        # 他的进程不设 DSH_HOME，启动痕迹写成 "(unset; 默认 <用户目录>\.dsh)" —— 先把真实路径抠出来再比。
        $wantHome = ([string]$m.home).TrimEnd('\')
        $hit = $bootLines | Where-Object {
          # 两个字段都可能写着她/他的家：`home`（进程自己的 DSH_HOME，可能带 "(unset; 默认 …)" 包装）
          # 和 `herHome`（配置里的她的家）。两个都拿来比，谁的路径对上就算谁。
          $candidates = @()
          if ($_.home) {
            $candidates += [string]$_.home
            if ([string]$_.home -match '默认\s+([^)]+)') { $candidates += $Matches[1] }
          }
          if ($_.selfHome) { $candidates += [string]$_.selfHome }
          if ($_.herHome) { $candidates += [string]$_.herHome }
          foreach ($c in $candidates) { if (([string]$c).TrimEnd('\') -ieq $wantHome) { return $true } }
          return $false
        } | Select-Object -Last 1
        if ($hit) { $bootText = ('pid={0} pkg={1}' -f $hit.pid, $hit.pkg) }
      }

      $pinText = '名册里没有会话'
      if ($pins -and $pins.PSObject.Properties.Name -contains $key) {
        $ids = @($pins.$key | Where-Object { $_ })
        if ($ids.Count -gt 0) { $pinText = ('会话 {0} 段' -f $ids.Count) }
      }

      # 常驻鱼应该开着；实验鱼允许关着（这正是"不承诺一直醒着"）。
      $state = 'OK'
      $why = @()
      if (-not $portOk) { if ([string]$m.status -eq 'experiment') { $state = 'WARN' } else { $state = 'FAIL' }; $why += '端口不通' }
      if ($pinText -eq '名册里没有会话') { $state = 'FAIL'; $why += '名册缺会话' }
      $evidence = ('{0}（{1}）｜端口 {2}｜{3}｜{4}｜{5}' -f $name, $key, $portText, $presenceText, $bootText, $pinText)
      $next = if ($state -eq 'OK') { '' } else { ('NEXT: pwsh -File scripts\fish.ps1 up {0}（看 logs\plugin-boot.log 里 home={1} 的那条）' -f $key, $m.home) }
      Add-Row '全鱼' $state $evidence $next
    }
  } catch {
    Add-Row '全鱼' 'WARN' ('名册读不了：{0}' -f $_.Exception.Message) 'NEXT: 看 pool\members.json 是不是合法 JSON'
  }
} else {
  Add-Row '全鱼' 'WARN' '名册不存在（还是"一条鱼"的时代）' 'NEXT: node scripts\migrate-members.mjs 生成 pool\members.json'
}

# ---- 输出 ----
Write-Host ''
Write-Host '小肥鱼体检' -ForegroundColor Cyan
Write-Host ('配置：{0}' -f $Cfg.ConfigPath)
Write-Host ''
$rows | Format-Table -AutoSize -Wrap | Out-String -Width 200 | Write-Host

if ($fails -eq 0 -and $warns -eq 0) {
  Write-Host '全过。' -ForegroundColor Green
} elseif ($fails -eq 0) {
  Write-Host ("没有 FAIL，但有 {0} 条 WARN（能跑，不对劲）。" -f $warns) -ForegroundColor Yellow
} else {
  Write-Host ("{0} 条 FAIL、{1} 条 WARN。" -f $fails, $warns) -ForegroundColor Red
}
foreach ($n in $script:nexts) { Write-Host $n -ForegroundColor Yellow }

exit $(if ($fails -gt 0) { 1 } else { 0 })
