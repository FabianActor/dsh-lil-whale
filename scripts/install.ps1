# install.ps1 -- 给别人装一条小鲸鱼。ASCII 文件名 + UTF-8 BOM。
#
#   pwsh -File install.ps1                                 装到仓库旁边的 lil-whale/
#   pwsh -File install.ps1 -Workspace D:\fish               装到指定目录
#   pwsh -File install.ps1 -ChildSessionId session-xxx      顺手把她的会话 id 写进名册
#   pwsh -File install.ps1 -SkipParent                      只装她，不动你这边的主 profile
#   pwsh -File install.ps1 -Force                           目标目录已经像"她的家"时仍然继续
#
# 它做什么：建目录 -> 建她自己的 DSH_HOME 与 profile -> 装插件 -> 写配置 -> 放种子文件 -> 验一遍。
# 它不做什么：不申请 API key（要人在她自己的网页里填）、不建会话、不写第一句话（那句得由人说）。
#
# 退出码：0 = 装好了；1 = 中途停下（每一步都打印了什么没成，最后一行是给人和模型看同一句 NEXT）。

param(
  [string]$Workspace = '',
  [string]$DshHome = '',
  [string]$ChildProfile = 'whale',
  [string]$ChildName = '小鲸鱼',      # 她的名字：只写进 AGENTS.md 的一行，不写进性格
  [string]$ChildMemberId = '',    # 名册里的键；空 = 跟 profile 同名
  [string]$ParentProfile = 'web',
  [int]$ChildPort = 0,                 # 0 = 从 3082 起找第一个空口
  [string]$ParentSessionId = '',
  [string]$ChildSessionId = '',
  [switch]$SkipParent,
  [switch]$Force,
  [string]$ConfigPath = '',  # 配置写到哪；空 = <仓库根>\lil-whale.config.json。试装必须指到临时目录
  [string]$PoolDir = ''      # 共享区（群/账本/私聊）；空 = 她家旁边同级的 lil-whale-pool
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path $PSScriptRoot -Parent
$TemplateRoot = Join-Path $RepoRoot 'templates'
$PoolRoot = if ($PoolDir -ne '') { $PoolDir } else { Join-Path (Split-Path $Workspace -Parent) 'lil-whale-pool' }

function Say([string]$text) { Write-Host $text }
function Step([string]$text) { Write-Host ""; Write-Host ("== " + $text) -ForegroundColor Cyan }
function Ok([string]$text)   { Write-Host ("   ok   " + $text) -ForegroundColor Green }
function Warn([string]$text) { Write-Host ("   !!   " + $text) -ForegroundColor Yellow }
function Note([string]$text) { Write-Host ("   .    " + $text) -ForegroundColor DarkGray }
function Die([string]$text, [string]$next) {
  Write-Host ("   xx   " + $text) -ForegroundColor Red
  Write-Host ""
  Write-Host ("   NEXT: " + $next) -ForegroundColor Yellow
  exit 1
}

# 只有 .json 不能带 BOM（dsh 的加载器会拒绝），其它都按 UTF-8 无 BOM 写。
function Write-Utf8NoBom([string]$path, [string]$text) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $enc)
}

function Test-Port([int]$port) {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', $port); return $true } catch { return $false } finally { $c.Dispose() }
}

# 安装期定口：从 3082 起找第一个现在没人听的口。
# 注意这只保证"install 这一刻"是空的；真占用了会在启动时 listen EADDRINUSE，那一步的提示见 README。
function Find-FreePort([int]$start) {
  for ($p = $start; $p -lt $start + 50; $p++) {
    if (-not (Test-Port $p)) { return $p }
  }
  return 0
}

# 渲染模板：{{KEY}} -> 值。模板里没有的键会被留下（一眼能看出来漏了）。
function Render-Template([string]$templatePath, [hashtable]$values) {
  $text = [System.IO.File]::ReadAllText($templatePath)
  foreach ($k in $values.Keys) {
    $text = $text.Replace('{{' + $k + '}}', [string]$values[$k])
  }
  return $text
}

if (-not $Workspace) { $Workspace = Join-Path (Split-Path $RepoRoot -Parent) 'lil-whale' }
if (-not $DshHome) { $DshHome = Join-Path $Workspace 'dsh-home' }
$Workspace = [System.IO.Path]::GetFullPath($Workspace)
$DshHome = [System.IO.Path]::GetFullPath($DshHome)

$portWanted = if ($ChildPort -gt 0) { $ChildPort } else { 3082 }
$port = Find-FreePort $portWanted
if ($port -eq 0) { Die "从 $portWanted 往上 50 个口都被占了。" "换 -ChildPort 指定一个空口，然后重跑 install.ps1" }

