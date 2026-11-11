# install.ps1 -- 给别人装一条鱼。ASCII 文件名 + UTF-8 BOM。
#
#   pwsh -File install.ps1                      装到仓库旁边的 lil-whale/（默认布局）
#   pwsh -File install.ps1 -HerHome D:\fish      装到指定目录
#   pwsh -File install.ps1 -SkipHost             只装小肥鱼，不动你这边的 web profile
#   pwsh -File install.ps1 -Force                目标目录已经像"她的家"时仍然继续（会覆盖 START.md）
#
# 它做什么：建目录 -> 建她自己的 DSH_HOME 与 profile -> 把两个插件装进 profile -> 写配置 -> 放种子文件。
# 它不做什么：不申请 API key（要人在她自己的网页里填）、不建会话、不写第一句话（那句得由人说）。
#
# 退出码：0 = 装好了；1 = 中途停下（每一步都打印了什么没成）。

param(
  [string]$HerHome = '',
  [string]$HerDshHome = '',
  [string]$HerProfile = 'whale',
  [string]$HostProfile = 'web',
  [int]$HerPort = 3082,
  [switch]$SkipHost,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path $PSScriptRoot -Parent

function Say([string]$text) { Write-Host $text }
function Step([string]$text) { Write-Host ""; Write-Host ("== " + $text) -ForegroundColor Cyan }
function Ok([string]$text)   { Write-Host ("   ok   " + $text) -ForegroundColor Green }
function Warn([string]$text) { Write-Host ("   !!   " + $text) -ForegroundColor Yellow }
function Die([string]$text)  { Write-Host ("   xx   " + $text) -ForegroundColor Red; exit 1 }

# 只有 .json 不能带 BOM（dsh 的加载器会拒绝），其它都按 UTF-8 写。
function Write-Utf8NoBom([string]$path, [string]$text) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $enc)
}

if (-not $HerHome) { $HerHome = Join-Path (Split-Path $RepoRoot -Parent) 'lil-whale' }
if (-not $HerDshHome) { $HerDshHome = Join-Path $HerHome 'dsh-home' }
$HerHome = [System.IO.Path]::GetFullPath($HerHome)
$HerDshHome = [System.IO.Path]::GetFullPath($HerDshHome)

Say ""
Say "  小小肥鱼 —— 安装"
Say "  仓库       $RepoRoot"
Say "  她的家     $HerHome"
Say "  她的 HOME  $HerDshHome"
Say "  她的口     $HerPort   (profile: $HerProfile)"
Say "  你的 profile $HostProfile$([bool]$SkipHost ? '  (跳过)' : '')"

Step '0. 环境检查'
$dsh = Get-Command dsh -ErrorAction SilentlyContinue
if (-not $dsh) { Die '找不到 dsh 命令。先装 DeepSeek Harness：npm i -g @deepseek-ai/dsh' }
$ver = (& dsh --version 2>&1 | Select-Object -First 1)
Ok "dsh $ver"
if (-not (Test-Path (Join-Path $RepoRoot 'plugin\dsh-group\package.json'))) {
  Die "仓库不完整：找不到 plugin\dsh-group。这个脚本要在项目仓库里跑。"
}
Ok '仓库结构正常'

Step '1. 目录'
if (Test-Path -LiteralPath $HerHome) {
  $looksLikeHer = (Test-Path (Join-Path $HerHome 'START.md')) -or (Test-Path (Join-Path $HerHome 'dsh-home'))
  if ($looksLikeHer -and -not $Force) {
    Die "「$HerHome」已经像一条鱼的家了（有 START.md 或 dsh-home）。要么换 -HerHome，要么加 -Force 覆盖 START.md。"
  }
}
foreach ($d in @($HerHome, (Join-Path $HerHome 'logs'), (Join-Path $HerHome 'group'),
                 (Join-Path $HerHome 'plan'), (Join-Path $HerHome 'state'), (Join-Path $HerHome 'run'),
                 $HerDshHome)) {
  if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}
Ok "建好了 6 个目录"

Step "2. 她的 profile（$HerProfile）"
$savedHome = $env:DSH_HOME
try {
  $env:DSH_HOME = $HerDshHome
  $profileDir = Join-Path $HerDshHome "profiles\$HerProfile"
  if (-not (Test-Path $profileDir)) {
    # 从自带的 web 模板复制一份：它正好是 base + web-app，她需要一个能开窗的 app。
    $dump = & dsh --profile $HerProfile --from-default-profile web --dump-config 2>&1
    if ($LASTEXITCODE -ne 0) { Die "建 profile 失败：$($dump | Select-Object -Last 3)" }
    Ok "从 web 模板建好 $profileDir"
  } else {
    Ok "profile 已存在，保留"
  }

  Step '3. 把群插件装进她的 profile'
  $add = & dsh plugin --profile $HerProfile add "link:$RepoRoot\plugin\dsh-group" 2>&1
  if ($LASTEXITCODE -ne 0) { Die "装插件失败：$($add | Select-Object -Last 5)" }
  Ok 'lil-whale-group'
} finally {
  $env:DSH_HOME = $savedHome
}

