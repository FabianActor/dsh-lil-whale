// 给 dsh-bili-eyes 打一个小补丁：把「转写失败」和「没人说话」分开。
//
// 背景（2026-11-18，LeeaCP 读代码发现的）：
//   dsh-bili-eyes 的 src/look.js 里有一张 TRANSCRIPT_NOTE 表，只登记了 no-key / none 两句。
//   storyboard 实际会产出 asr-failed / file-failed / no-audio 这些状态，表里没有 →
//   代码掉进下一个分支（speechRate === 0），屏幕上写「（这段基本没人说话：音乐或环境声）」。
//   转写挂了，纸上却写着没人说话——用一句自信的假话代替「没听成」。
//   真实原因就在 result.transcript.error 里，原代码只读了 .source。
//
// 用法：
//   node app\scripts\patch-bili-eyes-note.mjs [--pond <鱼塘根>] [--dry-run] [--check] [--detach]
//   --check   只检查是否已打补丁；有未打的 exit 1（给体检/发版检查用）
//   --detach  给已经打过的安装断开与 pnpm store 的硬链接，并把 store 那份恢复成原样
//
// 注意：打的是 node_modules 里的第三方插件代码，**重装或升级插件会覆盖**；升级后重跑本脚本。
// 上游仓库：https://github.com/QiuYeDx/dsh-bili-eyes
//
// 2026-11-18 小满验出「--check 会顺手打补丁」：检查器不能在检查时改被检查的东西。
// 同一天小鱼丸验出两处措辞：①同一条输出里「可以打（未写入）」和「本次打 1」打架
// ②「打了一半」（标记在、推送句没补）被说成「版本可能变了」——两种原因要分开说。
// 另按小满的账：打补丁时留一份 look.js.orig-<版本>（不覆盖已有），让「能重打」和「能回退」是同一层。
//
// 2026-11-18 LeeaCP：node_modules 里的 look.js 与 pnpm store 是同一个 inode（硬链接）。
// 原地写会把 store 里那份也改掉；pnpm 校验内容 hash 时发现名字与内容对不上，install/verify
// 可能重新解包，补丁就没了——不用等升级。所以从今天起：写入前先断开硬链接（写临时文件再 rename，
// 得到独立 inode），并把 store 那份恢复成上游原样；以后跑完 pnpm install 顺手 --check。

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const opt = (name, def = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const dryRun = argv.includes('--dry-run');
const checkOnly = argv.includes('--check');
const detachMode = argv.includes('--detach');
const readOnly = dryRun || checkOnly;
const pondRoot = path.resolve(String(opt('pond', path.resolve(APP_ROOT, '..'))));

const MARK = '// 2026-11-18 本地补丁：转写/台词文件失败时，不能掉进「没人说话」那句';

const NOTE_RE = /const TRANSCRIPT_NOTE = \{[\s\S]*?\n\};/;
const NOTE_NEW = (eol) => [
  'const TRANSCRIPT_NOTE = {',
  "  'no-key': '没有台词：本机转写服务没开，也没有字幕',",
  '  none: \'没有台词\',',
  `  ${MARK}`,
  "  'asr-failed': '台词没转成：转写服务报错了（不是没人说话）',",
  "  'file-failed': '台词文件读不了（不是没人说话）',",
  "  'no-audio': '这段没有音轨（不是没人说话）',",
  '};',
].join(eol);

const PUSH_OLD_RE = /if \(src && TRANSCRIPT_NOTE\[src\]\) lines\.push\(`（\$\{TRANSCRIPT_NOTE\[src\]\}）`\);/;
const PUSH_NEW = (eol) => [
  'if (src && TRANSCRIPT_NOTE[src]) {',
  "    const why = String(result.transcript?.error ?? '').trim().replace(/\\s+/g, ' ');",
  "    lines.push(`（${TRANSCRIPT_NOTE[src]}${why ? `；原因：${why.slice(0, 160)}` : ''}）`);",
  '  }',
].join(eol);

function candidates() {
  const out = [];
  const homes = path.join(pondRoot, 'homes');
  if (!fs.existsSync(homes)) return out;
  for (const home of fs.readdirSync(homes)) {
    const profiles = path.join(homes, home, 'dsh-home', 'profiles');
    if (!fs.existsSync(profiles)) continue;
    for (const profile of fs.readdirSync(profiles)) {
      const pkgDir = path.join(profiles, profile, 'node_modules', 'dsh-bili-eyes');
      const file = path.join(pkgDir, 'src', 'look.js');
      if (fs.existsSync(file)) out.push({ member: home, file, pkgDir });
    }
  }
  return out;
}

function versionOf(pkgDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    return String(pkg.version || '').trim();
  } catch {
    return '';
  }
}