Say ""
Say "  小小肥鱼  --  安装"
Say "  仓库         $RepoRoot"
Say "  她的家（工作区）$Workspace"
Say "  她的 DSH_HOME $DshHome"
Say "  她的窗       127.0.0.1:$port   (profile: $ChildProfile)"
Say "  你的 profile  $ParentProfile$([bool]$SkipParent ? '  (跳过)' : '')"
if ($port -ne $portWanted) { Warn "端口 $portWanted 被占，改用 $port（已写进配置，运行期不会再变）" }

Step '0. 环境检查'
$dsh = Get-Command dsh -ErrorAction SilentlyContinue
if (-not $dsh) { Die '找不到 dsh 命令。' '先装 DeepSeek Harness：npm i -g @deepseek-ai/dsh，然后重跑 install.ps1' }
$ver = (& dsh --version 2>&1 | Select-Object -First 1)
Ok "dsh $ver"
foreach ($rel in @('plugin\dsh-group\package.json', 'plugin\dsh-group-ui\package.json', 'templates\START.md.tpl')) {
  if (-not (Test-Path (Join-Path $RepoRoot $rel))) {
    Die "仓库不完整：找不到 $rel。" "确认你跑的是完整的项目仓库（git clone 下来那份），不是只有几个文件"
  }
}
Ok '仓库结构正常'

Step '1. 目录'
if (Test-Path -LiteralPath $Workspace) {
  $looksLikeHer = (Test-Path (Join-Path $Workspace 'START.md')) -or (Test-Path (Join-Path $Workspace 'dsh-home'))
  if ($looksLikeHer -and -not $Force) {
    Die "「$Workspace」已经像一条鱼的家了（有 START.md 或 dsh-home）。" "换 -Workspace 指向一个新目录；如果你确定要在这里重铺（会覆盖 START.md / 环境.md），加 -Force"
  }
}
foreach ($d in @($Workspace, (Join-Path $Workspace 'logs'), (Join-Path $Workspace 'plan'),
                 (Join-Path $Workspace 'run'), $DshHome, $PoolRoot,
                 (Join-Path $PoolRoot 'group'), (Join-Path $PoolRoot 'state'), (Join-Path $PoolRoot 'dm'))) {
  if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}
Ok "建好了她家的目录和共享区（$PoolRoot）"

# 她家里只放两个 Junction：group / state 的真身在共享区（PRD A.22）。
# 为什么不是真目录：群和账本是共享的，第二条鱼出现时，第二条的群文件写进第一条的家就是越界。
foreach ($link in @('group', 'state')) {
  $path = Join-Path $Workspace $link
  $target = Join-Path $PoolRoot $link
  if (Test-Path -LiteralPath $path) {
    $item = Get-Item -LiteralPath $path -Force
    if ($item.LinkType -eq 'Junction') { Ok "junction $link（已存在）" }
    else { Warn "「$link」已存在且不是 Junction（旧安装？）；保留它，真身在 $target" }
  } else {
    New-Item -ItemType Junction -Path $path -Target $target | Out-Null
    Ok "junction $link -> $target"
  }
}

Step "2. 她的 profile（$ChildProfile）"
$savedHome = $env:DSH_HOME
try {
  $env:DSH_HOME = $DshHome
  $profileDir = Join-Path $DshHome "profiles\$ChildProfile"
  if (-not (Test-Path $profileDir)) {
    # 从自带的 web 模板复制：它正好是 base + web-app，她需要一个能开窗的 app。
    # 别用 headless 模板 —— headless + web-app 两个 app bundle 并存时，启动器会退化成"接受 0 参数"。
    $dump = & dsh --profile $ChildProfile --from-default-profile web --dump-config 2>&1
    if ($LASTEXITCODE -ne 0) {
      Die "建 profile 失败：$($dump | Select-Object -Last 3)" "确认 dsh 版本 >= 0.2（它才有 --from-default-profile），然后重跑 install.ps1"
    }
    Ok "从 web 模板建好 $profileDir"
  } else {
    Ok "profile 已存在，保留"
  }

  Step '3. 把群插件装进她的 profile'
  $add = & dsh plugin --profile $ChildProfile add "link:$RepoRoot\plugin\dsh-group" 2>&1
  if ($LASTEXITCODE -ne 0) {
    Die "装插件失败：$($add | Select-Object -Last 5)" "进 $DshHome\profiles\$ChildProfile 手动跑 dsh plugin add 看完整报错"
  }
  Ok 'lil-whale-group'
} finally {
  $env:DSH_HOME = $savedHome
}

