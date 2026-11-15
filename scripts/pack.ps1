#requires -Version 7.0
# 打包：把一个能带走、能装起来跑的项目副本打成 zip
#
# 用法：
#   pwsh -File scripts\pack.ps1                  # 只打 zip
#   pwsh -File scripts\pack.ps1 -Npm             # 另外把两个插件包各 pack 一份 tgz
#
# 为什么用 `git archive` 而不是 `Compress-Archive` 整个目录：
#   1. 只有跟版本库里的文件才会进来 —— tmp\、logs\、*.log、本机配置、node_modules 自然都被挡在外面，
#      不用维护一份"排除清单"，也就不会哪天漏排一个（漏过一次本机配置，见 CHANGELOG A.15）。
#   2. archive\ 里放的是她旧家的真实记录（群消息、游标），不该出现在发给别人的包里，明确排除。
#
# 产物落在 dist\ 下（不进版本库）。

[CmdletBinding()]
param(
  [string]$OutDir = (Join-Path (Split-Path -Parent $PSScriptRoot) 'dist'),
  [switch]$Npm
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo
try {
  if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

  $stamp = Get-Date -Format 'yyyyMMdd-HHmm'
  $zip = Join-Path $OutDir "lil-whale-$stamp.zip"

  # 排除清单靠"从 ls-files 里挑"而不是 pathspec magic：
  # git archive 不支持 `:(exclude)`（实测 fatal: pathspec magic not supported），
  # 而它会照样把 archive\ 打进去、还返回 0 —— 一个静默的错误包。
  $files = @(git -c core.quotepath=false ls-files | Where-Object { $_ -notlike 'archive/*' })
  if ($files.Count -eq 0) { throw 'ls-files 一个文件都没列出来，不对' }

  # --prefix：解压出来是一个 lil-whale\ 目录，而不是一堆文件撒在面前。
  git -c core.quotepath=false archive --format=zip --prefix=lil-whale/ -o $zip HEAD -- @files
  if ($LASTEXITCODE -ne 0) { throw "git archive 失败（exit $LASTEXITCODE）" }

  $size = (Get-Item $zip).Length
  $count = $files.Count
  Write-Host ("打包完成：{0}" -f $zip)
  Write-Host ("  文件 {0} 个，{1:N1} KB" -f $count, ($size / 1KB))
  Write-Host ("  不含：archive\（她的旧家记录 + 旧脚本存档）、本机配置、tmp\、logs\、node_modules\")

  if ($Npm) {
    foreach ($pkg in @('plugin\dsh-lil-whale-group', 'plugin\dsh-lil-whale-group-ui')) {
      Push-Location (Join-Path $repo $pkg)
      try {
        $tag = (Get-Content 'package.json' -Raw | ConvertFrom-Json).version
        $tgz = npm pack --pack-destination $OutDir 2>&1 | Select-Object -Last 1
        if ($LASTEXITCODE -ne 0) { throw "npm pack 失败（$pkg）：$tgz" }
        Write-Host ("  npm 包：{0}（v{1}）" -f (Join-Path $OutDir $tgz), $tag)
      } finally { Pop-Location }
    }
  }

  # 只留最新 1 个 zip：产物堆起来会把 dist 变成垃圾场（而且以前还被 git add -A 误提交过一次）
  $zips = @(Get-ChildItem $OutDir -Filter 'lil-whale-*.zip' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
  foreach ($old in ($zips | Select-Object -Skip 1)) {
    Remove-Item -LiteralPath $old.FullName -Force
    Write-Host ("  删除旧包：{0}" -f $old.Name)
  }
} finally { Pop-Location }
