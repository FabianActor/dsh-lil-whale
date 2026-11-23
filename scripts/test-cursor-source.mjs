// 游标"读到了什么"的判定（fi-0013/0014/0015，2026-11-23）。
//
// 背景：rc.5 崩溃重启后，五条鱼一起重放已读消息；lee/whale 的 prior-cursor=128，
// 另外三条是 0，而同刻磁盘上的值已经是 3186——0 与"没有这一格"在纸上同形（fi-0013）；
// 1300 多条被重投（fi-0014）；文案还替人编了条数（fi-0015）。
//
// 这个文件只验纯函数：怎么从"来源 + 存的数 + 上次递到哪儿 + 文件行数"算起点。
// 不碰真状态，不读她的家。

import { readFileSync } from 'node:fs'

import {
  CURSOR_LOST_WINDOW,
  classifyCursorRead,
  cursorSourceLine,
  countsKnownOf,
} from '../plugin/dsh-lil-whale-group/lib/cursor-core.js'

let pass = 0
let fail = 0
const failures = []

function ok(value, name) {
  if (value) { pass += 1; return }
  fail += 1
  failures.push("  ✗ " + name)
}

function eq(name, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    pass += 1
    return
  }
  fail += 1
  failures.push(`  ✗ ${name}\n    期望: ${JSON.stringify(want)}\n    实际: ${JSON.stringify(got)}`)
}

// ---------- 正常：文件里真有一个值 ----------
{
  const r = classifyCursorRead({ source: 'file', stored: 100, lastDelivered: 90, lines: 120 })
  eq('file 起点', [r.start, r.src, r.unknown], [100, 'file', false])
  eq('file 不标回退', [r.regressed, r.capped], [false, false])
}
{
  const r = classifyCursorRead({ source: 'legacy', stored: 42, lastDelivered: null, lines: 50 })
  eq('legacy 照用，只在账上标来源', [r.start, r.src], [42, 'legacy'])
}
{
  const r = classifyCursorRead({ source: 'file', stored: -5, lastDelivered: null, lines: 50 })
  eq('负数不变成负起点', r.start, 0)
}

// ---------- 超过文件长度：夹到尾巴（旧行为，留痕） ----------
{
  const r = classifyCursorRead({ source: 'file', stored: 500, lastDelivered: 400, lines: 120 })
  eq('capped 起点', [r.start, r.src, r.capped], [120, 'capped', true])
}

// ---------- 回退：别重放（rc.5 那次的正面防线） ----------
{
  const r = classifyCursorRead({ source: 'file', stored: 128, lastDelivered: 3186, lines: 3202 })
  eq('128 < 3186 从 3186 接着走', [r.start, r.src, r.regressed], [3186, 'regressed', true])
  eq('回退不算 unknown（起点是信的）', [r.unknown, countsKnownOf(r)], [false, true])
}
{
  const r = classifyCursorRead({ source: 'missing', stored: 0, lastDelivered: 3186, lines: 3202 })
  eq('读不到但有 meta：先按回退走，不从 0 重放', [r.start, r.src], [3186, 'regressed'])
}
{
  const r = classifyCursorRead({ source: 'file', stored: 100, lastDelivered: 5000, lines: 3202 })
  eq('meta 比文件还大：夹到文件尾', r.start, 3202)
}

// ---------- 读不到：只给最近一小段，且不声称知道条数 ----------
{
  const r = classifyCursorRead({ source: 'missing', stored: 0, lastDelivered: null, lines: 100 })
  eq('missing 起点 = 文件尾 − 窗口', r.start, 100 - CURSOR_LOST_WINDOW)
  eq('missing 标 unknown', [r.src, r.unknown], ['missing', true])
  eq('unknown 不许报条数', countsKnownOf(r), false)
}
{
  const r = classifyCursorRead({ source: 'unknown', stored: 0, lastDelivered: null, lines: 100 })
  eq('损坏与缺失分开标', [r.src, r.unknown], ['unknown', true])
}
{
  const r = classifyCursorRead({ source: 'missing', stored: 0, lastDelivered: null, lines: 5 })
  eq('文件比窗口还短：起点 0', r.start, 0)
}

// ---------- 记账行：字段齐、值对 ----------
{
  const read = classifyCursorRead({ source: 'file', stored: 128, lastDelivered: 3186, lines: 3202 })
  eq(
    'cursor-source 行',
    cursorSourceLine({ member: 'lee', channel: 'group', read, lines: 3202 }),
    'member=lee channel=group src=regressed stored=128 start=3186 last-delivered=3186 regressed=yes lines=3202',
  )
}
{
  const read = classifyCursorRead({ source: 'missing', stored: 0, lastDelivered: null, lines: 100 })
  eq(
    '缺失行带 counts=unknown',
    cursorSourceLine({ member: 'whale', channel: 'dm:fabian__whale', read, lines: 100 }),
    'member=whale channel=dm:fabian__whale src=missing stored=0 start=80 counts=unknown lines=100',
  )
}
{
  const read = classifyCursorRead({ source: 'file', stored: 120, lastDelivered: null, lines: 100 })
  eq(
    '夹边界行带 capped=yes',
    cursorSourceLine({ member: 'lee', channel: 'group', read, lines: 100 }),
    'member=lee channel=group src=capped stored=120 start=100 capped=yes lines=100',
  )
}

// ---------- 坏文件自愈：从 meta 重建（r431） ----------
{
  const r = classifyCursorRead({ source: 'recovered', stored: 3220, lastDelivered: 3219, lines: 3220 })
  eq('recovered 当正常来源读', [r.start, r.src, r.unknown], [3220, 'recovered', false])
  eq('recovered 不报回退', r.regressed, false)
}

// ---------- 源码接线：坏文件留证、按 meta 重建、woke 行带来源 ----------
{
  const idx = readFileSync(new URL('../plugin/dsh-lil-whale-group/lib/index.js', import.meta.url), 'utf8')
  ok(idx.includes('cursor-corrupt'), '坏文件记一行 cursor-corrupt')
  ok(idx.includes('.corrupt-'), '坏文件留带时刻的副本')
  ok(idx.includes('recoveredCursorsOf'), '有 meta 时按 meta 重建各通道')
  const wokeLine = idx.split('\n').find((line) => line.includes("watchmanLog('woke',")) || ''
  ok(wokeLine.includes(' src='), 'woke 行带 src')
  ok(wokeLine.includes('counts='), 'woke 行带 counts')
  ok(wokeLine.includes('held='), 'woke 行带 held')
}

// ---------- 结果 ----------
console.log(`合计 ${pass + fail}，PASS ${pass}，FAIL ${fail}`)
for (const line of failures) console.log(line)
process.exit(fail === 0 ? 0 : 1)
