#requires -Version 7.0
# scripts\release-check.ps1 —— 拟发版检查
#
# 为什么要有它：平时所有验证都在**工作目录**里做，而工作目录里混着本机配置、临时脚本、
# 没提交的改动、她家生成物。那些东西在包里根本没有，所以"我这儿跑通了"不等于"发出去能装"。
#
# 这个脚本只做一件事：**拿打包出来的那一份 zip，在干净目录里装一遍、查一遍。**
# 包里的东西 = 用户会拿到的东西；工作目录里多出来的任何东西都不算数。
#
# 用法：
#   pwsh -File scripts\release-check.ps1              # 打新包 + 检查 + 清理
#   pwsh -File scripts\release-check.ps1 -SkipPack    # 用 dist 里最新的 zip
#   pwsh -File scripts\release-check.ps1 -Keep        # 保留解压目录和试装的家
#
# 退出码：全过 0；有 FAIL 1。WARN 不影响退出码。

[CmdletBinding()]
param(
  [switch]$SkipPack,
  [switch]$Keep
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path $PSScriptRoot -Parent
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$work = Join-Path $env:TEMP "llw-release-$stamp"
$checks = New-Object System.Collections.ArrayList

function Add-Check([string]$Name, [string]$Status, [string]$Detail) {
  [void]$checks.Add([pscustomobject]@{ 检查 = $Name; 结果 = $Status; 说明 = $Detail })
}
function Fail([string]$Name, [string]$Detail) { Add-Check $Name 'FAIL' $Detail }
function Warn([string]$Name, [string]$Detail) { Add-Check $Name 'WARN' $Detail }
function Ok([string]$Name, [string]$Detail = '') { Add-Check $Name 'OK' $Detail }

Write-Host '拟发版检查：拿打包出来的那一份，在干净目录里装一遍。' -ForegroundColor Cyan
Write-Host ''

# ── 0. 工作目录状态（不阻断，但要说出来）────────────────────────────────
$dirty = @(git -C $RepoRoot status --porcelain 2>$null)
if ($dirty.Count) {
  Warn '工作目录' "有 $($dirty.Count) 个未提交改动 —— 包只含已提交内容，这些不会进去"
} else {
  Ok '工作目录' '干净'
}

# ── 1. 打包 ────────────────────────────────────────────────────────────
if (-not $SkipPack) {
  & pwsh -NoProfile -File (Join-Path $PSScriptRoot 'pack.ps1') 2>&1 | ForEach-Object { Write-Host "    $_" }
  if ($LASTEXITCODE -ne 0) { Fail '打包' "pack.ps1 退出码 $LASTEXITCODE" }
}
$zip = Get-ChildItem (Join-Path $RepoRoot 'dist') -Filter 'lil-whale-*.zip' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $zip) { Fail '找包' 'dist 里没有 lil-whale-*.zip'; $zip = $null }
if ($zip) { Ok '找包' "$($zip.Name)（$([math]::Round($zip.Length / 1KB, 1)) KB）" }

if (-not $zip) {
  # 没包就没什么可查的了
} else {
  New-Item -ItemType Directory -Force -Path $work | Out-Null
  Expand-Archive -Path $zip.FullName -DestinationPath $work -Force
  $root = Get-ChildItem $work -Directory | Select-Object -First 1
  if (-not $root) { Fail '解压' '解压后没有顶层目录' }
}

