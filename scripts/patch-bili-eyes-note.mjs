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
//   node app\scripts\patch-bili-eyes-note.mjs [--pond <鱼塘根>] [--dry-run] [--check] [--detach] [--also-root <DSH_HOME>]
//   --check   只检查是否已打补丁；有未打的 exit 1（给体检/发版检查用）
//   --detach  给已经打过的安装断开与 pnpm store 的硬链接，并把 store 那份恢复成原样
//   --also-root  额外扫一份 `<DSH_HOME>\profiles\*\node_modules\dsh-bili-eyes`（2026-11-19：宿主
//                自己的 web profile 也装了这只眼睛，它不在 homes\ 下面，默认扫不到）
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
import { writeText, renameFile, copyFileTo } from './lib/safe-write.mjs';
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

// 2026-11-19：宿主自己的 web profile 也装了 dsh-bili-eyes（它不在 homes\ 下面），
// 默认扫不到；用 --also-root <DSH_HOME> 显式加一个 `<DSH_HOME>\profiles\*` 根。
// 默认不扫，是为了让"扫到几份"这个数在任何机器上都只由鱼塘内容决定。
const alsoRoots = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] !== '--also-root') continue;
  const v = argv[i + 1];
  if (!v || v.startsWith('--')) {
    console.error('--also-root 需要一个目录参数（例：--also-root C:\\Users\\Fabian\\.dsh）');
    process.exit(2);
  }
  alsoRoots.push(path.resolve(v));
}

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
// gen3（2026-11-19 小鱼丸 #2199 + 她的 scan-gap-action）：文案表的"要动作"三句只有状态
// 没有下一步；观测句不加，动作句加。做法与 gen2 同形：靠固定文案判"有没有"，不靠版本号。
const GEN3_TEXT = '；下一步：';
const GEN3_PAIRS = [
  [
    "'no-key': '没有台词：本机转写服务没开，也没有字幕',",
    `'no-key': '没有台词：本机转写服务没开，也没有字幕${GEN3_TEXT}要转写就先开本机转写服务',`,
  ],
  [
    "'asr-failed': '台词没转成：转写服务报错了（不是没人说话）',",
    `'asr-failed': '台词没转成：转写服务报错了（不是没人说话）${GEN3_TEXT}修好转写服务后重看（或先看画面/简介）',`,
  ],
  [
    "'file-failed': '台词文件读不了（不是没人说话）',",
    `'file-failed': '台词文件读不了（不是没人说话）${GEN3_TEXT}换一个文件或重下',`,
  ],
];

const NOTE_NEW = (eol) => [
  'const TRANSCRIPT_NOTE = {',
  // gen3（2026-11-19 小鱼丸 #2199 与 scan-gap-action）：要动手的那三句得带"下一步"。
  // 观测句（no-audio / file-empty / asr-empty / 没人说话）不加——它们不是让读者去做什么。
  `  'no-key': '没有台词：这次没拿到字幕，转写也没跑起来；下一步：要转写就先把转写配好（填 key，或指向本机转写服务）',`,
  '  none: \'没有台词\',',
  `  ${MARK}`,
  `  'asr-failed': '台词没转成：转写服务报错了（不是没人说话）${GEN3_TEXT}修好转写服务后重看（或先看画面/简介）',`,
  `  'file-failed': '台词文件读不了（不是没人说话）${GEN3_TEXT}换一个文件或重下',`,
  "  'no-audio': '这段没有音轨（不是没人说话）',",
  // 第四半（2026-11-18 小满 #1625）：转写跑了但结果是空的——"空"不是"没人说话"的断言。
  // 2026-11-18 小鱼丸说这两句可以合并进"没人说话"；裁决不合并：文案表是把状态翻译成
  // 读者能判断的话，把"我什么都没拿到"说成"他们没说话"，就是把缺数据读成事实。
  "  'file-empty': '台词是空的：字幕文件读到了，但里面没有字（不是没人说话）',",
  "  'asr-empty': '台词是空的：转写跑了，但这一格什么都没得到（不是没人说话）',",
  '};',
].join(eol);

