#!/usr/bin/env node
/**
 * 回归测试：账本正文写盘前必须把不可打印字节换成可见占位（第四条鱼 #1014，2026-11-17）。
 *
 * 现场：一条群消息里的 `b 被 PowerShell 的双引号 here-string 当成退格符（0x08），
 * 落盘后 "bundles=" 变成 "undles=" —— 一个合法但少一个字符的字段名，按字段读不会报错。
 *
 * 用法：node scripts/test-ledger-text.mjs   （exit 0 = PASS）
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countUnprintable, printableText } from '../plugin/dsh-lil-whale-group/lib/text-clean.js';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const ok = (cond, msg) => {
  if (!cond) failures.push(msg);
};

// 1) 退格符换成可见占位
ok(
  printableText('\u0008undles=dsh-bili-eyes') === '<0x08>undles=dsh-bili-eyes',
  '0x08 应换成 <0x08>（不能留下来冒充字母）',
);
ok(countUnprintable('a\u0008b') === 1, 'countUnprintable 应数出 1 个');
ok(countUnprintable('正常文字\n第二行') === 0, '换行和普通文字不该算作不可打印');

// 2) 换行保留（一条消息可以多行），其余原样
ok(printableText('第一行\n第二行') === '第一行\n第二行', '换行必须保留');
ok(printableText('普通的一句话') === '普通的一句话', '普通文字不该被改动');

// 3) 写入口真的用上了它（读代码，不认识就算了——这两处是可 grep 的契约）
const host = readFileSync(join(APP, 'plugin/dsh-lil-whale-group/lib/index.js'), 'utf8');
ok(host.includes("from './text-clean.js'"), 'index.js 应 import text-clean');
ok(host.includes('printableText(text.trim())'), 'say() 的正文应过 printableText');
ok(host.includes('text: printableText(text), kind: \'dm\''), 'sayPrivate() 的正文应过 printableText');

const poster = readFileSync(join(APP, 'scripts/post-group.mjs'), 'utf8');
ok(poster.includes('printableText'), 'post-group.mjs 应过 printableText');

if (failures.length) {
  console.log('FAIL test-ledger-text：');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log('PASS test-ledger-text（8 条断言：控制字符占位 + 换行保留 + 两处写入口都接上）');