if ($root) {
  $pkg = $root.FullName
  Write-Host "解压到 $pkg" -ForegroundColor DarkGray
  Write-Host ''

  # ── 2. 包里不该有的东西 ─────────────────────────────────────────────
  foreach ($bad in @('archive', '.git', 'dist', 'node_modules', 'lil-whale.config.json', 'tmp')) {
    if (Test-Path (Join-Path $pkg $bad)) { Fail "不该有 $bad" '本机/开发期产物混进了包' }
  }
  Ok '包内无本机产物' 'archive / .git / dist / node_modules / 本机配置 / tmp 都不在'

  # ── 3. 本机路径 ─────────────────────────────────────────────────────
  $allFiles = Get-ChildItem $pkg -Recurse -File -Include *.js, *.mjs, *.ps1, *.json, *.md, *.tpl, *.yml |
    Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.Name -ne 'release-check.ps1' }  # 它自己就是拿来 grep 这两个字面量的
  # 代码/模板/脚本里的本机路径 = FAIL（换台机器就装不上）；
  # 文档里的 = WARN（读得懂，但不该把作者的家写进用户手册；历史记录类文档除外）。
  $codeFiles = $allFiles | Where-Object { $_.Extension -in '.js', '.mjs', '.ps1', '.json', '.tpl', '.yml' }
  # 用户会读的文档：本机路径 = WARN（读得懂，但不该把作者的家写进用户手册）。
  # 项目记录（PRD / 还没做完的事 / 这一周她过得怎么样-完成即删）例外：那里面的路径是事故证据，清掉等于抹证据 —— 不扫。
  $recordDocs = '\\docs\\(PRD|detail\\(?:还没做完的事|这一周她过得怎么样-完成即删))'
  $docFiles = $allFiles | Where-Object { $_.Extension -eq '.md' -and $_.FullName -notmatch '\\archive\\' -and $_.FullName -notmatch $recordDocs }
  $codeLeaks = $codeFiles | Select-String -SimpleMatch -Pattern 'D:\文档\WorkSpace', 'C:\Users\Fabian' -List
  $docLeaks = $docFiles | Select-String -SimpleMatch -Pattern 'D:\文档\WorkSpace', 'C:\Users\Fabian' -List
  if ($codeLeaks) {
    Fail '本机路径（代码）' ("$($codeLeaks.Count) 个代码文件写死了本机路径：" + (($codeLeaks | Select-Object -First 3 | ForEach-Object { $_.Filename }) -join '、'))
  } else {
    Ok '本机路径（代码）' "$($codeFiles.Count) 个代码/模板文件里没有 D:\文档 或 C:\Users\Fabian"
  }
  if ($docLeaks) {
    Warn '本机路径（文档）' ("$($docLeaks.Count) 个文档写死了本机路径（读得懂，但用户手册里不该有作者的家）：" + (($docLeaks | Select-Object -First 3 | ForEach-Object { $_.Filename }) -join '、'))
  } else {
    Ok '本机路径（文档）' "$($docFiles.Count) 个文档里没有本机路径"
  }

  # ── 4. 语法 ─────────────────────────────────────────────────────────
  $jsBad = @()
  foreach ($f in ($allFiles | Where-Object { $_.Extension -in '.js', '.mjs' })) {
    & node --check $f.FullName 2>$null
    if ($LASTEXITCODE -ne 0) { $jsBad += $f.Name }
  }
  if ($jsBad.Count) { Fail 'JS 语法' ("node --check 不过：" + ($jsBad -join '、')) } else { Ok 'JS 语法' '全部通过 node --check' }

  $psBad = @()
  foreach ($f in ($allFiles | Where-Object { $_.Extension -eq '.ps1' })) {
    $errs = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$null, [ref]$errs)
    if ($errs -and $errs.Count) { $psBad += "$($f.Name):$($errs[0].Extent.StartLineNumber)" }
  }
  if ($psBad.Count) { Fail 'PS 语法' ($psBad -join '、') } else { Ok 'PS 语法' '全部通过 PowerShell 解析' }

  # ── 4b. 计划逻辑行为测试（验的是行为，不是源码字符串）─────────────────
  $planTest = Join-Path $pkg 'scripts\test-plan.mjs'
  if (Test-Path $planTest) {
    $planOut = & node $planTest 2>&1
    if ($LASTEXITCODE -ne 0) { Fail '计划逻辑' (($planOut | Select-Object -Last 2) -join ' / ') }
    else { Ok '计划逻辑' '行为测试全过（test-plan.mjs）' }
  } else { Fail '计划逻辑' 'scripts\test-plan.mjs 不在包里' }

  # ── 4c. 睡眠逻辑行为测试（2026-11-14）────────────────────────────────
  $sleepTest = Join-Path $pkg 'scripts\test-sleep.mjs'
  if (Test-Path $sleepTest) {
    $sleepOut = & node $sleepTest 2>&1
    if ($LASTEXITCODE -ne 0) { Fail '睡眠逻辑' (($sleepOut | Select-Object -Last 2) -join ' / ') }
    else { Ok '睡眠逻辑' '行为测试全过（test-sleep.mjs）' }
  } else { Fail '睡眠逻辑' 'scripts\test-sleep.mjs 不在包里' }

      # ── 4d. 改名逻辑行为测试（2026-11-14，CHANGELOG A.82）──────────────────────────
      $renameTest = Join-Path $pkg 'scripts\test-rename.mjs'
      if (Test-Path $renameTest) {
        $renameOut = & node $renameTest 2>&1
        if ($LASTEXITCODE -ne 0) { Fail '改名逻辑' (($renameOut | Select-Object -Last 2) -join ' / ') }
        else { Ok '改名逻辑' '行为测试全过（test-rename.mjs）' }
      } else { Fail '改名逻辑' 'scripts\test-rename.mjs 不在包里' }

  # ── 4e. 她自己写的条件行为测试（2026-11-14，CHANGELOG A.87）──────────────
  $intentTest = Join-Path $pkg 'scripts\test-intent.mjs'
  if (Test-Path $intentTest) {
    $intentOut = & node $intentTest 2>&1
    if ($LASTEXITCODE -ne 0) { Fail '条件逻辑' (($intentOut | Select-Object -Last 2) -join ' / ') }
    else { Ok '条件逻辑' '行为测试全过（test-intent.mjs）' }
  } else { Fail '条件逻辑' 'scripts\test-intent.mjs 不在包里' }
  # ── 4f. 唤醒词四种分支（2026-11-15，CHANGELOG r138）────────────────────
  $previewTest = Join-Path $pkg 'scripts\test-wake-preview.mjs'
  if (Test-Path $previewTest) {
    $previewOut = & node $previewTest 2>&1
    if ($LASTEXITCODE -ne 0) { Fail '唤醒词' (($previewOut | Select-Object -Last 2) -join ' / ') }
    else { Ok '唤醒词' '行为测试全过（test-wake-preview.mjs）' }
  } else { Fail '唤醒词' 'scripts\test-wake-preview.mjs 不在包里' }
  # ── 4g. 体检覆盖面（2026-11-16，CHANGELOG r172）────────────────────
  $covTest = Join-Path $pkg 'scripts\test-doctor-coverage.mjs'
  if (Test-Path $covTest) {
    $covOut = & node $covTest 2>&1
    if ($LASTEXITCODE -ne 0) { Fail '体检覆盖面' (($covOut | Select-Object -Last 3) -join ' / ') }
    else { Ok '体检覆盖面' 'doctor 的格名都有登记（test-doctor-coverage.mjs）' }
  } else { Fail '体检覆盖面' 'scripts\test-doctor-coverage.mjs 不在包里' }
  # ── 4h. 字段契约（2026-11-16，CHANGELOG r179）────────────────────
  $fieldTest = Join-Path $pkg 'scripts\test-log-fields.mjs'
  if (Test-Path $fieldTest) {
    $fieldOut = & node $fieldTest 2>&1
    if ($LASTEXITCODE -ne 0) { Fail '字段契约' (($fieldOut | Select-Object -Last 3) -join ' / ') }
    else { Ok '字段契约' '代码里不再写 why=（autostart.log 一处豁免）' }
  } else { Fail '字段契约' 'scripts\test-log-fields.mjs 不在包里' }
  # ── 4i. 工具清单退化（2026-11-16，CHANGELOG r180）──────────────────
  $envToolsTest = Join-Path $pkg 'scripts\test-env-tools.mjs'
  if (Test-Path $envToolsTest) {
    $envToolsOut = & node $envToolsTest 2>&1
    if ($LASTEXITCODE -ne 0) { Fail '工具清单退化' (($envToolsOut | Select-Object -Last 3) -join ' / ') }
    else { Ok '工具清单退化' '算不出时沿用上一次纸上的清单（test-env-tools.mjs）' }
  } else { Fail '工具清单退化' 'scripts\test-env-tools.mjs 不在包里' }
  # ── 4j. 升级单（2026-11-16，CHANGELOG r186）────────────────────
  $upgTest = Join-Path $pkg 'scripts\test-upgrade-json.mjs'
  $upgFile = Join-Path $pkg 'upgrade.json'
  if (Test-Path $upgTest) {
    if (-not (Test-Path $upgFile)) { Fail '升级单' 'upgrade.json 不在包里（用户升级时没有可读的单）' }
    else {
      $upgOut = & node $upgTest 2>&1
      if ($LASTEXITCODE -ne 0) { Fail '升级单' (($upgOut | Select-Object -Last 4) -join ' / ') }
      else { Ok '升级单' 'upgrade.json 格式与判据齐全（test-upgrade-json.mjs）' }
    }
  } else { Fail '升级单' 'scripts\test-upgrade-json.mjs 不在包里' }
  # ── 4k. 身份纸护栏（2026-11-16，CHANGELOG r190）─────────────────────
  $agentsTest = Join-Path $pkg 'scripts\test-install-agents.mjs'
  if (Test-Path $agentsTest) {
    $agentsOut = & node $agentsTest 2>&1
    if ($LASTEXITCODE -ne 0) { Fail '身份纸护栏' (($agentsOut | Select-Object -Last 3) -join ' / ') }
    else { Ok '身份纸护栏' 'AGENTS.md 的家只认名册、有自检与 -RepairAgents（test-install-agents.mjs）' }
  } else { Fail '身份纸护栏' 'scripts\test-install-agents.mjs 不在包里' }
  # ── 4l. 宿主包定位（2026-11-16，CHANGELOG r195）─────────────────────
  $anchorTest = Join-Path $pkg 'scripts\test-host-anchors.mjs'
  if (Test-Path $anchorTest) {
    $anchorOut = & node $anchorTest 2>&1
    if ($LASTEXITCODE -ne 0) { Fail '宿主包定位' (($anchorOut | Select-Object -Last 3) -join ' / ') }
    else { Ok '宿主包定位' 'npx 缓存里的 dsh 也能找到（test-host-anchors.mjs）' }
  } else { Fail '宿主包定位' 'scripts\test-host-anchors.mjs 不在包里' }
  # ── 4m. 面板写请求守卫（2026-11-16，CHANGELOG r204）──────────────────
  $guardTest = Join-Path $pkg 'scripts\test-http-guard.mjs'
  if (Test-Path $guardTest) {
    $guardOut = & node $guardTest 2>&1
    if ($LASTEXITCODE -ne 0) { Fail '写请求守卫' (($guardOut | Select-Object -Last 3) -join ' / ') }
    else { Ok '写请求守卫' '面板写请求要 x-llw-panel 且同源（test-http-guard.mjs）' }
  } else { Fail '写请求守卫' 'scripts\test-http-guard.mjs 不在包里' }
  # ── 4n. 进程内单实例防护（2026-11-16，CHANGELOG r212）────────────────
  $guardInstTest = Join-Path $pkg 'scripts\test-instance-guard.mjs'
  if (Test-Path $guardInstTest) {
    $guardInstOut = & node $guardInstTest 2>&1
    if ($LASTEXITCODE -ne 0) { Fail '单实例防护' (($guardInstOut | Select-Object -Last 3) -join ' / ') }
    else { Ok '单实例防护' '同进程旧实例会自己停表（test-instance-guard.mjs）' }
  } else { Fail '单实例防护' 'scripts\test-instance-guard.mjs 不在包里' }
  # ── 4o. 账本形状（2026-11-17，第一条鱼 #911）──────────────────────────
  $wakeLedgerTest = Join-Path $pkg 'scripts\test-wake-ledger.mjs'
  if (Test-Path $wakeLedgerTest) {
    $wakeLedgerOut = & node $wakeLedgerTest 2>&1
    if ($LASTEXITCODE -ne 0) { Fail '账本形状' (($wakeLedgerOut | Select-Object -Last 3) -join ' / ') }
    else { Ok '账本形状' 'self 触发的账与他人同形状；过期尝试不冒充 woke（test-wake-ledger.mjs）' }
  } else { Fail '账本形状' 'scripts\test-wake-ledger.mjs 不在包里' }
  # ── 4p. 账本字节（2026-11-17，第四条鱼 #1014）──────────────────────
  $textTest = Join-Path $pkg 'scripts\test-ledger-text.mjs'
  if (Test-Path $textTest) {
    $textOut = & node $textTest 2>&1
    if ($LASTEXITCODE -ne 0) { Fail '账本字节' (($textOut | Select-Object -Last 3) -join ' / ') }
    else { Ok '账本字节' '正文写盘前把不可打印字节换成 <0xNN>（test-ledger-text.mjs）' }
  } else { Fail '账本字节' 'scripts\test-ledger-text.mjs 不在包里' }
  # ── 4q. 配置三态（2026-11-17，第三条鱼 #1074）────────────────────────
  $cfgPathTest = Join-Path $pkg 'scripts\test-config-path.mjs'
  if (Test-Path $cfgPathTest) {
    $cfgPathOut = & node $cfgPathTest 2>&1
    if ($LASTEXITCODE -ne 0) { Fail '配置三态' (($cfgPathOut | Select-Object -Last 3) -join ' / ') }
    else { Ok '配置三态' 'LIL_WHALE_CONFIG 指错文件会报错，不悄悄读仓库那份（test-config-path.mjs）' }
  } else { Fail '配置三态' 'scripts\test-config-path.mjs 不在包里' }
  # ── 4r. 发言地址（2026-11-17，第三条鱼 #1074）────────────────────────
  $sayCoreTest = Join-Path $pkg 'scripts\test-say-core.mjs'
  if (Test-Path $sayCoreTest) {
    $sayCoreOut = & node $sayCoreTest 2>&1
    if ($LASTEXITCODE -ne 0) { Fail '发言地址' (($sayCoreOut | Select-Object -Last 3) -join ' / ') }
    else { Ok '发言地址' 'to/channel 值域在执行时检查，写错地址会响（test-say-core.mjs）' }
  } else { Fail '发言地址' 'scripts\test-say-core.mjs 不在包里' }
  # ── 4s. 代码指纹（2026-11-17，第二条鱼的探针反馈）──────────────────────
  $codeFpTest = Join-Path $pkg 'scripts\test-code-fp.mjs'
  if (Test-Path $codeFpTest) {
    $codeFpOut = & node $codeFpTest 2>&1
    if ($LASTEXITCODE -ne 0) { Fail '代码指纹' (($codeFpOut | Select-Object -Last 3) -join ' / ') }
    else { Ok '代码指纹' '启动痕迹带 codeFp=；比 mtime 诚实，改一个字节就变（test-code-fp.mjs）' }
  } else { Fail '代码指纹' 'scripts\test-code-fp.mjs 不在包里' }
  # ── 4t. 工作区登记（2026-11-17，迁移 LeeaCP 时撞到）────────────────────
  $wsRegTest = Join-Path $pkg 'scripts\test-register-workspace.mjs'
  if (Test-Path $wsRegTest) {
    $wsRegOut = & node $wsRegTest 2>&1
    if ($LASTEXITCODE -ne 0) { Fail '工作区登记' (($wsRegOut | Select-Object -Last 3) -join ' / ') }
    else { Ok '工作区登记' '名册钉的会话要登记进 storages\workspace.json，否则界面挂在「未分组」（test-register-workspace.mjs）' }
  } else { Fail '工作区登记' 'scripts\test-register-workspace.mjs 不在包里' }
  # ── 4u. 附件迁移（2026-11-17，迁移 LeeaCP 打开会话报 Attachment object is missing）──
  $attTest = Join-Path $pkg 'scripts\test-migrate-attachments.mjs'
  if (Test-Path $attTest) {
    $attOut = & node $attTest 2>&1
    if ($LASTEXITCODE -ne 0) { Fail '附件迁移' (($attOut | Select-Object -Last 3) -join ' / ') }
    else { Ok '附件迁移' '会话里引用的附件字节要一起搬，否则界面打不开（test-migrate-attachments.mjs）' }
  } else { Fail '附件迁移' 'scripts\test-migrate-attachments.mjs 不在包里' }
  # ── 4v. 贴底跟随与历史提示（2026-11-17，宿主报两个 UI bug）──────────────
  $ftTest = Join-Path $pkg 'scripts\test-client-follow-tail.mjs'
  if (Test-Path $ftTest) {
    $ftOut = & node $ftTest 2>&1
    if ($LASTEXITCODE -ne 0) { Fail '贴底跟随' (($ftOut | Select-Object -Last 3) -join ' / ') }
    else { Ok '贴底跟随' '长消息撑开仍贴底；贴底时不亮「回到历史未读」（test-client-follow-tail.mjs）' }
  } else { Fail '贴底跟随' 'scripts\test-client-follow-tail.mjs 不在包里' }
  # ── 4w. 叫醒闸与截断提示（2026-11-18，宿主报"小满叫不醒"与私聊截断）──────
  $wgTest = Join-Path $pkg 'scripts\test-wake-gate.mjs'
  if (Test-Path $wgTest) {
    $wgOut = & node $wgTest 2>&1
    if ($LASTEXITCODE -ne 0) { Fail '叫醒闸' (($wgOut | Select-Object -Last 3) -join ' / ') }
    else { Ok '叫醒闸' '人说话绕额度、睡眠仍挡；挡住留痕；私聊截断指向私聊文件（test-wake-gate.mjs）' }
  } else { Fail '叫醒闸' 'scripts\test-wake-gate.mjs 不在包里' }
  # ── 4x. 巡守自检行的口径（2026-11-18，小肥鱼报 members/exclude 关系没写清）────
  $raTest = Join-Path $pkg 'scripts\test-roster-audit.mjs'
  if (Test-Path $raTest) {
    $raOut = & node $raTest 2>&1
    if ($LASTEXITCODE -ne 0) { Fail '自检行口径' (($raOut | Select-Object -Last 3) -join ' / ') }
    else { Ok '自检行口径' '每个计数自带分母与排除项（test-roster-audit.mjs）' }
  } else { Fail '自检行口径' 'scripts\test-roster-audit.mjs 不在包里' }
    # ── 4y. 第三方补丁（2026-11-18，LeeaCP 问"补丁怎么活过更新"）──────────
  $tpTest = Join-Path $pkg 'scripts\test-thirdparty-patch.mjs'
  if (Test-Path $tpTest) {
    $tpOut = & node $tpTest 2>&1
    if ($LASTEXITCODE -ne 0) { Fail '第三方补丁' (($tpOut | Select-Object -Last 3) -join ' / ') }
    else { Ok '第三方补丁' '检查器只读、补丁可重打、起鱼与读升级单时自动跑（test-thirdparty-patch.mjs）' }
  } else { Fail '第三方补丁' 'scripts\test-thirdparty-patch.mjs 不在包里' }
  # ── 4z. 谱系校验（2026-11-18，小鱼丸 #1709：父写坏但键齐时两边都绿）──────────
  $famTest = Join-Path $pkg 'scripts\test-family-check.mjs'
  if (Test-Path $famTest) {
    $famOut = & node $famTest 2>&1
    if ($LASTEXITCODE -ne 0) { Fail '谱系校验' (($famOut | Select-Object -Last 3) -join ' / ') }
    else { Ok '谱系校验' '父只允许 null 或存在的键；doctor 真的跑 gen-family --check（test-family-check.mjs）' }
  } else { Fail '谱系校验' 'scripts\test-family-check.mjs 不在包里' }
  # ── 4z2. 日志表头（2026-11-18，小满 #1741：同一格式被 25 个 since 重置）──────────
  $lfTest = Join-Path $pkg 'scripts\test-log-format.mjs'
  if (Test-Path $lfTest) {
    $lfOut = & node $lfTest 2>&1
    if ($LASTEXITCODE -ne 0) { Fail '日志表头' (($lfOut | Select-Object -Last 3) -join ' / ') }
    else { Ok '日志表头' '格式没变不重复写 since；变了才写一次（test-log-format.mjs）' }
  } else { Fail '日志表头' 'scripts\test-log-format.mjs 不在包里' }