// gen3 是否已在：三句里至少一句带"下一步"，且三句原句都不再原样存在。
// （只查一句会漏：某台机器可能被手改过一句，另两句还旧。）
function hasGen3(text) {
  // no-key 这一句可能已经是更新的一代（gen4 换了整句），只要它带了「下一步」就算这一半在。
  const noKeyDone = /'no-key': '[^']*；下一步：/.test(text);
  return (
    noKeyDone &&
    text.includes("台词没转成：转写服务报错了（不是没人说话）" + GEN3_TEXT) &&
    text.includes("台词文件读不了（不是没人说话）" + GEN3_TEXT)
  );
}

// 把"要动作"的三句从旧措辞换成带下一步的新措辞（幂等；已经新的不动）。
function applyGen3(text) {
  let next = text;
  for (const [from, to] of GEN3_PAIRS) {
    if (!next.includes(to)) next = next.replace(from, () => to);
  }
  return hasGen3(next) ? { ok: true, next } : { ok: false, why: '三句「要动作」的文案没有一处能换成带下一步的版本（插件版本可能变了）' };
}
// gen4（2026-11-19 小鱼丸 #2218）：`no-key` 这一格里说话的人**不知道**自己为什么没有台词——
// 它的成因是 `!willTranscribe()`（默认目标是云端、且没有 key），跟"本机转写服务没开"不是一回事。
// 改法只换文案：不去断言一个这段代码手里没有的量；动态的目标细节在另一个包（dsh-video-storyboard 的
// `asr.js:136 describeAsrTarget()`），进上游 issue，不扩本地补丁面。
const GEN4_OLD_NO_KEY = `'no-key': '没有台词：本机转写服务没开，也没有字幕${GEN3_TEXT}要转写就先开本机转写服务',`;
const GEN4_NEW_NO_KEY = "'no-key': '没有台词：这次没拿到字幕，转写也没跑起来；下一步：要转写就先把转写配好（填 key，或指向本机转写服务）',";

function hasGen4(text) {
  return text.includes(GEN4_NEW_NO_KEY);
}

function applyGen4(text) {
  if (text.includes(GEN4_NEW_NO_KEY)) return { ok: true, next: text };
  if (!text.includes(GEN4_OLD_NO_KEY)) {
    return { ok: false, why: '找不到 `no-key` 那句的旧措辞（插件版本可能变了，或已经改过但不一样）' };
  }
  return { ok: true, next: text.replace(GEN4_OLD_NO_KEY, () => GEN4_NEW_NO_KEY) };
}

// gen5（2026-11-19 小鱼丸 #2237）：结果缓存存的是整段成品 text，而缓存键里不含文案版本。
// ⇒ 补丁落盘后，24 小时内看过的同一条片仍会原样回放旧句——"修了但看不见"，且每改一版文案
// 都要让所有鱼手动清一次缓存（鱼对 dsh-home 只读，清不掉）。把补丁代次放进 cacheKey 即可：
// 换代 = 旧缓存键全部失效；旧 JSON 留在 cache 目录按 cacheHours 自然过期，不删、也不用删。
const CACHE_TAG = 'llw-patch-g6';
const CACHE_KEY_OLD = "function cacheKey(parts) { return crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 16); }";
const CACHE_KEY_NEW = (eol) => [
  '// 2026-11-19 本地补丁：缓存键带补丁代次——文案改了，旧缓存不再被原样回放。',
  `const PATCH_CACHE_TAG = '${CACHE_TAG}';`,
  "function cacheKey(parts) { return crypto.createHash('sha1').update(JSON.stringify([PATCH_CACHE_TAG, parts])).digest('hex').slice(0, 16); }",
].join(eol);

function hasCacheTag(text) {
  return text.includes(`const PATCH_CACHE_TAG = '${CACHE_TAG}';`);
}

// 换代不是"从上游打第一次"，而是"上一代换成这一代"：先认现有标记行、只换标签；
// 认不到标记行，才是第一次打（上游原文里 cacheKey 还是裸 JSON.stringify）。
function applyCacheTag(text, eol) {
  if (hasCacheTag(text)) return { ok: true, next: text };
  const tagLine = /const PATCH_CACHE_TAG = '[^']*';/;
  if (tagLine.test(text)) {
    return { ok: true, next: text.replace(tagLine, () => `const PATCH_CACHE_TAG = '${CACHE_TAG}';`) };
  }
  if (!text.includes(CACHE_KEY_OLD)) {
    return { ok: false, why: '找不到 cacheKey 的落点（插件版本可能变了）' };
  }
  return { ok: true, next: text.replace(CACHE_KEY_OLD, () => CACHE_KEY_NEW(eol)) };
}

