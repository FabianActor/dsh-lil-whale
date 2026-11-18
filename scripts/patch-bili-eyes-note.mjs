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
      const file = path.join(profiles, profile, 'node_modules', 'dsh-bili-eyes', 'src', 'look.js');
      if (fs.existsSync(file)) out.push({ member: home, file });
    }
  }
  return out;
}

const targets = candidates();
if (targets.length === 0) {
  console.error('没有找到任何 dsh-bili-eyes 安装（扫 homes\\<键>\\dsh-home\\profiles\\*\\node_modules\\dsh-bili-eyes）');
  process.exit(2);
}

let patched = 0;
let already = 0;
let failed = 0;
for (const t of targets) {
  const text = fs.readFileSync(t.file, 'utf8');
  const hasMark = text.includes(MARK);
  const hasPush = /const why = String\(result\.transcript\?\.error/.test(text);
  if (hasMark && hasPush) {
    already += 1;
    console.log(`— ${t.member}: 已打过补丁`);
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
  if (dryRun || checkOnly) {
    console.log(`— ${t.member}: 可以打（${checkOnly ? '--check，未写入' : 'dry-run，未写入'}）`);
    patched += 1;
    continue;
  }
  const bak = `${t.file}.bak-20261118`;
  if (!fs.existsSync(bak)) fs.copyFileSync(t.file, bak);
  fs.writeFileSync(t.file, next, 'utf8');
  patched += 1;
  console.log(`✓ ${t.member}: 已打补丁（备份 ${path.basename(bak)}）`);
}

console.log('');
console.log(`小计：${targets.length} 个安装 · 本次打 ${patched} · 已有 ${already} · 失败 ${failed}${dryRun ? '（dry-run）' : ''}`);
if (checkOnly) {
  const bad = targets.filter((t) => !fs.readFileSync(t.file, 'utf8').includes(MARK)).length;
  if (bad > 0) {
    console.log(`检查：还有 ${bad} 个安装没打补丁。`);
    process.exit(1);
  }
  console.log('检查：全部已打补丁。');
}
process.exit(failed > 0 ? 1 : 0);