// ---- 硬链接（pnpm store）处理 ----
// node_modules 里的文件通常与 pnpm store 是同一个 inode；原地写会把 store 那份也改掉。
// Windows 上用 `fsutil hardlink list` 列出同 inode 的所有路径（输出是卷内路径，要拼回盘符）。

function normPath(p) {
  return path.resolve(p).toLowerCase();
}

function hardLinksOf(file) {
  if (process.platform !== 'win32') return [];
  try {
    const out = execFileSync('fsutil', ['hardlink', 'list', file], { encoding: 'utf8' });
    const root = path.parse(path.resolve(file)).root; // 例如 "D:\"
    return out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      // fsutil 输出的是卷内路径（"\"开头，不带盘符）：拼回文件所在卷的盘符。
      // 注意不能交给 path.isAbsolute 判——"\"开头的路径在 Node 里也算绝对，
      // 会被解析到"当前盘"而不是"文件所在盘"（2026-11-18 测试在 C 盘临时目录踩到）。
      .map((p) => (/^[A-Za-z]:[\\/]/.test(p) ? p : path.join(root, p.replace(/^[\\/]+/, ''))));
  } catch {
    return [];
  }
}

// 写补丁前先断开与 store 的硬链接，并把 store 那份恢复成打补丁前的内容。
// 返回是否发生了断开（给计数用）。
function writePatched(t, next) {
  let nlink = 1;
  try {
    nlink = fs.statSync(t.file).nlink;
  } catch {
    nlink = 1;
  }
  if (nlink <= 1) {
    fs.writeFileSync(t.file, next, 'utf8');
    return false;
  }
  const before = fs.readFileSync(t.file, 'utf8');
  const links = hardLinksOf(t.file).filter((p) => normPath(p) !== normPath(t.file));
  // 1) 先断开自己：写临时文件再 rename（rename 只换目录项，新文件是独立 inode）
  const tmp = `${t.file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, next, 'utf8');
  fs.renameSync(tmp, t.file);
  // 2) store 那份恢复成补丁前的内容：优先用 .orig-<版本>，没有就用刚读到的原内容
  const orig = origPath(t);
  const original = fs.existsSync(orig) ? fs.readFileSync(orig, 'utf8') : before;
  for (const p of links) {
    if (p.includes(`${path.sep}profiles${path.sep}`)) continue; // 别的鱼那份各打各的
    try {
      if (fs.readFileSync(p, 'utf8') !== original) fs.writeFileSync(p, original, 'utf8');
    } catch {
      /* 没有权限就不硬来，--check 会报告 store 仍是补丁内容 */
    }
  }
  return true;
}

// --detach：把「已经打过补丁、但仍与 store 共享 inode」的安装批量断开，并恢复 store。
function detachGroup() {
  const group = targets.filter((t) => {
    try {
      return fs.statSync(t.file).nlink > 1;
    } catch {
      return false;
    }
  });
  if (group.length === 0) return 0;
  const links = hardLinksOf(group[0].file);
  const origSample = group.map((t) => origPath(t)).find((p) => fs.existsSync(p));
  const original = origSample ? fs.readFileSync(origSample, 'utf8') : null;
  if (original === null) {
    console.log('! 没有找到 .orig-* 备份：store 那份无法恢复（补丁内容还在 store 里）；重装插件或手动恢复后再 --check');
  }
  let detached = 0;
  for (const t of group) {
    const cur = fs.readFileSync(t.file, 'utf8'); // 保持当前内容（补丁版）
    const tmp = `${t.file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, cur, 'utf8');
    fs.renameSync(tmp, t.file);
    detached += 1;
    console.log(`— ${t.member}: 已断开与 pnpm store 的硬链接（内容保持补丁版）`);
  }
  for (const p of links) {
    if (p.includes(`${path.sep}profiles${path.sep}`)) continue;
    if (original === null) continue;
    try {
      if (fs.readFileSync(p, 'utf8') !== original) fs.writeFileSync(p, original, 'utf8');
      console.log(`— pnpm store 已恢复原样：${p}`);
    } catch {
      console.log(`! pnpm store 恢复失败（没有权限）：${p}`);
    }
  }
  return detached;
}

const targets = candidates();
if (targets.length === 0) {
  console.error('没有找到任何 dsh-bili-eyes 安装（扫 homes\\<键>\\dsh-home\\profiles\\*\\node_modules\\dsh-bili-eyes）');
  process.exit(2);
}

// 2026-11-18 LeeaCP：已经打过的安装如果是原地写的，store 里那份也是补丁内容。
// 先把这些硬链接断开、把 store 恢复原样（--detach）。
const detached = detachMode ? detachGroup() : 0;

let storeWarningShown = false;