// gen6（2026-11-19 fi-0004，小鱼丸 #2272）：没登录 / 查不到登录态时，台词栏教人去"配转写"，
// 该做的是扫码登录；而匿名态根本没问过字幕，旧句把"没拿到的结果"说成了另一件事。
const GEN6_LOGIN_OLD = "  if (login.state === 'expired') lines.push('（B站登录已过期：这次没有 AI 字幕和总结。只在主人私聊时提醒他重新扫码登录，群里别说）');";
const GEN6_LOGIN_NEW = (eol) => [
  GEN6_LOGIN_OLD,
  "  else if (login.state === 'none') lines.push('（B站没登录：匿名拿不到字幕和 AI 总结，所以这次没有台词。只在主人私聊时提醒他扫码登录，群里别说）');",
  "  else if (login.state === 'unknown') lines.push(`（暂时查不到 B站登录状态：这次没有 AI 字幕和总结。下一步：稍后重试${login.error ? `；原因：${String(login.error).slice(0, 120)}` : ''}）`);",
].join(eol);
const GEN6_COMPACT_OLD = 'export function compactCells(result, maxCellChars) {';
const GEN6_COMPACT_NEW = 'export function compactCells(result, maxCellChars, opts = {}) {';
const GEN6_NOTE_OLD = '  if (src && TRANSCRIPT_NOTE[src]) {';
const GEN6_NOTE_NEW = (eol) => [
  "  if (src === 'no-key' && (opts.loginState === 'none' || opts.loginState === 'unknown')) {",
  "    const st = opts.loginState === 'none' ? 'B 站没登录' : '暂时查不到 B 站登录状态';",
  "    const err = String(opts.loginError ?? '').trim().replace(/\\s+/g, ' ');",
  "    lines.push(`（没有台词：${st}，这次没拿到字幕；下一步：${opts.loginState === 'none' ? '让主人扫码登录后再看（不用去配转写）' : '稍后重试；一直这样就请主人检查登录'}${err ? `；原因：${err.slice(0, 120)}` : ''}）`);",
  "  } else if (src && TRANSCRIPT_NOTE[src]) {",
].join(eol);
const GEN6_FIT_OLD = 'export function fitCells(result, room, preferred) {';
const GEN6_FIT_NEW = 'export function fitCells(result, room, preferred, opts = {}) {';
const GEN6_FIT_CALL_OLD = 'const m = compactCells(result, n);';
const GEN6_FIT_CALL_NEW = 'const m = compactCells(result, n, opts);';
const GEN6_FIT_LAST_OLD = 'return compactCells(result, 0);';
const GEN6_FIT_LAST_NEW = 'return compactCells(result, 0, opts);';
const GEN6_BODY_OLD = 'body = `${intro}\\n${fitCells(storyboard, room, DETAIL_CHARS[detail])}`;';
const GEN6_BODY_NEW = 'body = `${intro}\\n${fitCells(storyboard, room, DETAIL_CHARS[detail], { loginState: login.state, loginError: login.error })}`;';
const GEN6_ZOOM_OLD = '    compactCells(result, DETAIL_CHARS.med),';
const GEN6_ZOOM_NEW = '    compactCells(result, DETAIL_CHARS.med, { loginState: login.state, loginError: login.error }),';

function hasGen6(text) {
  return text.includes(GEN6_COMPACT_NEW) && text.includes("login.state === 'none'") && text.includes("opts.loginState === 'none' || opts.loginState === 'unknown'");
}

