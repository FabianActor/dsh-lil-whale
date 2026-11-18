// 只读地在一条鱼的会话原件里按关键词找话，并给出真实时间、行号、seq。
//
// 背景（2026-11-18）：billion-context 的库在"挂上插件那一刻"才开始记账，
// 更早的历史不在库里；而库里的 ts 往往是"批次落盘时刻"，不能证明某句话是哪天说的。
// 要证明"某天说过"，只能回原件——这个脚本就是那把尺子。
//
// 用法：
//   node app\scripts\session-grep.mjs --member xiaoman --pattern 出生
//   node app\scripts\session-grep.mjs --member xiaoman --pattern "11-15" --role user
//   node app\scripts\session-grep.mjs --file "<...>\session-xxx.v4.jsonl.zstd" --pattern 鲸落 --limit 50
// 选项：
//   --member <键>     鱼塘里的鱼键（去 homes\<键>\dsh-home\sessions 里找）
//   --file <路径>     直接指定会话文件（.zstd 或已解压的 .jsonl）
//   --pond <路径>     鱼塘根（默认 app 的上一级）
//   --pattern <文本>  要找的文字（纯文本包含匹配，不区分大小写；必填）
//   --role user|assistant|all   只找谁说的（默认 all）
//   --from / --to     YYYY-MM-DD（本地日期，含两端）
//   --limit <n>       最多打印几条（默认 20）
//   --json            机器可读输出（每条一行 JSON）
//
// 读法：--role user 只出真人打的字；时间来自事件自己的 e.time（不是库里的批次时间）。
// 退出码：0 有命中；1 没有命中；2 用法错误。

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = (name, def = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const flag = (name) => argv.includes(`--${name}`);

const pattern = opt('pattern');
if (!pattern || pattern === true) {
  console.error('用法：node app\\scripts\\session-grep.mjs （--member <键> | --file <路径>） --pattern <文本> [--role user|assistant|all] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit N] [--json]');
  process.exit(2);
}
const role = String(opt('role', 'all')).toLowerCase();
if (!['user', 'assistant', 'all'].includes(role)) {
  console.error('--role 只能是 user / assistant / all');
  process.exit(2);
}
const limit = Math.max(1, Number(opt('limit', 20)) || 20);
const fromDay = opt('from') ? String(opt('from')) : null;
const toDay = opt('to') ? String(opt('to')) : null;
for (const [k, v] of [['from', fromDay], ['to', toDay]]) {
  if (v !== null && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    console.error(`--${k} 要写成 YYYY-MM-DD：${v}`);
    process.exit(2);
  }
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');
const POND_ROOT = String(opt('pond', path.resolve(APP_ROOT, '..')));

// ---- 找文件 ----
function walkSessions(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkSessions(p));
    else if (ent.name === 'session.v4.jsonl.zstd') out.push(p);
  }
  return out;
}

const files = [];
const fileOpt = opt('file');
if (fileOpt && fileOpt !== true) {
  files.push(path.resolve(String(fileOpt)));
} else {
  const member = opt('member');
  if (!member || member === true) {
    console.error('要么给 --member <键>，要么给 --file <路径>');
    process.exit(2);
  }
  const dir = path.join(POND_ROOT, 'homes', String(member), 'dsh-home', 'sessions');
  if (!fs.existsSync(dir)) {
    console.error(`找不到她的会话目录：${dir}`);
    process.exit(2);
  }
  files.push(...walkSessions(dir));
}
if (files.length === 0) {
  console.error('没有找到会话文件。');
  process.exit(2);
}

// ---- 解多帧 zstd ----
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
function decompressFrames(buf) {
  const parts = [];
  let pos = 0;
  while (pos < buf.length) {
    const idx = buf.indexOf(MAGIC, pos);
    if (idx < 0) break;
    let next = buf.indexOf(MAGIC, idx + 4);
    if (next < 0) next = buf.length;
    try { parts.push(zlib.zstdDecompressSync(buf.subarray(idx, next)).toString('utf8')); } catch { /* 半帧跳过 */ }
    pos = next;
  }
  return parts.join('');
}

const dayOf = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
const timeOf = (t) => new Date(t).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

const needle = String(pattern).toLowerCase();
const hits = [];

for (const file of files) {
  const raw = fs.readFileSync(file);
  const textBlob = file.endsWith('.zstd') ? decompressFrames(raw) : raw.toString('utf8');
  const sessionDir = path.basename(path.dirname(file));
  let lineNo = 0;
  for (const line of textBlob.split('\n')) {
    lineNo += 1;
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type !== 'user/message' || !e.data) continue;
    const r = e.data.role;
    if (!['user', 'assistant'].includes(r)) continue;
    if (role !== 'all' && r !== role) continue;
    const src = e.data.source || {};
    // 只收正文；群通知/时间采样/工具结果这些不是"话"
    if (r === 'user' && src.kind && src.kind !== 'user' && src.kind !== 'dm' && src.kind !== 'group') continue;
    const msg = (e.data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    if (!msg) continue;
    if (!msg.toLowerCase().includes(needle)) continue;
    const day = dayOf(e.time);
    if (fromDay && day < fromDay) continue;
    if (toDay && day > toDay) continue;
    hits.push({ day, time: timeOf(e.time), ms: e.time, role: r, sourceKind: src.kind || '', file: path.basename(file), sessionId: sessionDir, line: lineNo, seq: e.seq, text: msg });
  }
}

if (hits.length === 0) {
  if (flag('json')) console.log(JSON.stringify({ hits: 0, pattern: String(pattern) }));
  else console.log(`没有命中：${pattern}`);
  process.exit(1);
}

hits.sort((a, b) => a.ms - b.ms);
const shown = hits.slice(0, limit);

if (flag('json')) {
  for (const h of shown) console.log(JSON.stringify(h));
} else {
  console.log(`命中 ${hits.length} 条（打印 ${shown.length} 条）｜关键词：${pattern}｜范围：${hits[0].day} → ${hits[hits.length - 1].day}`);
  console.log('');
  for (const h of shown) {
    const flat = h.text.replace(/\r?\n/g, ' ⏎ ');
    console.log(`- ${h.day} ${h.time}　${h.role === 'user' ? '他/使用者' : '她'}　L${h.line} seq=${h.seq}　${h.sessionId.slice(0, 20)}${h.sourceKind ? ` [${h.sourceKind}]` : ''}`);
    console.log(`  ${flat.length > 160 ? flat.slice(0, 160) + '…' : flat}`);
  }
  const days = [...new Set(hits.map((h) => h.day))].sort();
  console.log('');
  console.log(`覆盖日期：${days.join('、')}`);
  console.log('（这些时间是事件自己的 e.time，不是 billion-context 库里的批次时间。）');
}
