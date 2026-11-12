#!/usr/bin/env node
// 名册原子替换：读 pins.json -> 换掉某个成员的会话 id 列表 -> 一次 rename 落地。
// 用途：她搬段那天，把 whale 的会话 id 从旧段换成新段。
// 为什么不用手改：pins.json 是"哪段会话算哪条鱼"的唯一出处，写一半断电就会让两段都算她，
// 或者一段都不算。先写临时文件再 rename，读者要么看见旧名册、要么看见新名册。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 不能用 new URL(...).pathname：仓库路径里有中文（文档），会被百分号编码成 %E6%96%87…，
// 拼出来的路径不存在 ⇒ 读配置静默失败 ⇒ 报"找不到 groupDir"。这个坑 11-12 在
// gen-neutral-preset.mjs 里踩过一次，这里是第二次。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readConfig() {
  const explicit = process.env.LIL_WHALE_CONFIG;
  const candidates = explicit ? [explicit] : [path.join(ROOT, 'lil-whale.config.json'), path.join(ROOT, 'lil-whale.config.example.json')];
  for (const p of candidates) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      /* 下一个 */
    }
  }
  return null;
}

function defaultPinsFile() {
  const cfg = readConfig();
  const groupDir = cfg && cfg.groupDir;
  if (!groupDir) die('找不到配置里的 groupDir；请用 --file 指到 pins.json，或设 LIL_WHALE_CONFIG');
  return path.join(groupDir, 'pins.json');
}

function die(msg) {
  console.error(`NEXT: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      const v = next !== undefined && !next.startsWith('--') ? argv[++i] : 'true';
      out[k] = v;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const member = args.member;
if (!member) die('用法：node scripts\\pins.mjs --member whale --id <会话id>[,<会话id>] [--file group\\pins.json]');
if (args.id === undefined) die('缺少 --id（一个或多个会话 id，逗号分隔；允许空串表示暂时没有会话）');

const pinsFile = args.file ? path.resolve(args.file) : defaultPinsFile();
if (!fs.existsSync(pinsFile)) die(`找不到名册：${pinsFile}`);

let raw;
try {
  raw = fs.readFileSync(pinsFile, 'utf8');
} catch (e) {
  die(`读不了名册：${e.message}`);
}

let pins;
try {
  pins = JSON.parse(raw);
} catch (e) {
  die(`名册不是合法 JSON，拒绝改：${e.message}`);
}

const ids = args.id === '' ? [] : args.id.split(',').map((s) => s.trim()).filter(Boolean);
for (const id of ids) {
  if (!/^session-[0-9a-f-]{20,}$/.test(id)) die(`不认识的会话 id 形状：${id}（应形如 session-xxxxxxxx-…）`);
}
const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dup.length) die(`同一个 id 写了两遍：${dup.join(',')}`);

const before = JSON.stringify(pins[member] ?? null);
pins[member] = ids;
const after = JSON.stringify(pins[member]);

const tmp = `${pinsFile}.tmp-${process.pid}`;
const body = JSON.stringify(pins, null, 2) + '\n';
fs.writeFileSync(tmp, body, 'utf8');
fs.renameSync(tmp, pinsFile);

console.log(`pins.json: ${member} ${before} -> ${after}`);
console.log(`file: ${pinsFile}`);
console.log('注意：同一时刻只该有一段会话在群里。先加后删会有"两段都算她"的瞬间——所以是整份替换。');
