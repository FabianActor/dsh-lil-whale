#requires -Version 7.0
# doctor.ps1 -- 一条鱼还活着吗？
#
# 用法：
#   pwsh -File scripts\doctor.ps1                只看她
#   pwsh -File scripts\doctor.ps1 -IncludeLee    连他的窗一起看
#
# 为什么要有这个脚本：装完先验那四件（README / docs\detail\怎么生一条新鱼.md）是手工敲的，
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
# r242：环境变量给了但文件不在，是"你给的路径不对"，不是"没配置"——必须报出来。
if ($Cfg.ConfigIssue) {
  Add-Row '配置' 'FAIL' $Cfg.ConfigIssue 'NEXT: 检查 LIL_WHALE_CONFIG 的拼写；不想用它就先清掉（$env:LIL_WHALE_CONFIG=$null）—— 脚本不会悄悄改读仓库里的真配置'
} elseif ($Cfg.ConfigFound) {
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
# 2026-11-16 第四份沉淀 P3：这里原来写死 presence\whale.json，默认键是 fish 的机器上恒 FAIL。
# 判据：心跳看的是"名册里第一条非巡守的鱼"，键名从名册来，不从作者自己的鱼名来。
$presenceKey = $null
if ($Cfg.MembersFile -and (Test-Path -LiteralPath $Cfg.MembersFile)) {
  try {
    $mjP = Get-Content -LiteralPath $Cfg.MembersFile -Raw -Encoding utf8 | ConvertFrom-Json
    $pair = @($mjP.members.PSObject.Properties | Where-Object {
        $_.Value.kind -eq 'fish' -and $_.Value.role -ne 'watcher' -and $_.Value.lifecycle -ne 'archived'
      }) | Select-Object -First 1
    if ($pair) { $presenceKey = $pair.Name }
  } catch { }
}
if (-not $presenceKey) { $presenceKey = 'whale' }
$presenceFile = Join-Path $Cfg.PoolState ("presence\{0}.json" -f $presenceKey)
if (Test-Path -LiteralPath $presenceFile) {
  try {
    $p = Get-Content -LiteralPath $presenceFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $at = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$p.at)
    $age = (Get-Date) - $at.LocalDateTime
    $state = if ($age.TotalHours -gt 24) { 'WARN' } else { 'OK' }
    Add-Row '她的心跳' $state ("status={0}，最后心跳 {1}" -f $p.status, (Format-Age $age))
    if ($state -eq 'WARN') { Add-Row '她的心跳（说明）' 'WARN' '心跳超过 24 小时没动：可能只是没人叫她（她不是常驻的），也可能是会话没被打开' }
  } catch {
    Add-Row '她的心跳' 'FAIL' (("pool\state\presence\{0}.json 读不了：{1}") -f $presenceKey, $_.Exception.Message) 'NEXT: 看 state\presence\ 下的文件是不是坏 JSON'
  }
} else {
  # 2026-11-16 第五份沉淀 P2：刚装完还没开窗时这里必然是"文件不存在"。
  # 它是首装的正常状态，不该让体检红着一屏——标 INFO 并把"怎么变 OK"写出来。
  Add-Row '她的心跳' 'INFO' (("pool\state\presence\{0}.json 还不存在——要是刚装完还没开过窗，这属正常（首装 1 FAIL 就是这一格）；开窗并进那段会话后会有心跳" -f $presenceKey)) 'NEXT: 在 GUI 里打开她的页面，进那段会话'
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
          $txt = Get-Content -LiteralPath $wakeOn -Raw -Encoding utf8
          $raw = $txt | ConvertFrom-Json
          # 2026-11-16：ConvertFrom-Json '[]' 返回 $null；而 if 表达式里返回 @() 也会被管道展开成 $null。
          # 所以"形状对不对"用单独的标志，别拿 $null 判断空表。
          $shapeOk = $true
          $list = @()
          if ($raw -is [array]) { $list = @($raw) }
          elseif ($null -ne $raw -and $null -ne $raw.items) { $list = @($raw.items) }
          elseif (-not ($null -eq $raw -and $txt.Trim() -eq '[]')) { $shapeOk = $false }
          if (-not $shapeOk) {
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

  # 3f. 游标不能比文件还靠前（2026-11-14 22:5x，Fabian 的私信没叫醒她）
  # 判据：游标 > 行数 ⇒ 那条消息会被当成"已经读过"，永远不叫醒。行数取真源文件。
  $groupFile = Join-Path $Cfg.GroupDir 'messages.jsonl'
  $dmDir = Join-Path $Cfg.PoolDir 'dm'
  $cursorDir = Join-Path $Cfg.PoolState 'cursors'
  $cursorBad = @()
  $cursorChecked = 0
  if (Test-Path -LiteralPath $cursorDir) {
    foreach ($cf in Get-ChildItem -LiteralPath $cursorDir -File -Filter '*.json') {
      $key = $cf.BaseName
      $data = $null
      try { $data = Get-Content -LiteralPath $cf.FullName -Raw -Encoding utf8 | ConvertFrom-Json } catch { continue }
      $box = $data.$key
      if ($null -eq $box) { continue }
      foreach ($prop in $box.PSObject.Properties) {
        $channelKey = $prop.Name
        $seen = [long]$prop.Value
        $file = $null
        if ($channelKey -eq 'group') { $file = $groupFile }
        elseif ($channelKey -like 'dm:*') { $file = Join-Path $dmDir ($channelKey.Substring(3) + '.jsonl') }
        if ($null -eq $file -or -not (Test-Path -LiteralPath $file)) { continue }
        $count = @(Get-Content -LiteralPath $file -Encoding utf8 | Where-Object { $_.Trim() -ne '' }).Count
        $cursorChecked += 1
        if ($seen -gt $count) { $cursorBad += "$key/$channelKey=$seen>行数$count" }
      }
    }
  }
  if ($cursorBad.Count -gt 0) {
    Add-Row '游标' 'FAIL' ($cursorBad -join '；') 'NEXT: 游标比文件靠前，新消息会被当成已读——把它退回到行数（2026-11-14 私信事故）'
  } elseif ($cursorChecked -gt 0) {
    Add-Row '游标' 'OK' ("$cursorChecked 个通道都不超过行数")
  } else {
    Add-Row '游标' 'WARN' '没有可检查的游标文件' 'NEXT: 跑一次 fish.ps1 list 看进程是否起来'
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

  # 3g. dsh 依赖的 undici 有没有装全（2026-11-15，小肥鱼报的 web_fetch 崩）
  # 现象：目录在、lib\cache 里少文件 ⇒ require('undici') 报 Cannot find module '../cache/memory-cache-store'。
  # 判据：看文件在不在，不看接口通不通（接口可能走别的路，通了也不代表这个包是好的）。
  $repair = Join-Path $PSScriptRoot 'repair-undici.mjs'
  if (Test-Path -LiteralPath $repair) {
    $undiciOut = & node $repair --check 2>&1
    $undiciCode = $LASTEXITCODE
    if ($undiciCode -eq 0) {
      # 2026-11-16 第五份沉淀 P3：SKIP 的意思是"没有 undici 可查"，不是"查过且完好"。
      $undiciLine = ($undiciOut | Select-Object -Last 1).Trim()
      if ($undiciLine -match '^SKIP') { Add-Row 'undici 文件' 'INFO' $undiciLine }
      else { Add-Row 'undici 文件' 'OK' $undiciLine }
    } else {
      Add-Row 'undici 文件' 'FAIL' (($undiciOut | Where-Object { $_ -match '^WARN|^FAIL|^  - ' } | Select-Object -First 3) -join ' ') 'NEXT: node scripts/repair-undici.mjs --fix'
    }
  } else {
    Add-Row 'undici 文件' 'WARN' '没有 scripts\repair-undici.mjs' 'NEXT: 从仓库同步这个脚本'
  }
  # 3h. 生效值：巡守进程写出来的那份（2026-11-15 小肥鱼/小鱼丸）
  # 判据：文件在、at 是近 5 分钟内的、四个数与环境.md 对得上；"没写过"和"死了"要分得开。
  $capsFile = Join-Path $Cfg.PoolState 'wake-caps.json'
  # "文件不在"有两种意思，顺序不能反（小肥鱼 2026-11-15 08:50）：
  #   日志里没有 wake-caps 行 → 版本还没到，等重启；
  #   日志里有那行、文件却不在 → 写失败（权限/路径/盘），要查。
  $capsLogSeen = $false
  $homesRoot = Join-Path $Cfg.PondRoot 'homes'
  if (Test-Path -LiteralPath $homesRoot) {
    foreach ($h in @(Get-ChildItem -LiteralPath $homesRoot -Directory -ErrorAction SilentlyContinue)) {
      $lg = Join-Path $h.FullName 'logs\watchman.log'
      if ((Test-Path -LiteralPath $lg) -and (Select-String -LiteralPath $lg -Pattern 'wake-caps \| fmt=1' -Quiet -ErrorAction SilentlyContinue)) { $capsLogSeen = $true; break }
    }
  }
  if (-not (Test-Path -LiteralPath $capsFile)) {
    if ($capsLogSeen) {
      Add-Row '生效值' 'FAIL' 'watchman.log 里有 wake-caps 行，但 wake-caps.json 不在：写失败（权限/路径/盘）' 'NEXT: 看巡守日志里 wake-caps-write-failed 的 detail'
    } else {
      Add-Row '生效值' 'WARN' '日志里还没有 wake-caps 行：版本还没到（等主 dsh 重启到带这段代码的版本）' 'NEXT: 重启主 dsh（3080）后看 pool\state\wake-caps.json'
    }
  } else {
    try {
      $caps = Get-Content -LiteralPath $capsFile -Raw -Encoding UTF8 | ConvertFrom-Json
      $atMs = 0
      if ($null -ne $caps.at) {
        try {
          $atUtc = ([datetime]$caps.at).ToUniversalTime()
          $atMs = [DateTimeOffset]::new($atUtc).ToUnixTimeMilliseconds()
        } catch { $atMs = 0 }
      }
      $ageMin = if ($atMs -gt 0) { [Math]::Round(((Get-Date).ToUniversalTime() - [DateTimeOffset]::FromUnixTimeMilliseconds($atMs).UtcDateTime).TotalMinutes) } else { -1 }
      $capText = "间隔 $($caps.caps.cooldownSec)s / 每小时 $($caps.caps.perHour) / 每天 $($caps.caps.perDay) / 全池 $($caps.caps.totalPerDay) / 推门 $($caps.caps.maxWakesPerDay)"
      $overrides = @($caps.source.overrides)
      $srcText = if ($overrides.Count -gt 0) { "配置覆盖：" + ($overrides -join '、') } else { '代码默认值' }
      if (-not $capsLogSeen) {
        Add-Row '生效值' 'WARN' "文件在（$capText），但日志里没有 wake-caps 行——可能不是这个版本的巡守写的" 'NEXT: 确认主 dsh 的 pkg 版本与 boot 行'
      } elseif ($ageMin -lt 0) {
        Add-Row '生效值' 'FAIL' 'wake-caps.json 里没有可读的 at' 'NEXT: 看 pool\state\wake-caps.json 的内容'
      } elseif ($ageMin -gt 5) {
        Add-Row '生效值' 'FAIL' "巡守 $ageMin 分钟没更新生效值（进程可能死了/卡住）：$capText" 'NEXT: 看 homes\<鱼>\logs\watchman.log 末尾有没有 wake-caps 行'
      } else {
        $capPid = $caps.pid
    $capLoaded = ''
    try { if ($caps.source.configMtime) { $capLoaded = ([datetime]$caps.source.configMtime).ToLocalTime().ToString('HH:mm:ss') } } catch { }
    # 2026-11-16 第五份沉淀 N3：那是配置文件的 mtime，不是"加载时间"；按事实写。
    $capWho = "pid=$capPid" + $(if ($capLoaded) { "，配置文件最后修改于 $capLoaded" } else { '' })
    Add-Row '生效值' 'OK' "$capText（$srcText；$capWho；$ageMin 分钟前写出）"
      }
    } catch {
      Add-Row '生效值' 'FAIL' "wake-caps.json 读不出来：$($_.Exception.Message)" 'NEXT: 看文件是不是写坏了'
    }
  }

# 3i. 默认值有没有被配置钉死（小鱼丸 2026-11-15 09:1x）
# 判据：配置里只留确实偏离默认的项；等于默认的就删掉，否则默认值会被静默劫持。
$wakeConfigJs = Join-Path $Cfg.Root 'plugin\dsh-lil-whale-group\lib\wake-config.js'
if (-not (Test-Path -LiteralPath $wakeConfigJs)) {
  Add-Row '默认值' 'WARN' "找不到 wake-config.js（$wakeConfigJs）——这条检查没法做，不是通过" 'NEXT: 看 plugin\dsh-lil-whale-group\lib\ 下有没有这个文件'
} else {
  $cfgUrl = 'file:///' + ($wakeConfigJs -replace '\\', '/')
  $defJson = & node -e "import(process.argv[1]).then(m=>console.log(JSON.stringify(m.WAKE_DEFAULTS)))" $cfgUrl 2>$null
  $defaults = $null
  try { $defaults = $defJson | ConvertFrom-Json } catch { }
  if ($null -eq $defaults) {
    Add-Row '默认值' 'WARN' '读不出 WAKE_DEFAULTS（wake-config.js 导入失败）' 'NEXT: 手工跑一次 node -e "import(...)" 看报错'
  } elseif (-not ($Cfg.MembersFile -and (Test-Path -LiteralPath $Cfg.MembersFile))) {
    Add-Row '默认值' 'WARN' '没有名册，没法查每条鱼的配置' 'NEXT: 先有 pool\members.json'
  } else {
    $pinned = @()
    $roster = (Get-Content -LiteralPath $Cfg.MembersFile -Raw -Encoding utf8 | ConvertFrom-Json).members
    foreach ($prop in $roster.PSObject.Properties) {
      $m = $prop.Value
      if ($m.kind -ne 'fish' -or $m.role -eq 'watcher') { continue }
      $cfgRel = [string]$m.configFile
      if (-not $cfgRel) { continue }
      $cfgPath = if ([System.IO.Path]::IsPathRooted($cfgRel)) { $cfgRel } else { Join-Path $Cfg.Root $cfgRel }
      if (-not (Test-Path -LiteralPath $cfgPath)) { continue }
      try { $fishCfg = Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { continue }
      foreach ($section in @('wake', 'watch')) {
        $sec = $fishCfg.$section
        if ($null -eq $sec) { continue }
        foreach ($p in $sec.PSObject.Properties) {
          if ($p.Name -like '_*') { continue }
          $defVal = $defaults.($p.Name)
          if ($null -ne $defVal -and [string]$p.Value -eq [string]$defVal) {
            $pinned += "$($prop.Name).$section.$($p.Name)=$($p.Value)"
          }
        }
      }
    }
    if ($pinned.Count -gt 0) {
      Add-Row '默认值' 'WARN' ("配置里钉着等于默认值的键：" + ($pinned -join '、') + '（等于默认就该删，否则以后改默认不生效）') 'NEXT: 删掉这些键，只留真正偏离默认的项'
    } else {
      $nowStamp = (Get-Date).ToString('HH:mm:ss')
    Add-Row '默认值' 'OK' "磁盘上现在这份配置（读于 $nowStamp）里没有等于默认值的覆盖项（默认值改得动）"
    }
  }
}

# 3j. 生命周期字段：缺省值要写死，旧字段要有到期日（小鱼丸/小肥鱼 2026-11-15 18:42）
#     判据：①没有 lifecycle ⇒ 按 active 读（11-15 之前不存在归档这个状态）；
#           ②还带着旧 status 字段 ⇒ 报一次 —— 兜底可以不删，但要会喊。
try {
  if ($Cfg.MembersFile -and (Test-Path -LiteralPath $Cfg.MembersFile)) {
    $lifeMissing = @(); $lifeLegacy = @()
    $mjLife = Get-Content -LiteralPath $Cfg.MembersFile -Raw -Encoding utf8 | ConvertFrom-Json
    foreach ($p in $mjLife.members.PSObject.Properties) {
      $m = $p.Value
      if ($m.kind -ne 'fish') { continue }
      if ($m.PSObject.Properties.Name -notcontains 'lifecycle') { $lifeMissing += $p.Name }
      if ($m.PSObject.Properties.Name -contains 'status') { $lifeLegacy += $p.Name }
    }
    $famFile = Join-Path $Cfg.PoolDir 'family.json'
    if (Test-Path -LiteralPath $famFile) {
      try {
        $fam = Get-Content -LiteralPath $famFile -Raw -Encoding utf8 | ConvertFrom-Json
        foreach ($fp in $fam.nodes.PSObject.Properties) {
          if ($fp.Value.PSObject.Properties.Name -notcontains 'lifecycle') { $lifeMissing += ('family:' + $fp.Name) }
          if ($fp.Value.PSObject.Properties.Name -contains 'status') { $lifeLegacy += ('family:' + $fp.Name) }
        }
      } catch { }
    }
    if ($lifeLegacy.Count) {
      Add-Row '生命周期字段' 'WARN' ('还带着旧 status 字段：' + ($lifeLegacy -join '、') + '（兼容兜底会读它，但兜底没有到期日）') 'NEXT: 迁掉旧字段，只留 lifecycle（迁移脚本见 docs\detail\还没做完的事.md）'
    } elseif ($lifeMissing.Count) {
      Add-Row '生命周期字段' 'WARN' ('缺 lifecycle：' + ($lifeMissing -join '、') + '（按 active 读；此规则自 2026-11-15 起有效）') 'NEXT: 补 lifecycle=active'
    } else {
      Add-Row '生命周期字段' 'OK' '名册和谱系里只有 lifecycle（缺省按 active 读），没有旧 status 字段'
    }
  }
} catch {
  Add-Row '生命周期字段' 'WARN' ('核不了：' + $_.Exception.Message)
}

# 3k. 会话绑定：新鱼第一次开口后要有人把她钉进名册（第三条鱼 2026-11-15 20:25 撞到）
#     她家里的会话是宿主在网页里建的；建完名册里没有她 —— 群里不认她，第一句话会被拒。
#     这一格只报"该钉没钉"和"钉了找不到"，不替人钉（名册是宿主的账）。
try {
  if ($Cfg.MembersFile -and (Test-Path -LiteralPath $Cfg.MembersFile)) {
    $rosterBind = (Get-Content -LiteralPath $Cfg.MembersFile -Raw -Encoding utf8 | ConvertFrom-Json).members
    $pinsFile = Join-Path $Cfg.GroupDir 'pins.json'
    $pins = $null
    if (Test-Path -LiteralPath $pinsFile) {
      try { $pins = Get-Content -LiteralPath $pinsFile -Raw -Encoding utf8 | ConvertFrom-Json } catch { $pins = $null }
    }
    foreach ($prop in $rosterBind.PSObject.Properties) {
      $m = $prop.Value
      if ($m.kind -ne 'fish' -or $m.role -eq 'watcher' -or -not $m.dshHome) { continue }
      $fishName = if ($m.name) { [string]$m.name } else { $prop.Name }
      $sessionsRoot = Join-Path ([string]$m.dshHome) 'sessions'
      $sessionFiles = @()
      if (Test-Path -LiteralPath $sessionsRoot) {
        $sessionFiles = @(Get-ChildItem -LiteralPath $sessionsRoot -Recurse -File -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
      }
      $bound = @()
      if ($pins -and ($pins.PSObject.Properties.Name -contains $prop.Name)) { $bound = @($pins.($prop.Name)) }
      if ($sessionFiles.Count -eq 0 -and $bound.Count -eq 0) {
        Add-Row ('会话绑定（' + $fishName + '）') 'OK' '还没开口（没有会话，也没钉）'
      } elseif ($sessionFiles.Count -gt 0 -and $bound.Count -eq 0) {
        Add-Row ('会话绑定（' + $fishName + '）') 'WARN' ('她家里有 {0} 个会话文件，但没有一段钉在 pins.json 里（群里不认她）' -f $sessionFiles.Count) ('NEXT: pwsh -File scripts/fish.ps1 bind ' + $prop.Name + ' -Session <会话id>')
      } else {
        $matched = 0
        foreach ($bid in $bound) {
          if (@($sessionFiles | Where-Object { $_ -like ('*' + $bid + '*') }).Count -gt 0) { $matched++ }
        }
        if ($matched -eq $bound.Count) {
          Add-Row ('会话绑定（' + $fishName + '）') 'OK' ('钉了 {0} 段，在她家都能找到' -f $bound.Count)
        } else {
          Add-Row ('会话绑定（' + $fishName + '）') 'WARN' ('钉了 {0} 段，只有 {1} 段能在她家找到（会叫错人）' -f $bound.Count, $matched) ('NEXT: 核对 pins.json 与 ' + $sessionsRoot)
        }
      }
    }
  }
} catch {
  Add-Row '会话绑定' 'WARN' ('查不了：' + $_.Exception.Message)
}

# 4. 名册：群认会话不认名字；登记错了 = 叫错人
#    2026-11-16 17:59 第三、四条鱼发现：这一格是单鱼时代的遗留——写死 whale、又拿"配置主人的家"去查别人；
#    鱼在自己家里跑 doctor 时会误报 FAIL，还附一条会改坏共享状态的 NEXT。上面的「会话绑定」已逐鱼查过同一件事。
#    "修是让旧路也对，删是让它不存在"——整格删掉，只留两件仍需要的事。
$pinsFile = Join-Path $Cfg.GroupDir 'pins.json'
if (-not (Test-Path -LiteralPath $pinsFile)) {
  Add-Row '名册' 'FAIL' 'group\pins.json 不存在' 'NEXT: 群不认人：她说的每句话都会被守门拒掉'
} else {
  # 空白也要是声明：watcher 的家不在鱼塘里（%USERPROFILE%\.dsh），「会话绑定」按设计只盖三条鱼。
  Add-Row '名册（lee）' 'INFO' 'watcher 的家不在鱼塘里，pins.lee 不在这套体检的视野里（空白是声明，不是通过）'
}

# 她有没有过会话：sessionId 写过，或者家里的 sessions\ 目录里有文件。
# 判据来自第三条鱼 2026-11-15 18:56：没会话要拆两态 —— 从没开口（等）和有过但没挂上（查），
# 这两种在纸上长得一样、下一步完全不同；而"一条永远为真的 FAIL 会训练人忽略 FAIL"。
function Test-EverHadSession([object]$m) {
  try {
    if ($m.sessionId) { return $true }
    if ($m.dshHome) {
      $sess = Join-Path ([string]$m.dshHome) 'sessions'
      if (Test-Path -LiteralPath $sess) {
        $any = @(Get-ChildItem -LiteralPath $sess -File -ErrorAction SilentlyContinue)
        if ($any.Count -gt 0) { return $true }
      }
    }
  } catch { }
  return $false
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
    $missing = @(); $never = @()
    foreach ($k in $fishKeys) {
      $ids = @()
      if ($pinsObj.PSObject.Properties.Name -contains $k) { $ids = @($pinsObj.$k) }
      if ($ids.Count -eq 0) {
        if (Test-EverHadSession $mj.members.$k) { $missing += $k } else { $never += $k }
      }
    }
    if ($missing.Count) {
      Add-Row '名册（全鱼）' 'FAIL' ('这些鱼有过会话，但 pins.json 里没有：' + ($missing -join '、')) ('NEXT: node scripts\pins.mjs --member <键> --id <会话id>（鱼有 ' + ($fishKeys -join '/') + '）')
    } elseif ($never.Count) {
      Add-Row '名册（全鱼）' 'INFO' ('还没醒过（从没有过会话）：' + ($never -join '、') + ' —— 等她开口；有会话之后这一格会自己变成 FAIL 或 OK') 'NEXT: 在 GUI 里打开她的页面建第一段会话，再 node scripts\pins.mjs 绑定'
    } else {
      Add-Row '名册（全鱼）' 'OK' ('每条鱼都有会话：' + ($fishKeys -join '、'))
    }
  }
} catch {
  Add-Row '名册（全鱼）' 'WARN' ("读不了名册或 pins：{0}" -f $_.Exception.Message) 'NEXT: 看 pool\members.json 与 pool\group\pins.json 是不是合法 JSON'
}
# 4c1. 谱系（全鱼）：名册里的每个人都要在 family.json 里有节点（2026-11-17 r240）
#      单向包含：members ⊆ family；family 里多出来的算历史/归档节点，不算不一致
#      （反过来"两边必须相等"会把合法历史判成错，然后被人改成好看的样子——小鱼丸）。
try {
  $familyFile = Join-Path $Cfg.PoolDir 'family.json'
  if ($Cfg.MembersFile -and (Test-Path -LiteralPath $Cfg.MembersFile) -and (Test-Path -LiteralPath $familyFile)) {
    $mjFam = Get-Content -LiteralPath $Cfg.MembersFile -Raw -Encoding utf8 | ConvertFrom-Json
    $famObj = Get-Content -LiteralPath $familyFile -Raw -Encoding utf8 | ConvertFrom-Json
    $memberKeys = @($mjFam.members.PSObject.Properties.Name)
    $familyKeys = @($famObj.nodes.PSObject.Properties.Name)
    $onlyMember = @($memberKeys | Where-Object { $familyKeys -notcontains $_ })
    $onlyFamily = @($familyKeys | Where-Object { $memberKeys -notcontains $_ })
    if ($onlyMember.Count) {
      Add-Row '谱系（全鱼）' 'WARN' ('名册里有人在谱系里没有节点：' + ($onlyMember -join '、')) 'NEXT: node scripts\gen-family.mjs --seed 重生成；报错就按报错修 pool\family.json'
    } elseif ($onlyFamily.Count) {
      Add-Row '谱系（全鱼）' 'OK' ('名册都在谱系里（另有 ' + $onlyFamily.Count + ' 个历史节点：' + ($onlyFamily -join '、') + '）')
    } else {
      Add-Row '谱系（全鱼）' 'OK' ('名册与谱系节点一致：' + ($memberKeys -join '、'))
    }
  } else {
    Add-Row '谱系（全鱼）' 'INFO' '还没有名册或还没有 family.json（干净安装后两者都会在）'
  }
} catch {
  Add-Row '谱系（全鱼）' 'WARN' ("读不了名册或谱系：{0}" -f $_.Exception.Message) 'NEXT: 看 pool\members.json 与 pool\family.json 是不是合法 JSON'
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

# 4e. writer 唯一：一段会话只能一个进程写（CHANGELOG A.47）
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
#      它说了假话，而假话跟真话长得一样。CHANGELOG A.17 之后版本号只有 package.json 一个出处，这里就核这一条。）
if ($lastBoot) {
  try {
    $bootObj = $lastBoot | ConvertFrom-Json
    $pkgPath = Join-Path $Cfg.Root 'plugin\dsh-lil-whale-group\package.json'
    if ($bootObj.pkg -and (Test-Path -LiteralPath $pkgPath)) {
      $diskVer = (Get-Content -LiteralPath $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json).version
      # 2026-11-16 第五份沉淀 N2：只看最后一行会被"刚好重启的那条鱼"骗过——主进程还是旧代码也报 OK。
      # 改成按每个运行者（selfHome，没有就用 pid）各取最近一条启动行，逐个核。
      $bootAllVer = @()
      $bootPathVer = Join-Path $PSScriptRoot '..\logs\plugin-boot.log'
      if (Test-Path -LiteralPath $bootPathVer) {
        $bootAllVer = @(Get-Content -LiteralPath $bootPathVer -Encoding utf8 | ForEach-Object {
          try { $_ | ConvertFrom-Json } catch { $null }
        } | Where-Object { $_ -and $_.pkg })
      }
      # 只认"这一座鱼塘里、现在还在跑的进程"：
      # ①启动行写的家必须是名册里的家（旧鱼塘根、换过目录的历史行不掺和）；
      # ②pid 还活着（pid 会被复用，所以还要 ③）；
      # ③进程启动时间不晚于那条启动行、且相隔不超过 30 分钟（pid 被别的程序复用时会露馅）。
      $allowedHomes = @{}
      if ($Cfg.MembersFile -and (Test-Path -LiteralPath $Cfg.MembersFile)) {
        $rosterVer = (Get-Content -LiteralPath $Cfg.MembersFile -Raw -Encoding utf8 | ConvertFrom-Json).members
        foreach ($rp in $rosterVer.PSObject.Properties) {
          if ($rp.Value.home) { $allowedHomes[(([string]$rp.Value.home).TrimEnd('\'))] = $true }
          if ($rp.Value.dshHome) { $allowedHomes[(([string]$rp.Value.dshHome).TrimEnd('\'))] = $true }
        }
      }
      $liveBoot = @()
      $seenPid = @{}
      foreach ($rowVer in $bootAllVer) {
        $rowPid = [string]$rowVer.pid
        if (-not $rowPid -or $seenPid.ContainsKey($rowPid)) { continue }
        $rowHome = ([string]$rowVer.selfHome).TrimEnd('\')
        if ($allowedHomes.Count -gt 0 -and -not $allowedHomes.ContainsKey($rowHome)) { continue }
        $seenPid[$rowPid] = $true
        $procVer = Get-Process -Id ([int]$rowPid) -ErrorAction SilentlyContinue
        if (-not $procVer) { continue }
        # pid 会被系统进程复用（svchost/dasHost/SearchFilterHost…）；这里只认 node，
        # 而且认不出启动时间的（系统进程常拒绝访问）也不拿它当"我们的进程"。
        if ($procVer.ProcessName -ne 'node') { continue }
        $startUtc = $null
        try { $startUtc = $procVer.StartTime.ToUniversalTime() } catch { $startUtc = $null }
        if (-not $startUtc) { continue }
        try {
          $rowAtUtc = ([datetime]$rowVer.at).ToUniversalTime()
          if ($rowAtUtc -lt $startUtc.AddSeconds(-5) -or ($rowAtUtc - $startUtc).TotalMinutes -gt 30) { continue }
        } catch { continue }
        $liveBoot += $rowVer
      }
      if ($liveBoot.Count -eq 0) {
        # 读不到进程表（沙箱等）就退回"每个 selfHome 的最近一行"，并注明口径。
        $byHomeVer = @{}
        foreach ($rowVer in $bootAllVer) { $byHomeVer[([string]$rowVer.selfHome).TrimEnd('\')] = $rowVer }
        $liveBoot = @($byHomeVer.Values)
        $scopeText = '启动痕迹（读不到进程表）'
      } else {
        $scopeText = '进程'
      }
      $staleRunners = @($liveBoot | Where-Object { ([string]$_.pkg -replace '^.*@', '') -ne $diskVer })
      if ($staleRunners.Count -eq 0) {
        $runnerText = (@($liveBoot | ForEach-Object { [string]$_.pkg -replace '^.*@', '' }) | Sort-Object -Unique) -join '/'
        Add-Row '版本一致' 'OK' ("所有{0}都跑 {1}（磁盘 {2}；{3} 个）" -f $scopeText, $runnerText, $diskVer, $liveBoot.Count)
      } else {
        $staleText = ($staleRunners | ForEach-Object { 'pid={0} 启动 {1}' -f $_.pid, ([string]$_.pkg -replace '^.*@', '') }) -join '；'
        Add-Row '版本一致' 'WARN' ("还有{0}跑着旧代码（磁盘 {1}）：{2}" -f $scopeText, $diskVer, $staleText) 'NEXT: 重启这些进程（主 dsh 与各条鱼），让它们加载新版本'
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

# 8e. 沙箱通行证 & 钥匙指纹（2026-11-14 CHANGELOG A.67 / CHANGELOG A.68）
#     "文件工具能写、pwsh 写不进"= 这只鱼的 workspace 子树缺 capability SID；
#     "人从 UI 改了 key"不会进 keys.log —— 只能靠指纹对一下，报出来但不拦（换 key 是正常操作）。
try {
  if ($Cfg.MembersFile -and (Test-Path -LiteralPath $Cfg.MembersFile)) {
    $rosterAcl = (Get-Content -LiteralPath $Cfg.MembersFile -Raw -Encoding utf8 | ConvertFrom-Json).members
    $keyLog = Join-Path $Cfg.PoolState 'keys.log'
    $keyFps = @{}
    $keyNameOf = @{}
    $inheritFrom = @{}
    $lastKeyLine = @{}
    if (Test-Path -LiteralPath $keyLog) {
      foreach ($line in (Get-Content -LiteralPath $keyLog -Encoding utf8)) {
        if ($line -like '*| key-inherit |*') {
          $ck = if ($line -match 'child=([a-z0-9-]+)') { $Matches[1] } else { $null }
          $fk = if ($line -match 'from=([a-z0-9-]+)') { $Matches[1] } else { $null }
          if ($ck -and $fk) { $inheritFrom[$ck] = $fk }
        }
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
      # 2026-11-15：通行证齐全不等于贴得上去 —— 贴要 WRITE_OWNER，而它来自家根上的显式 ACE。
      if (-not (Test-WorkspaceProvisionRights ([string]$m.home))) {
        Add-Row ('家根权限（' + $fishName + '）') 'WARN' '家根没有当前用户的完全控制：沙箱贴通行证要 WRITE_OWNER，鱼会连 pwsh 都起不来' ('NEXT: pwsh -File scripts/fish.ps1 acl-repair ' + $prop.Name)
      } else {
        Add-Row ('家根权限（' + $fishName + '）') 'OK' '家根有当前用户的完全控制（沙箱贴通行证的前置）'
      }
      # 2026-11-16：DACL 只是通行证的一半；另一半是完整性标签（沙箱里的 pwsh 是 Low）。
      $labelGaps = @(Get-WorkspaceLabelGaps $probe)
      if ($labelGaps.Count -gt 0) {
        Add-Row ('完整性标签（' + $fishName + '）') 'WARN' ("{0} 个对象缺 Low 标签（DACL 允许、pwsh 仍写不进）" -f $labelGaps.Count) ('NEXT: pwsh -File scripts\fish.ps1 acl-repair ' + $prop.Name)
      } else {
        Add-Row ('完整性标签（' + $fishName + '）') 'OK' '家目录树都有 Low 标签（沙箱里 pwsh 写权限的另一半）'
      }
      if ($m.dshHome) {
        $cred = Join-Path ([string]$m.dshHome) '.credentials.yaml'
        if (Test-Path -LiteralPath $cred) {
          $fp = Get-FileFingerprint $cred
          $keyFps[$prop.Name] = $fp
          $keyNameOf[$prop.Name] = $fishName
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
  # 跨鱼钥匙：doctor 只比"自己 vs 自己上次"，两条鱼共用一把 key 时账上一路 OK（2026-11-16 第三、四条鱼发现）。
  # 这不是 FAIL —— 继承是有意设计（keys.log 的 key-inherit 会记）；但它一定是有后果的事实，要说出来。
  $fpGroups = @($keyFps.GetEnumerator() | Group-Object Value | Where-Object { $_.Count -gt 1 })
  if ($fpGroups.Count -gt 0) {
    foreach ($g in $fpGroups) {
      $members = @($g.Group | ForEach-Object { [string]$_.Key })
      $roots = @($members | Where-Object { -not $inheritFrom.ContainsKey($_) -or ($members -notcontains $inheritFrom[$_]) })
      $explained = ($roots.Count -eq 1) -and @($members | Where-Object { $_ -ne $roots[0] -and ($members -contains $inheritFrom[$_]) }).Count -eq ($members.Count - 1)
      $who = ($members | ForEach-Object { $keyNameOf[$_] + '（' + $_ + '）' }) -join '、'
      if ($explained) {
        $childDesc = ($members | Where-Object { $_ -ne $roots[0] } | ForEach-Object { $_ + ' ← ' + $inheritFrom[$_] }) -join '、'
        Add-Row '钥匙（跨鱼）' 'OK' ("{0} 共用同一把钥匙（指纹 {1}）：有意继承（{2}，有 key-inherit 记录）" -f $who, $g.Name, $childDesc)
      } else {
        Add-Row '钥匙（跨鱼）' 'WARN' ("{0} 共用同一把钥匙（指纹 {1}）：会互相抢同一份额度，且账上没有继承记录" -f $who, $g.Name) 'NEXT: 若是有意的，用 fish.ps1 key grant 记账；不想共用就让宿主在各自网页里填各自的 key'
      }
    }
  } else {
    Add-Row '钥匙（跨鱼）' 'OK' '各条鱼的钥匙指纹各不相同'
  }
} catch {
  Add-Row '通行证' 'WARN' ('查不了：' + $_.Exception.Message)
}

# 8f. 身份纸四路对齐（2026-11-16 r190）
#     三条鱼的身份纸曾各自指向不同的错家：install.ps1 用「安装参数」写 AGENTS.md，
#     而 render-env.mjs 用「名册」写 环境.md —— 同一件事两个来源；而且那行只在文件不存在时写，
#     错了就永远是错的。所以这一格不看"某一份纸对不对"，看四路能不能对上：
#       ① members.json 的 home  ② AGENTS.md 里写出的家  ③ START.md 实际所在的目录  ④ 运行记录里的 selfHome
#     前三条都是纸（纸可以一致地错），只有 ④ 是"机器实际在哪儿"；④ 自己先要过不变式
#     （home == selfHome + \dsh-home 且 cwd == selfHome），不成立就别拿它裁决别人。
try {
  if ($Cfg.MembersFile -and (Test-Path -LiteralPath $Cfg.MembersFile)) {
    $rosterIdPaper = (Get-Content -LiteralPath $Cfg.MembersFile -Raw -Encoding utf8 | ConvertFrom-Json).members
    $bootPathPaper = Join-Path $PSScriptRoot '..\logs\plugin-boot.log'
    $bootLinesPaper = @()
    if (Test-Path -LiteralPath $bootPathPaper) {
      $bootLinesPaper = @(Get-Content -LiteralPath $bootPathPaper -Encoding utf8 | ForEach-Object {
        try { $_ | ConvertFrom-Json } catch { $null }
      } | Where-Object { $_ })
    }
    # 两边都可能是反引号/引号/中文句号收尾，所以只认"第一个 Windows 绝对路径"。
    $rxPaperHome = '([A-Za-z]:\\[^' + [char]0x0060 + [char]0x0022 + [char]0x3002 + '\r\n]+)'
    foreach ($prop in $rosterIdPaper.PSObject.Properties) {
      $m = $prop.Value
      if ($m.kind -ne 'fish' -or $m.role -eq 'watcher' -or -not $m.home) { continue }
      $fishName = if ($m.name) { [string]$m.name } else { $prop.Name }
      $homePaper = [System.IO.Path]::GetFullPath([string]$m.home).TrimEnd('\')
      $dshPaper = if ($m.dshHome) { [System.IO.Path]::GetFullPath([string]$m.dshHome) } else { Join-Path $homePaper 'dsh-home' }
      $agentsPaper = Join-Path $dshPaper 'AGENTS.md'

      $agentsHomePaper = ''
      if (Test-Path -LiteralPath $agentsPaper) {
        try {
          $oneLine = (Get-Content -LiteralPath $agentsPaper -Encoding utf8 -ErrorAction Stop | Where-Object { $_ -match '家在' }) | Select-Object -First 1
          if ($oneLine -and $oneLine -match $rxPaperHome) { $agentsHomePaper = ([string]$Matches[1]).TrimEnd('\') }
        } catch { }
      }

      $bad = @()
      if (-not (Test-Path -LiteralPath $agentsPaper)) { $bad += '没有 AGENTS.md' }
      elseif (-not $agentsHomePaper) { $bad += 'AGENTS.md 里解析不出家' }
      elseif ($agentsHomePaper -ine $homePaper) { $bad += ('身份纸=' + $agentsHomePaper) }

      if (-not (Test-Path -LiteralPath (Join-Path $homePaper 'START.md'))) { $bad += '家里没有 START.md' }

      $bootHomePaper = ''
      $bootBadPaper = ''
      $hit = $bootLinesPaper | Where-Object { $_.profile -and ([string]$_.profile) -ieq ([string]$m.profile) -and $_.selfHome } | Select-Object -Last 1
      if ($hit) {
        $sh = ([string]$hit.selfHome).TrimEnd('\')
        $bh = [string]$hit.home
        $cw = [string]$hit.cwd
        if ($bh -ieq ($sh + '\dsh-home') -and $cw -ieq $sh) { $bootHomePaper = $sh }
        else { $bootBadPaper = ('运行记录自身不一致：home={0} cwd={1} selfHome={2}' -f $bh, $cw, $sh) }
      }
      if ($bootBadPaper) { $bad += $bootBadPaper }
      elseif ($bootHomePaper -and $bootHomePaper -ine $homePaper) { $bad += ('运行 selfHome=' + $bootHomePaper) }

      if ($bad.Count -eq 0) {
        $suffix = if ($bootHomePaper) { '（含运行记录）' } else { '（还没有启动痕迹，只对三路）' }
        Add-Row ('身份纸（' + $fishName + '）') 'OK' ('四路一致：' + $homePaper + $suffix)
      } else {
        Add-Row ('身份纸（' + $fishName + '）') 'WARN' (('名册=' + $homePaper + '；') + ($bad -join '；')) ('NEXT: pwsh -File scripts\install.ps1 -RepairAgents -ChildMemberId ' + $prop.Name)
      }
    }
  }
} catch {
  Add-Row '身份纸' 'WARN' ('查不了：' + $_.Exception.Message)
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
        $hits = @($bootLines | Where-Object {
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
        })
        # 2026-11-16 第五份沉淀 P6：宿主的启动行 selfHome 也等于鱼的家（宿主用鱼的配置跑），
        # 只按路径取"最后一条"会取到宿主的 pid。鱼自己的行有 profile 字段，优先按它过滤。
        # 2026-11-16 第五份沉淀 N1：宿主进程可能没设 DSH_PROFILE（启动行 profile 是 "(unset)"，
        # 早年还可能带着继承来的 "web"）。watcher 整类不过滤 profile，只按家匹配；鱼才按 profile 收窄。
        if ($m.profile -and $m.role -ne 'watcher') {
          $byProfile = @($hits | Where-Object { [string]$_.profile -ieq [string]$m.profile })
          if ($byProfile.Count -gt 0) { $hits = $byProfile }
        }
        $hit = $hits | Select-Object -Last 1
        if ($hit) { $bootText = ('pid={0} pkg={1}' -f $hit.pid, $hit.pkg) }
      }

      $pinText = '名册里没有会话'
      if ($pins -and $pins.PSObject.Properties.Name -contains $key) {
        $ids = @($pins.$key | Where-Object { $_ })
        if ($ids.Count -gt 0) { $pinText = ('会话 {0} 段' -f $ids.Count) }
      }

      # 严重度只看事实，不看出身：归档的跳过，活着的端口不通就是 FAIL。
      $state = 'OK'
      $why = @()
      if ([string]$m.lifecycle -eq 'archived') { $state = 'INFO'; $why += '已归档，不查' }
      elseif (-not $portOk) { $state = 'FAIL'; $why += '端口不通' }
      if ($pinText -eq '名册里没有会话') {
        if (Test-EverHadSession $m) { $state = 'FAIL'; $why += '名册缺会话' }
        else { if ($state -eq 'OK') { $state = 'INFO' }; $why += '还没醒过（从没有过会话）' }
      }
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

# 9d. 出生账（births.log）：账上多一条看得见，少一条看不见——除非账本自己说了从哪天起是完整的。
#     第三条鱼 2026-11-15 22:25：我这边这本账是空的；第四条鱼补：先让它自己说 since，否则"鱼数=行数"永远 FAIL。
#     第三条鱼 22:32 再补两刀：同日出生的按日期精度是 undecidable（不能算进 expected），"欠账"要能机器数——所以这一行输出结构化字段。
#     第三条鱼 22:39：字段名按**判据**命名，不按读者命名——expected/prior 是"谁在乎"，due-after-since/before-since 是"怎么算的"。
try {
  $birthsLog = Join-Path $Cfg.PoolState 'births.log'
  if (-not (Test-Path -LiteralPath $birthsLog)) {
    Add-Row '出生账' 'INFO' '还没有 births.log（记账之后还没有鱼出生）'
  } else {
    $bLines = @(Get-Content -LiteralPath $birthsLog -Encoding utf8)
    $fmtLine = @($bLines | Where-Object { $_ -match '\| log-format \|' }) | Select-Object -Last 1
    if (-not $fmtLine) {
      Add-Row '出生账' 'WARN' 'births.log 没有 log-format since 标记：这本账记不了"少"，只能记得住"多"' 'NEXT: 往 births.log 追加一行 log-format（格式见 docs/detail/日志都记在哪.md）'
    } else {
      $sinceText = if ([string]$fmtLine -match 'since=([0-9T:\-\.Z]+)') { $matches[1] } else { $null }
      if (-not $sinceText) {
        Add-Row '出生账' 'WARN' 'births.log 的 log-format 行没有 since=' 'NEXT: 补一个 since= 时间戳'
      } else {
        $since = try { [datetimeoffset]::Parse($sinceText).LocalDateTime } catch { $null }
        if (-not $since) {
          Add-Row '出生账' 'WARN' ('births.log 的 since 读不了：{0}' -f $sinceText)
        } else {
          $mf = $Cfg.MembersFile
          $members = if ($mf -and (Test-Path -LiteralPath $mf)) { (Get-Content -LiteralPath $mf -Raw -Encoding utf8 | ConvertFrom-Json).members } else { $null }
          $dueAfterSince = @()
          $sameDay = @()
          $beforeSince = @()
          if ($members) {
            foreach ($p in $members.PSObject.Properties) {
              if ($p.Value.kind -ne 'fish' -or -not $p.Value.bornAt) { continue }
              $born = $null
              try { $born = [datetime]::ParseExact([string]$p.Value.bornAt, 'yyyy-MM-dd', $null) } catch { $born = $null }
              if (-not $born) { continue }
              if ($born.Date -gt $since.Date) { $dueAfterSince += $p.Name }
              elseif ($born.Date -eq $since.Date) { $sameDay += $p.Name }
              else { $beforeSince += $p.Name }
            }
          }
          $onLedger = @($bLines | Where-Object { $_ -match '\| birth \|' } | ForEach-Object { if ($_ -match 'key=([a-z0-9-]+)') { $matches[1] } } | Where-Object { $_ })
          $missingAfterSince = @($dueAfterSince | Where-Object { $onLedger -notcontains $_ })
          $beforeSinceOnLedger = @($beforeSince | Where-Object { $onLedger -contains $_ })
          $dash = { param($a) if ($a.Count -eq 0) { '-' } else { $a -join ',' } }
          $note = ('since={0} due-after-since={1} missing-after-since={2} missing-keys={3} on-ledger={4} before-since={5} before-since-keys={6} before-since-on-ledger={7} undecidable-same-day={8} undecidable-keys={9}' -f $sinceText, $dueAfterSince.Count, $missingAfterSince.Count, (& $dash $missingAfterSince), $onLedger.Count, $beforeSince.Count, (& $dash $beforeSince), $beforeSinceOnLedger.Count, $sameDay.Count, (& $dash $sameDay))
          if ($missingAfterSince.Count -gt 0) {
            Add-Row '出生账' 'WARN' (('since 之后缺出生行：{0} | {1}' -f ($missingAfterSince -join ', '), $note)) ('NEXT: 查 pool\state\births.log 为什么少了这些键（{0}）' -f ($missingAfterSince -join ','))
          } else {
            Add-Row '出生账' 'OK' $note
          }
        }
      }
    }
  }
} catch { Add-Row '出生账' 'WARN' ('核不了：{0}' -f $_.Exception.Message) }

# 9c. 格式分界（巡守账本）：分界行只在启动时写，而"启动"不是必然事件。
#     小鱼丸 2026-11-15 19:08：别让补强变成唯一 —— 但不能让它的缺席也看不见。
#     2026-11-16 02:0x：按"一家一本"逐鱼检查；日志轮转会改名当前文件，新文件开头没有分界行是轮转的正常样子，
#     只要最近轮转的那份里有分界行就算同一格式延续（否则每次轮转都会误报一次 WARN）。
try {
  $boundary = '2026-11-15 18:35'
  $members9c = @()
  if ($Cfg.MembersFile -and (Test-Path -LiteralPath $Cfg.MembersFile)) {
    $members9c = @((Get-Content -LiteralPath $Cfg.MembersFile -Raw -Encoding utf8 | ConvertFrom-Json).members.PSObject.Properties |
      Where-Object { $_.Value.kind -eq 'fish' -and $_.Value.home })
  }
  foreach ($prop9c in $members9c) {
    $m = $prop9c.Value
    $wmPath = Join-Path ([string]$m.home) 'logs\watchman.log'
    if (-not (Test-Path -LiteralPath $wmPath)) { continue }
    $tail = @(Get-Content -LiteralPath $wmPath -Encoding utf8 -Tail 3000)
    $hasFmt3 = @($tail | Where-Object { $_ -match '\| log-format \| fmt=3' }).Count -gt 0
    $label = '{0}（{1}）' -f $m.name, $prop9c.Name
    if ($hasFmt3) {
      Add-Row '格式分界' 'OK' ($label + '：有 log-format 分界行')
      continue
    }
    $lateAny = @($tail | Where-Object { $_ -match '^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})' -and [string]$matches[1] -gt $boundary }).Count -gt 0
    if (-not $lateAny) {
      Add-Row '格式分界' 'INFO' ($label + '：还没有 18:35 之后的行，分界未到')
      continue
    }
    $logsDir = Join-Path ([string]$m.home) 'logs'
    $rotatedWithFmt = $false
    try {
      $rotated = @(Get-ChildItem -LiteralPath $logsDir -Filter 'watchman.*.log' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 3)
      foreach ($r in $rotated) {
        $rTail = @(Get-Content -LiteralPath $r.FullName -Encoding utf8 -Tail 400)
        if (@($rTail | Where-Object { $_ -match '\| log-format \| fmt=3' }).Count -gt 0) { $rotatedWithFmt = $true; break }
      }
    } catch { }
    # 2026-11-16 02:19（第四条鱼 #724 收回 + 判据更正）：不拿"启动版本 vs 磁盘版本"当"写者在不在"——
    # 磁盘版本会因为跟分界无关的改动上涨（改一句文案也算），版本不同只在"一次改动恰好重合"时等于"写者不在"。
    # 改成绑"写者引入的那一刻"：LOG_FORMAT_SINCE；并把版本写成有名字的常量（数字不会说话，注解会）。
    $logFormatSince = '1.6.39'   # 自这一版起：每个进程在 apply() 开头各写自己那份 log-format（此前只有巡守写，且只写它注视的那一家）
    function Test-VerAtLeast([string]$ver, [string]$atLeast) {
      try {
        $v = [version]($ver -replace '[+-].*$', '')
        $a = [version]($atLeast -replace '[+-].*$', '')
        return ($v -ge $a)
      } catch { return $null }
    }
    $bootVer9c = $null
    $bootSeen9c = $false
    try {
      $bootPath9c = Join-Path $Cfg.Root 'logs\plugin-boot.log'
      if (Test-Path -LiteralPath $bootPath9c) {
        $myHome9c = [string]$m.dshHome
        foreach ($ln9c in @(Get-Content -LiteralPath $bootPath9c -Encoding utf8)) {
          try {
            $o9c = $ln9c | ConvertFrom-Json
            if (-not $o9c.pkg) { continue }
            if ($myHome9c -and $o9c.home -and (([string]$o9c.home).TrimEnd('\') -ieq $myHome9c.TrimEnd('\'))) {
              $bootVer9c = [string]$o9c.pkg -replace '^.*@', ''
              $bootSeen9c = $true
            }
          } catch { }
        }
      }
    } catch { }
    if ($rotatedWithFmt) {
      Add-Row '格式分界' 'OK' ($label + '：分界行在被轮转的旧文件里（轮转后新文件不重复写）')
    } elseif (-not $bootSeen9c) {
      Add-Row '格式分界' 'INFO' ($label + '：本文件还没有分界行，这一家也还没有启动痕迹（第三种状态）——等它先启动一次')
    } elseif (-not $bootVer9c) {
      Add-Row '格式分界' 'INFO' ($label + '：本文件还没有分界行——启动版本读不到，判不了"还没到"还是"丢了"（不猜）')
    } elseif ($null -eq (Test-VerAtLeast $bootVer9c $logFormatSince)) {
      Add-Row '格式分界' 'INFO' ($label + '：本文件还没有分界行——启动版本 ' + $bootVer9c + ' 解析不了，判不了')
    } elseif (-not (Test-VerAtLeast $bootVer9c $logFormatSince)) {
      Add-Row '格式分界' 'INFO' ($label + '：本文件还没有分界行——进程还是旧代码（启动 ' + $bootVer9c + '，' + $logFormatSince + ' 起才每个进程各写自己那份），属"还没到"，重启后自愈')
    } else {
      Add-Row '格式分界' 'WARN' ($label + '：进程已经是带分界的代码（启动 ' + $bootVer9c + ' ≥ ' + $logFormatSince + '）却没有 log-format 行——这不像"还没到"，像真丢了') 'NEXT: 重启这一条鱼（fish.ps1 down <键> -Yes; fish.ps1 up <键> -NoBrowser）'
    }
  }
} catch { Add-Row '格式分界' 'WARN' ('核不了：{0}' -f $_.Exception.Message) }

# 9b. 工具数（每条鱼）：账本里只有数字，但"变少"本身就是一条该报的事。
#     第三条鱼 2026-11-15 19:05：工具消失是静默的，能加一行检查就加一行。
try {
  $plugLog = Join-Path $Cfg.GroupDir 'plugin.log'
  if ((Test-Path -LiteralPath $plugLog) -and $Cfg.MembersFile -and (Test-Path -LiteralPath $Cfg.MembersFile)) {
    $toolRows = @(Get-Content -LiteralPath $plugLog -Encoding utf8 -Tail 4000 | ForEach-Object {
      try { $_ | ConvertFrom-Json } catch { $null }
    } | Where-Object { $_ -and $_.note -eq 'wake-agent-tools' -and $_.member })
    $tm = (Get-Content -LiteralPath $Cfg.MembersFile -Raw -Encoding utf8 | ConvertFrom-Json).members
    foreach ($p in $tm.PSObject.Properties) {
      if ($p.Value.kind -ne 'fish') { continue }
      $k = $p.Name
      $mine = @($toolRows | Where-Object { $_.member -eq $k })
      if ($mine.Count -lt 2) {
        Add-Row '工具数（全鱼）' 'INFO' ('{0}（{1}）：记录不足两次，看不出增减' -f $p.Value.name, $k)
        continue
      }
      $prevN = [int]$mine[-2].toolCount; $curN = [int]$mine[-1].toolCount
      if ($curN -lt $prevN) {
        Add-Row '工具数（全鱼）' 'WARN' ('{0}（{1}）：{2} → {3}，少了 {4} 件（{5}）' -f $p.Value.name, $k, $prevN, $curN, ($prevN - $curN), ([string]$mine[-1].at)) 'NEXT: dsh --profile <键> --dump-config | Select-String dsh-lil-whale-group（看她插件掉没掉）'
      } else {
        Add-Row '工具数（全鱼）' 'OK' ('{0}（{1}）：{2} 件（上次 {3}）' -f $p.Value.name, $k, $curN, $prevN)
      }
    }
  }
} catch { Add-Row '工具数（全鱼）' 'WARN' ('核不了：{0}' -f $_.Exception.Message) }

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
