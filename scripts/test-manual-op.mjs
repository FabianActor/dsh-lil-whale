#!/usr/bin/env node
/**
 * test-manual-op.mjs — 人工操作账的行形与校验（r342；r347 补 hint 与末字节闸）。
 *
 * 跑法：node scripts/test-manual-op.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { endOfFileProblem, formatManualOp, parseAt, tsLocal, MANUAL_FMT, MANUAL_KINDS } from './lib/manual-op-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = readFileSync(join(HERE, 'manual-op.mjs'), 'utf8').replace(/\r\n/g, '\n');

let pass = 0;
const fails = [];
function ok(name, cond, detail = '') {
  if (cond) pass += 1;
  else fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function throws(name, fn, expect) {
  try {
    fn();
    fails.push(`${name} — 没抛错`);
  } catch (e) {
    ok(name, String(e.message).includes(expect), `实际：${e.message}`);
  }
}
/** 校验 message 片段 + hint（hint 是给 CLI 选 NEXT 用的，选错 NEXT 等于指错方向）。 */
function throwsHint(name, fn, expectMessage, expectHint) {
  try {
    fn();
    fails.push(`${name} — 没抛错`);
  } catch (e) {
    ok(name, String(e.message).includes(expectMessage) && e.hint === expectHint, `hint=${e.hint} 实际：${e.message}`);
  }
}

const base = { ts: '2026-11-18 19:29:50', by: 'lee', removed: 3, bytes: 18117679, note: '清过期视频缓存' };
const line = formatManualOp(base);
ok('行形：时间在最前', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \| /.test(line), line);
ok('行形：kind 与 fmt', line.includes('| manual-rm | fmt=' + MANUAL_FMT + ' '), line);
ok('行形：by/removed/bytes/note 齐全', line.includes('by=lee removed=3 bytes=18117679 note=清过期视频缓存'), line);
ok('行形：竖线恰好 2 个字段分隔', (line.match(/\|/g) || []).length === 2, line);
ok('缺省值：removed/bytes 可以是 0', formatManualOp({ ts: base.ts, by: 'lee', note: 'x' }).includes('removed=0 bytes=0'));
ok('kind 白名单里含 manual-other', MANUAL_KINDS.includes('manual-other'));
ok('tsLocal 形状', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(tsLocal(new Date(2026, 10, 18, 19, 29, 50))));

throws('缺 note 抛错', () => formatManualOp({ ...base, note: '  ' }), 'note');
throws('缺 by 抛错', () => formatManualOp({ ...base, by: '' }), 'by');
throws('by 换行抛错', () => formatManualOp({ ...base, by: 'lee\n2026-11-18 20:00:00 | manual-rm | fmt=1 by=someone' }), 'by');
throws('by 竖线抛错', () => formatManualOp({ ...base, by: 'lee|by=mallory' }), 'by');
throws('by 空格抛错', () => formatManualOp({ ...base, by: 'lee x' }), 'by');
throws('by 太长抛错', () => formatManualOp({ ...base, by: 'a'.repeat(33) }), 'by');
throws('坏 kind 抛错', () => formatManualOp({ ...base, kind: 'rm' }), 'kind');
throws('note 换行抛错', () => formatManualOp({ ...base, note: 'a\nb' }), '换行');
throws('note 竖线抛错', () => formatManualOp({ ...base, note: 'a|b' }), '竖线');
throws('bytes 负数抛错', () => formatManualOp({ ...base, bytes: -1 }), 'bytes');
throws('removed 小数抛错', () => formatManualOp({ ...base, removed: 1.5 }), 'removed');

ok('parseAt 本地时间', parseAt('2026-11-18 19:29:50')?.getMinutes() === 29);
ok('parseAt ISO', parseAt('2026-11-18T11:29:50.000Z') instanceof Date);
ok('parseAt 垃圾返回 null', parseAt('昨天下午') === null);
ok('parseAt 空串返回 null', parseAt('') === null);

