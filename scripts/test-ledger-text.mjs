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
import { countUnprintable, encodingOf, printableText, scanBytes } from '../plugin/dsh-lil-whale-group/lib/text-clean.js';

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

// 4) 扫字节之前，先问"它是不是本来就不是文本"（第四条鱼 #1016，2026-11-17）
//    UTF-16LE 的 "no" 是 6e 00 6f 00，按 UTF-8 读就是一片 NUL —— 那是读法不对，不是字节坏了。
const utf16 = Buffer.from('no', 'utf16le');
ok(encodingOf(utf16) === 'utf-16le', 'UTF-16LE（无 BOM）应被认出来，而不是当成 UTF-8');
ok(scanBytes(utf16).unprintable.length === 0, 'UTF-16LE 的 "no" 解码后不该报不可打印字符');
ok(scanBytes(utf16).decoded === 'no', 'UTF-16LE 应能解回原文');
ok(encodingOf(Buffer.from('hello')) === 'utf-8', '普通 ASCII 仍按 utf-8');
ok(
  scanBytes(Buffer.from('a\u0008b', 'utf8')).unprintable.length === 1,
  '普通的 0x08 仍要被扫出来（不能因为兼容 UTF-16 就把真的坏字节放过）',
);
ok(
  scanBytes(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('ok', 'utf16le')])).encoding === 'utf-16le-bom',
  '带 BOM 的 UTF-16LE 也要认',
);

if (failures.length) {
  console.log('FAIL test-ledger-text：');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log('PASS test-ledger-text（14 条断言：控制字符占位 + 换行保留 + 两处写入口 + UTF-16 与 UTF-8 分开读）');
