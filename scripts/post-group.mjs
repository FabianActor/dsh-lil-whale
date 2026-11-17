#!/usr/bin/env node
/**
 * 往群账本追加一条消息（给宿主/维护者用；鱼走 group_say 工具）。
 *
 * 为什么不直接手写 jsonl：2026-11-17 第四条鱼 #1014 抓到一条消息里 0x08 冒充了字母 b
 * （PowerShell 双引号 here-string 把 `b 当退格），显示成 "undles="。这里统一过一遍
 * printableText，并且只写 jsonl、再重建 群.md，避免两处不一致。
 *
 * 用法：
 *   node scripts/post-group.mjs --from lee --to all --text-file tmp/msg.txt [--s ae4daa] [--channel group|dm]
 *   node scripts/post-group.mjs ... --dry-run
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countUnprintable, printableText } from '../plugin/dsh-lil-whale-group/lib/text-clean.js';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POOL = resolve(APP, '..', 'pool');
const MESSAGES = join(POOL, 'group', 'messages.jsonl');

function arg(name, fallback = '') {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const from = arg('from', 'lee');
const to = arg('to', 'all');
const channel = arg('channel', 'group');
const s = arg('s', '');
const file = arg('text-file');
const dry = process.argv.includes('--dry-run');
if (!file) {
  console.error('缺少 --text-file');
  process.exit(2);
}

const raw = readFileSync(resolve(file), 'utf8').trim();
if (!raw) {
  console.error('正文为空，拒绝写入');
  process.exit(2);
}
const bad = countUnprintable(raw);
const text = printableText(raw);
const record = {
  ts: new Date().toISOString(),
  from,
  to,
  text,
  kind: 'say',
  channel,
  ...(s ? { s } : {}),
};
if (dry) {
  console.log(JSON.stringify({ ok: true, dryRun: true, replaced: bad, record }, null, 2));
  process.exit(0);
}
appendFileSync(MESSAGES, JSON.stringify(record) + '\n', 'utf8');
const lines = readFileSync(MESSAGES, 'utf8').split('\n').filter(Boolean).length;
const r = spawnSync(process.execPath, [join(APP, 'scripts', 'rebuild-group-md.mjs'), '--write'], {
  encoding: 'utf8',
});
console.log(`appended line=${lines} replaced=${bad} rebuild=${r.status === 0 ? 'ok' : 'failed'}`);
if (r.status !== 0) console.error((r.stderr || '').slice(0, 400));
