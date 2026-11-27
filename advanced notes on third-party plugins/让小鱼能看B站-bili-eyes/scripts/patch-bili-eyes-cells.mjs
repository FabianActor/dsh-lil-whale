#!/usr/bin/env node
// 给 dsh-bili-eyes 的格子清单加上"落点"：格号带总数、每格带 BV 号。
//
// 起因（2026-11-26，群里小肥鱼与小满）：工具输出的「（这一格里拼了 9 张小图）」
// 不带片名也不带这次采样的格数，转手到另一条视频上照样读得通 —— 句子离开了落点
// 还能读，就会有人（包括我）把它搬到别处。做法是把坐标写进句子本身：
//
//   旧：格1 0:00–0:02（这一格里拼了 9 张小图）
//   新：格1/6 0:00–0:02 · bc=BV1QoWb6FELj（这一格里拼了 9 张小图）
//
// 判据（小满给的）：写一条正则，能从任意转发文本里把落点捞回来。
//   /bc=(BV[0-9A-Za-z]{10})/  与  /格(\d+)\/(\d+)/
//
// 用法：
//   node scripts\patch-bili-eyes-cells.mjs --check      只读，看各安装打没打
//   node scripts\patch-bili-eyes-cells.mjs --dry-run    打印将改什么，不写
//   node scripts\patch-bili-eyes-cells.mjs              真打（写前备份 .orig-cells-<时间>）
//
// 第三方补丁不进 CHANGELOG（记法第 4 条），只进本目录的笔记。

import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const MARK = 'bc=' + '${bc}'; // 幂等标记：改动后在源码里出现这段
// 2026-11-27：这里原来用 `new URL(import.meta.url).pathname`，中文与空格会被百分号编码
// （`%E6%96%87...`），`existsSync(<鱼塘根>\homes)` 恒为假 ⇒ 只扫到宿主那份，
// 四条鱼一个都没扫到，而脚本照样打印 ok、退出码 0。别用 pathname，用 fileURLToPath。
const here = dirname(fileURLToPath(import.meta.url));

const args = new Set(process.argv.slice(2));
const dry = args.has('--dry-run');
const check = args.has('--check');

function pondRoot() {
  // <仓库根>\app\advanced notes ...\scripts\ → 上四级是鱼塘根
  let p = here;
  for (let i = 0; i < 4; i += 1) p = dirname(p);
  return p;
}

function candidates() {
  const out = [];
  const push = (p) => { if (existsSync(p) && !out.includes(p)) out.push(p); };
  push(join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', 'dsh-bili-eyes', 'src', 'look.js'));
  const homes = join(pondRoot(), 'homes');
  if (existsSync(homes)) {
    for (const key of readdirSync(homes)) {
      push(join(homes, key, 'dsh-home', 'profiles', key, 'node_modules', 'dsh-bili-eyes', 'src', 'look.js'));
    }
  }
  return out;
}

// 2026-11-27 小肥鱼：五份安装同版本号、两种内容 ⇒ 版本号不是"大家跑的是同一份"的凭据。
// `--check` 除了看每份打没打，还要比"已打的那些彼此是不是同一份"（sha12），不等就点名。
function sha12(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12);
}

// 2026-11-27 小肥鱼："分母不能自己数自己"——"这次扫到几份"如果由扫描本身给出，
// 扫 1 份和扫 5 份都是它说了算。所以另取一个数当分母：名册里有几条带 dshHome 的鱼，
// 就按名册逐条拼出"应该在哪"的路径，用 existsSync 直接看它在不在；在、但没进候选 ⇒ 扫描漏了。
// 候选份数 ≠ 这个应到的份数就红，并点名少了谁。
function expectedInstalls() {
  const rosterFile = join(pondRoot(), 'pool', 'members.json')
  const out = []
  if (!existsSync(rosterFile)) return { paths: out, why: `名册不在：${rosterFile}` }
  let members = {}
  try {
    const doc = JSON.parse(readFileSync(rosterFile, 'utf8'))
    members = doc.members ?? doc
  } catch (error) {
    return { paths: out, why: `名册读不了：${error.message}` }
  }
  for (const [key, m] of Object.entries(members)) {
    if (!m || typeof m !== 'object' || !m.dshHome) continue
    if (m.lifecycle === 'archived') continue
    out.push({ key, path: join(m.dshHome, 'profiles', key, 'node_modules', 'dsh-bili-eyes', 'src', 'look.js') })
  }
  return { paths: out, why: null }
}

const OLD_CELL = /const tiles = c\.sub \? `（这一格里拼了 \$\{c\.sub \* c\.sub\} 张小图）` : '';\r?\n(\s*)lines\.push\(`格\$\{c\.i\} \$\{fmtDur\(c\.t_start\)\}–\$\{fmtDur\(c\.t_end\)\}\$\{tiles\}/;
const NEW_CELL = [
  "const tiles = c.sub ? `（这一格里拼了 ${c.sub * c.sub} 张小图）` : '';",
  "$1const total = (result.sheets ?? []).reduce((n, s) => n + (s.cells?.length ?? 0), 0);",
  "$1const bcTag = bc ? ` · bc=${bc}` : '';",
  "$1lines.push(`格${c.i}${total > 0 ? `/${total}` : ''} ${fmtDur(c.t_start)}–${fmtDur(c.t_end)}${bcTag}${tiles}",
].join('\n');