let patchable = 0;   // 可以打 / 本次打
let halfFixed = 0;   // 只打了一半，本次补上另一半
let already = 0;
let halfStuck = 0;   // 只打了一半，且缺的那半找不到落点（要人拿 orig 回滚）
let failed = 0;      // 找不到落点等
for (const t of targets) {
  const text = fs.readFileSync(t.file, 'utf8');
  const hasMark = text.includes(MARK);
  const hasPush = /const why = String\(result\.transcript\?\.error/.test(text);
  if (hasMark && hasPush) {
    already += 1;
    console.log(`— ${t.member}: 已打过补丁`);
    if (!detachMode && !storeWarningShown) {
      let nlink = 1;
      try {
        nlink = fs.statSync(t.file).nlink;
      } catch {
        nlink = 1;
      }
      if (nlink > 1) {
        storeWarningShown = true;
        console.log('  （注意：这份 look.js 还与 pnpm store 共享 inode —— 补丁可能也改了 store；跑一次 --detach 断开并把 store 恢复原样）');
      }
    }
    continue;
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  if (hasMark !== hasPush) {
    // 只打了一半：缺哪半补哪半（2026-11-18 小鱼丸：只看见、不修，重打也没用）
    const missingNote = !hasMark;      // 文案表那半没打
    const canFixMissing = missingNote ? NOTE_RE.test(text) : PUSH_OLD_RE.test(text);
    const which = missingNote ? '标记/文案表' : '推送句';
    if (!canFixMissing) {
      halfStuck += 1;
      console.log(`✗ ${t.member}: 标记在、${which}没找到落点 → ${t.file}`);
      console.log('  判不了：可能是「只打了一半」，也可能是上游自己修了这句——我们的检查用的是自己写下的措辞，不是语义。');
      console.log(`  下一步：先看 diff——把 ${path.basename(t.file)} 与 ${path.basename(origPath(t))} 对一下；若上游已自行修复，不要回滚。`);
      console.log(`  真要回滚：先把当前文件另存为 ${path.basename(t.file)}.bak-<时间>（别让「下一步」不可逆），再把 orig 复制回去、重跑本脚本。`);
      continue;
    }
    if (readOnly) {
      console.log(`— ${t.member}: 只打了一半（缺${which}），可以补（${checkOnly ? '--check，未写入' : 'dry-run，未写入'}）`);
      halfFixed += 1;
      continue;
    }
    const next = missingNote ? text.replace(NOTE_RE, NOTE_NEW(eol)) : text.replace(PUSH_OLD_RE, PUSH_NEW(eol));
    ensureBackups(t);
    writePatched(t, next);
    halfFixed += 1;
    console.log(`✓ ${t.member}: 补上了另一半（${which}）`);
    continue;
  }
  if (!NOTE_RE.test(text) || !PUSH_OLD_RE.test(text)) {
    failed += 1;
    console.log(`✗ ${t.member}: 找不到落点（插件版本可能变了）→ ${t.file}`);
    continue;
  }
  const next = text
    .replace(NOTE_RE, NOTE_NEW(eol))
    .replace(PUSH_OLD_RE, PUSH_NEW(eol));
  if (readOnly) {
    console.log(`— ${t.member}: 可以打（${checkOnly ? '--check，未写入' : 'dry-run，未写入'}）`);
    patchable += 1;
    continue;
  }
  ensureBackups(t);
  writePatched(t, next);
  patchable += 1;
  console.log(`✓ ${t.member}: 已打补丁（原始副本 ${path.basename(origPath(t))}）`);
}

function origPath(t) {
  return `${t.file}.orig-${versionOf(t.pkgDir) || 'unknown'}`;
}
function ensureBackups(t) {
  const orig = origPath(t);
  if (!fs.existsSync(orig)) fs.copyFileSync(t.file, orig);
  const bak = `${t.file}.bak-20261118`;
  if (!fs.existsSync(bak)) fs.copyFileSync(t.file, bak);
}

console.log('');
if (readOnly) {
  console.log(`小计：${targets.length} 个安装 · 可打 ${patchable} · 可补一半 ${halfFixed} · 已有 ${already} · 无法自动补 ${halfStuck} · 失败 ${failed} · 未写盘`);
} else {
  console.log(`小计：${targets.length} 个安装 · 本次打 ${patchable} · 本次补一半 ${halfFixed} · 已有 ${already} · 无法自动补 ${halfStuck} · 失败 ${failed}${detachMode ? ` · 断开硬链接 ${detached}` : ''}`);
}
if (checkOnly) {
  const bad = targets.filter((t) => {
    const s = fs.readFileSync(t.file, 'utf8');
    const hasMark = s.includes(MARK);
    const hasPush = /const why = String\(result\.transcript\?\.error/.test(s);
    return !(hasMark && hasPush);
  }).length;
  if (bad > 0) {
    console.log(`检查：还有 ${bad} 个安装没打全补丁（含只打了一半的）。`);
    process.exit(1);
  }
  console.log('检查：全部已打补丁。');
}
const needsWork = patchable + halfFixed;
process.exit(failed > 0 || halfStuck > 0 || (checkOnly && needsWork > 0) ? 1 : 0);
