// render.mjs —— SVG → PNG，用 resvg（Rust 写的纯软件光栅化器），不碰浏览器。
//
// 为什么要换：2026-11-15 小肥鱼在沙箱里渲染失败，Chromium 报
//   FATAL:mojo/public/cpp/platform/platform_channel.cc:187] Check failed: 拒绝访问 (0x5)
// 根因是沙箱挡了 Chromium 的命名管道（IPC），不是 SVG 的问题。她试过 --no-sandbox /
// --single-process / --headless=old，都不行——浏览器这条路在她的沙箱里走不通。
//
// resvg 是一段本地代码，不建 IPC、不联网、不落 profile 目录，只读字体、读 SVG、写 PNG。
//
// 用法（在她家根目录）：
//   node ..\..\pool\tools\svg-render\render.mjs -In 画\鲸落.svg
//   node ..\..\pool\tools\svg-render\render.mjs -In 画\鲸落.svg -Out 画\鲸落.png
//   node ..\..\pool\tools\svg-render\render.mjs -In 画\x.svg -Width 1200 -Bg '#0b2230'
//
// 画布尺寸：-Width/-Height > SVG 自己的 width/height > viewBox > 800x600。
// 退出码：0 = 成功，打印一行 `ok <png> <字节> <宽>x<高>`；1 = 失败，打印 `error:` + `NEXT:`。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, extname, basename } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

function fail(msg) {
  console.log(`error: ${msg}`);
  console.log('NEXT: 先跑 run\\svg-lint.ps1 看是不是 XML/越界问题；SVG 根元素要有 xmlns="http://www.w3.org/2000/svg"');
  process.exit(1);
}

const args = process.argv.slice(2);
const opt = { In: '', Out: '', Width: 0, Height: 0, Bg: '', Transparent: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-In' || a === '--in') opt.In = args[++i] ?? '';
  else if (a === '-Out' || a === '--out') opt.Out = args[++i] ?? '';
  else if (a === '-Width' || a === '--width') opt.Width = Number(args[++i] ?? 0);
  else if (a === '-Height' || a === '--height') opt.Height = Number(args[++i] ?? 0);
  else if (a === '-Bg' || a === '--bg') opt.Bg = args[++i] ?? '';
  else if (a === '-Transparent' || a === '--transparent') opt.Transparent = true;
  else fail(`不认识的参数：${a}`);
}
if (!opt.In) fail('缺 -In（要渲染的 .svg）');

const inPath = resolve(opt.In);
if (!existsSync(inPath)) fail(`找不到文件：${opt.In}`);
if (extname(inPath).toLowerCase() !== '.svg') fail(`只接受 .svg：${inPath}`);

let svg = readFileSync(inPath, 'utf8');
if (!svg.includes('<svg')) fail(`这不是 SVG（里面没有 <svg>）：${inPath}`);

// 画布尺寸
let w = Number.isFinite(opt.Width) && opt.Width > 0 ? Math.round(opt.Width) : 0;
let h = Number.isFinite(opt.Height) && opt.Height > 0 ? Math.round(opt.Height) : 0;
if (!w) {
  const m = svg.match(/<svg[^>]*?\swidth\s*=\s*"([0-9.]+)/);
  if (m) w = Math.round(Number(m[1]));
}
if (!h) {
  const m = svg.match(/<svg[^>]*?\sheight\s*=\s*"([0-9.]+)/);
  if (m) h = Math.round(Number(m[1]));
}
if (!w || !h) {
  const m = svg.match(/viewBox\s*=\s*"([0-9.\-\s]+)"/);
  if (m) {
    const p = m[1].split(/[\s,]+/).filter(Boolean);
    if (p.length >= 4) {
      if (!w) w = Math.round(Number(p[2]));
      if (!h) h = Math.round(Number(p[3]));
    }
  }
}
if (!w || !h) { w = 800; h = 600; }
if (w > 4096 || h > 4096) fail(`画布太大（${w}x${h}）；上限 4096`);

const outPath = resolve(opt.Out || inPath.replace(/\.svg$/i, '.png'));
const outDir = dirname(outPath);
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const options = {
  fitTo: { mode: 'width', value: w },
  font: { loadSystemFonts: true },
};
if (!opt.Transparent) {
  options.background = opt.Bg || '#ffffff';
}

let png;
try {
  const resvg = new Resvg(svg, options);
  const rendered = resvg.render();
  png = rendered.asPng();
  if (opt.Height && rendered.height !== h) {
    // 只给了 -Height 时按宽度缩放，高度由比例决定；这里不做二次拉伸，只提示
  }
} catch (e) {
  fail(`渲染失败：${e && e.message ? e.message : e}`);
}
writeFileSync(outPath, png);
const dims = `${Math.round(Number((png.readUInt32BE?.(16) ?? 0)))}x${Math.round(Number((png.readUInt32BE?.(20) ?? 0)))}`;
console.log(`ok ${outPath} ${png.length}B ${dims}`);