function patchText(src) {
  let t = src;
  const steps = [];

  if (!t.includes('const bc = String(opts.bc')) {
    const anchor = 'export function compactCells(result, maxCellChars, opts = {}) {\n  const lines = [];';
    if (!t.includes(anchor)) return { ok: false, why: '锚点不在：compactCells 开头' };
    t = t.replace(anchor, `${anchor}\n  const bc = String(opts.bc ?? '').trim();`);
    steps.push('compactCells 读 opts.bc');
  }

  if (!t.includes('bcTag')) {
    if (!OLD_CELL.test(t)) return { ok: false, why: '锚点不在：格子那一行' };
    t = t.replace(OLD_CELL, NEW_CELL);
    steps.push('格子行带 格N/总数 与 bc=');
  }

  const callers = [
    ['{ loginState: login.state, loginError: login.error })', '{ loginState: login.state, loginError: login.error, bc: meta.bvid })', 'look 的 fitCells 传 bc'],
    ['compactCells(result, DETAIL_CHARS.med, { loginState: login.state, loginError: login.error })', 'compactCells(result, DETAIL_CHARS.med, { loginState: login.state, loginError: login.error, bc: meta.bvid })', 'zoom 的 compactCells 传 bc'],
    ['fitCells(result, room, DETAIL_CHARS[detail])', 'fitCells(result, room, DETAIL_CHARS[detail], { bc: meta.bvid })', '本机视频的 fitCells 传 bc'],
  ];
  for (const [from, to, label] of callers) {
    if (t.includes(to)) continue;
    if (!t.includes(from)) return { ok: false, why: `锚点不在：${label}` };
    t = t.replace(from, to);
    steps.push(label);
  }
  return { ok: true, text: t, steps };
}

let bad = 0;
const files = candidates();
if (!files.length) { console.log('xx 没找到任何 dsh-bili-eyes 安装'); process.exit(1); }
const patchedHashes = new Map();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const patched = src.includes('bcTag') && src.includes('bc: meta.bvid');
  if (check) {
    const h = sha12(f);
    console.log(`${patched ? 'ok' : 'xx'} ${patched ? '已打' : '未打'} sha12=${h} ${f}`);
    if (!patched) bad += 1;
    else patchedHashes.set(h, [...(patchedHashes.get(h) ?? []), f]);
    continue;
  }
  if (patched) { console.log(`ok 已打 ${f}`); continue; }
  const r = patchText(src);
  if (!r.ok) { console.log(`xx ${f}：${r.why}`); bad += 1; continue; }
  if (dry) { console.log(`ok 将改 ${f}（${r.steps.join(' / ')}）`); continue; }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
  copyFileSync(f, `${f}.orig-cells-${stamp}`);
  writeFileSync(f, r.text, 'utf8');
  console.log(`ok 已打 ${f}（${r.steps.join(' / ')}）`);
}
if (check) {
  if (patchedHashes.size > 1) {
    console.log('xx 补丁内容不齐（同版本号、不同内容 ⇒ 版本号不能当"同一份"的凭据）');
    for (const [h, list] of patchedHashes) console.log(`   sha12=${h} ×${list.length}: ${list.map((f) => f.split('dsh-home')[0] || f).join(' | ')}`);
    bad += 1;
  } else if (patchedHashes.size === 1) {
    console.log(`ok 已打的 ${[...patchedHashes.values()][0].length} 份内容一致（sha12=${[...patchedHashes.keys()][0]}）`);
  }

  // 分母不能自己数自己：候选份数要跟"名册说应该有几份"对上。
  const expect = expectedInstalls();
  const seen = new Set(files.map((f) => f.toLowerCase()));
  const missing = expect.paths.filter((e) => existsSync(e.path) && !seen.has(e.path.toLowerCase()));
  const installed = expect.paths.filter((e) => existsSync(e.path));
  if (expect.why) {
    console.log(`!! 没有独立的份数分母（${expect.why}）——这次只证明"扫到的这些"，不证明"该扫的都扫到了"`);
  } else if (missing.length > 0) {
    console.log(`xx 扫描漏了 ${missing.length} 份：磁盘上有、候选里没有 ⇒ 候选份数(${files.length}) < 应到份数(${installed.length})`);
    for (const m of missing) console.log(`   ${m.key}: ${m.path}`);
    bad += 1;
  } else {
    console.log(`ok 候选 ${files.length} 份，名册应到的 ${installed.length} 份一个不缺（独立分母：pool\\members.json）`);
  }

  if (bad) process.exit(1);
}