if (-not $SkipParent) {
  Step "4. 把两个插件装进你的 profile（$ParentProfile）"
  try {
    $env:DSH_HOME = $savedHome
    $add1 = & dsh plugin --profile $ParentProfile add "link:$RepoRoot\plugin\dsh-group" 2>&1
    if ($LASTEXITCODE -ne 0) {
      Die "装 lil-whale-group 失败：$($add1 | Select-Object -Last 5)" "确认你的 profile 名对（默认 web），或用 -SkipParent 只装她"
    }
    $add2 = & dsh plugin --profile $ParentProfile add "link:$RepoRoot\plugin\dsh-group-ui" 2>&1
    if ($LASTEXITCODE -ne 0) {
      Die "装 lil-whale-group-ui 失败：$($add2 | Select-Object -Last 5)" "同上"
    }
    Ok 'lil-whale-group + lil-whale-group-ui'
    Warn "装好以后要重启一次你的 dsh，界面才认这两个插件"
  } finally {
    $env:DSH_HOME = $savedHome
  }
}

Step '5. 写配置'
# 合并写，不是覆盖写：已有的字段（repoRoot / herWaker / pwshExe …）原样留着，
# 否则在装好的机器上重跑一次 install，会把这份配置里手写的东西全丢掉。
$cfgPath = if ($ConfigPath -ne '') { $ConfigPath } else { Join-Path $RepoRoot 'lil-whale.config.json' }
if ((Test-Path $cfgPath) -and -not $Force) {
  try {
    $existing = [System.IO.File]::ReadAllText($cfgPath) | ConvertFrom-Json -AsHashtable
    $liveHome = [string]$existing['herHome']
    if ($liveHome -ne '' -and $liveHome -ne $Workspace) {
      Die "这份配置已经指向一个真实的家（$liveHome），而这次要写成 $Workspace" "确认要覆盖就加 -Force；只是想试装就加 -ConfigPath <临时文件>"
    }
  } catch { }
}
$cfg = [ordered]@{}
if (Test-Path $cfgPath) {
  try {
    $old = [System.IO.File]::ReadAllText($cfgPath) | ConvertFrom-Json -AsHashtable
    if ($old) { foreach ($k in $old.Keys) { $cfg[$k] = $old[$k] } }
  } catch {
    Warn "旧配置读不动（$($_.Exception.Message)），这次整份重写"
    $cfg = [ordered]@{}
  }
}
if (-not $cfg.Contains('_说明')) {
  $cfg['_说明'] = '这台机器上所有"会变的假设"集中在这里。代码和脚本都不许再写死绝对路径 —— 打包给别人时只改这一个文件（或用环境变量 LIL_WHALE_CONFIG 指向另一份）。字段含义见 docs/打包.md。'
}
$cfg['herHome'] = $Workspace
$cfg['herDshHome'] = $DshHome
$cfg['whaleProfile'] = $ChildProfile
$cfg['leeProfile'] = $ParentProfile
$cfg['herPort'] = $port
$cfg['poolDir'] = $PoolRoot
$cfg['poolStateDir'] = (Join-Path $PoolRoot 'state')
$cfg['dmDir'] = (Join-Path $PoolRoot 'dm')
$cfg['membersFile'] = (Join-Path $PoolRoot 'members.json')
Write-Utf8NoBom $cfgPath ($cfg | ConvertTo-Json -Depth 5)
Ok $cfgPath
Note "这份配置是这台机器的真源；装完别删。要装到别的目录，用 -ConfigPath 指到别处"

Step '6. 种子文件（不写性格、不写期望）'
$deployDate = Get-Date -Format 'yyyy-MM-dd'

# 闸门参数从插件源码里读，免得这张纸和实现漂移；读不到就用默认值。
$wakeSrc = ''
$groupSrc = Join-Path $RepoRoot 'plugin\dsh-group\lib\index.js'
if (Test-Path $groupSrc) { $wakeSrc = [System.IO.File]::ReadAllText($groupSrc) }
$cooldown = 60; $perHour = 12; $perDay = 60; $quietFrom = 0; $quietTo = 8
# 必须用 -cmatch：PowerShell 的 -match 默认不区分大小写，会先把 maxWakesPerDay: 8 当成 perDay 抓走。
if ($wakeSrc -cmatch 'cooldownSec:\s*(\d+)') { $cooldown = [int]$Matches[1] }
if ($wakeSrc -cmatch '(?<![A-Za-z])perHour:\s*(\d+)') { $perHour = [int]$Matches[1] }
if ($wakeSrc -cmatch '(?<![A-Za-z])perDay:\s*(\d+)') { $perDay = [int]$Matches[1] }
if ($wakeSrc -cmatch 'quietFromHour:\s*(\d+)') { $quietFrom = [int]$Matches[1] }
if ($wakeSrc -cmatch 'quietToHour:\s*(\d+)') { $quietTo = [int]$Matches[1] }

