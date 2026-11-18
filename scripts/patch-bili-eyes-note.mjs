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
//
// 2026-11-18 LeeaCP（r298）：断开硬链接之后，"改一处、四处一起变"这个便利没有了——
// 四份是四个 inode，谁只改一份，另外三份会静默停在旧版，而 --check 只看标记在不在，
// 照样报"已打过补丁"。所以 --check 现在多比一层：同一个插件版本的多份安装，内容必须一致；
// 不一致报「补丁版本不齐」，并指出是哪几台。判据：检查器能看见的，要包括"彼此是不是同一版"。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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
const MARK2 = '// 2026-11-18 本地补丁：没有 transcript 对象时，也不能掉进「没人说话」那句（小鱼丸 #1623）';

const NOTE_RE = /const TRANSCRIPT_NOTE = \{[\s\S]*?\n\};/;
// 第四/五半（2026-11-18 小满 #1625）：表里没登记的状态名——`file-empty` / `asr-empty`
// 是"转写跑了但空"，不是对内容的断言；表外的名字（`mystery`）连状态都还没翻译。
const UNKNOWN_TEXT = '台词状态没识别：';
const SPEECH_OLD_RE = /(\r?\n)([ \t]*)else if \(result\.plan\?\.inputs && result\.plan\.inputs\.speechRate === 0\) lines\.push\('（这段基本没人说话：音乐或环境声）'\);/;
const UNKNOWN_NEW = (indent, eol) => [
  `${indent}else if (src && !['file', 'subtitle', 'asr'].includes(src)) {`,
  `${indent}  lines.push(\`（${UNKNOWN_TEXT}\${src}——这是插件里的名字，不是内容判断）\`);`,
  `${indent}}`,
  `${indent}else if (result.plan?.inputs && result.plan.inputs.speechRate === 0) lines.push('（这段基本没人说话：音乐或环境声）');`,
].join(eol);
const NOTE_NEW = (eol) => [
  'const TRANSCRIPT_NOTE = {',
  "  'no-key': '没有台词：本机转写服务没开，也没有字幕',",
  '  none: \'没有台词\',',
  `  ${MARK}`,
  "  'asr-failed': '台词没转成：转写服务报错了（不是没人说话）',",
  "  'file-failed': '台词文件读不了（不是没人说话）',",
  "  'no-audio': '这段没有音轨（不是没人说话）',",
  // 第四半（2026-11-18 小满 #1625）：转写跑了但结果是空的——"空"不是"没人说话"的断言。
  // 2026-11-18 小鱼丸说这两句可以合并进"没人说话"；裁决不合并：文案表是把状态翻译成
  // 读者能判断的话，把"我什么都没拿到"说成"他们没说话"，就是把缺数据读成事实。
  "  'file-empty': '台词是空的：字幕文件读到了，但里面没有字（不是没人说话）',",
  "  'asr-empty': '台词是空的：转写跑了，但这一格什么都没得到（不是没人说话）',",
  '};',
].join(eol);

// 第三半（2026-11-18 小鱼丸 #1623）：result.transcript 整个缺席时，src 是 undefined，
// 既不进表、又继续落到 speechRate===0 那句 => 「这一栏没给」被冒充成「没人说话」。
// 产家（source 的取值）表补不到它，因为这一格压根没有 source。
const NO_TRANS_TEXT = '（没有拿到转写结果：这一栏没给，不代表没人说话）';
const NO_TRANS_OLD_RE = /else if \(result\.plan\?\.inputs && result\.plan\.inputs\.speechRate === 0\) lines\.push\('（这段基本没人说话：音乐或环境声）'\);/;
const NO_TRANS_NEW = (eol) => [
  'else if (!result.transcript) {',
  `    ${MARK2}`,
  `    lines.push('${NO_TRANS_TEXT}');`,
  '  }',
  "  else if (result.plan?.inputs && result.plan.inputs.speechRate === 0) lines.push('（这段基本没人说话：音乐或环境声）');",
].join(eol);

const PUSH_OLD_RE = /if \(src && TRANSCRIPT_NOTE\[src\]\) lines\.push\(`（\$\{TRANSCRIPT_NOTE\[src\]\}）`\);/;
const PUSH_NEW = (eol) => [
  'if (src && TRANSCRIPT_NOTE[src]) {',
  "    const why = String(result.transcript?.error ?? '').trim().replace(/\\s+/g, ' ');",
  "    lines.push(`（${TRANSCRIPT_NOTE[src]}${why ? `；原因：${why.slice(0, 160)}` : ''}）`);",
  '  }',
].join(eol);

