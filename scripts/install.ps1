#requires -Version 7.0
# install.ps1 -- 给别人装一条小鲸鱼。ASCII 文件名 + UTF-8 BOM。
#
#   pwsh -File install.ps1                                 装到仓库旁边的 lil-whale/
#   pwsh -File install.ps1 -Workspace D:\fish               装到指定目录
#   pwsh -File install.ps1 -ChildSessionId session-xxx      顺手把小鱼的会话 id 写进名册
#   pwsh -File install.ps1 -SkipParent                      不把两个插件装进你的主 profile（已有鱼塘加鱼、试装用；第一次安装别用）
#   pwsh -File install.ps1 -Force                           目标目录已经像"她的家"时仍然继续
#
# 它做什么：建目录 -> 建她自己的 DSH_HOME 与 profile -> 装插件 -> 写配置 -> 放种子文件 -> 验一遍。
# 它不做什么：不申请 API key（要人在她自己的网页里填）、不建会话、不写第一句话（那句得由人说）。
#
# 退出码：0 = 装好了；1 = 中途停下（每一步都打印了什么没成，最后一行是给人和模型看同一句 NEXT）。

param(
  [string]$Workspace = '',
  [string]$DshHome = '',
  [string]$ChildProfile = 'fish',
  [string]$ChildName = '小鱼',      # 她的名字：只写进 AGENTS.md 的一行，不写进性格
  [string]$ParentName = '宿主',     # 大鱼（巡守/宿主）在群里的显示名（第一次安装会问，别替用户决定）
  [string]$HumanName = '人类',      # 用户自己在群里的显示名（第一次安装会问）
  [string]$ChildMemberId = '',    # 名册里的键；空 = 跟 profile 同名
  [string]$ParentMemberId = 'host', # 家长/巡守的成员键（递归装第二代时改它）
  [string]$HumanMemberId = 'human', # 人类的成员键
  [string]$ParentProfile = 'web',
  [int]$ChildPort = 0,                 # 0 = 从 3082 起找第一个空口
  [string]$ParentSessionId = '',
  [string]$ChildSessionId = '',
  [Alias('SkipParentPlugins')][switch]$SkipParent,
  [switch]$Force,
  [switch]$RepairAgents,  # 只重写身份纸 AGENTS.md，其余一概不碰（2026-11-16 r190）
  [string]$PondRoot = '',  # 鱼塘根；空 = 按仓库位置推（仓库必须在 <鱼塘根>\app 里）（2026-11-16 r195）
  [switch]$RepoPrepared,   # 内部用：从复制过去的仓库继续装，别再复制一次
  [string]$ConfigPath = '',  # 配置写到哪；空 = <仓库根>\lil-whale.config.json。试装必须指到临时目录
  [string]$PoolDir = ''      # 共享区（群/账本/私聊）；空 = 她家旁边同级的 lil-whale-pool
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path $PSScriptRoot -Parent
$TemplateRoot = Join-Path $RepoRoot 'templates'

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

# --- 2026-11-16 r195：装之前先确认鱼塘根（P4/P10） ---
# 这个项目要装在 <鱼塘根>\app 里：pool/ 与 homes/ 是它的兄弟目录。
# 从桌面直接下载、在仓库里就装，会把 pool/ 与 homes/ 建到桌面去（第三方装机实测）。
if (-not $RepoPrepared) {
  $repoLeaf = Split-Path $RepoRoot -Leaf
  if ($repoLeaf -ne 'app') {
    if ([string]::IsNullOrWhiteSpace($PondRoot)) {
      # 2026-11-16 r199：安装目录不许静默选。能交互就问用户；不能交互（被 agent / 管道调用）就停下，
      # 并明确要求"先问用户"——第三方装机实测的 bug：agent 会把仓库和解出来的 pool/homes
      # 一起放进当前会话工作区（<workspace>\whale-src\），因为没人问过它该放哪。
      if ([Console]::IsInputRedirected) {
        Die "这个项目要装在 <鱼塘根>\app 里，当前仓库在：$RepoRoot" "先问用户：把鱼塘放在哪个目录（不要用当前会话的工作区，也别用下载目录），再运行：pwsh -File scripts\install.ps1 -PondRoot <鱼塘根>"
      }
      Say '这个项目要装在 <鱼塘根>\app 里：pool\ 与 homes\ 是它的兄弟目录。'
      Say '先定鱼塘根——不要装进当前会话的工作区，也别装进下载目录。'
      $defaultPond = Join-Path $env:USERPROFILE 'lil-whale'
      $answer = Read-Host "鱼塘根目录（直接回车用默认：$defaultPond）"
      if ([string]::IsNullOrWhiteSpace($answer)) { $answer = $defaultPond }
      $PondRoot = $answer
      if ([string]::IsNullOrWhiteSpace($PondRoot)) { Die '没有给出鱼塘根。' '重跑并指定 -PondRoot <目录>' }
      Say "鱼塘根：$PondRoot"
    }
    $pond = [System.IO.Path]::GetFullPath($PondRoot).TrimEnd('\')
    $target = Join-Path $pond 'app'
    if (-not (Test-Path $pond)) { New-Item -ItemType Directory -Path $pond -Force | Out-Null; Say "已新建鱼塘根：$pond" }
    if (-not (Test-Path $target)) { New-Item -ItemType Directory -Path $target -Force | Out-Null; Say "已新建仓库目录：$target" }
    $skipNames = @('pool', 'homes', 'logs', 'dist', 'tmp', '.git')
    $copied = 0
    Get-ChildItem -LiteralPath $RepoRoot -Force | Where-Object { $skipNames -notcontains $_.Name } | ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $target $_.Name) -Recurse -Force
      $copied += 1
    }
    Ok "已把仓库内容复制到 $target（$copied 项；跳过 pool/homes/logs/dist/tmp/.git）"
    $newScript = Join-Path $target 'scripts\install.ps1'
    if (-not (Test-Path $newScript)) {
      Die "复制后找不到 $newScript" "手动把仓库放到 $target 再运行 install.ps1"
    }
    $passArgs = @('-NoLogo', '-NoProfile', '-File', $newScript, '-PondRoot', $pond, '-RepoPrepared')
    foreach ($k in $PSBoundParameters.Keys) {
      if ($k -in @('PondRoot', 'RepoPrepared')) { continue }
      $v = $PSBoundParameters[$k]
      if ($v -is [System.Management.Automation.SwitchParameter]) {
        if ($v.IsPresent) { $passArgs += ('-' + $k) }
      } elseif ($null -ne $v -and ([string]$v) -ne '') {
        $passArgs += @(('-' + $k), [string]$v)
      }
    }
    Say ("从复制过去的那份继续安装：" + $newScript)
    & pwsh @passArgs
    exit $LASTEXITCODE
  }
  Note "鱼塘根：$(Split-Path $RepoRoot -Parent)（仓库就在 <鱼塘根>\app 里）"
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

# 布局（2026-11-13 17:00 起）：默认"鱼塘"结构 —— <pond>\app（仓库）/ pool（共享区）/ homes\<鱼> / acl。
# 仓库就在 <pond>\app 里时，新鱼装到 <pond>\homes\<成员键>，共享区用 <pond>\pool；
# 仓库不在 app\ 下（单克隆/老布局），退回"家旁边一个共享区"。
$PondRoot = Split-Path $RepoRoot -Parent
# 2026-11-16 第四份沉淀 P1：以前还要求 pool 目录已存在才认鱼塘布局——
# 首次安装时 pool 正是本脚本要建的，于是 $InPond 恒为 false，家落到 <鱼塘根>\lil-whale、
# 共享区落到同级 lil-whale-pool，巡守按 <鱼塘根>\homes 对账就会报"名册和家对不上"。
# 判据只看仓库在不在 app\ 里（pool 由本脚本创建）。
$InPond = ((Split-Path $RepoRoot -Leaf) -eq 'app')

# 2026-11-16 r215：第一次安装先问名字与成员键。
# 以前直接套默认值（小鱼 / 宿主 / 人类 + fish / host / human），代装的 agent 一句不问，
# 用户事后才发现"我群里叫人类"、巡守 id 是别人的鱼名。非交互（agent/管道）时不猜：
# 把该问的列出来并停下，让人先问用户，再带着参数重跑。
$earlyPool = if ($PoolDir -ne '') { $PoolDir } elseif ($InPond) { Join-Path $PondRoot 'pool' } else { Join-Path $PondRoot 'lil-whale-pool' }
$isFirstInstall = -not (Test-Path -LiteralPath (Join-Path $earlyPool 'members.json'))
if ($isFirstInstall -and -not $RepairAgents) {
  $interactiveInstall = -not [Console]::IsInputRedirected
  $childKeyAsked = if ($ChildMemberId) { $ChildMemberId } elseif ($PSBoundParameters.ContainsKey('ChildProfile')) { $ChildProfile } else { '' }
  # 2026-11-16 r216：第一条鱼的成员键固定为 fish（键=家目录，改它等于换家；第一次安装不开放）。
  if ($childKeyAsked -and $childKeyAsked -cne 'fish') {
    Die ('第一次安装时，第一条鱼的成员键固定是 fish（换它=换家目录）。你传了：{0}' -f $childKeyAsked) '装好之后再加鱼：pwsh -File scripts\fish.ps1 new -Key <键>'
  }
  if ($PSBoundParameters.ContainsKey('ChildProfile') -and $ChildProfile -cne 'fish') {
    Die ('第一次安装时，第一条鱼的 profile 也固定是 fish。你传了：{0}' -f $ChildProfile) '显示名用 -ChildName；profile 与家目录绑在一起，第一次安装不开放'
  }
  $ChildMemberId = 'fish'
  Note '下面问两种东西：名字=群里怎么称呼（随意改）；成员键=数据主键（小写 ASCII，进文件路径）。两项都能自定义，默认值只是省事。'
  $asks = @(
    [pscustomobject]@{ Var = 'ChildName'; Label = '小鱼的名字（群里怎么称呼她；默认「小鱼」，可改成别的中文名）'; Default = $ChildName; Have = $(if ($PSBoundParameters.ContainsKey('ChildName')) { $ChildName } else { '' }) },
    [pscustomobject]@{ Var = 'ParentName'; Label = '大鱼/巡守的名字（群里怎么称呼主 dsh；默认「宿主」，可改）'; Default = $ParentName; Have = $(if ($PSBoundParameters.ContainsKey('ParentName')) { $ParentName } else { '' }) },
    [pscustomobject]@{ Var = 'ParentMemberId'; Label = '大鱼/巡守的成员键（数据主键，小写 ASCII；默认 host，可自定义如 keeper）'; Default = $ParentMemberId; Have = $(if ($PSBoundParameters.ContainsKey('ParentMemberId')) { $ParentMemberId } else { '' }) },
    [pscustomobject]@{ Var = 'HumanName'; Label = '你自己的名字（群里怎么称呼你；默认「人类」，可改）'; Default = $HumanName; Have = $(if ($PSBoundParameters.ContainsKey('HumanName')) { $HumanName } else { '' }) },
    [pscustomobject]@{ Var = 'HumanMemberId'; Label = '你自己的成员键（数据主键，小写 ASCII；默认 human，可自定义如 fabian、keeper）'; Default = $HumanMemberId; Have = $(if ($PSBoundParameters.ContainsKey('HumanMemberId')) { $HumanMemberId } else { '' }) }
  )
  $missingAsk = @()
  foreach ($item in $asks) {
    $val = [string]$item.Have
    if ($val -eq '') {
      if (-not $interactiveInstall) { $missingAsk += ('{0}（默认通常是：{1}）' -f $item.Label, $item.Default); continue }
      $ans = Read-Host ('{0}（直接回车用默认：{1}）' -f $item.Label, $item.Default)
      $val = if ([string]::IsNullOrWhiteSpace($ans)) { [string]$item.Default } else { $ans.Trim() }
    }
    Set-Variable -Name $item.Var -Value $val
  }
  if ($missingAsk.Count -gt 0) {
    Die ('第一次安装前先问用户这几件事，不要替他决定。—— 名字和成员键是两件事，都可以自定义：
  - 小鱼的名字（群里显示的称呼；默认「小鱼」）
  - 大鱼/巡守的名字（默认「宿主」）
  - 大鱼/巡守的成员键（数据主键，小写 ASCII；默认 host，例如 keeper）
  - 你自己的名字（默认「人类」）
  - 你自己的成员键（数据主键；默认 human，例如 fabian、keeper）
  （小鱼的成员键固定为 fish，不用问。）') '问完后带参数重跑：-ChildName <名字> -ParentName <名字> -ParentMemberId <键> -HumanName <名字> -HumanMemberId <键>'
  }
  Note '第一条鱼的成员键固定为 fish（profile 同为 fish）；显示名随时可用 -ChildName 改。'
  foreach ($pair in @(
    [pscustomobject]@{ Name = 'ChildMemberId'; Rule = '^[a-z][a-z0-9-]{1,15}$' },
    [pscustomobject]@{ Name = 'ParentMemberId'; Rule = '^[a-z][a-z0-9-]{1,15}$' },
    [pscustomobject]@{ Name = 'HumanMemberId'; Rule = '^[a-z][a-z0-9-]{1,15}$' }
  )) {
    $v = [string](Get-Variable -Name $pair.Name -ValueOnly)
    if ($v -cnotmatch $pair.Rule) { Die ('成员键不合法：{0}={1}' -f $pair.Name, $v) '成员键用小写字母开头，只能小写字母/数字/连字符，2–16 位' }
  }
}

$childKey = if ($ChildMemberId) { $ChildMemberId } else { $ChildProfile }
if (-not $Workspace) {
  if ($InPond) { $Workspace = Join-Path (Join-Path $PondRoot 'homes') $childKey }
  else { $Workspace = Join-Path $PondRoot 'lil-whale' }
}
if (-not $DshHome) { $DshHome = Join-Path $Workspace 'dsh-home' }
$Workspace = [System.IO.Path]::GetFullPath($Workspace)
# 共享区（群/账本/私聊）。必须在 $Workspace 补完默认值之后再算：
# 2026-11-12 22:20 修 —— 原来这行在上面，$Workspace 为空时 Split-Path '' 直接抛错。
if ($PoolDir -ne '') { $PoolRoot = $PoolDir }
elseif ($InPond) { $PoolRoot = Join-Path $PondRoot 'pool' }
else { $PoolRoot = Join-Path (Split-Path $Workspace -Parent) 'lil-whale-pool' }
$PoolRoot = [System.IO.Path]::GetFullPath($PoolRoot)
$DshHome = [System.IO.Path]::GetFullPath($DshHome)

# -RepairAgents：只重写身份纸（<dshHome>\AGENTS.md），别的文件一概不碰。
# 为什么单独一个开关（2026-11-16 三条鱼指出）：-Force 会一起重写 START.md(434)、环境.md(442)、
# pins.json(498)，其中 pins.json 是会话绑定，重建可能让巡守叫错人。修一行路径不该拆四扇门。
if ($RepairAgents) {
  $membersFileRA = Join-Path $PoolRoot 'members.json'
  if (-not (Test-Path -LiteralPath $membersFileRA)) {
    Die "没有名册：$membersFileRA" '先跑一次完整安装，或用 -ChildMemberId 指明是哪条鱼'
  }
  $rosterRA = $null
  try { $rosterRA = Get-Content -LiteralPath $membersFileRA -Raw -Encoding utf8 | ConvertFrom-Json }
  catch { Die "名册读不了：$($_.Exception.Message)" '先修好 pool\members.json（合法 JSON）再重跑' }
  $meRA = $rosterRA.members.$childKey
  if (-not $meRA) {
    Die "名册里没有成员键 $childKey。" ('现有：' + (($rosterRA.members.PSObject.Properties.Name) -join '、'))
  }
  if (-not $meRA.home) { Die "名册里 $childKey 没有 home 字段。" '先补名册再重跑' }
  $repairHome = [System.IO.Path]::GetFullPath([string]$meRA.home).TrimEnd('\')
  $repairDsh = if ($meRA.dshHome) { [System.IO.Path]::GetFullPath([string]$meRA.dshHome) } else { Join-Path $repairHome 'dsh-home' }
  $agentsRepairFile = Join-Path $repairDsh 'AGENTS.md'
  $repairName = if ($meRA.name) { [string]$meRA.name } else { $ChildName }
  if (-not (Test-Path -LiteralPath $repairHome)) { Die "名册里 $childKey 的家不存在：$repairHome" '先修名册里的 home，或恢复这个家' }
  if (-not (Test-Path -LiteralPath $repairDsh)) { Die "这个家没有 dsh-home：$repairDsh" '缺 dsh-home 不是一句路径能修的，先完整安装一次' }
  $repairValues = @{ HER_HOME = $repairHome; CHILD_NAME = $repairName }
  Write-Utf8NoBom $agentsRepairFile (Render-Template (Join-Path $TemplateRoot 'AGENTS.md.tpl') $repairValues)
  Ok ("身份纸已重写：" + $agentsRepairFile)
  Note ("第一行：" + (Get-Content -LiteralPath $agentsRepairFile -Encoding utf8 -TotalCount 1))
  if (-not (Test-Path -LiteralPath (Join-Path $repairHome 'START.md'))) {
    Die "写完了，但它指的家没有 START.md：$(Join-Path $repairHome 'START.md')" '先恢复 START.md（或完整安装一次），再回来重跑'
  }
  exit 0
}

$portWanted = if ($ChildPort -gt 0) { $ChildPort } else { 3082 }
# 端口登记查重（2026-11-13 他要的）：先读共享区已登记的口，再找空口。
# "空着"不等于"没登记"：另一个进程还没起时口是空的，但它已经占了这个号。
$registeredPorts = @{}
$membersProbe = Join-Path $PoolRoot 'members.json'
if (Test-Path -LiteralPath $membersProbe) {
  try {
    $probe = Get-Content -LiteralPath $membersProbe -Raw -Encoding utf8 | ConvertFrom-Json
    foreach ($p in $probe.members.PSObject.Properties) {
      if ($p.Value.port) { $registeredPorts[[int]$p.Value.port] = $p.Name }
    }
    # 2026-11-15 补：鱼数上限在这里也查一次。以前只有 fish.ps1 new 查，绕过它直接跑 install 就能超员。
    $fishCount = @($probe.members.PSObject.Properties | Where-Object { $_.Value.kind -eq 'fish' }).Count
    $maxFish = 5
    $settingsProbe = Join-Path $PoolRoot 'state\settings.json'
    if (Test-Path -LiteralPath $settingsProbe) {
      try {
        $st = Get-Content -LiteralPath $settingsProbe -Raw -Encoding utf8 | ConvertFrom-Json
        if ($st.maxFish) { $maxFish = [int]$st.maxFish }
      } catch { }
    }
    if ($fishCount -ge $maxFish) {
      Die ("鱼已经 {0} 条，到了上限 {1} 条（pool\state\settings.json 的 maxFish）。" -f $fishCount, $maxFish) "先归档一条不用的鱼（scripts\archive-fish.ps1），或者改上限"
    }
  } catch { Warn "members.json 读不了（$membersProbe）：这次不查端口登记" }
}
$port = Find-FreePort $portWanted
for ($i = 0; $i -lt 50 -and $port -gt 0 -and $registeredPorts.ContainsKey($port); $i++) {
  Warn ("端口 {0} 已被 {1} 登记，跳过" -f $port, $registeredPorts[$port])
  $port = Find-FreePort ($port + 1)
}
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
foreach ($rel in @('plugin\dsh-lil-whale-group\package.json', 'plugin\dsh-lil-whale-group-ui\package.json', 'templates\START.md.tpl')) {
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

# 她家里只放两个 Junction：group / state 的真身在共享区（CHANGELOG A.22）。
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
  # 2026-11-16 r195：dsh 装插件时固定调 pnpm add，而 DSH 不自带 pnpm。
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Die "找不到 pnpm：dsh 装插件时固定调用 pnpm add（DSH 不自带它）。" "先运行 npm install --global pnpm@10，再重跑 install.ps1"
  }
  $add = & dsh plugin --profile $ChildProfile add "link:$RepoRoot\plugin\dsh-lil-whale-group" 2>&1
  if ($LASTEXITCODE -ne 0) {
    Die "装插件失败：$($add | Select-Object -Last 5)" "进 $DshHome\profiles\$ChildProfile 手动跑 dsh plugin add 看完整报错（若提示找不到 pnpm，先 npm install --global pnpm@10）"
  }
  Ok '@fabianactor/dsh-lil-whale-group'
} finally {
  $env:DSH_HOME = $savedHome
}

# 2026-11-15（测试鱼二代时发现）：`--from-default-profile web` 建出来的 profile 是空的——
# 没有她的模型（只有默认 deepseek-official 通道）、没有 preset-neutral。
# 结果是"能起来、能加载群插件，但一开口没模型可调"。以前这些是手工补的，每生一条鱼补一次。
# 现在从家长的 profile 抄 llm-pi-ai + agent-default-model 两段，再装中立预设。
Step '3b. 给她装模型与中立预设（不然她醒得来、想不了）'
$childPatch = Join-Path $DshHome "profiles\$ChildProfile\cordis.patch.yml"
$parentPatch = ''
try {
  $membersFileForSeed = Join-Path $PoolRoot 'members.json'
  if ((Test-Path -LiteralPath $membersFileForSeed) -and $ParentMemberId) {
    $mj = [System.IO.File]::ReadAllText($membersFileForSeed) | ConvertFrom-Json -AsHashtable
    $pm = $null
    if ($mj.Contains('members') -and $mj['members'].Contains($ParentMemberId)) { $pm = $mj['members'][$ParentMemberId] }
    if ($pm -and $pm['dshHome'] -and $pm['profile']) {
      $cand = Join-Path ([string]$pm['dshHome']) "profiles\$([string]$pm['profile'])\cordis.patch.yml"
      if (Test-Path -LiteralPath $cand) { $parentPatch = $cand }
    }
  }
} catch { }
if ($parentPatch -eq '' -and $savedHome) {
  $cand = Join-Path $savedHome "profiles\$ParentProfile\cordis.patch.yml"
  if (Test-Path -LiteralPath $cand) { $parentPatch = $cand }
}
$seedScript = Join-Path $RepoRoot 'scripts\seed-child-profile.mjs'
if ((Test-Path -LiteralPath $childPatch) -and (Test-Path -LiteralPath $seedScript)) {
  if ($parentPatch -ne '') {
    $seedOut = & node $seedScript --parent-patch $parentPatch --child-patch $childPatch --profile $ChildProfile --home $DshHome 2>&1
    if ($LASTEXITCODE -eq 0) { Ok '模型配置 + 中立预设（从家长的 profile 抄来，模型和钥匙跟家长一致）' }
    else { Warn "模型/预设没装上：$($seedOut | Select-Object -Last 3) —— 她可能醒得来但没模型可调" }
  } else {
    Warn "找不到家长的 profile patch（$ParentMemberId / $ParentProfile），模型与中立预设没装 —— 装完手动跑 node scripts\seed-child-profile.mjs ..."
  }
} elseif ($parentPatch -eq '') {
  Note '没有家长的 profile patch，跳过模型与预设（干净机器第一次装鱼塘时正常）'
}

# 2026-11-15（测试鱼二代时发现）：新 DSH_HOME 第一次打开网页时，默认工作区是
# <文档>\deepseek-harness\default-workspace —— 全机共用的一个文件夹，不是她的家。
# 后果：她在网页里新建的会话 cwd 在别人家，沙箱能写的范围也不是她自己的家。
# 这里先把工作区表种好（她的家 = 默认工作区），她第一次开窗就落在自己家里。
Step '3c. 把她的家设成她的默认工作区'
$wsFile = Join-Path $DshHome 'storages\workspace.json'
if (-not (Test-Path -LiteralPath $wsFile)) {
  $wsParent = Split-Path -Parent $wsFile
  if (-not (Test-Path -LiteralPath $wsParent)) { New-Item -ItemType Directory -Path $wsParent -Force | Out-Null }
  $wsId = [guid]::NewGuid().ToString()
  $wsNow = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $wsTable = [ordered]@{}
  $wsTable[$wsId] = [ordered]@{ path = $Workspace; title = '家'; sessionIds = @(); createdAt = $wsNow; updatedAt = $wsNow }
  $wsJson = [ordered]@{
    unit   = [ordered]@{ name = 'workspace'; version = 2 }
    global = [ordered]@{ initialized = $true; workspaceIds = @($wsId); archivedSessionIds = @(); pinnedSessionIds = @(); defaultWorkspaceId = $wsId }
    tables = [ordered]@{ workspaces = $wsTable }
  }
  Write-Utf8NoBom $wsFile ($wsJson | ConvertTo-Json -Depth 8)
  Ok "工作区表：$Workspace"
} else {
  Ok '工作区表已存在，保留'
}

# 2026-11-15 20:2x（第三条鱼第一次醒来）：沙箱给 workspace 贴通行证要到家根上拿 WRITE_OWNER，
# 而新家缺"当前用户的完全控制"这条显式 ACE ⇒ 所有 pwsh 起不来（Win32 5），
# 鱼醒来第一件事变成修自己的门。装的时候补，补不上就当场失败 —— 错在装的人，不在鱼。
Step '3d. 家根权限（沙箱贴通行证的前置）'
$needMe = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$rootAcl = Get-Acl -LiteralPath $Workspace
$hasFull = @($rootAcl.Access | Where-Object {
  $_.AccessControlType -eq 'Allow' -and
  $_.IdentityReference.Value -eq $needMe -and
  (([System.Security.AccessControl.FileSystemRights]$_.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl)
})
if ($hasFull.Count -gt 0) {
  Ok "已有完全控制：$needMe"
} else {
  try {
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($needMe, 'FullControl', 'Allow')
    $rootAcl.AddAccessRule($rule)
    Set-Acl -LiteralPath $Workspace -AclObject $rootAcl -ErrorAction Stop
    $again = @((Get-Acl -LiteralPath $Workspace).Access | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -eq $needMe })
    if ($again.Count -eq 0) { throw '写完读不到那条 ACE' }
    Ok "补了完全控制：$needMe"
  } catch {
    Die "给家根补完全控制失败：$($_.Exception.Message)" "检查 $Workspace 的所有者；没有这条权限，鱼第一次调用 pwsh 就会失败（Win32 5）"
  }
}

if (-not $SkipParent) {
  Step "4. 把两个插件装进你的 profile（$ParentProfile）"
  try {
    $env:DSH_HOME = $savedHome
    $add1 = & dsh plugin --profile $ParentProfile add "link:$RepoRoot\plugin\dsh-lil-whale-group" 2>&1
    if ($LASTEXITCODE -ne 0) {
      Die "装 @fabianactor/dsh-lil-whale-group 失败：$($add1 | Select-Object -Last 5)" "确认 profile 名（默认 web）；如果是给已有鱼塘加鱼或试装，可以用 -SkipParentPlugins 跳过这一步"
    }
    $add2 = & dsh plugin --profile $ParentProfile add "link:$RepoRoot\plugin\dsh-lil-whale-group-ui" 2>&1
    if ($LASTEXITCODE -ne 0) {
      Die "装 @fabianactor/dsh-lil-whale-group-ui 失败：$($add2 | Select-Object -Last 5)" "同上"
    }
    Ok '@fabianactor/dsh-lil-whale-group + -ui'
    Warn "装好以后要重启一次你的 dsh，界面才认这两个插件"
  } finally {
    $env:DSH_HOME = $savedHome
  }
}

Step '5. 写配置'
# 合并写，不是覆盖写：已有的字段（repoRoot / selfWaker / pwshExe …）原样留着，
# 否则在装好的机器上重跑一次 install，会把这份配置里手写的东西全丢掉。
# 一条鱼一份配置：标准名 lil-whale.config.json 给"占着它的那条鱼"，其余用 lil-whale.config.<键>.json。
# 2026-11-16 r197：原来判据写死 $childKey -ne 'whale'（我们自己的鱼名）；改成看标准配置文件里的 selfHome 是不是这条鱼。
$cfgName = 'lil-whale.config.json'
if ($InPond) {
  $baseCfg = Join-Path $RepoRoot 'lil-whale.config.json'
  $baseOwnsMe = -not (Test-Path $baseCfg)
  if (-not $baseOwnsMe) {
    try {
      $baseJson = [System.IO.File]::ReadAllText($baseCfg) | ConvertFrom-Json -AsHashtable
      $baseHome = if ($baseJson.Contains('selfHome')) { [string]$baseJson['selfHome'] } else { '' }
      if ($baseHome) { $baseOwnsMe = ([System.IO.Path]::GetFullPath($baseHome).TrimEnd('\') -ieq $Workspace.TrimEnd('\')) }
    } catch { $baseOwnsMe = $false }
  }
  if (-not $baseOwnsMe) { $cfgName = "lil-whale.config.$childKey.json" }
}
$cfgPath = if ($ConfigPath -ne '') { $ConfigPath } else { Join-Path $RepoRoot $cfgName }
if ((Test-Path $cfgPath) -and -not $Force) {
  try {
    $existing = [System.IO.File]::ReadAllText($cfgPath) | ConvertFrom-Json -AsHashtable
    $liveHome = [string]$existing['selfHome']
    if ($liveHome -eq '') { $liveHome = [string]$existing['herHome'] }
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
  $cfg['_说明'] = '这台机器上所有"会变的假设"集中在这里。代码和脚本都不许再写死绝对路径 —— 打包给别人时只改这一个文件（或用环境变量 LIL_WHALE_CONFIG 指向另一份）。字段含义见 docs/detail/怎么打包给别人.md。'
}
# 2026-11-14：键名从单鱼时代的 her*/whale* 改成 self*（每条鱼读的都是自己那份配置）。
# 旧键在这里删掉，不留两份 —— 同一个值两个名字，早晚会打架；旧配置靠 config.js 的 LEGACY_KEYS 仍然能读。
$cfg['selfHome'] = $Workspace
$cfg['selfDshHome'] = $DshHome
$cfg['selfProfile'] = $ChildProfile
$cfg['leeProfile'] = $ParentProfile
$cfg['selfPort'] = $port
foreach ($legacy in @('herHome','herDshHome','herWaker','herPort','whaleProfile','whaleCwd')) { $cfg.Remove($legacy) }
$cfg['poolDir'] = $PoolRoot
$cfg['poolStateDir'] = (Join-Path $PoolRoot 'state')
$cfg['dmDir'] = (Join-Path $PoolRoot 'dm')
$cfg['membersFile'] = (Join-Path $PoolRoot 'members.json')
Write-Utf8NoBom $cfgPath ($cfg | ConvertTo-Json -Depth 5)
Ok $cfgPath
# 2026-11-15 补：Step 6/7 的 node 脚本（render-env / gen-family / sleep-cli）都按
# LIL_WHALE_CONFIG → 仓库根 → 默认 的顺序找配置。用 -ConfigPath 试装时，它们会读到
# 真的那份配置、把种子和谱系写进真的家和真名册（2026-11-15 彩排踩到过）。
# 所以从这行开始，把"这次要装的那份配置"直接指给它们，脚本结束再还原。
$savedCfgEnv = $env:LIL_WHALE_CONFIG
$env:LIL_WHALE_CONFIG = $cfgPath
Note "这份配置是这台机器的真源；装完别删。要装到别的目录，用 -ConfigPath 指到别处"

Step '6. 种子文件（不写性格、不写期望）'
$deployDate = Get-Date -Format 'yyyy-MM-dd'

# 闸门参数从插件源码里读，免得这张纸和实现漂移；读不到就用默认值。
$wakeSrc = ''
$groupSrc = Join-Path $RepoRoot 'plugin\dsh-lil-whale-group\lib\index.js'
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
  PARENT_ID = $ParentMemberId
  CHILD_ID = $(if ($ChildMemberId) { $ChildMemberId } else { $ChildProfile })
  HUMAN_ID = $HumanMemberId
  TOOLS = '- （工具清单没能自动生成，见下面那行提示）'
}

# 名册里这条鱼用哪个键：给了 -ChildMemberId 就用它，否则跟 profile 同名。
$childMember = if ($ChildMemberId) { $ChildMemberId } else { $ChildProfile }

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
    & node $envScript --workspace $Workspace --profile $ChildProfile --pool-dir $PoolRoot --her-port $port --deploy-date $deployDate --child-name $ChildName --child-id $ChildMemberId --parent-id $ParentMemberId --newborn 2>&1 | ForEach-Object { Write-Host ('    ' + $_) }
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
# 2026-11-16 r190：身份纸里的家必须和名册同源。
# 原来这里用 $Workspace（安装参数），而 render-env.mjs:328 用名册的 home —— 同一件事两个来源，
# 于是 环境.md 对、AGENTS.md 错（2026-11-16 三条鱼的身份纸各自指向三种错家）。
# 判据：传进来的会漂，存下来的不会 —— 定义只认名册，传参只能核对。
$agentsHome = $Workspace
$agentsSource = '安装参数'
$membersFileForAgents = Join-Path $PoolRoot 'members.json'
if (Test-Path -LiteralPath $membersFileForAgents) {
  try {
    $rosterForAgents = Get-Content -LiteralPath $membersFileForAgents -Raw -Encoding utf8 | ConvertFrom-Json
    $meForAgents = $rosterForAgents.members.$childMember
    if ($meForAgents -and $meForAgents.home) {
      $agentsHome = [System.IO.Path]::GetFullPath([string]$meForAgents.home).TrimEnd('\')
      $agentsSource = '名册'
    }
  } catch {
    Warn "名册读不了（$membersFileForAgents），身份纸暂按安装参数写：$Workspace"
  }
}
$values.HER_HOME = $agentsHome
if (-not (Test-Path $agentsPath) -or $Force) {
  Write-Utf8NoBom $agentsPath (Render-Template (Join-Path $TemplateRoot 'AGENTS.md.tpl') $values)
  Ok ("AGENTS.md（家来自{0}）" -f $agentsSource)
  # 写后自检（r190）：纸指的家要真的在、里面要有 START.md。
  # 少了这一步，一份指错的身份纸会一直"看起来装好了"——一直到她醒来才发现读不到第一页。
  $agentsStart = Join-Path $agentsHome 'START.md'
  if (-not (Test-Path -LiteralPath $agentsHome)) {
    Die "AGENTS.md 指向的家不存在：$agentsHome" '核对 pool\members.json 里这条鱼的 home（或 -ChildMemberId）再重跑'
  }
  if (-not (Test-Path -LiteralPath $agentsStart)) {
    Die "AGENTS.md 指向的家没有 START.md：$agentsStart" '先让完整安装生成 START.md，再重跑；或检查 -Workspace'
  }
} else {
  Ok 'AGENTS.md 已存在，保留（要重写身份纸：install.ps1 -RepairAgents -ChildMemberId <键>）'
}

# group 是共享区（Junction）时，messages/pins 属于整个鱼群，不属于这个新家。
# 这里曾经把 pins.json 初始化成 "lee: [] / whale: []" —— 正好写进共享区，把老鱼的名册整份抹掉
# （2026-11-12 装第二条鱼时真踩过：大肥鱼和小肥鱼同时"不在群里"，而且没有任何报错）。
$groupPath = Join-Path $Workspace 'group'
$sharedGroup = $false
try { $gi = Get-Item -LiteralPath $groupPath -ErrorAction Stop; if ($gi.LinkType) { $sharedGroup = $true } } catch { }
$poolGroup = Join-Path $PoolRoot 'group'
if ($sharedGroup) {
  # 共享区：只补缺、绝不覆盖。新池子第一次装的时候 messages/pins 谁都没建过 ——
  # 这里是唯一的创建机会；但已有内容一个字都不能动（CHANGELOG A.29 那次把整份名册抹掉就是"初始化"干的）。
  $poolMsg = Join-Path $poolGroup 'messages.jsonl'
  $poolPins = Join-Path $poolGroup 'pins.json'
  $pinsPath = $poolPins
  if (-not (Test-Path $poolMsg)) { Write-Utf8NoBom $poolMsg ''; Ok 'group\messages.jsonl（共享区，新建）' }
  if (-not (Test-Path $poolPins)) {
    $parentIds = @(); $childIds = @()
    if ($ParentSessionId) { $parentIds += $ParentSessionId }
    if ($ChildSessionId) { $childIds += $ChildSessionId }
    $pins = [ordered]@{}
    $pins[$ParentMemberId] = $parentIds
    $pins[$childMember] = $childIds
    Write-Utf8NoBom $poolPins (($pins | ConvertTo-Json -Depth 5) + "`n")
    Ok 'group\pins.json（共享区，新建；只有父辈和你两条）'
  } else {
    Ok 'group 是共享区（Junction）：messages/pins 归共享区管，已有就不动'
  }
} else {
  $msgPath = Join-Path $Workspace 'group\messages.jsonl'
  if (-not (Test-Path $msgPath)) { Write-Utf8NoBom $msgPath ''; Ok 'group\messages.jsonl' }

  $pinsPath = Join-Path $Workspace 'group\pins.json'
  if (-not (Test-Path $pinsPath) -or $Force) {
    $parentIds = @(); $childIds = @()
    if ($ParentSessionId) { $parentIds += $ParentSessionId }
    if ($ChildSessionId) { $childIds += $ChildSessionId }
    $pins = [ordered]@{}
    $pins[$ParentMemberId] = $parentIds
    $pins[$childMember] = $childIds
    Write-Utf8NoBom $pinsPath (($pins | ConvertTo-Json -Depth 5) + "`n")
    if ($ChildSessionId -or $ParentSessionId) { Ok 'group\pins.json（已带会话 id）' }
    else { Ok 'group\pins.json（空的，出生后填）' }
  }
}

# 名册（pool\members.json）：干净安装时谁都没建过，这里补一份最小名册 ——
# 不生成它的话，面板/群会退回"内置三条"，新装的鱼在设置页和 @ 面板里看不见（CHANGELOG A.32 那个病）。
$membersPath = Join-Path $PoolRoot 'members.json'
if (-not (Test-Path $membersPath)) {
  $nowIso = (Get-Date).ToString('o')
  $members = [ordered]@{}
  # 父辈（lee）的端口/家/配置：配置里有就用配置，没有就用约定默认。
  # 2026-11-12 22:20 修：原来这里取 $Cfg.LeePort / LeeHome / LeeProfile —— $Cfg 不存在（变量叫 $cfg），
  # 而且 $cfg 里根本没有这三个键 ⇒ 新装机器上 lee 的 port/home/dshHome/profile 全是 null。
  $leeHome = if ($cfg.Contains('leeHome')) { [string]$cfg['leeHome'] } else { Join-Path $env:USERPROFILE '.dsh' }
  $leePort = if ($cfg.Contains('leePort')) { [int]$cfg['leePort'] } else { 3080 }
  $members[$ParentMemberId] = [ordered]@{
    name = $ParentName; kind = 'fish'; role = 'watcher'; parent = $null
    port = $leePort; home = $leeHome; dshHome = $leeHome
    profile = $ParentProfile; lifecycle = 'active'; bornAt = $null
  }
  $members[$HumanMemberId] = [ordered]@{ name = $HumanName; kind = 'human'; role = 'human'; parent = $null }
  $members[$childMember] = [ordered]@{
    name = $ChildName; kind = 'fish'; role = 'member'; parent = $ParentMemberId
    port = $port; home = $Workspace; dshHome = $DshHome
    profile = $ChildProfile; lifecycle = 'active'; bornAt = $nowIso
  }
  $rawMembers = [ordered]@{ version = 1; updatedAt = $nowIso; members = $members }
  Write-Utf8NoBom $membersPath (($rawMembers | ConvertTo-Json -Depth 8) + "`n")
  Ok 'members.json（共享区，新建：父辈 + 人 + 这条鱼）'

  # 首鱼也要出生账（2026-11-16 第四份沉淀 P4）：fish.ps1 new 一直记，这条安装路径以前漏了。
  # 账本要先有 log-format 分界行，否则 doctor 只说"记不了少"（9d 的判据）。
  $installBirthLog = Join-Path $PoolRoot 'state\births.log'
  try {
    if (-not (Test-Path -LiteralPath $installBirthLog)) {
      $sinceIso = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
      $fmtLine = '{0} | log-format | fmt=1 since={1} note=install.ps1 写的第一行（首鱼出生账）' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $sinceIso
      Write-Utf8NoBom $installBirthLog ($fmtLine + [Environment]::NewLine)
    }
    $installBirthLine = '{0} | birth | fmt=3 key={1} name={2} parent={3} by=install.ps1 parentLifecycle=active requestedBy=' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $childMember, $ChildName, $ParentMemberId
    Add-Content -LiteralPath $installBirthLog -Value $installBirthLine -Encoding utf8
    Ok 'births.log（首鱼出生账）'
  } catch { Warn ("首鱼出生账没记上：{0}" -f $_.Exception.Message) }
} else {
  # 名册已存在（鱼塘里已经有别的鱼）：把这条新鱼加进去，别让用户再手跑一次。
  # 2026-11-13 17:0x 修：原来这里只打印"用 members-add.mjs"，装第二条鱼时新鱼不在名册里，
  # fish.ps1 认不出它、面板里也看不见（CHANGELOG A.32 同族）。
  $membersAdd = Join-Path $RepoRoot 'scripts\members-add.mjs'
  if (Test-Path $membersAdd) {
    $addArgs = @($membersAdd, '--key', $childMember, '--name', $ChildName, '--parent', $ParentMemberId,
      '--port', [string]$port, '--home', $Workspace, '--dshHome', $DshHome,
      '--profile', $ChildProfile, '--configFile', $cfgName)
    $addOut = & node @addArgs 2>&1
    if ($LASTEXITCODE -eq 0) { Ok "members.json 已更新：$($addOut | Select-Object -Last 1)" }
    else { Warn "新鱼没写进名册：$($addOut | Select-Object -Last 3) —— 手动跑 node scripts\members-add.mjs --key $childMember ..." }
  } else {
    Warn '找不到 scripts\members-add.mjs，新鱼没写进名册'
  }
}

# 谱系真源（pool\family.json）：干净安装时也没人建过 —— 用名册 seed 一份（已有则不覆盖）。
# 2026-11-13 19:xx 补：以前只有 members.json，谱系页要人手跑 gen-family；装完就该是齐的。
$genFamily = Join-Path $RepoRoot 'scripts\gen-family.mjs'
$familyPath = Join-Path $PoolRoot 'family.json'
# 2026-11-13 22:4x 修：以前只在 family.json 不存在时 seed —— 鱼塘里加第二条鱼时它已经存在，
# 新鱼就永远进不了谱系（gen-family.mjs 自己会补缺失节点，重跑无害）。
if (Test-Path -LiteralPath $genFamily) {
  $gfOut = & node $genFamily --seed 2>&1
  if ($LASTEXITCODE -eq 0) { Ok "family.json 已初始化：$($gfOut | Select-Object -Last 1)" }
  else { Warn "family.json 没生成：$($gfOut | Select-Object -Last 3)" }
}

$planPath = Join-Path $Workspace 'plan\wake-plan.json'
if (-not (Test-Path $planPath)) { Write-Utf8NoBom $planPath "[]`n"; Ok 'plan\wake-plan.json（空的：她现在没有任何固定日程）' }

# 睡眠作息（CHANGELOG A.73）：默认 00:00–08:00，她可以自己改；家长可以强行叫醒。
# 判断逻辑只在 sleep-core.js 一份实现里 —— 这里只负责种文件，不自己算窗口。
$sleepCli = Join-Path $RepoRoot 'scripts\sleep-cli.mjs'
$sleepSeedKey = $childMember
if ((Test-Path -LiteralPath $sleepCli) -and $sleepSeedKey) {
  $seedOut = & node $sleepCli seed $sleepSeedKey 2>&1
  if ($LASTEXITCODE -eq 0) { Ok 'plan\sleep.json（默认 00:00–08:00；她能自己改，家长能强行叫醒）' }
  else { Warn "plan\sleep.json 没种上：$($seedOut | Select-Object -Last 2)" }
}

Step '7. 验一遍'
try {
  $env:DSH_HOME = $DshHome
  $dump = & dsh --profile $ChildProfile --dump-config 2>&1
  $rows = ($dump | Select-String -Pattern 'id: dsh-lil-whale-group' | Measure-Object).Count
  if ($LASTEXITCODE -ne 0 -or $rows -lt 1) {
    Die "她的 profile 没合成出群插件（dump 最后几行：$($dump | Select-Object -Last 3)）" "进 $DshHome\profiles\$ChildProfile 看 package.json 的 dsh.profile.bundles 里有没有 lil-whale-group"
  }
  Ok "她的 profile：$rows 行 dsh-lil-whale-group"
} finally {
  $env:DSH_HOME = $savedHome
}

# 还原给子进程看的环境变量（试装时指向临时配置，别让它留在这台机器的会话里）。
if ($null -eq $savedCfgEnv) { Remove-Item Env:LIL_WHALE_CONFIG -ErrorAction SilentlyContinue } else { $env:LIL_WHALE_CONFIG = $savedCfgEnv }

Say ""
# 第五份装机沉淀 P1：插件的卸载/重装发生在主 dsh 进程里，旧实例不会自己退出（dispose 不触发），
# 会按加载时的配置继续写旧目录、甚至重建已删除的目录。装完必须重启主 dsh。
$mainPortNow = if ($cfg.Contains('leePort')) { [int]$cfg['leePort'] } else { 3080 }
if (Test-Port $mainPortNow) {
  Warn "主 dsh 正在 127.0.0.1:$mainPortNow 上运行：卸载/重装插件**不会**让旧插件实例退出，它们会继续写旧目录（实测会重建已删除的目录）。装完请重启主 dsh；重启前不要删旧目录。"
}

Say "  装好了。接下来的四件事脚本替不了：" -ForegroundColor Green
Say ""
Say "  1) 重启你的 dsh（装进你 profile 的两个插件要重启才生效）。"
Say "  2) 起她的窗：pwsh -File scripts\fish.ps1 up $childMember（或双击 scripts\bin\Run All Whales.cmd）"
Say "     -- 它会打印她的网址，形如  http://127.0.0.1:$port/?token=xxxx"
Say "     -- token 是每次启动随机生成的，只印在那一行；自己敲 127.0.0.1:$port 会 401。"
Say "  3) 在她的网页里填她自己的 API key（设置 -> Models），别和你共用一把。"
Say "  4) 添加工作区 $Workspace ，在里面新建一段对话，然后由你说第一句话。"
Say ""
Say "  出生之后，还要两段会话 id 群才认人。**这两段由用户决定，安装脚本不替你挑**——"
Say "  尤其不要拿'这次安装开的那段会话'当父辈：它是临时的，不该代表用户。"
Say "     pwsh -File scripts\fish.ps1 sessions $ParentMemberId     # 列候选：id / 最后写时间 / 所在工作区"
Say "     pwsh -File scripts\fish.ps1 bind $ParentMemberId -Session <选中的 id>"
Say "     她那一段同理：先在网页里说第一句话，再 sessions $childMember / bind $childMember -Session <id>"
Say "  （装的时候也可以显式传 -ParentSessionId / -ChildSessionId——只在你已经知道是哪段时传。）"
Say ""
Say "  她不会有预设的性格：第一次醒来是什么样，取决于你写了什么、没写什么。" -ForegroundColor Gray
Say ""