if (-not $SkipHost) {
  Step "4. 把两个插件装进你的 profile（$HostProfile）"
  try {
    $env:DSH_HOME = $savedHome          # 你的 HOME（一般是 ~/.dsh）
    $add1 = & dsh plugin --profile $HostProfile add "link:$RepoRoot\plugin\dsh-group" 2>&1
    if ($LASTEXITCODE -ne 0) { Die "装 lil-whale-group 失败：$($add1 | Select-Object -Last 5)" }
    $add2 = & dsh plugin --profile $HostProfile add "link:$RepoRoot\plugin\dsh-group-ui" 2>&1
    if ($LASTEXITCODE -ne 0) { Die "装 lil-whale-group-ui 失败：$($add2 | Select-Object -Last 5)" }
    Ok 'lil-whale-group + lil-whale-group-ui'
    Warn "装好以后要重启一次你的 dsh，界面才认这两个插件"
  } finally {
    $env:DSH_HOME = $savedHome
  }
}

Step '5. 写配置'
$cfgPath = Join-Path $RepoRoot 'lil-whale.config.json'
$cfg = [ordered]@{
  herHome = $HerHome
  herDshHome = $HerDshHome
  whaleProfile = $HerProfile
  leeProfile = $HostProfile
  herPort = $HerPort
}
Write-Utf8NoBom $cfgPath ($cfg | ConvertTo-Json -Depth 5)
Ok $cfgPath

Step '6. 种子文件（不写性格、不写期望）'
$startPath = Join-Path $HerHome 'START.md'
if (-not (Test-Path $startPath) -or $Force) {
  $start = @"
# START

这里是你自己的地方。

- 屋子是空的，除了这一页没有别的东西要求你做什么。
- `logs\` 想写就写，空着不算错。
- `环境.md` 是别人写的工具清单，不是自我介绍，也不是规矩。
- 这一页怎么改、改成什么，都由你。

$(Get-Date -Format 'yyyy-MM-dd') 有人在这里建了个空文件夹，然后停手了。
"@
  Write-Utf8NoBom $startPath $start
  Ok 'START.md'
}
$agentsPath = Join-Path $HerDshHome 'AGENTS.md'
if (-not (Test-Path $agentsPath)) {
  Write-Utf8NoBom $agentsPath "你是小小肥鱼。家在 $HerHome。醒来先读 START.md。其余没有人替你写。`n"
  Ok 'AGENTS.md'
}
$msgPath = Join-Path $HerHome 'group\messages.jsonl'
if (-not (Test-Path $msgPath)) { Write-Utf8NoBom $msgPath ''; Ok 'group\messages.jsonl' }
$pinsPath = Join-Path $HerHome 'group\pins.json'
if (-not (Test-Path $pinsPath)) { Write-Utf8NoBom $pinsPath "{`"lee`": [], `"whale`": []}`n"; Ok 'group\pins.json（空的，出生后才填）' }
$planPath = Join-Path $HerHome 'plan\wake-plan.json'
if (-not (Test-Path $planPath)) { Write-Utf8NoBom $planPath "[]`n"; Ok 'plan\wake-plan.json（空的：她现在没有任何固定日程）' }

Step '7. 验一遍'
$savedHome = $env:DSH_HOME
try {
  $env:DSH_HOME = $HerDshHome
  $dump = & dsh --profile $HerProfile --dump-config 2>&1
  $rows = ($dump | Select-String -Pattern 'id: lil-whale-group' | Measure-Object).Count
  if ($LASTEXITCODE -ne 0 -or $rows -lt 1) { Die "她的 profile 没合成出群插件（dump 最后几行：$($dump | Select-Object -Last 3)）" }
  Ok "她的 profile：$rows 行 lil-whale-group"
} finally {
  $env:DSH_HOME = $savedHome
}

Say ""
Say "  装好了。接下来是人的部分，脚本替不了：" -ForegroundColor Green
Say ""
Say "  1) 起她的窗：  pwsh -File `"$RepoRoot\scripts\launch.ps1`" -Target whale"
Say "     （或者双击 scripts\bin\Run lil whale.cmd）"
Say "  2) 在她那个网页里填 API key：设置 -> Models。她用自己的 key，别跟你共用。"
Say "  3) 添加工作区：$HerHome ，然后在里面新建一段会话。"
Say "  4) 第一句话由你说。她没有预设的性格，第一次醒来是什么样，取决于你写了什么、没写什么。"
Say "  5) 出生之后，把她的完整会话 id 写进 $HerHome\group\pins.json 的 whale 数组，"
Say "     再把你这段会话的完整 id 写进 lee 数组 —— 群才知道谁是谁。"
Say ""