function applyGen6(text, eol) {
  if (hasGen6(text)) return { ok: true, next: text };
  let next = text;
  if (!next.includes(GEN6_LOGIN_NEW(eol))) {
    if (!next.includes(GEN6_LOGIN_OLD)) return { ok: false, why: '找不到 login expired 那句的落点（插件版本可能变了）' };
    next = next.replace(GEN6_LOGIN_OLD, () => GEN6_LOGIN_NEW(eol));
  }
  if (!next.includes(GEN6_COMPACT_NEW)) {
    if (!next.includes(GEN6_COMPACT_OLD)) return { ok: false, why: '找不到 compactCells 的落点（插件版本可能变了）' };
    next = next.replace(GEN6_COMPACT_OLD, GEN6_COMPACT_NEW);
  }
  if (!next.includes('opts.loginState')) {
    if (!next.includes(GEN6_NOTE_OLD)) return { ok: false, why: '找不到台词分支的落点（插件版本可能变了）' };
    next = next.replace(GEN6_NOTE_OLD, () => GEN6_NOTE_NEW(eol));
  }
  if (!next.includes(GEN6_FIT_NEW)) {
    if (!next.includes(GEN6_FIT_OLD) || !next.includes(GEN6_FIT_CALL_OLD) || !next.includes(GEN6_FIT_LAST_OLD)) {
      return { ok: false, why: '找不到 fitCells 的落点（插件版本可能变了）' };
    }
    next = next.replace(GEN6_FIT_OLD, GEN6_FIT_NEW).replace(GEN6_FIT_CALL_OLD, GEN6_FIT_CALL_NEW).replace(GEN6_FIT_LAST_OLD, GEN6_FIT_LAST_NEW);
  }
  if (!next.includes('loginState: login.state')) {
    if (!next.includes(GEN6_BODY_OLD) || !next.includes(GEN6_ZOOM_OLD)) {
      return { ok: false, why: '找不到调用处（look/zoom）的落点（插件版本可能变了）' };
    }
    next = next.replace(GEN6_BODY_OLD, GEN6_BODY_NEW).replace(GEN6_ZOOM_OLD, GEN6_ZOOM_NEW);
  }
  return hasGen6(next) ? { ok: true, next } : { ok: false, why: '补完仍缺「登录态那两句」（文件里有旧痕迹但改不动）' };
}

// 一次补到最新：gen3 → gen4 → gen5 → gen6。每一步都是幂等的（已在就不动）；
// 任何一步找不到落点就停在那一步之前——不写半份"看着像最新"的文件。
function finishPatch(text, eol) {
  let cur = text;
  const g3 = applyGen3(cur);
  if (g3.ok) cur = g3.next;
  const g4 = applyGen4(cur);
  if (g4.ok) cur = g4.next;
  const g5 = applyCacheTag(cur, eol);
  if (g5.ok) cur = g5.next;
  const g6 = applyGen6(cur, eol);
  if (g6.ok) cur = g6.next;
  return cur;
}


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
  if (fs.existsSync(homes)) {
    for (const home of fs.readdirSync(homes)) {
      const profiles = path.join(homes, home, 'dsh-home', 'profiles');
      if (!fs.existsSync(profiles)) continue;
      for (const profile of fs.readdirSync(profiles)) {
        const pkgDir = path.join(profiles, profile, 'node_modules', 'dsh-bili-eyes');
        const file = path.join(pkgDir, 'src', 'look.js');
        if (fs.existsSync(file)) out.push({ member: home, file, pkgDir });
      }
    }
  }
  // 宿主的 profile：member 写成「宿主/<profile>」，一眼看得出它不在鱼塘里。
  for (const root of alsoRoots) {
    const profiles = path.join(root, 'profiles');
    if (!fs.existsSync(profiles)) continue;
    for (const profile of fs.readdirSync(profiles)) {
      const pkgDir = path.join(profiles, profile, 'node_modules', 'dsh-bili-eyes');
      const file = path.join(pkgDir, 'src', 'look.js');
      if (fs.existsSync(file)) out.push({ member: `宿主/${profile}`, file, pkgDir });
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
function normalizedHashOf(text) {
  const clean = String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(clean, 'utf8').digest('hex');
}
function normalizedHash(file) {
  return normalizedHashOf(fs.readFileSync(file, 'utf8'));
}

// 2026-11-18 LeeaCP（r303）：期望内容比 mtime / 多数派都硬。
// 打补丁的脚本知道"打完应该长什么样"：拿上游原文跑同一套变换就能算出来。
// 与期望一致 = 新；不一致 = 旧，而且能直接报第一处差在哪一行。
function patchedFrom(originalText, eol) {
  if (!NOTE_RE.test(originalText) || !PUSH_OLD_RE.test(originalText)) return null;
  let next = originalText.replace(NOTE_RE, NOTE_NEW(eol)).replace(PUSH_OLD_RE, PUSH_NEW(eol));
  if (!NO_TRANS_OLD_RE.test(next)) return null;
  next = next.replace(NO_TRANS_OLD_RE, NO_TRANS_NEW(eol));
  const g2 = applyGen2(next, eol);
  if (!g2.ok) return null;
  const g3 = applyGen3(g2.next);
  if (!g3.ok) return null;
  const g4 = applyGen4(g3.next);
  if (!g4.ok) return null;
  return finishPatch(g4.next, eol);
}

// 同版本里任一安装留下的 orig 就是上游原文（四台同版本时字节相同）。
function expectedTextOf(list) {
  for (const t of list) {
    const orig = origAnyPath(t);
    if (!orig) continue;
    let text;
    try {
      text = fs.readFileSync(orig, 'utf8');
    } catch {
      continue;
    }
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const expected = patchedFrom(text, eol);
    if (expected) return expected;
  }
  return null;
}

// 第一处差异（只用于人读：报行号 + 两边那行的前 80 字）。
function firstDiffLine(expectedText, actualText) {
  const a = expectedText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  const b = actualText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if ((a[i] ?? '') !== (b[i] ?? '')) {
      const clip = (s) => (s === undefined ? '(没有这一行)' : s.trim().slice(0, 80) || '(空行)');
      return { line: i + 1, expected: clip(a[i]), actual: clip(b[i]) };
    }
  }
  return null;
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
      if (!groups.has(h)) groups.set(h, { hash: h, targets: [], newestAt: 0 });
      const g = groups.get(h);
      g.targets.push(t);
      try {
        const ms = fs.statSync(t.file).mtimeMs;
        if (ms > g.newestAt) g.newestAt = ms;
      } catch {
        /* 读不到时间就不写，后面按 0 处理 */
      }
    }
    if (groups.size > 1) {
      // 2026-11-18 LeeaCP（r299/r303）：先说清"哪几份互相一样"，再拿期望内容分新旧。
      // mtime 只留作线索（被单独 append 过的那份反而更新，方向可能反）。
      const expectedText = expectedTextOf(list);
      const expectedHash = expectedText ? normalizedHashOf(expectedText) : null;
      const arr = [...groups.values()].sort((x, y) => y.newestAt - x.newestAt);
      for (const g of arr) {
        g.matchesExpected = expectedHash === null ? null : g.hash === expectedHash;
        if (g.matchesExpected === false && g.targets.length > 0) {
          try {
            g.diff = firstDiffLine(expectedText, fs.readFileSync(g.targets[0].file, 'utf8'));
          } catch {
            g.diff = null;
          }
        }
      }
      const earliest = arr.reduce((acc, g) => (!acc || g.newestAt < acc.newestAt ? g : acc), null);
      problems.push({ version, groups: arr, earliest, expectedKnown: expectedHash !== null });
    }
  }
  return { byVersion, problems };
}

