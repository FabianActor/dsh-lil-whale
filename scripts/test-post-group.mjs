#!/usr/bin/env node
/**
 * `scripts/post-group.mjs` 的叫醒口径（r462）。
 *
 * 为什么要测：这个脚本以前只写 `to: 'all'`、不写 `mention`，读侧把「没有 mention 字段」
 * 当成老记录，按老规则 `to=all` 叫醒所有人 —— 于是「在群里顺手说一句」把五条鱼全叫起来了
 * （2026-11-24 宿主追问「为什么没有 mention 所有人，但所有人都被唤醒了」）。
 *
 * 判据：不写 `--mention` ⇒ 记录里 `mention: []`（谁都不叫醒）；写 `all` ⇒ `'all'`；
 * 写名单 ⇒ 数组。三种都用 `--dry-run` 验，不碰群账本。
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const APP = resolve(dirname(SELF), '..');
const SCRIPT = join(APP, 'scripts', 'post-group.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'llw-post-group-'));

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? '：' + detail : ''}`);
  }
}

function dryRun(extra, text = '测试一句') {
  const body = join(tmp, 'body.txt');
  writeFileSync(body, text, 'utf8');
  const r = spawnSync(process.execPath, [SCRIPT, '--from', 'lee', '--to', 'all', '--text-file', body, '--dry-run', ...extra], {
    encoding: 'utf8',
  });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    json = null;
  }
  return { status: r.status, json, stderr: r.stderr || '' };
}

console.log('post-group：叫醒口径');

const none = dryRun([]);
ok('不写 --mention 时退出码是 0', none.status === 0, `exit=${none.status}`);
ok('不写 --mention ⇒ mention 是空数组', Array.isArray(none.json?.record?.mention) && none.json.record.mention.length === 0,
  JSON.stringify(none.json?.record?.mention));
ok('不写 --mention ⇒ 记录里这个字段真写出来了（不是没写）',
  none.json?.record !== undefined && Object.prototype.hasOwnProperty.call(none.json.record, 'mention'));

const all = dryRun(['--mention', 'all']);
ok('--mention all ⇒ mention 是字符串 all', all.json?.record?.mention === 'all', String(all.json?.record?.mention));

const two = dryRun(['--mention', 'whale,xiaoman']);
ok('--mention 两个键 ⇒ 数组两项', Array.isArray(two.json?.record?.mention) && two.json.record.mention.join(',') === 'whale,xiaoman',
  JSON.stringify(two.json?.record?.mention));

const cjk = dryRun(['--mention', 'whale、xiaoman']);
ok('中文顿号分隔也认', Array.isArray(cjk.json?.record?.mention) && cjk.json.record.mention.join(',') === 'whale,xiaoman',
  JSON.stringify(cjk.json?.record?.mention));

const empty = dryRun([], '   ');
ok('空正文 ⇒ exit 2', empty.status === 2, `exit=${empty.status}`);

// 静态那一层：脚本不能退回"只写 to、不写 mention"的老形状
const src = (await import('node:fs')).readFileSync(SCRIPT, 'utf8');
ok('源码里 record 带 mention 字段', /channel,\r?\n\s*mention,/.test(src));
ok('回执会说清叫醒谁', src.includes('mention=${wakes}'));

rmSync(tmp, { recursive: true, force: true });
console.log(`test-post-group：合计 ${pass + fail}，PASS ${pass}，FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);