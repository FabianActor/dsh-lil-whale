#requires -Version 7.0
<#
.SYNOPSIS
  把一张 SVG 渲染成 PNG（本机 Edge 无头模式，不联网）。只在宿主可用：
  沙箱里的鱼起不来浏览器（Chromium 要命名管道，2026-11-15 实测被挡），她用 scripts\svg-render.mjs。

.DESCRIPTION
  画画这件事的闭环是「写 → 看 → 改」。SVG 是文本，鱼能写；但看不见就没法改。
  这个脚本只负责渲染，不判断画得好不好、像不像。

  用法：
    pwsh -File render-svg.ps1 -In 画\鱼.svg
    pwsh -File render-svg.ps1 -In 画\鱼.svg -Out 画\鱼.png -Width 800 -Height 600
    pwsh -File render-svg.ps1 -In 画\鱼.svg -Transparent

  画布尺寸：-Width/-Height > SVG 自己的 width/height > viewBox > 800x600。

  退出码：0 = 渲染成功并打印一行 `ok <png> <字节> <宽>x<高>`；1 = 失败并给 NEXT 行。
#>
param(
  [Parameter(Mandatory = $true)][string]$In,
  [string]$Out = '',
  [int]$Width = 0,
  [int]$Height = 0,
  [string]$Bg = '#ffffff',
  [switch]$Transparent
)

$ErrorActionPreference = 'Stop'

function Fail([string]$msg) {
  Write-Output "error: $msg"
  Write-Output 'NEXT: 检查 -In 路径；SVG 根元素要有 xmlns="http://www.w3.org/2000/svg"；实在不行把它发群里让人看一眼'
  exit 1
}

if (-not (Test-Path -LiteralPath $In)) { Fail "找不到文件：$In" }
$inPath = (Resolve-Path -LiteralPath $In).Path
if ([IO.Path]::GetExtension($inPath).ToLowerInvariant() -ne '.svg') { Fail "只接受 .svg：$inPath" }

$svg = [IO.File]::ReadAllText($inPath)
if ($svg -notmatch '<svg') { Fail "这不是 SVG（里面没有 <svg>）：$inPath" }

# 去掉 XML 声明和 DOCTYPE —— 内联进 HTML 时它们不合法
$svg = [regex]::Replace($svg, '^\s*<\?xml[^>]*\?>\s*', '')
$svg = [regex]::Replace($svg, '^\s*<!DOCTYPE[^>]*>\s*', '', 'IgnoreCase')

# 画布尺寸
$w = $Width
$h = $Height
if ($w -le 0) {
  $mw = [regex]::Match($svg, '<svg[^>]*?\swidth\s*=\s*"([0-9.]+)')
  if ($mw.Success) { $w = [int][math]::Round([double]$mw.Groups[1].Value) }
}
if ($h -le 0) {
  $mh = [regex]::Match($svg, '<svg[^>]*?\sheight\s*=\s*"([0-9.]+)')
  if ($mh.Success) { $h = [int][math]::Round([double]$mh.Groups[1].Value) }
}
if ($w -le 0 -or $h -le 0) {
  $mv = [regex]::Match($svg, 'viewBox\s*=\s*"([0-9.\-\s]+)"')
  if ($mv.Success) {
    $parts = $mv.Groups[1].Value -split '[\s,]+' | Where-Object { $_ -ne '' }
    if ($parts.Count -ge 4) {
      if ($w -le 0) { $w = [int][math]::Round([double]$parts[2]) }
      if ($h -le 0) { $h = [int][math]::Round([double]$parts[3]) }
    }
  }
}
if ($w -le 0 -or $h -le 0) { $w = 800; $h = 600 }
if ($w -gt 4096 -or $h -gt 4096) { Fail "画布太大（${w}x${h}）；上限 4096，改小一点或给 -Width/-Height" }

# 输出路径
if ([string]::IsNullOrWhiteSpace($Out)) {
  $Out = [IO.Path]::ChangeExtension($inPath, '.png')
}
$outPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Out)
$outDir = [IO.Path]::GetDirectoryName($outPath)
if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }

# Edge
$edge = $env:LIL_WHALE_EDGE
if ([string]::IsNullOrWhiteSpace($edge)) {
  $candidates = @(
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Google\Chrome\Application\chrome.exe'
  )
  foreach ($c in $candidates) { if (Test-Path -LiteralPath $c) { $edge = $c; break } }
}
if ([string]::IsNullOrWhiteSpace($edge) -or -not (Test-Path -LiteralPath $edge)) {
  Fail '找不到 Edge/Chrome（渲染要借它的无头模式）。可以设环境变量 LIL_WHALE_EDGE 指向浏览器 exe'
}

$bgColor = if ($Transparent) { 'transparent' } else { $Bg }

$tmp = Join-Path $env:TEMP ('llw-svg-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
  $htmlPath = Join-Path $tmp 'page.html'
  $html = '<!doctype html><html><head><meta charset="utf-8"><style>' +
    "html,body{margin:0;padding:0;width:${w}px;height:${h}px;background:$bgColor}" +
    "svg{display:block;width:${w}px;height:${h}px}" +
    '</style></head><body>' + $svg + '</body></html>'
  [IO.File]::WriteAllText($htmlPath, $html, [Text.UTF8Encoding]::new($false))

  $fileUrl = 'file:///' + ($htmlPath -replace '\\', '/')
  $profileDir = Join-Path $tmp 'profile'
  $chromeArgs = @(
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking',
    "--user-data-dir=$profileDir",
    "--window-size=$w,$h",
    "--screenshot=$outPath",
    $fileUrl
  )
  & $edge @chromeArgs 2>&1 | Out-Null

  if (-not (Test-Path -LiteralPath $outPath)) { Fail "浏览器没写出 PNG：$outPath" }
  $info = Get-Item -LiteralPath $outPath
  if ($info.Length -le 0) { Fail "PNG 是空的：$outPath" }
  $dims = ''
  try {
    Add-Type -AssemblyName System.Drawing
    $img = [System.Drawing.Image]::FromFile($outPath)
    $dims = "$($img.Width)x$($img.Height)"
    $img.Dispose()
  } catch {
    $dims = '?'
  }
  Write-Output "ok $outPath $($info.Length)B $dims"
  exit 0
} finally {
  try { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue } catch { }
}