// 本地时间；读不到就写"时间读不到"（别印 1970）。
function fmtMs(ms) {
  if (!ms) return '(时间读不到)';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
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
    writeText(readOnly, t.file, next);
    return false;
  }
  const before = fs.readFileSync(t.file, 'utf8');
  const links = hardLinksOf(t.file).filter((p) => normPath(p) !== normPath(t.file));
  // 1) 先断开自己：写临时文件再 rename（rename 只换目录项，新文件是独立 inode）
  const tmp = `${t.file}.tmp-${process.pid}`;
  writeText(readOnly, tmp, next);
  renameFile(readOnly, tmp, t.file);
  // 2) store 那份恢复成补丁前的内容：优先用 .orig-<版本>，没有就用刚读到的原内容
  const orig = origPath(t);
  const original = fs.existsSync(orig) ? fs.readFileSync(orig, 'utf8') : before;
  for (const p of links) {
    if (p.includes(`${path.sep}profiles${path.sep}`)) continue; // 别的鱼那份各打各的
    try {
      if (fs.readFileSync(p, 'utf8') !== original) writeText(readOnly, p, original);
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
    writeText(readOnly, tmp, cur);
    renameFile(readOnly, tmp, t.file);
    detached += 1;
    console.log(`— ${t.member}: 已断开与 pnpm store 的硬链接（内容保持补丁版）`);
  }
  for (const p of links) {
    if (p.includes(`${path.sep}profiles${path.sep}`)) continue;
    if (original === null) continue;
    try {
      if (fs.readFileSync(p, 'utf8') !== original) writeText(readOnly, p, original);
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
let gen3Pending = 0;  // 前五半已在、只缺「下一步」三句（只读模式）
let gen3Fixed = 0;    // 同上，本次补上
let gen4Pending = 0;  // 前六半已在、只差 `no-key` 那句的真原因（只读模式）
let gen4Fixed = 0;    // 同上，本次补上
let cachePending = 0; // 七半已在、只差「结果缓存带补丁代次」（只读模式）
let cacheFixed = 0;   // 同上，本次补上
let gen6Pending = 0;  // 八半已在、只差登录态那两句（只读模式）
let gen6Fixed = 0;    // 同上，本次补上
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
      writePatched(t, finishPatch(g2.next, eol));
      lateFixed += 1;
      console.log(`✓ ${t.member}: 补上「空台词 / 表外名字」两半`);
      continue;
    }
    // gen3（2026-11-19 小鱼丸 #2199）：前五半都在，还差「要动作」三句的"下一步"。
    if (!hasGen3(text) && !hasGen4(text)) {
      const g3 = applyGen3(text);
      if (!g3.ok) {
        failed += 1;
        console.log(`✗ ${t.member}: ${g3.why} → ${t.file}`);
        continue;
      }
      if (readOnly) {
        console.log(`— ${t.member}: 还差「下一步」三句，可以补（${checkOnly ? '--check，未写入' : 'dry-run，未写入'}）`);
        gen3Pending += 1;
        continue;
      }
      ensureBackups(t);
      const g3ThenG4 = applyGen4(g3.next);
      writePatched(t, finishPatch(g3ThenG4.ok ? g3ThenG4.next : g3.next, eol));
      gen3Fixed += 1;
      console.log(`✓ ${t.member}: 补上「下一步」三句${g3ThenG4.ok ? '（并带上「没有台词」那句的真原因）' : ''}`);
      continue;
    }
    // gen4（2026-11-19 小鱼丸 #2218）：前六半都在，只差 `no-key` 那句的真原因。
    if (!hasGen4(text)) {
      const g4 = applyGen4(text);
      if (!g4.ok) {
        failed += 1;
        console.log(`✗ ${t.member}: ${g4.why} → ${t.file}`);
        continue;
      }
      if (readOnly) {
        console.log(`— ${t.member}: 还差「没有台词」那句的真原因，可以补（${checkOnly ? '--check，未写入' : 'dry-run，未写入'}）`);
        gen4Pending += 1;
        continue;
      }
      ensureBackups(t);
      writePatched(t, finishPatch(g4.next, eol));
      gen4Fixed += 1;
      console.log(`✓ ${t.member}: 补上「没有台词」那句的真原因`);
      continue;
    }
    // gen5（2026-11-19 小鱼丸 #2237）：文案全在，但结果缓存会把旧文案原样回放 24 小时。
    if (!hasCacheTag(text)) {
      const g5 = applyCacheTag(text, eol);
      if (!g5.ok) {
        failed += 1;
        console.log(`✗ ${t.member}: ${g5.why} → ${t.file}`);
        continue;
      }
      if (readOnly) {
        console.log(`— ${t.member}: 还差「结果缓存带补丁代次」，可以补（${checkOnly ? '--check，未写入' : 'dry-run，未写入'}）`);
        cachePending += 1;
        continue;
      }
      ensureBackups(t);
      writePatched(t, g5.next);
      cacheFixed += 1;
      console.log(`✓ ${t.member}: 补上缓存代次（旧结果缓存不再回放旧文案）`);
      continue;
    }
    // gen6（2026-11-19 fi-0004，小鱼丸 #2272）：没登录 / 查不到登录态时，别教人去配转写。
    if (!hasGen6(text)) {
      const g6 = applyGen6(text, eol);
      if (!g6.ok) {
        failed += 1;
        console.log(`✗ ${t.member}: ${g6.why} → ${t.file}`);
        continue;
      }
      if (readOnly) {
        console.log(`— ${t.member}: 还差「登录态那两句」，可以补（${checkOnly ? '--check，未写入' : 'dry-run，未写入'}）`);
        gen6Pending += 1;
        continue;
      }
      ensureBackups(t);
      writePatched(t, finishPatch(g6.next, eol));
      gen6Fixed += 1;
      console.log(`✓ ${t.member}: 补上「登录态那两句」（匿名/未知态不再教人配转写）`);
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
    writePatched(t, finishPatch(g2third.next, eol));
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
    writePatched(t, finishPatch(g2half.next, eol));
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
  next = finishPatch(g2full.next, eol);
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
  if (!fs.existsSync(orig)) copyFileTo(readOnly, t.file, orig);
  const bak = `${t.file}.bak-20261118`;
  if (!fs.existsSync(bak)) copyFileTo(readOnly, t.file, bak);
}

console.log('');
if (readOnly) {
  console.log(`小计：${targets.length} 个安装 · 可打 ${patchable} · 可补一半 ${halfFixed} · 还差无转写 ${thirdPending} · 还差空台词/未识别 ${latePending} · 还差下一步 ${gen3Pending} · 还差真原因 ${gen4Pending} · 还差缓存代次 ${cachePending} · 还差登录态 ${gen6Pending} · 已有 ${already} · 无法自动补 ${halfStuck} · 失败 ${failed} · 未写盘`);
} else {
  console.log(`小计：${targets.length} 个安装 · 本次打 ${patchable} · 本次补一半 ${halfFixed} · 补无转写 ${thirdFixed} · 补空台词/未识别 ${lateFixed} · 补下一步 ${gen3Fixed} · 补真原因 ${gen4Fixed} · 补缓存代次 ${cacheFixed} · 补登录态 ${gen6Fixed} · 已有 ${already} · 无法自动补 ${halfStuck} · 失败 ${failed}${detachMode ? ` · 断开硬链接 ${detached}` : ''}`);
}
if (checkOnly) {
  const bad = targets.filter((t) => {
    const s = fs.readFileSync(t.file, 'utf8');
    const hasMark = s.includes(MARK);
    const hasPush = /const why = String\(result\.transcript\?\.error/.test(s);
    const hasNoTrans = s.includes(NO_TRANS_TEXT);
    return !(hasMark && hasPush && hasNoTrans && hasGen2(s) && hasGen4(s) && hasCacheTag(s) && hasGen6(s));
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
      console.log(`  ✗ 插件 ${p.version}：`);
      p.groups.forEach((g, i) => {
        const names = g.targets.map((t) => t.member).join('、');
        console.log(`     组 ${i + 1}（${g.targets.length} 份 · 最近修改 ${fmtMs(g.newestAt)}）：${names}`);
        for (const t of g.targets) {
          let ms = 0;
          try {
            ms = fs.statSync(t.file).mtimeMs;
          } catch {
            ms = 0;
          }
          console.log(`       - ${t.member}: ${t.file}（${fmtMs(ms)}）`);
        }
      });
      if (p.earliest) {
        const names = p.earliest.targets.map((t) => t.member).join('、');
        console.log(`  最早修改的是 ${names}（${fmtMs(p.earliest.newestAt)}）——线索，不是结论（被单独 append 过的那份反而更新）。`);
      }
      // 2026-11-18 LeeaCP（r303）：期望内容才是判据；mtime/多数派都只是证据的形状。
      if (p.expectedKnown) {
        const same = p.groups.filter((g) => g.matchesExpected === true);
        const stale = p.groups.filter((g) => g.matchesExpected === false);
        if (same.length > 0) {
          const names = same.reduce((acc, g) => acc.concat(g.targets.map((t) => t.member)), []).join('、');
          console.log(`  与期望一致的是 ${names}（期望 = 拿同版本的 orig 跑同一套变换算出来的「打完应该长什么样」）。`);
        }
        for (const g of stale) {
          const names = g.targets.map((t) => t.member).join('、');
          if (g.diff) {
            console.log(`  与期望不一致的是 ${names}——第一处差异在 L${g.diff.line}：期望「${g.diff.expected}」≠ 实际「${g.diff.actual}」。它们才是旧的。`);
          } else {
            console.log(`  与期望不一致的是 ${names}（内容读不到，没法给出差异行）。`);
          }
        }
      } else {
        console.log('  （同版本里没有 orig 副本，算不出期望内容；mtime 只当线索，别当结论。）');
      }
    }
    console.log('  NEXT: 逐份跑 --dry-run 看差在哪，再重跑补丁；差异大的一份先与同版本另一台对 diff。');
    process.exit(1);
  }
  console.log('检查：全部已打补丁。');
}
const needsWork = patchable + halfFixed + thirdPending + latePending + gen3Pending + gen4Pending + cachePending + gen6Pending;
process.exit(failed > 0 || halfStuck > 0 || (checkOnly && needsWork > 0) ? 1 : 0);