// r347：错误要带 hint，NEXT 才会指对方向（字符集被拒时别再让人去"去掉换行"）。
throwsHint('by 中文 → hint=charset', () => formatManualOp({ ...base, by: '李' }), '1–32 位', 'charset');
throwsHint('by 换行 → hint=field', () => formatManualOp({ ...base, by: 'a\nb' }), '换行', 'field');
throwsHint('缺 note → hint=missing', () => formatManualOp({ ...base, note: ' ' }), 'note', 'missing');
throwsHint('坏 kind → hint=kind', () => formatManualOp({ ...base, kind: 'x' }), 'kind', 'kind');

// r347：追加前的末字节闸。"上一行没换行结尾"这一格，光看行数不变量抓不到。
ok('endOfFileProblem：空文件无问题', endOfFileProblem(Buffer.alloc(0)) === null);
ok('endOfFileProblem：以换行结尾无问题', endOfFileProblem(Buffer.from('a\n')) === null);
ok('endOfFileProblem：CRLF 结尾也算结束', endOfFileProblem(Buffer.from('a\r\n')) === null);
const eofProblem = endOfFileProblem(Buffer.from('a|b'));
ok('endOfFileProblem：没有结尾换行要报', eofProblem && eofProblem.bytes === 3, JSON.stringify(eofProblem));
ok('endOfFileProblem：尾巴给出最后内容', eofProblem && eofProblem.tail === 'a|b', JSON.stringify(eofProblem));

// 接线：闸在 append 之前；--fix-eof 是单独动作；旧通用 NEXT 不许回来。
const eofAt = CLI.indexOf('endOfFileProblem(readFileSync(file))');
const appendAt = CLI.indexOf("appendFileSync(file, line + '\\n'");
ok('接线：先查末字节再 append', eofAt >= 0 && appendAt >= 0 && eofAt < appendAt, `eofAt=${eofAt} appendAt=${appendAt}`);
ok('接线：--fix-eof 存在', CLI.includes('--fix-eof'));
ok('接线：NEXT 按 hint 分路（charset）', CLI.includes('charset:'));
ok('接线：字符集 NEXT 说明允许范围', CLI.includes('1–32 位 ASCII'));
ok('接线：旧的"把 by/note 里的换行或竖线去掉"已退役', !CLI.includes('把 by/note 里的换行或竖线去掉'));
// r356/r357（小鱼丸 2026-11-19 群）：dry-run 常被拿来诊断，被末字节闸挡住时也要给出"若补换行会写成什么样"；
// 机器读的形状统一一套键（ok / dryRun / file / eof{state,bytes?,tail?} / line；真跑另带 lineNo）。
ok('接线：dry-run 被拒时给 refused= 与 eof.state=not-newline', CLI.includes("refused: 'eof-not-newline'") && CLI.includes("state: 'not-newline'"));
ok('接线：dry-run 被拒时仍带 line', /refused: 'eof-not-newline'[\s\S]{0,200}?\bline\b/.test(CLI));
ok('接线：dry-run 被拒时仍 exit 2（fail-closed）', /if \(dry\) \{[\s\S]*?state: 'not-newline'[\s\S]*?process\.exit\(2\)/.test(CLI));
ok('接线：dry-run 成功时 eof.state=ok 且带 line', CLI.includes("eof: { state: 'ok' }, line"));
ok('接线：真跑加 --json 时吐同一套形状并带 lineNo', CLI.includes('dryRun: false') && CLI.includes('lineNo: after'));
ok('接线：--json 写进用法注释', CLI.includes('[--json]'));

if (fails.length) {
  console.error(`test-manual-op：合计 ${pass + fails.length}，PASS ${pass}，FAIL ${fails.length}`);
  for (const f of fails) console.error('  xx ' + f);
  process.exit(1);
}
console.log(`test-manual-op：合计 ${pass}，PASS ${pass}，FAIL 0`);