$values = @{
  HER_HOME = $Workspace
  HER_DSH_HOME = $DshHome
  HER_PORT = $port
  GROUP_DIR = (Join-Path $PoolRoot 'group')
  COOLDOWN = $cooldown
  PER_HOUR = $perHour
  PER_DAY = $perDay
  QUIET_FROM = ('{0:00}:00' -f $quietFrom)
  QUIET_TO = ('{0:00}:00' -f $quietTo)
  TOKEN_PER_TURN = '180-200'
  CHILD_NAME = $ChildName
  DEPLOY_DATE = $deployDate
  PARENT_ID = 'lee'
  CHILD_ID = $(if ($ChildMemberId) { $ChildMemberId } else { $ChildProfile })
  HUMAN_ID = 'fabian'
  TOOLS = '- （工具清单没能自动生成，见下面那行提示）'
}

# 「你能做什么」必须从实际挂载的工具算出来，不能手写：
# 手写的目录一定会过期，而且过期时看起来跟没过期一样（2026-11-12 前的教训）。
$toolsScript = Join-Path $RepoRoot 'scripts\tools-from-profile.mjs'
if (Test-Path $toolsScript) {
  $savedHome = $env:DSH_HOME
  $env:DSH_HOME = $DshHome
  try {
    $raw = & node $toolsScript --profile $ChildProfile 2>$null
    $parsed = $raw | ConvertFrom-Json
  } catch {
    $parsed = $null
  } finally {
    if ($null -eq $savedHome) { Remove-Item Env:\DSH_HOME -ErrorAction SilentlyContinue } else { $env:DSH_HOME = $savedHome }
  }
  if ($parsed -and $parsed.ok -and @($parsed.tools).Count -gt 0) {
    $linesOfTools = @($parsed.tools | ForEach-Object { '- ' + $_.line })
    # 群发言不是 profile 里的工具，是插件给的；它的存在与否由同一次安装决定，所以写死在生成结果里。
    $linesOfTools += '- 在群里说话（`group_say`）'
    $values.TOOLS = ($linesOfTools -join "`r`n")
    Ok ("你能做什么：按实际组合算出 {0} 条（preset={1}）" -f @($parsed.tools).Count, $parsed.preset)
    if (@($parsed.skipped).Count -gt 0) {
      Note ("跳过 {0} 个：{1}" -f @($parsed.skipped).Count, (($parsed.skipped | ForEach-Object { $_.id + '(' + $_.why + ')' }) -join '; '))
    }
  } else {
    $reason = if ($parsed) { $parsed.reason } else { '跑不起来' }
    Warn "没能从 --dump-config 算出工具清单（$reason）。环境.md 里那一节会写成占位提示 —— 不影响安装，但装完最好自己看一眼。"
  }
} else {
  Warn "找不到 scripts\tools-from-profile.mjs，环境.md 的工具清单会写成占位提示。"
}

$startPath = Join-Path $Workspace 'START.md'
if (-not (Test-Path $startPath) -or $Force) {
  Write-Utf8NoBom $startPath (Render-Template (Join-Path $TemplateRoot 'START.md.tpl') $values)
  Ok 'START.md'
} else {
  Ok 'START.md 已存在，保留'
}

$envPath = Join-Path $Workspace '环境.md'
if (-not (Test-Path $envPath) -or $Force) {
  # 环境.md 由 scripts/render-env.mjs 生成：模板 + 现场数据（名册 / 真实工具清单 / 叫醒参数）。
  # 为什么不在 PowerShell 里拼：同一份文件必须有"重新生成"的入口，否则代码一改，纸就旧了
  # （2026-11-12 20:10 Fabian 提："有些描述放在小鱼的目录内"）。
  $envScript = Join-Path $RepoRoot 'scripts\render-env.mjs'
  if (Test-Path $envScript) {
    & node $envScript --workspace $Workspace --profile $ChildProfile --pool-dir $PoolRoot --her-port $ChildPort --deploy-date $deployDate --child-name $ChildName --child-id $ChildMemberId 2>&1 | ForEach-Object { Write-Host ('    ' + $_) }
    if ($LASTEXITCODE -ne 0) {
      Warn 'render-env.mjs 失败，环境.md 没写。装完手动跑一次：node scripts\render-env.mjs --workspace <家> --profile <profile>'
    } else {
      Ok '环境.md（模板 + 名册 + 真实工具清单；以后用 fish.ps1 refresh 重生成）'
    }
  } else {
    Warn '找不到 scripts\render-env.mjs，环境.md 没生成。'
  }
} else {
  Ok '环境.md 已存在，保留（要刷新：fish.ps1 refresh <鱼>）'
}

