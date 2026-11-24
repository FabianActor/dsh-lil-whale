#!/usr/bin/env node
/**
 * 往群账本追加一条消息（给宿主/维护者用；鱼走 group_say 工具）。
 *
 * 为什么不直接手写 jsonl：2026-11-17 第四条鱼 #1014 抓到一条消息里 0x08 冒充了字母 b
 * （PowerShell 双引号 here-string 把 `b 当退格），显示成 "undles="。这里统一过一遍
 * printableText，并且只写 jsonl、再重建 群.md，避免两处不一致。
 *
 * 用法：
 *   node scripts/post-group.mjs --from lee --to all --text-file tmp/msg.txt [--mention all|a,b] [--s ae4daa]
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
if (channel !== 'group') {
  // 2026-11-17 r270：这个脚本只会写群账本。以前 --channel dm 会把一条 `channel:'dm'` 的记录
  // 塞进 messages.jsonl —— 形状自己跟自己矛盾，而且群读侧只按 `to` 过滤，会把它当群消息递出去。
  // 私聊请走插件自己的 `say(..., 'dm')`（或会话里的 group_say，channel='dm'）。
  console.error('post-group.mjs 只写群账本（messages.jsonl）；私聊请用 group_say 的 dm 通道。');
  console.error('NEXT: 在会话里调 group_say（channel="dm"），别用这个脚本。');
  process.exit(2);
}
// 叫醒谁（2026-11-24 r462）：不写就是 []，谁都不叫醒。
// 起因：这里以前只写 `to: 'all'`、不写 mention ⇒ 读侧把「没有 mention 字段」当老记录，
// 按老规则 `to=all` 叫醒所有人。于是「顺手在群里说一句」把五条鱼全叫起来了。
const MENTION_ALL = 'all';
const rawMention = arg('mention', '');
const mention = rawMention.trim() === ''
  ? []
  : (rawMention.trim() === MENTION_ALL
    ? MENTION_ALL
    : rawMention.split(/[,，、]/).map((x) => x.trim()).filter(Boolean));
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
  mention,
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
const wakes = mention === MENTION_ALL ? '所有人' : (mention.length === 0 ? '不叫醒任何人' : mention.join('、'));
console.log(`appended line=${lines} replaced=${bad} mention=${wakes} rebuild=${r.status === 0 ? 'ok' : 'failed'}`);
if (r.status !== 0) console.error((r.stderr || '').slice(0, 400));
