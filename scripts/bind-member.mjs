#!/usr/bin/env node
// 把一段会话钉给某条鱼（名册的唯一写入口之一）。
// 为什么单独一个脚本：pins.json 和 members.json 要一起改，改一半断电会让人和名册对不上。
// 只由宿主跑（fish.ps1 bind 会先校验"这段会话真的在那条鱼家里"）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function die(msg) {
  console.error(`NEXT: ${msg}`);
  process.exit(1);
}

function readConfig() {
  const explicit = process.env.LIL_WHALE_CONFIG;
  const candidates = explicit ? [explicit] : [path.join(ROOT, 'lil-whale.config.json'), path.join(ROOT, 'lil-whale.config.example.json')];
  for (const p of candidates) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* 下一个 */ }
  }
  return null;
}

function atomicWriteJson(file, value) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const key = argv[i].slice(2);
  const next = argv[i + 1];
  args[key] = next !== undefined && !next.startsWith('--') ? argv[++i] : 'true';
}
const memberKey = args.member;
const sessionId = args.id;
if (!memberKey) die('用法：node scripts/bind-member.mjs --member <键> --id <会话id>');
if (!sessionId) die('缺少 --id（会话 id，形如 session-xxxxxxxx-…）');
if (!/^session-[0-9a-f-]{20,}$/.test(sessionId)) die(`会话 id 形状不对：${sessionId}`);

const cfg = readConfig();
if (!cfg) die('读不到配置（lil-whale.config.json 或 LIL_WHALE_CONFIG）');
const groupDir = cfg.groupDir || (cfg.poolDir ? path.join(cfg.poolDir, 'group') : null);
if (!groupDir) die('配置里没有 groupDir / poolDir');
const pinsFile = path.join(groupDir, 'pins.json');
const membersFile = cfg.membersFile || (cfg.poolDir ? path.join(cfg.poolDir, 'members.json') : null);
if (!membersFile) die('配置里没有 membersFile / poolDir');

if (!fs.existsSync(pinsFile)) die(`找不到名册：${pinsFile}`);
if (!fs.existsSync(membersFile)) die(`找不到名册：${membersFile}`);

let pins;
try { pins = JSON.parse(fs.readFileSync(pinsFile, 'utf8')); } catch (e) { die(`pins.json 不是合法 JSON：${e.message}`); }
let roster;
try { roster = JSON.parse(fs.readFileSync(membersFile, 'utf8')); } catch (e) { die(`members.json 不是合法 JSON：${e.message}`); }

const member = roster?.members?.[memberKey];
if (!member) die(`members.json 里没有成员：${memberKey}`);
if (member.role === 'watcher') die('巡守的会话在它自己的 HOME 里，不走这条命令');
if (member.kind !== 'fish') die(`${memberKey} 不是鱼（kind=${member.kind}）`);

const before = JSON.stringify(pins[memberKey] ?? null);
pins[memberKey] = [sessionId];
atomicWriteJson(pinsFile, pins);

if (member.sessionId !== sessionId) {
  member.sessionId = sessionId;
  atomicWriteJson(membersFile, roster);
}

const logDir = path.join(cfg.poolStateDir || (cfg.poolDir ? path.join(cfg.poolDir, 'state') : ''), '');
const logFile = path.join(logDir, 'fish.log');
try {
  fs.mkdirSync(logDir, { recursive: true });
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date();
  const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  fs.appendFileSync(logFile, `${ts} | bind | fmt=1 member=${memberKey} session=${sessionId} by=fish.ps1\n`, 'utf8');
} catch { /* 记账失败不拦正确的动作 */ }

console.log(`pins.json: ${memberKey} ${before} -> ${JSON.stringify([sessionId])}`);
console.log(`members.json: sessionId=${sessionId}`);
console.log('注意：这段会话现在算「在群里」了；同一时刻只该有一段会话代表她。');
