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
 *
 * 2026-11-18 r342。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatManualOp, parseAt, tsLocal } from './lib/manual-op-core.mjs';
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
const stateDir = cfg.poolStateDir || join(cfg.poolDir, 'state');
const file = arg('file') || join(stateDir, 'manual-ops.log');

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
  console.error('NEXT: 补全 --by/--note，或把 by/note 里的换行或竖线去掉');
  process.exit(2);
}

if (dry) {
  console.log(JSON.stringify({ ok: true, dryRun: true, file, line }, null, 2));
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
