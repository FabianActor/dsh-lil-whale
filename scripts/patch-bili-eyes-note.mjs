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
//   node app\scripts\patch-bili-eyes-note.mjs [--pond <鱼塘根>] [--dry-run] [--check]
//   --check   只检查是否已打补丁；有未打的 exit 1（给体检/发版检查用）
//
// 注意：打的是 node_modules 里的第三方插件代码，**重装或升级插件会覆盖**；升级后重跑本脚本。
// 上游仓库：https://github.com/QiuYeDx/dsh-bili-eyes
//
// 2026-11-18 小满验出「--check 会顺手打补丁」：检查器不能在检查时改被检查的东西。
// 同一天小鱼丸验出两处措辞：①同一条输出里「可以打（未写入）」和「本次打 1」打架
// ②「打了一半」（标记在、推送句没补）被说成「版本可能变了」——两种原因要分开说。
// 另按小满的账：打补丁时留一份 look.js.orig-<版本>（不覆盖已有），让「能重打」和「能回退」是同一层。

import fs from 'node:fs';
import path from 'node:path';
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

const targets = candidates();
if (targets.length === 0) {
  console.error('没有找到任何 dsh-bili-eyes 安装（扫 homes\\<键>\\dsh-home\\profiles\\*\\node_modules\\dsh-bili-eyes）');
  process.exit(2);
}

let patchable = 0;   // 可以打 / 本次打
let already = 0;
let half = 0;        // 只打了一半（标记在、推送句没补，或反过来）
let failed = 0;      // 找不到落点等
for (const t of targets) {
  const text = fs.readFileSync(t.file, 'utf8');
  const hasMark = text.includes(MARK);
  const hasPush = /const why = String\(result\.transcript\?\.error/.test(text);
  if (hasMark && hasPush) {
    already += 1;
    console.log(`— ${t.member}: 已打过补丁`);
    continue;
  }
  if (hasMark !== hasPush) {
    half += 1;
    console.log(`✗ ${t.member}: 只打了一半（${hasMark ? '标记在、推送句没补' : '推送句在、标记没补'}）→ ${t.file}`);
    continue;
  }
  if (!NOTE_RE.test(text) || !PUSH_OLD_RE.test(text)) {
    failed += 1;
    console.log(`✗ ${t.member}: 找不到落点（插件版本可能变了）→ ${t.file}`);
    continue;
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const next = text
    .replace(NOTE_RE, NOTE_NEW(eol))
    .replace(PUSH_OLD_RE, PUSH_NEW(eol));
  if (readOnly) {
    console.log(`— ${t.member}: 可以打（${checkOnly ? '--check，未写入' : 'dry-run，未写入'}）`);
    patchable += 1;
    continue;
  }
  const version = versionOf(t.pkgDir);
  const orig = `${t.file}.orig-${version || 'unknown'}`;
  if (!fs.existsSync(orig)) fs.copyFileSync(t.file, orig);
  const bak = `${t.file}.bak-20261118`;
  if (!fs.existsSync(bak)) fs.copyFileSync(t.file, bak);
  fs.writeFileSync(t.file, next, 'utf8');
  patchable += 1;
  console.log(`✓ ${t.member}: 已打补丁（原始副本 ${path.basename(orig)}）`);
}

console.log('');
if (readOnly) {
  console.log(`小计：${targets.length} 个安装 · 可打 ${patchable} · 已有 ${already} · 只打一半 ${half} · 失败 ${failed} · 未写盘`);
} else {
  console.log(`小计：${targets.length} 个安装 · 本次打 ${patchable} · 已有 ${already} · 只打一半 ${half} · 失败 ${failed}`);
}
if (checkOnly) {
  const bad = targets.filter((t) => !fs.readFileSync(t.file, 'utf8').includes(MARK)).length;
  if (bad > 0) {
    console.log(`检查：还有 ${bad} 个安装没打补丁。`);
    process.exit(1);
  }
  console.log('检查：全部已打补丁。');
}
process.exit(failed > 0 || half > 0 ? 1 : 0);
