#requires -Version 7.0
<#
.SYNOPSIS
  给「画画」装一个不靠浏览器的渲染器（resvg）。

.DESCRIPTION
  为什么要有这一步：2026-11-15 小肥鱼在沙箱里渲染失败，Chromium 报
  `FATAL:mojo/.../platform_channel.cc:187] Check failed: 拒绝访问 (0x5)`
  ——沙箱挡了浏览器的命名管道（IPC），不是 SVG 的问题。浏览器这条路在鱼的家
  里走不通，所以换成 resvg：一段本地代码，不建 IPC、不联网、不落 profile。

  装到 `pool\tools\svg-render\`（不跟着 app 进 git；node_modules 本来就不该进库）。
  装完她会用这条命令：
    node ..\..\pool\tools\svg-render\render.mjs -In 画\名字.svg

  用法：
    pwsh -File app\scripts\setup-svg-render.ps1
    pwsh -File app\scripts\setup-svg-render.ps1 -Force   # 重装
#>
param([switch]$Force)

$ErrorActionPreference = 'Stop'

$appRoot = Split-Path -Parent $PSScriptRoot          # …\lil-whale\app
$pondRoot = Split-Path -Parent $appRoot              # …\lil-whale
$target = Join-Path $pondRoot 'pool\tools\svg-render'
$source = Join-Path $PSScriptRoot 'svg-render.mjs'

function Fail([string]$msg) {
  Write-Output "error: $msg"
  Write-Output 'NEXT: 先确认 node/npm 在 PATH；公司网络可能需要先配 npm 镜像'
  exit 1
}

if (-not (Test-Path -LiteralPath $source)) { Fail "找不到渲染器源码：$source" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail '找不到 node（渲染器是 node 脚本）' }

New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -LiteralPath $source -Destination (Join-Path $target 'render.mjs') -Force

$pkgPath = Join-Path $target 'package.json'
if ($Force -or -not (Test-Path -LiteralPath $pkgPath)) {
  '{"name":"llw-svg-render","private":true,"type":"module"}' |
    Set-Content -LiteralPath $pkgPath -Encoding utf8
}

$hasResvg = Test-Path -LiteralPath (Join-Path $target 'node_modules\@resvg\resvg-js\package.json')
if ($Force -or -not $hasResvg) {
  Push-Location $target
  try {
    & npm install @resvg/resvg-js --no-audit --no-fund 2>&1 | ForEach-Object { Write-Output $_ }
    if ($LASTEXITCODE -ne 0) { Fail "npm install 失败（exit $LASTEXITCODE）" }
  } finally {
    Pop-Location
  }
}

# 冒烟：真渲染一张
$smokeSvg = Join-Path $target '_smoke.svg'
$smokePng = Join-Path $target '_smoke.png'
@'
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80">
  <rect width="120" height="80" fill="#0b2230"/>
  <circle cx="60" cy="40" r="24" fill="#5b9bd5"/>
</svg>
'@ | Set-Content -LiteralPath $smokeSvg -Encoding utf8
& node (Join-Path $target 'render.mjs') -In $smokeSvg -Out $smokePng
$rc = $LASTEXITCODE
Remove-Item -LiteralPath $smokeSvg, $smokePng -Force -ErrorAction SilentlyContinue
if ($rc -ne 0) { Fail '冒烟渲染失败（render.mjs 跑不通）' }

Write-Output "ok 渲染器已就绪：$target\render.mjs"
