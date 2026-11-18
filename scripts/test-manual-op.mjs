#!/usr/bin/env node
/**
 * test-manual-op.mjs — 人工操作账的行形与校验（r342）。
 *
 * 跑法：node scripts/test-manual-op.mjs
 */
import { formatManualOp, parseAt, tsLocal, MANUAL_FMT, MANUAL_KINDS } from './lib/manual-op-core.mjs';

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
throws('坏 kind 抛错', () => formatManualOp({ ...base, kind: 'rm' }), 'kind');
throws('note 换行抛错', () => formatManualOp({ ...base, note: 'a\nb' }), '换行');
throws('note 竖线抛错', () => formatManualOp({ ...base, note: 'a|b' }), '竖线');
throws('bytes 负数抛错', () => formatManualOp({ ...base, bytes: -1 }), 'bytes');
throws('removed 小数抛错', () => formatManualOp({ ...base, removed: 1.5 }), 'removed');

ok('parseAt 本地时间', parseAt('2026-11-18 19:29:50')?.getMinutes() === 29);
ok('parseAt ISO', parseAt('2026-11-18T11:29:50.000Z') instanceof Date);
ok('parseAt 垃圾返回 null', parseAt('昨天下午') === null);
ok('parseAt 空串返回 null', parseAt('') === null);

if (fails.length) {
  console.error(`test-manual-op：合计 ${pass + fails.length}，PASS ${pass}，FAIL ${fails.length}`);
  for (const f of fails) console.error('  xx ' + f);
  process.exit(1);
}
console.log(`test-manual-op：合计 ${pass}，PASS ${pass}，FAIL 0`);