// 第四/五半是否已在：空台词两句在表里 + 表外名字有自己的分支。
function hasGen2(text) {
  return text.includes("'file-empty'") && text.includes("'asr-empty'") && text.includes(UNKNOWN_TEXT);
}
// 把"第三半及之前"的版本补到"第四/五半"（幂等；两半都齐了就不动）。
function applyGen2(text, eol) {
  let next = text;
  if (!hasGen2(next)) {
    if (!next.includes("'file-empty'") || !next.includes("'asr-empty'")) {
      if (!NOTE_RE.test(next)) return { ok: false, why: '找不到台词文案表的落点（插件版本可能变了）' };
      next = next.replace(NOTE_RE, NOTE_NEW(eol));
    }
    if (!next.includes(UNKNOWN_TEXT)) {
      const m = next.match(SPEECH_OLD_RE);
      if (!m) return { ok: false, why: '找不到「没人说话」那行的落点（插件版本可能变了）' };
      next = next.replace(SPEECH_OLD_RE, (all, nl, indent) => nl + UNKNOWN_NEW(indent, eol));
    }
  }
  return { ok: true, next };
}

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

// 2026-11-18 LeeaCP（r298）：断链后四份是四个 inode，只改一份不会带着另外三份一起变。
// --check 只看标记在不在，所以"只打了一份"会照样报"已打过补丁"。这里补一层：同一版本的多份
// 安装内容必须一致；不一致就点名（判据：检查器能看见的，也包括"彼此是不是同一版"）。
// 换行与 BOM 不算差异（包里可能被 eol 规则转成 CRLF）。
function normalizedHash(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function consistencyOf(targets) {
  const byVersion = new Map();
  for (const t of targets) {
    const v = versionOf(t.pkgDir) || '(版本没读到)';
    if (!byVersion.has(v)) byVersion.set(v, []);
    byVersion.get(v).push(t)
  }
  const problems = [];
  for (const [version, list] of byVersion) {
    if (list.length < 2) continue;
    const groups = new Map();
    for (const t of list) {
      const h = normalizedHash(t.file);
      if (!groups.has(h)) groups.set(h, []);
      groups.get(h).push(t);
    }
    if (groups.size > 1) problems.push({ version, groups: [...groups.values()] });
  }
  return { byVersion, problems };
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
let thirdPending = 0; // 前两半已在、只缺「没有转写结果」那半（只读模式）
let thirdFixed = 0;   // 同上，本次补上
let latePending = 0;  // 三半已在、只缺「空台词/未识别」两半（只读模式）
let lateFixed = 0;    // 同上，本次补上
let already = 0;
let halfStuck = 0;   // 只打了一半，且缺的那半找不到落点（要人拿 orig 回滚）
let failed = 0;      // 找不到落点等
for (const t of targets) {
  const text = fs.readFileSync(t.file, 'utf8');
  const hasMark = text.includes(MARK);
  const hasPush = /const why = String\(result\.transcript\?\.error/.test(text);
  const hasNoTrans = text.includes(NO_TRANS_TEXT);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  if (hasMark && hasPush && hasNoTrans) {
    // 三半已在：再看第四/五半（空台词两句 + 表外名字）。只缺这两半时也要能补，
    // 否则"已打过补丁"的安装会永远停在旧版文案上（2026-11-18 小满 #1625）。
    if (!hasGen2(text)) {
      const g2 = applyGen2(text, eol);
      if (!g2.ok) {
        failed += 1;
        console.log(`✗ ${t.member}: ${g2.why} → ${t.file}`);
        continue;
      }
      if (readOnly) {
        console.log(`— ${t.member}: 三半已在，还差「空台词 / 表外名字」两半，可以补（${checkOnly ? '--check，未写入' : 'dry-run，未写入'}）`);
        latePending += 1;
        continue;
      }
      ensureBackups(t);
      writePatched(t, g2.next);
      lateFixed += 1;
      console.log(`✓ ${t.member}: 补上「空台词 / 表外名字」两半`);
      continue;
    }
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
  if (hasMark && hasPush) {
    // 前两半已在、只缺「没有转写结果」那半（2026-11-18 小鱼丸 #1623：关账前别把这一格一起关掉）
    if (!NO_TRANS_OLD_RE.test(text)) {
      failed += 1;
      console.log(`✗ ${t.member}: 找不到「没有转写结果」分支的落点（插件版本可能变了）→ ${t.file}`);
      continue;
    }
    if (readOnly) {
      console.log(`— ${t.member}: 前两半已在，还差「没有转写结果」那半，可以补（${checkOnly ? '--check，未写入' : 'dry-run，未写入'}）`);
      thirdPending += 1;
      continue;
    }
    ensureBackups(t);
    const g2third = applyGen2(text.replace(NO_TRANS_OLD_RE, NO_TRANS_NEW(eol)), eol);
    if (!g2third.ok) {
      failed += 1;
      console.log(`✗ ${t.member}: ${g2third.why} → ${t.file}`);
      continue;
    }
    writePatched(t, g2third.next);
    thirdFixed += 1;
    console.log(`✓ ${t.member}: 补上「没有转写结果」分支`);
    continue;
  }
  if (hasMark !== hasPush) {
    // 只打了一半：缺哪半补哪半（2026-11-18 小鱼丸：只看见、不修，重打也没用）
    const missingNote = !hasMark;      // 文案表那半没打
    const canFixMissing = missingNote ? NOTE_RE.test(text) : PUSH_OLD_RE.test(text);
    const which = missingNote ? '标记/文案表' : '推送句';
    if (!canFixMissing) {
      halfStuck += 1;
      // 2026-11-18 小鱼丸：这句提示原来写死走 origPath()，可"从没打成功过"的安装根本没生成 orig，
      // 于是它指着一个不存在的文件让人去 diff。先看目录里到底有什么，再决定下一步。
      const orig = origAnyPath(t);
      const hasOrig = Boolean(orig);
      const ver = versionOf(t.pkgDir);
      console.log(`✗ ${t.member}: 标记在、${which}没找到落点 → ${t.file}`);
      console.log('  判不了：可能是「只打了一半」，也可能是上游自己修了这句——我们的检查用的是自己写下的措辞，不是语义。');
      if (hasOrig) {
        console.log(`  下一步：先看 diff——把 ${path.basename(t.file)} 与 ${path.basename(orig)} 对一下；若上游已自行修复，不要回滚。`);
        console.log(`  真要回滚：先把当前文件另存为 ${path.basename(t.file)}.bak-<时间>（别让「下一步」不可逆），再把 orig 复制回去、重跑本脚本。`);
      } else {
        // 2026-11-18 小满：先问"下一步要动的东西在不在"；不在就别指路。
        // 并且别让读者自己去列目录——把同目录的文件名列出来。
        const dir = path.dirname(t.file);
        let listing = '（目录读不了）';
        try {
          const names = fs.readdirSync(dir).filter((n) => n.startsWith(path.basename(t.file)));
          listing = names.length
            ? names.map((n) => `${n} ${fs.statSync(path.join(dir, n)).size} B`).join(' · ')
            : '（是个空目录）';
        } catch {
          listing = '（目录读不了）';
        }
        console.log(`  目录里实际有：${listing}`);
        console.log('  这台没有 orig 可对：它从没成功打过补丁，所以没留下原样副本（不是放错了位置，是根本没生成过）。');
        console.log('  先看当前文件里有没有我们那三句（`asr-failed` / `file-failed` / `no-audio`）：都在、只有推送那句不像 ⇒ 上游改过措辞，别回滚。');
        console.log('  要补就手工补那半，或从同版本另一台拷一份 look.js.orig-* 过来，再重跑本脚本。');
      }
      // 2026-11-18 第二条鱼/第四条鱼：这句解释里的词必须真的出现在这一行里。
      // 版本读不到但 orig 名字里没有 unknown（如 orig-1.6.33）时，不解释 unknown，只把"版本没读到"说清。
      if (hasOrig && !ver) {
        if (path.basename(orig).includes('unknown')) {
          console.log('  （orig 名字里的 unknown 是「版本没读到」，不是版本号叫 unknown。）');
        } else {
          console.log('  （插件版本没读到；不影响你把上面两份文件对一下 diff。）');
        }
      }
      continue;
    }
    if (readOnly) {
      console.log(`— ${t.member}: 只打了一半（缺${which}），可以补（${checkOnly ? '--check，未写入' : 'dry-run，未写入'}）`);
      halfFixed += 1;
      continue;
    }
    const halfNext = missingNote ? text.replace(NOTE_RE, NOTE_NEW(eol)) : text.replace(PUSH_OLD_RE, PUSH_NEW(eol));
    const g2half = applyGen2(halfNext, eol);
    if (!g2half.ok) {
      failed += 1;
      console.log(`✗ ${t.member}: ${g2half.why} → ${t.file}`);
      continue;
    }
    ensureBackups(t);
    writePatched(t, g2half.next);
    halfFixed += 1;
    console.log(`✓ ${t.member}: 补上了另一半（${which}）`);
    continue;
  }
  if (!NOTE_RE.test(text) || !PUSH_OLD_RE.test(text)) {
    failed += 1;
    console.log(`✗ ${t.member}: 找不到落点（插件版本可能变了）→ ${t.file}`);
    continue;
  }
  let next = text
    .replace(NOTE_RE, NOTE_NEW(eol))
    .replace(PUSH_OLD_RE, PUSH_NEW(eol));
  if (!NO_TRANS_OLD_RE.test(next)) {
    failed += 1;
    console.log(`✗ ${t.member}: 前两半已打，但找不到「没有转写结果」分支的落点（插件版本可能变了）→ ${t.file}`);
    continue;
  }
  next = next.replace(NO_TRANS_OLD_RE, NO_TRANS_NEW(eol));
  const g2full = applyGen2(next, eol);
  if (!g2full.ok) {
    failed += 1;
    console.log(`✗ ${t.member}: ${g2full.why} → ${t.file}`);
    continue;
  }
  next = g2full.next;
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
// 目录里真正存在的那份 orig（不按当前版本名猜——版本读不到时名字会变，文件还在）
function origAnyPath(t) {
  const dir = path.dirname(t.file);
  const base = `${path.basename(t.file)}.orig-`;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(base)) return path.join(dir, name);
    }
  } catch {
    return null;
  }
  return null;
}
function ensureBackups(t) {
  const orig = origPath(t);
  if (!fs.existsSync(orig)) fs.copyFileSync(t.file, orig);
  const bak = `${t.file}.bak-20261118`;
  if (!fs.existsSync(bak)) fs.copyFileSync(t.file, bak);
}

console.log('');
if (readOnly) {
  console.log(`小计：${targets.length} 个安装 · 可打 ${patchable} · 可补一半 ${halfFixed} · 还差无转写 ${thirdPending} · 还差空台词/未识别 ${latePending} · 已有 ${already} · 无法自动补 ${halfStuck} · 失败 ${failed} · 未写盘`);
} else {
  console.log(`小计：${targets.length} 个安装 · 本次打 ${patchable} · 本次补一半 ${halfFixed} · 补无转写 ${thirdFixed} · 补空台词/未识别 ${lateFixed} · 已有 ${already} · 无法自动补 ${halfStuck} · 失败 ${failed}${detachMode ? ` · 断开硬链接 ${detached}` : ''}`);
}
if (checkOnly) {
  const bad = targets.filter((t) => {
    const s = fs.readFileSync(t.file, 'utf8');
    const hasMark = s.includes(MARK);
    const hasPush = /const why = String\(result\.transcript\?\.error/.test(s);
    const hasNoTrans = s.includes(NO_TRANS_TEXT);
    return !(hasMark && hasPush && hasNoTrans && hasGen2(s));
  }).length;
  if (bad > 0) {
    console.log(`检查：还有 ${bad} 个安装没打全补丁（含只打了一半的）。`);
    process.exit(1);
  }
  // 2026-11-18 LeeaCP（r298）：补丁都"在"之后，再比一次"是不是同一版"。
  const { byVersion, problems } = consistencyOf(targets);
  if (byVersion.size > 1) {
    const list = [...byVersion.entries()].map(([v, l]) => `${v} ×${l.length}`).join('、');
    console.log(`· 安装的插件版本不同：${list}（各自按自己的版本判补丁，不合并比较）`);
  }
  if (problems.length > 0) {
    console.log('检查：补丁版本不齐——同版本的多份安装内容不同。');
    for (const p of problems) {
      const groups = p.groups.map((g) => `${g.map((t) => t.member).join('、')}（${g.length} 份）`).join(' ／ ');
      console.log(`  ✗ 插件 ${p.version}：${groups}`);
    }
    console.log('  NEXT: 逐份跑 --dry-run 看差在哪，再重跑补丁；差异大的一份先与同版本另一台对 diff。');
    process.exit(1);
  }
  console.log('检查：全部已打补丁。');
}
const needsWork = patchable + halfFixed + thirdPending + latePending;
process.exit(failed > 0 || halfStuck > 0 || (checkOnly && needsWork > 0) ? 1 : 0);

