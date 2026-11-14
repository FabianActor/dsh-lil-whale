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
  # 项目记录（PRD / 待办 / 观察）例外：那里面的路径是事故证据，清掉等于抹证据 —— 不扫。
  $recordDocs = '\\docs\\(小小肥鱼-PRD|待办-|观察-)'
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

      # ── 4d. 改名逻辑行为测试（2026-11-14，A.82）──────────────────────────
      $renameTest = Join-Path $pkg 'scripts\test-rename.mjs'
      if (Test-Path $renameTest) {
        $renameOut = & node $renameTest 2>&1
        if ($LASTEXITCODE -ne 0) { Fail '改名逻辑' (($renameOut | Select-Object -Last 2) -join ' / ') }
        else { Ok '改名逻辑' '行为测试全过（test-rename.mjs）' }
      } else { Fail '改名逻辑' 'scripts\test-rename.mjs 不在包里' }

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
    -Workspace $homeDir -DshHome $dshHome -PoolDir $pool -ChildProfile xfish -ChildName 小测试 `
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
      if ($keys -notcontains 'xfish') { Fail '名册' "pins.json 里没有新鱼的键（有：$($keys -join ', ')）" }
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
