#!/usr/bin/env node
/**
 * 记一行「人做的操作」（r342）。逻辑与行形在 scripts/lib/manual-op-core.mjs，先读那份注释。
 *
 * 为什么要有这个：机器自己做 prune/rotate 会写 watchman.log；
 * 人手动删/搬共享区的东西没人记，事后只能凭目录 mtime 和聊天记录对账。
 * 这个脚本只做一件事——把「谁、什么时候、动了什么、为什么」落成一行，追加到
 * `<鱼塘根>\pool\state\manual-ops.log`，不改任何别的账。
 *
 * 用法：
 *   node scripts/manual-op.mjs --by lee --removed 3 --bytes 18117679 --note "清过期视频缓存（宿主让转告小肥鱼）"
 *   node scripts/manual-op.mjs --by lee --at "2026-11-18 19:29:50" --removed 3 --bytes 18117679 --note "补记当时那笔"
 *   [--kind manual-rm|manual-other] [--file <日志路径>] [--dry-run]
 *   node scripts/manual-op.mjs --fix-eof [--file <日志路径>]   # 上一行没换行结尾时只补一个换行
 *
 * 2026-11-18 r342；r347 按小鱼丸私聊补两处：NEXT 要按错误类型说人话、
 * 追加前先看末字节（否则两条记录会粘成一行，行数不变量看不出问题）。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { endOfFileProblem, formatManualOp, parseAt, tsLocal } from './lib/manual-op-core.mjs';
import { loadConfigOrExit } from './lib/config-path.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const cfg = loadConfigOrExit({ repoRoot: resolve(HERE, '..') });

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const kind = arg('kind', 'manual-rm');
const by = arg('by');
const removed = arg('removed', '0');
const bytes = arg('bytes', '0');
const note = arg('note');
const atText = arg('at');
const dry = process.argv.includes('--dry-run');
const fixEof = process.argv.includes('--fix-eof');
const stateDir = cfg.poolStateDir || join(cfg.poolDir, 'state');
const file = arg('file') || join(stateDir, 'manual-ops.log');

// --fix-eof（r347）：账本末行没有换行结尾时，只补一个换行；不改已有任何字节。
// 单独一个动作，是因为"补换行"本身就是一次手改账本，得有人按一次键。
if (fixEof) {
  if (!existsSync(file)) {
    console.log(`no-file ${file}（不用补）`);
    process.exit(0);
  }
  const raw = readFileSync(file);
  const problem = endOfFileProblem(raw);
  if (!problem) {
    console.log(`ok ${file} 末字节已经是换行，不用补`);
    process.exit(0);
  }
  if (dry) {
    console.log(JSON.stringify({ ok: true, dryRun: true, fixEof: true, file, bytes: problem.bytes }, null, 2));
    process.exit(0);
  }
  appendFileSync(file, '\n', 'utf8');
  console.log(`fixed ${file} 补了一个换行（${statSync(file).size - problem.bytes} 字节），原有内容未改`);
  process.exit(0);
}

if (!by || !note) {
  console.error('缺少 --by / --note（一行账至少要知道是谁、做了什么）');
  console.error('NEXT: node scripts/manual-op.mjs --by lee --removed 3 --bytes 18117679 --note "清过期视频缓存"');
  process.exit(2);
}

let when = new Date();
if (atText) {
  when = parseAt(atText);
  if (!when) {
    console.error(`--at 看不懂：${atText}`);
    console.error('NEXT: 用本地时间 "2026-11-18 19:29:50"，或 ISO 串');
    process.exit(2);
  }
}

let line;
try {
  line = formatManualOp({ ts: tsLocal(when), kind, by, removed, bytes, note });
} catch (e) {
  console.error(e.message);
  // NEXT 按错误类型分开说（r347，小鱼丸 2026-11-18 私聊）：
  // 字符集被拒的时候，让人去"去掉换行"是把他引到一个不存在的问题上。
  const next = {
    missing: '补全 --by / --note：一行账至少要有"谁"和"做了什么"。',
    charset: '--by 改成 1–32 位 ASCII：字母、数字、下划线、点或连字符（中文、空格、换行都不行）。',
    field: '把字段里的换行和竖线去掉：换行会造出第二行，竖线会造出第二个字段。',
    kind: '--kind 只用 manual-rm 或 manual-other。',
  }[e.hint] || '照上面那行改，改完重跑。';
  console.error(`NEXT: ${next}`);
  process.exit(2);
}

// 追加前先看末字节（r347）：上一行没换行结尾时直接 append，两条记录会粘成一行；
// 行数只 +1，后面的不变量也抓不到。检查必须在写之前，代价是一次 read。
const eof = existsSync(file) ? endOfFileProblem(readFileSync(file)) : null;
if (eof) {
  // dry-run 的用途是诊断（r356，小鱼丸 2026-11-19 群）：真跑确实该被拒，但"若补一个换行会写成什么样"
  // 仍是它该回答的问题——只报拒绝，读的人容易以为是自己参数写错。
  if (dry) {
    console.log(JSON.stringify({ ok: false, dryRun: true, file, refused: 'eof-not-newline', eof: { bytes: eof.bytes, tail: eof.tail }, wouldAppend: line }, null, 2));
    console.error(`xx 账本末行没有换行结尾（${eof.bytes} 字节，尾部是「${eof.tail}」）；真跑会被拒，上面只是"若补一个换行之后的追加结果"。`);
    console.error(`NEXT: 先补一个换行：node scripts/manual-op.mjs --fix-eof --file "${file}"，然后重跑这次记账。`);
    process.exit(2);
  }
  console.error(`xx 账本末行没有换行结尾（${eof.bytes} 字节，尾部是「${eof.tail}」）；现在追加会把两条记录粘成一行。`);
  console.error(`NEXT: 先补一个换行：node scripts/manual-op.mjs --fix-eof --file "${file}"，然后重跑这次记账。`);
  process.exit(2);
}

if (dry) {
  console.log(JSON.stringify({ ok: true, dryRun: true, file, eof: 'ok', line }, null, 2));
  process.exit(0);
}

function nonEmptyLines(text) {
  return String(text ?? '').split('\n').filter((l) => l.trim() !== '');
}

const before = existsSync(file) ? nonEmptyLines(readFileSync(file, 'utf8')).length : 0;

mkdirSync(dirname(file), { recursive: true });
appendFileSync(file, line + '\n', 'utf8');

// 不变量（小鱼丸 2026-11-18 20:2x 私聊建议）：一次调用之后，账本行数只许 +1。
// 它同时挡住"字段里的换行造出第二行"和"同一行写两次"——追加式账本没有回滚，所以必须当场发现。
const lines = nonEmptyLines(readFileSync(file, 'utf8'));
const after = lines.length;
const last = lines[lines.length - 1] ?? '';
if (after !== before + 1 || last !== line) {
  console.error(`xx 账本行数不对：调用前 ${before} 行，调用后 ${after} 行（期望 ${before + 1}）；最后一行${last === line ? '与写入一致' : '与写入不一致'}`);
  console.error('NEXT: 这行不合法就别再重试；先看账本尾部，人工决定要不要留痕');
  process.exit(3);
}
console.log(`appended ${file} line=${after}`);
console.log(line);
