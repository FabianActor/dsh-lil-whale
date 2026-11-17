#!/usr/bin/env node
/**
 * 发一条私聊（写 pool\dm\<a>__<b>.jsonl + 可读投影 私聊-<a>__<b>.md）。
 *
 * 为什么不是 --channel dm 的 post-group：那个脚本只写群账本（r270 已改成直接拒绝），
 * 私聊有自己的一本账（`pool\dm`），形状是 `kind:"dm"` / `channel:"dm"`，
 * 收件人只看 `pool\dm`。两条账不能混。
 *
 * 用法：
 *   node scripts/post-dm.mjs --from lee --to lee2 --text-file tmp/msg.txt [--dry-run]
 *
 * 2026-11-17 r271。成员键来自名册（config.membersFile），不是写死的。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigOrExit } from './lib/config-path.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const cfg = loadConfigOrExit({ repoRoot: resolve(HERE, '..') });

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const from = arg('from');
const to = arg('to');
const file = arg('text-file');
const dry = process.argv.includes('--dry-run');

if (!from || !to) {
  console.error('缺少 --from / --to');
  console.error('NEXT: node scripts/post-dm.mjs --from lee --to lee2 --text-file tmp/msg.txt');
  process.exit(2);
}
if (!file) {
  console.error('缺少 --text-file');
  console.error('NEXT: 把正文写进一个临时文件，再传 --text-file');
  process.exit(2);
}

const membersFile = cfg.membersFile || join(cfg.groupDir, 'members.json');
let members = {};
try {
  const parsed = JSON.parse(readFileSync(membersFile, 'utf8'));
  members = parsed.members && typeof parsed.members === 'object' ? parsed.members : parsed;
} catch (e) {
  console.error(`名册读不了：${membersFile}（${e.message}）`);
  console.error('NEXT: 先确认鱼塘装完整（fish.ps1 doctor 的「名册与家」一格）');
  process.exit(1);
}
for (const key of [from, to]) {
  if (!members[key]) {
    console.error(`名册里没有成员 ${key}`);
    console.error(`NEXT: 名字用名册里的键（${Object.keys(members).join(' / ')}）`);
    process.exit(2);
  }
}
if (from === to) {
  console.error('自己给自己发私聊不成立（群和私聊都不走这条）');
  process.exit(2);
}

const raw = readFileSync(resolve(file), 'utf8').trim();
if (!raw) {
  console.error('正文为空，拒绝写入');
  process.exit(2);
}

const dmDir = cfg.dmDir || join(cfg.groupDir, 'dm');
const [x, y] = [from, to].sort();
const dmFile = join(dmDir, `${x}__${y}.jsonl`);
const readable = join(dmDir, `私聊-${x}__${y}.md`);
const labelOf = (k) => members[k]?.label || k;
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

const record = { ts: now.toISOString(), from, to, text: raw, kind: 'dm', channel: 'dm' };

if (dry) {
  console.log(JSON.stringify({ ok: true, dryRun: true, dmFile, readable, record }, null, 2));
  process.exit(0);
}

mkdirSync(dmDir, { recursive: true });
appendFileSync(dmFile, JSON.stringify(record) + '\n', 'utf8');
if (!existsSync(readable)) {
  writeFileSync(readable, `# 私聊 · ${labelOf(x)} / ${labelOf(y)}\n\n`, 'utf8');
}
appendFileSync(readable, `**${stamp} · ${labelOf(from)}**\n\n${raw}\n\n`, 'utf8');
const lines = readFileSync(dmFile, 'utf8').split('\n').filter(Boolean).length;
console.log(`appended ${dmFile} line=${lines}`);
