#!/usr/bin/env node
'use strict';
/**
 * fissue.mjs -- 鱼群内 issue 的收件台（宿主 2026-11-19 定名；名字连读像 fish+issue，也像 fissure）。
 *
 * 思路：
 *   鱼对 `pool\` 只读，所以**写入点只有这里**。它们唯一能做的动作是"在群里说一条"；
 *   收、编号、判重、关单归我。账是只追加的事件流，页面和索引都是投影（可重生成）。
 *
 * 用法：
 *   node scripts/fissue.mjs scan            # 按游标扫 pool\group\messages.jsonl，收新的 fissue 投递
 *   node scripts/fissue.mjs list [--open]   # 列表（默认全部）
 *   node scripts/fissue.mjs show fi-0001    # 看一页
 *   node scripts/fissue.mjs claim fi-0001   # 认领（池里同时只能有一条在做）
 *   node scripts/fissue.mjs comment fi-0001 --from lee --text "..."   # 或 --text-file
 *   node scripts/fissue.mjs close fi-0001 --commit <hash> --verify "..." [--note "..."]
 *   node scripts/fissue.mjs merge fi-0002 --into fi-0001 --why "同一条"   # 判重后合并
 *   node scripts/fissue.mjs reopen fi-0001 --why "又出现了"
 *   node scripts/fissue.mjs index           # 只重生成 INDEX/页面
 *   node scripts/fissue.mjs check           # 自检（事件自洽、页面在、current 指向 open）
 *   可选 --json（给机器看）、--dry-run（scan/new 不落盘）
 *
 * 数据：<鱼塘根>\pool\fissue\
 *   issues.jsonl   只追加事件流（open/assign/comment/close/reopen/merge/reject）
 *   cursor.json    扫群游标（最后一次扫到第几行）
 *   current.json   正在做的那一条（一次只许一条）
 *   INDEX.md       索引投影
 *   open\  closed\ 一条一页（fi-0001.md）
 *
 * 编号：账里存整数 num，展示补零成 fi-0001；超过 9999 自动变宽（fi-10000），排序一律用 num。
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigOrExit } from './lib/config-path.mjs';
import {
  FISSUE_FMT,
  FIELD_LABELS,
  MARKER_RE,
  foldIssues,
  issueId,
  numOfId,
  parseFissueMessage,
  renderIndex,
  renderIssue,
  similarity,
  validateEvents,
} from './lib/fissue-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const cfg = loadConfigOrExit({ repoRoot: resolve(HERE, '..') });
const POOL = cfg.poolDir;
if (!POOL) die('配置里没有 poolDir', '先修 lil-whale.config.json（或 LIL_WHALE_CONFIG 指向的那份）');

const GROUP_DIR = cfg.groupDir || join(POOL, 'group');
const MESSAGES = join(GROUP_DIR, 'messages.jsonl');
const DIR = join(POOL, 'fissue');
const ISSUES = join(DIR, 'issues.jsonl');
const CURSOR = join(DIR, 'cursor.json');
const CURRENT = join(DIR, 'current.json');
const INDEX = join(DIR, 'INDEX.md');
const OPEN_DIR = join(DIR, 'open');
const CLOSED_DIR = join(DIR, 'closed');

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const dryRun = argv.includes('--dry-run');
const cmd = argv.find((a) => !a.startsWith('--')) || 'help';

function arg(name, fallback = '') {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
}
function flag(name) {
  return argv.includes(`--${name}`);
}
function die(message, next = '') {
  console.error('xx ' + message);
  if (next) console.error('\nNEXT: ' + next);
  process.exit(1);
}
function nowIso() {
  return new Date().toISOString();
}
function stampOf(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || '?';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}
function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    die(`读不了 ${path}：${e.message}`, '这份 JSON 坏了；先修它，别继续往坏了写。');
  }
}
function writeJsonAtomic(path, value) {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
}
function readEvents() {
  if (!existsSync(ISSUES)) return [];
  const lines = readFileSync(ISSUES, 'utf8').split(/\r?\n/u);
  const events = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch (e) {
      die(`issues.jsonl 第 ${i + 1} 行不是 JSON：${e.message}`, '事件流只追加不改；坏行人工核对后再动。');
    }
  }
  return events;
}
function appendEvent(ev) {
  ensureDir(DIR);
  appendFileSync(ISSUES, JSON.stringify(ev) + '\n', 'utf8');
}
function readCurrent() {
  const cur = readJson(CURRENT, { num: null });
  return cur && typeof cur === 'object' ? cur : { num: null };
}
function readCursor() {
  const cur = readJson(CURSOR, { lastLine: 0 });
  return Number.isInteger(cur.lastLine) ? cur.lastLine : 0;
}
function readText(flagName) {
  const file = arg(`${flagName}-file`);
  if (file) {
    if (!existsSync(file)) die(`没有这个文件：${file}`);
    return readFileSync(file, 'utf8').trim();
  }
  return arg(flagName);
}
function readLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split(/\r?\n/u);
}

function stateNow() {
  const events = readEvents();
  const folded = foldIssues(events);
  return { events, folded };
}

function writeDerived(folded) {
  ensureDir(DIR);
  ensureDir(OPEN_DIR);
  ensureDir(CLOSED_DIR);
  const generatedAt = stampOf(nowIso());
  writeFileSync(INDEX, renderIndex(folded, { generatedAt }), 'utf8');

  const expected = new Map();
  for (const it of folded.issues.values()) {
    const dirWanted = it.status === 'open' ? OPEN_DIR : CLOSED_DIR;
    const file = join(dirWanted, `${it.id}.md`);
    expected.set(file, true);
    writeFileSync(file, renderIssue(it, { generatedAt }), 'utf8');
  }
  for (const dir of [OPEN_DIR, CLOSED_DIR]) {
    for (const name of readdirSync(dir)) {
      if (!/^fi-\d+\.md$/u.test(name)) continue;
      const file = join(dir, name);
      if (!expected.has(file)) unlinkSync(file);
    }
  }
}

function printIssueLine(it) {
  const closed = it.status === 'open' ? '' : `  → ${it.mergedInto !== null ? issueId(it.mergedInto) : 'closed'}`;
  console.log(`${it.id}  ${it.status}  ${it.title}${closed}  （来自 ${it.from || '?'}）`);
}

function issueOrDie(ref) {
  const num = numOfId(ref);
  if (num === null) die(`认不出编号：${ref}`, '用 fi-0001 或 1 这样的写法。');
  const { events, folded } = stateNow();
  const it = folded.issues.get(num);
  if (!it) die(`没有 ${issueId(num)}`, '先 `list` 看有哪些。');
  return { it, events, folded, num };
}

function summaryOf(folded) {
  const open = [...folded.issues.values()].filter((i) => i.status === 'open').length;
  const closed = folded.issues.size - open;
  return `${folded.issues.size} 条（open ${open} / closed ${closed}），退回 ${folded.rejects.length} 条`;
}

function cmdScan() {
  const lines = readLines(MESSAGES);
  const start = Math.min(readCursor(), lines.length);
  const { events, folded } = stateNow();
  const maxNum = folded.issues.size === 0 ? 0 : Math.max(...[...folded.issues.keys()]);
  let next = maxNum;
  const added = [];
  const rejected = [];
  const hints = [];

  for (let i = start; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(raw);
    } catch {
      continue; // 群文件里坏行不该挡住 fissue；它有自己的账
    }
    const text = String(rec.text ?? '');
    if (!MARKER_RE.test(text)) continue;
    const from = String(rec.from ?? '?');
    const parsed = parseFissueMessage(text);
    // 2026-11-19：加了第六格「验收」。老五格照收（缺验收记提示），别因为改格式把已经寄出的信退回。
    const hardMissing = parsed.missing.filter((label) => label !== '验收')
    if (hardMissing.length > 0) {
      rejected.push({ line: i + 1, from, why: `缺 ${hardMissing.join('、')}` })
      continue
    }
    if (parsed.missing.includes('验收')) {
      hints.push(`${issueId(next + 1)}（群第 ${i + 1} 行）缺「验收」：按旧五格收下，开工前跟提的人要一句能复算的验法`)
    }
    next += 1;
    const ev = {
      ev: 'open',
      fmt: FISSUE_FMT,
      num: next,
      at: new Date(Number(rec.ts) || Date.now()).toISOString(),
      from,
      msg: i + 1,
      title: parsed.title,
      fields: parsed.fields,
      excerpt: text.slice(0, 300),
    };
    added.push(ev);
    for (const old of folded.issues.values()) {
      const score = Math.max(
        similarity(parsed.title, old.title),
        similarity(parsed.title + parsed.fields['现象'], old.title + String(old.fields['现象'] ?? '')),
      );
      if (score >= 0.45) hints.push(`${issueId(next)} 可能重复 ${old.id}「${old.title}」（相似 ${score.toFixed(2)}）`);
    }
    folded.issues.set(ev.num, {
      num: ev.num,
      id: issueId(ev.num),
      status: 'open',
      title: ev.title,
      fields: ev.fields,
      from: ev.from,
      at: ev.at,
      msg: ev.msg,
      events: [ev],
      comments: [],
      assignee: null,
      closed: null,
      mergedInto: null,
      problems: [],
    });
  }

  const scannedTo = lines.length;
  if (dryRun) {
    console.log(`（dry-run）扫到第 ${scannedTo} 行：会收 ${added.length} 条、退回 ${rejected.length} 条`);
    for (const ev of added) console.log(`  + ${issueId(ev.num)} ${ev.title}（来自 ${ev.from}，群第 ${ev.msg} 行）`);
    for (const r of rejected) console.log(`  - 退回：第 ${r.line} 行 ${r.from}：${r.why}`);
    for (const h of hints) console.log(`  ? ${h}`);
    return;
  }

  for (const ev of added) appendEvent(ev);
  for (const r of rejected) {
    appendEvent({ ev: 'reject', fmt: FISSUE_FMT, at: nowIso(), line: r.line, from: r.from, why: r.why });
  }
  writeJsonAtomic(CURSOR, { lastLine: scannedTo, updatedAt: nowIso() });
  if (added.length > 0 || rejected.length > 0) writeDerived(folded);

  if (json) {
    console.log(JSON.stringify({ ok: true, scanned: scannedTo, added, rejected, hints }, null, 2));
    return;
  }
  console.log(`扫到第 ${scannedTo} 行：新收 ${added.length} 条，退回 ${rejected.length} 条`);
  for (const ev of added) console.log(`  + ${issueId(ev.num)} ${ev.title}（来自 ${ev.from}，群第 ${ev.msg} 行）`);
  for (const r of rejected) console.log(`  - 退回：第 ${r.line} 行 ${r.from}：${r.why}（缺栏也会记一笔，去要齐再交）`);
  for (const h of hints) console.log(`  ? ${h}`);
}

function cmdNew() {
  const from = arg('from', 'lee');
  const title = arg('title');
  const fields = {};
  const missing = [];
  if (!title.trim()) missing.push('标题');
  for (const label of FIELD_LABELS) {
    const value = arg(label) || arg(label === '现象' ? 'symptom' : label === '证据' ? 'evidence' : label === '期望' ? 'expect' : label === '前案' ? 'prior' : label === '验收' ? 'verify' : 'unsure');
    fields[label] = value;
    if (!String(value).trim()) missing.push(label);
  }
  if (missing.length > 0) die(`缺栏：${missing.join('、')}`, '六格齐全才收；缺的就写"没有/不知道"，但不能空着。');
  const { folded } = stateNow();
  const num = folded.issues.size === 0 ? 1 : Math.max(...[...folded.issues.keys()]) + 1;
  const ev = { ev: 'open', fmt: FISSUE_FMT, num, at: nowIso(), from, msg: null, title: title.trim(), fields, excerpt: '' };
  if (dryRun) {
    console.log(`（dry-run）会记 ${issueId(num)} ${ev.title}`);
    return;
  }
  appendEvent(ev);
  const next = foldIssues(readEvents());
  writeDerived(next);
  console.log(`已记 ${issueId(num)} ${ev.title}`);
}

function cmdList() {
  const { folded } = stateNow();
  const rows = [...folded.issues.values()].sort((a, b) => a.num - b.num);
  const filtered = flag('open') ? rows.filter((i) => i.status === 'open') : rows;
  if (json) {
    console.log(JSON.stringify(filtered.map((i) => ({ id: i.id, num: i.num, status: i.status, title: i.title, from: i.from, mergedInto: i.mergedInto, assignee: i.assignee })), null, 2));
    return;
  }
  const cur = readCurrent();
  const curNote = cur.num ? `（在做：${issueId(cur.num)}）` : '（没在做）';
  console.log(`${summaryOf(folded)} ${curNote}`);
  for (const it of filtered) printIssueLine(it);
}

function cmdShow() {
  const ref = numOfId(argv[1]);
  if (ref === null) die(`认不出编号：${argv[1] ?? '（没给）'}`, '用 fi-0001。');
  const { folded } = stateNow();
  const it = folded.issues.get(ref);
  if (!it) die(`没有 ${issueId(ref)}`);
  const page = it.status === 'open' ? join(OPEN_DIR, `${it.id}.md`) : join(CLOSED_DIR, `${it.id}.md`);
  if (!existsSync(page)) {
    writeDerived(folded);
  }
  process.stdout.write(readFileSync(page, 'utf8'));
}

function cmdClaim() {
  const { it, folded, num } = issueOrDie(argv[1]);
  if (it.status !== 'open') die(`${it.id} 不是 open（${it.status}），先 reopen 或看别的。`);
  const cur = readCurrent();
  const by = arg('by', 'lee');
  if (cur.num && cur.num !== num) {
    die(`已经有在做的一条：${issueId(cur.num)}（${cur.at ?? '?'}）`, '一次只做一条；先把它 close 或 comment 里说明放回，再 claim 新的。');
  }
  if (cur.num === num) {
    console.log(`已经在做：${it.id}`);
    return;
  }
  writeJsonAtomic(CURRENT, { num, at: nowIso(), by });
  appendEvent({ ev: 'assign', fmt: FISSUE_FMT, num, at: nowIso(), to: by });
  writeDerived(foldIssues(readEvents()));
  console.log(`claim ${it.id}：${it.title}`);
  console.log('接下来：动手前先读页面；只跟提出者私聊问细节；关单要带 commit 与验证。');
}

function cmdComment() {
  const { it, num } = issueOrDie(argv[1]);
  const text = readText('text');
  if (!text) die('comment 需要 --text 或 --text-file');
  const from = arg('from', 'lee');
  appendEvent({ ev: 'comment', fmt: FISSUE_FMT, num, at: nowIso(), from, text });
  writeDerived(foldIssues(readEvents()));
  console.log(`comment → ${it.id}（来自 ${from}）`);
}

function cmdClose() {
  const { it, folded, num } = issueOrDie(argv[1]);
  if (it.status !== 'open') die(`${it.id} 不是 open（${it.status}），不能关。`);
  const commit = arg('commit');
  const verify = readText('verify');
  if (!commit) die('close 需要 --commit（真提交号）', '关单没有提交号，等于说"修了"但没有记录。');
  if (!verify) die('close 需要 --verify（怎么验过）', '写清看到什么、在哪看到的。');
  const cur = readCurrent();
  if (cur.num !== num) {
    die(`现在在做的是 ${cur.num ? issueId(cur.num) : '（没有）'}，不是 ${it.id}`, `先 claim ${it.id}，或者说明为什么越序。`);
  }
  appendEvent({ ev: 'close', fmt: FISSUE_FMT, num, at: nowIso(), by: arg('by', 'lee'), commit, verify, note: readText('note') });
  writeJsonAtomic(CURRENT, { num: null, at: nowIso() });
  writeDerived(foldIssues(readEvents()));
  console.log(`close ${it.id}（commit ${commit}）`);
}

function cmdMerge() {
  const src = issueOrDie(argv[1]);
  const target = numOfId(arg('into'));
  if (target === null) die('merge 需要 --into fi-000X');
  const dst = src.folded.issues.get(target);
  if (!dst) die(`没有 ${issueId(target)}`);
  if (dst.num === src.num) die('不能并进自己');
  appendEvent({ ev: 'merge', fmt: FISSUE_FMT, num: src.num, at: nowIso(), into: target, why: readText('why') || arg('why') });
  const cur = readCurrent();
  if (cur.num === src.num) writeJsonAtomic(CURRENT, { num: null, at: nowIso() });
  writeDerived(foldIssues(readEvents()));
  console.log(`merge ${src.it.id} → ${issueId(target)}`);
}

function cmdReopen() {
  const { it, num } = issueOrDie(argv[1]);
  if (it.status === 'open') die(`${it.id} 已经是 open。`);
  appendEvent({ ev: 'reopen', fmt: FISSUE_FMT, num, at: nowIso(), by: arg('by', 'lee'), why: readText('why') || arg('why') });
  writeDerived(foldIssues(readEvents()));
  console.log(`reopen ${it.id}`);
}

function cmdIndex() {
  const { folded } = stateNow();
  writeDerived(folded);
  console.log(`index 已重生成：${summaryOf(folded)}`);
}

function cmdCheck() {
  const problems = [];
  const events = readEvents();
  const valid = validateEvents(events);
  problems.push(...valid.problems);
  const folded = foldIssues(events);
  problems.push(...folded.problems);
  for (const it of folded.issues.values()) problems.push(...it.problems.map((p) => `${it.id}：${p}`));

  // 编号与事件一致
  const nums = [...folded.issues.keys()].sort((a, b) => a - b);
  if (nums.length > 0 && nums[nums.length - 1] !== nums.length) {
    problems.push(`最大编号 ${issueId(nums[nums.length - 1])} 与条数 ${nums.length} 不一致（有跳号）`);
  }

  // current 必须指向 open 的那一条
  const cur = readCurrent();
  if (cur.num) {
    const it = folded.issues.get(cur.num);
    if (!it) problems.push(`current.json 指向不存在的 ${issueId(cur.num)}`);
    else if (it.status !== 'open') problems.push(`current.json 指向已关闭的 ${issueId(cur.num)}（做完要清 current）`);
  }

  // 页面在不在
  for (const it of folded.issues.values()) {
    const dirWanted = it.status === 'open' ? OPEN_DIR : CLOSED_DIR;
    const page = join(dirWanted, `${it.id}.md`);
    if (!existsSync(page)) problems.push(`${it.id} 缺页面（${page}）`);
  }

  // 游标不超过群文件行数
  const lines = readLines(MESSAGES).length;
  const cursor = readCursor();
  if (cursor > lines) problems.push(`cursor.json 游标 ${cursor} 超过群文件 ${lines} 行（文件被截过？）`);

  if (json) {
    console.log(JSON.stringify({ ok: problems.length === 0, problems, summary: summaryOf(folded) }, null, 2));
    process.exit(problems.length === 0 ? 0 : 1);
  }
  if (problems.length > 0) {
    for (const p of problems) console.error('xx ' + p);
    console.error(`\nNEXT: 先看 issues.jsonl 与 pages；事件流只追加不改，修的是投影或补一条说明。`);
    process.exit(1);
  }
  console.log(`ok fissue：${summaryOf(folded)}`);
}

function usage() {
  console.log('fissue <scan|list|show|claim|comment|close|merge|reopen|new|index|check> [args]');
  console.log('  scan            扫群消息收新的 fissue 投递');
  console.log('  list [--open]   看列表');
  console.log('  show fi-0001    看一条');
  console.log('  claim fi-0001   认领（同时只能有一条在做）');
  console.log('  comment fi-0001 --from lee --text "..."');
  console.log('  close fi-0001 --commit <hash> --verify "..."');
  console.log('  merge fi-0002 --into fi-0001 --why "同一条"');
  console.log('  reopen fi-0001 --why "又出现了"');
  console.log('  new --from lee --title "..." --现象 "..." ...（六格齐全）');
  console.log('  index / check');
}

switch (cmd) {
  case 'scan':
    cmdScan();
    break;
  case 'list':
    cmdList();
    break;
  case 'show':
    cmdShow();
    break;
  case 'claim':
    cmdClaim();
    break;
  case 'comment':
    cmdComment();
    break;
  case 'close':
    cmdClose();
    break;
  case 'merge':
    cmdMerge();
    break;
  case 'reopen':
    cmdReopen();
    break;
  case 'new':
    cmdNew();
    break;
  case 'index':
    cmdIndex();
    break;
  case 'check':
    cmdCheck();
    break;
  default:
    usage();
    process.exit(cmd === 'help' ? 0 : 1);
}