$agentsPath = Join-Path $DshHome 'AGENTS.md'
if (-not (Test-Path $agentsPath)) {
  Write-Utf8NoBom $agentsPath (Render-Template (Join-Path $TemplateRoot 'AGENTS.md.tpl') $values)
  Ok 'AGENTS.md'
}

# group 是共享区（Junction）时，messages/pins 属于整个鱼群，不属于这个新家。
# 这里曾经把 pins.json 初始化成 "lee: [] / whale: []" —— 正好写进共享区，把老鱼的名册整份抹掉
# （2026-11-12 装第二条鱼时真踩过：大肥鱼和小肥鱼同时"不在群里"，而且没有任何报错）。
$groupPath = Join-Path $Workspace 'group'
$sharedGroup = $false
try { $gi = Get-Item -LiteralPath $groupPath -ErrorAction Stop; if ($gi.LinkType) { $sharedGroup = $true } } catch { }
if ($sharedGroup) {
  Ok 'group 是共享区（Junction）：messages/pins 归共享区管，跳过初始化'
} else {
  $msgPath = Join-Path $Workspace 'group\messages.jsonl'
  if (-not (Test-Path $msgPath)) { Write-Utf8NoBom $msgPath ''; Ok 'group\messages.jsonl' }

  $pinsPath = Join-Path $Workspace 'group\pins.json'
  if (-not (Test-Path $pinsPath) -or $Force) {
    $parentIds = @(); $childIds = @()
    if ($ParentSessionId) { $parentIds += $ParentSessionId }
    if ($ChildSessionId) { $childIds += $ChildSessionId }
    $pins = [ordered]@{ lee = $parentIds; whale = $childIds }
    Write-Utf8NoBom $pinsPath (($pins | ConvertTo-Json -Depth 5) + "`n")
    if ($ChildSessionId -or $ParentSessionId) { Ok 'group\pins.json（已带会话 id）' }
    else { Ok 'group\pins.json（空的，出生后填）' }
  }
}

$planPath = Join-Path $Workspace 'plan\wake-plan.json'
if (-not (Test-Path $planPath)) { Write-Utf8NoBom $planPath "[]`n"; Ok 'plan\wake-plan.json（空的：她现在没有任何固定日程）' }

Step '7. 验一遍'
try {
  $env:DSH_HOME = $DshHome
  $dump = & dsh --profile $ChildProfile --dump-config 2>&1
  $rows = ($dump | Select-String -Pattern 'id: lil-whale-group' | Measure-Object).Count
  if ($LASTEXITCODE -ne 0 -or $rows -lt 1) {
    Die "她的 profile 没合成出群插件（dump 最后几行：$($dump | Select-Object -Last 3)）" "进 $DshHome\profiles\$ChildProfile 看 package.json 的 dsh.profile.bundles 里有没有 lil-whale-group"
  }
  Ok "她的 profile：$rows 行 lil-whale-group"
} finally {
  $env:DSH_HOME = $savedHome
}

Say ""
Say "  装好了。接下来的四件事脚本替不了：" -ForegroundColor Green
Say ""
Say "  1) 重启你的 dsh（装进你 profile 的两个插件要重启才生效）。"
Say "  2) 起她的窗：双击 scripts\bin\Run lil whale.cmd"
Say "     -- 它会打印她的网址，形如  http://127.0.0.1:$port/?token=xxxx"
Say "     -- token 是每次启动随机生成的，只印在那一行；自己敲 127.0.0.1:$port 会 401。"
Say "  3) 在她的网页里填她自己的 API key（设置 -> Models），别和你共用一把。"
Say "  4) 添加工作区 $Workspace ，在里面新建一段对话，然后由你说第一句话。"
Say ""
Say "  出生之后，还要两段会话 id 群才认人（脚本可以在装的时候用 -ParentSessionId / -ChildSessionId 直接写）："
Say "     侧边栏选中那段对话 -> 点 ··· -> 复制 Session ID"
Say "     她的那段写进 $pinsPath 的 whale，你的那段写进 lee"
Say ""
Say "  她不会有预设的性格：第一次醒来是什么样，取决于你写了什么、没写什么。" -ForegroundColor Gray
Say ""