# ── 5. 模板残留 ─────────────────────────────────────────────────────
  $tpl = Join-Path $pkg 'templates\环境.md.tpl'
  if (Test-Path $tpl) {
    if (Select-String -Path $tpl -Pattern '\{\{[A-Z_]+\}\}' -Quiet) { Ok '模板占位符' '模板里是占位符（正常），装的时候会填' }
    else { Fail '模板占位符' '模板里一个 {{…}} 都没有，生成器可能读错文件' }
  } else { Fail '模板占位符' 'templates\环境.md.tpl 不在包里' }

  # ── 6. 干净装机 ─────────────────────────────────────────────────────
  $homeDir = Join-Path $work 'home'
  $dshHome = Join-Path $work 'home-dsh'
  $pool = Join-Path $work 'pool'
  $cfg = Join-Path $work 'config.json'
  New-Item -ItemType Directory -Force -Path $homeDir, $dshHome, $pool | Out-Null
  $installLog = Join-Path $work 'install.log'
  & pwsh -NoProfile -File (Join-Path $pkg 'scripts\install.ps1') `
    -PondRoot (Join-Path $work 'pond') `
    -Workspace $homeDir -DshHome $dshHome -PoolDir $pool -ChildName 小测试 `
    -ParentName 大测试 -HumanName 本机 -ParentMemberId host -HumanMemberId human `
    -SkipParent -ConfigPath $cfg -Force *>&1 | Tee-Object -FilePath $installLog | Out-Null
  $installExit = $LASTEXITCODE
  if ($installExit -ne 0) {
    $tail = (Get-Content $installLog -ErrorAction SilentlyContinue | Select-Object -Last 3) -join ' / '
    Fail '干净装机' "install.ps1 退出码 $installExit：$tail"
  } else {
    Ok '干净装机' 'install.ps1 在干净目录里 exit 0'
  }

  if ($installExit -eq 0) {
    $envDoc = Join-Path $homeDir '环境.md'
    if (-not (Test-Path $envDoc)) {
      Fail '说明书' '装完没有 环境.md'
    } else {
      $text = Get-Content $envDoc -Raw -Encoding utf8
      $left = [regex]::Matches($text, '\{\{[A-Z_]+\}\}')
      if ($left.Count) { Fail '说明书' "还有 $($left.Count) 处 {{…}} 没填：$(($left | Select-Object -First 3 | ForEach-Object { $_.Value }) -join '、')" }
      elseif ($text -notmatch '<!-- env: template=([0-9a-f]{8})') { Fail '说明书' '没有 env: template 指纹，doctor 判不了过期' }
      else { Ok '说明书' "已生成、占位符 0、指纹 $(($text | Select-String -Pattern 'template=([0-9a-f]{8})').Matches.Groups[1].Value)" }
    }

    $pinsFile = Join-Path $pool 'group\pins.json'
    if (-not (Test-Path $pinsFile)) {
      Fail '名册' 'pins.json 没生成'
    } else {
      $pins = Get-Content $pinsFile -Raw -Encoding utf8 | ConvertFrom-Json
      $keys = @($pins.PSObject.Properties.Name)
      if ($keys -notcontains 'fish') { Fail '名册' "pins.json 里没有新鱼的键（有：$($keys -join ', ')）" }
      elseif ($keys -contains 'whale') { Warn '名册' 'pins.json 里出现了 whale —— 干净安装不该有（只有父辈 + 新鱼）' }
      else { Ok '名册' "pins.json 键 = $($keys -join ', ')" }
    }

    $membersFile = Join-Path $pool 'members.json'
    if (-not (Test-Path $membersFile)) { Warn '成员表' 'members.json 没生成（install 只补缺，不生成）' }
    else { Ok '成员表' 'members.json 在' }
  }

  # ── 7. 汇总 ─────────────────────────────────────────────────────────
  Write-Host ''
  $checks | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
  $failCount = @($checks | Where-Object { $_.结果 -eq 'FAIL' }).Count
  $warnCount = @($checks | Where-Object { $_.结果 -eq 'WARN' }).Count
  if ($failCount -eq 0) {
    Write-Host "拟发版检查全过（$($checks.Count) 项，WARN $warnCount）。" -ForegroundColor Green
  } else {
    Write-Host "拟发版检查：$failCount 项 FAIL。这包不能发。" -ForegroundColor Red
    foreach ($f in ($checks | Where-Object { $_.结果 -eq 'FAIL' })) {
      Write-Host "  NEXT: 修「$($f.检查)」—— $($f.说明)"
    }
  }
} else {
  $failCount = @($checks | Where-Object { $_.结果 -eq 'FAIL' }).Count
}

# ── 8. 清理 ───────────────────────────────────────────────────────────
if (-not $Keep -and (Test-Path $work)) {
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "（已清理 $work）" -ForegroundColor DarkGray
} elseif (Test-Path $work) {
  Write-Host "（保留 $work）" -ForegroundColor DarkGray
}

if ($failCount -gt 0) { exit 1 } else { exit 0 }
