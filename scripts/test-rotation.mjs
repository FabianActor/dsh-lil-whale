#!/usr/bin/env node
// 换段算法的断言。用法：node scripts\test-rotation.mjs
// 为什么先写测试再接线：换段这件事的坑全在边界上（0 轮、最后 1 轮不裁、预算裁到只剩一轮、
// 停顿与强制换谁先谁后）。这些边界在真会话里一天只撞上一次，靠"上了再看"要等一周。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ROTATION_DEFAULTS,
  resolveRotation,
  rotationDue,
  carryBudgetChars,
  trimText,
  groupTurns,
  pickCarryTurns,
  buildCarryText,
  buildOpeningText,
  handoverLine,
  rotationRecord,
} from '../plugin/dsh-lil-whale-group/lib/rotation-core.js'

let failed = 0
function test(name, fn) {
  try {
    fn()
    console.log(`ok   ${name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL ${name}`)
    console.log(`     ${error.message}`)
  }
}

// ---------- 开关（r496） ----------
test('开关：写了 enabled 就听 enabled', () => {
  assert.equal(resolveRotation({ enabled: true }, undefined).enabled, true)
  assert.equal(resolveRotation({ enabled: false, rounds: 40 }, undefined).enabled, false, '开关压过轮数')
  assert.equal(resolveRotation(undefined, { enabled: 'off' }).enabled, false)
  assert.equal(resolveRotation({ enabled: true }, { enabled: false }).enabled, false, '单鱼能关掉总控')
})

test('开关：没写 enabled 但写了 rounds，就按轮数算', () => {
  assert.equal(resolveRotation({ rounds: 40 }, undefined).enabled, true)
  assert.equal(resolveRotation({ rounds: 0 }, undefined).enabled, false)
  assert.equal(resolveRotation(undefined, { rounds: 12 }).enabled, true)
})

test('开关：两样都没写就不换段', () => {
  assert.equal(resolveRotation(undefined, undefined).enabled, false)
  assert.equal(resolveRotation({}, {}).enabled, false)
})

test('源码：不再有 noteOnce(rotation-hold…) 那种传法，改成按 failedAt 记一次', () => {
  const src = readFileSync(new URL('../plugin/dsh-lil-whale-group/lib/index.js', import.meta.url), 'utf8')
  assert.equal(/noteOnce\(`rotation-hold/.test(src), false, 'noteOnce 的第一个参数必须是成员对象')
  assert.ok(src.includes('rotationHoldNoted'))
  assert.ok(/note: 'rotation-hold', member, channel: channel\.key/.test(src))
})

// ---------- 生效值 ----------
test('默认值：80 轮 / 带 3 轮 / 停 20 分钟 / 再延 10 轮', () => {
  const r = resolveRotation(undefined, undefined)
  assert.equal(r.rounds, ROTATION_DEFAULTS.rounds)
  assert.equal(r.carryRounds, ROTATION_DEFAULTS.carryRounds)
  assert.equal(r.pauseMin, ROTATION_DEFAULTS.pauseMin)
  assert.equal(r.forceExtra, ROTATION_DEFAULTS.forceExtra)
  assert.equal(r.enabled, false, 'r496：默认关')
  assert.deepEqual(r.sources, [])
})

test('总控压默认值，单鱼压总控，且说出谁压的', () => {
  const r = resolveRotation({ rounds: 60, carryRounds: 5 }, { rounds: 300 })
  assert.equal(r.rounds, 300)
  assert.equal(r.carryRounds, 5)
  assert.ok(r.sources.includes('member.rounds'))
  assert.ok(r.sources.includes('global.carryRounds'))
})

test('0 = 关；带原话轮数被夹到上限；负数不当回事', () => {
  assert.equal(resolveRotation({ rounds: 0 }, null).enabled, false)
  assert.equal(resolveRotation({ carryRounds: 99 }, null).carryRounds, ROTATION_DEFAULTS.maxCarryRounds)
  assert.equal(resolveRotation({ rounds: -5 }, null).rounds, 0)
})

test('写坏的设置退回上一层，不把所有人的换段关掉', () => {
  const r = resolveRotation({ rounds: 60 }, { rounds: 'abc' })
  assert.equal(r.rounds, 60, '坏值应退回总控的 60')
})

// ---------- 该不该换 ----------
const base = { rounds: 120, pauseMin: 20, forceExtra: 10 }
const T0 = Date.parse('2026-11-25T20:00:00+08:00')

test('关着就不换', () => {
  const r = rotationDue({ ...base, rounds: 0, lastTurn: 999, lastActivityMs: T0, nowMs: T0 + 3600_000 })
  assert.equal(r.due, false)
  assert.equal(r.why, 'off')
})

test('没到轮数：不换，并说出还差几轮', () => {
  const r = rotationDue({ ...base, lastTurn: 119, lastActivityMs: T0, nowMs: T0 + 3600_000 })
  assert.equal(r.due, false)
  assert.equal(r.why, 'not-yet')
  assert.equal(r.remaining, 1)
})

test('轮数到了、刚有人说话：等停顿', () => {
  const r = rotationDue({ ...base, lastTurn: 120, lastActivityMs: T0, nowMs: T0 + 5 * 60_000 })
  assert.equal(r.due, false)
  assert.equal(r.why, 'waiting')
  assert.equal(Math.round(r.waitMin), 15)
})

test('轮数到了、安静满 20 分钟：换', () => {
  const r = rotationDue({ ...base, lastTurn: 120, lastActivityMs: T0, nowMs: T0 + 20 * 60_000 })
  assert.equal(r.due, true)
  assert.equal(r.why, 'pause')
})

test('一直连着聊：延到 130 轮强制换（不等停顿）', () => {
  const busy = T0 + 1 * 60_000
  assert.equal(rotationDue({ ...base, lastTurn: 129, lastActivityMs: busy, nowMs: T0 + 2 * 60_000 }).due, false)
  const r = rotationDue({ ...base, lastTurn: 130, lastActivityMs: busy, nowMs: T0 + 2 * 60_000 })
  assert.equal(r.due, true)
  assert.equal(r.why, 'force')
})

test('读不到轮数：不换，也不猜', () => {
  const r = rotationDue({ ...base, lastTurn: null, lastActivityMs: T0, nowMs: T0 + 3600_000 })
  assert.equal(r.due, false)
  assert.equal(r.why, 'no-turns')
})

// ---------- 窗口与裁剪 ----------
test('窗口：0 轮 0 字；1 轮 400；3 轮 560；10 轮 1120（顶上界 1200 是留给更细步长的）', () => {
  assert.equal(carryBudgetChars(0), 0)
  assert.equal(carryBudgetChars(1), 400)
  assert.equal(carryBudgetChars(3), 560)
  assert.equal(carryBudgetChars(10), 1120)
  // 超过上限的轮数不放大窗口（夹住了）
  assert.equal(carryBudgetChars(50), 1120)
})

test('裁字带省略号，且说了自己裁过', () => {
  assert.equal(trimText('一二三四五六', 6), '一二三四五六')
  assert.equal(trimText('一二三四五六七', 6), '一二三四五…')
  assert.equal(trimText('  多余   空白  ', 20), '多余 空白')
})

// ---------- 原话 ----------
const rec = (from, text, ts = T0) => ({ from, text, ts })

test('同一个人的连续几句算一轮', () => {
  const { turns } = groupTurns([rec('human', '在吗'), rec('human', '看这个')], { labelOf: (k) => (k === 'human' ? '你' : '她') })
  assert.equal(turns.length, 1)
  assert.equal(turns[0].texts.length, 2)
  assert.equal(turns[0].speaker, '你')
})

test('说话的人换了就是新的一轮', () => {
  const { turns } = groupTurns([rec('human', 'a'), rec('fish', 'b'), rec('human', 'c')])
  assert.equal(turns.length, 3)
})

test('没有文字的记录跳过，但数得出来', () => {
  const { turns, nonText } = groupTurns([rec('human', 'a'), { from: 'fish', image: 'x' }, rec('fish', 'b')])
  assert.equal(turns.length, 2)
  assert.equal(nonText, 1)
})

test('只留最后 K 轮，K 夹在上限里，丢了几轮要报', () => {
  const turns = Array.from({ length: 15 }, (_, i) => ({ from: i % 2 ? 'fish' : 'human', speaker: i % 2 ? '她' : '你', texts: [`t${i}`], ts: T0 }))
  assert.equal(pickCarryTurns(turns, 3).turns.length, 3)
  assert.equal(pickCarryTurns(turns, 3).dropped, 12)
  assert.equal(pickCarryTurns(turns, 99).turns.length, ROTATION_DEFAULTS.maxCarryRounds)
  assert.equal(pickCarryTurns(turns, 0).turns.length, 0)
})

test('最后 1 轮不裁，再往前每轮裁到 40 字', () => {
  const long = '甲'.repeat(100)
  const turns = groupTurns([rec('human', long), rec('fish', long), rec('human', long)], { labelOf: (k) => (k === 'human' ? '你' : '她') }).turns
  const out = buildCarryText(turns, { carryRounds: 3, budgetChars: 5000 })
  assert.ok(out.text.endsWith(`你：${long}`), '最后一轮应完整保留')
  assert.ok(out.text.includes('你：' + '甲'.repeat(39) + '…'), '前面那轮应裁到 40 字')
  assert.equal(out.trimmed, 2)
})

test('超预算从最早那轮开始整轮丢，先保最近的那轮', () => {
  const turns = groupTurns([rec('human', '甲'.repeat(300)), rec('fish', '乙'.repeat(300)), rec('human', '丙'.repeat(300))], { labelOf: (k) => (k === 'human' ? '你' : '她') }).turns
  const out = buildCarryText(turns, { carryRounds: 3, budgetChars: 200 })
  assert.ok(out.dropped >= 1, `应说明丢了几轮，实际 dropped=${out.dropped}`)
  assert.ok(out.text.includes('丙'), '最近的这轮必须在')
  assert.ok(out.text.length <= 202, `实际 ${out.text.length} 字`)
})

test('carryRounds=0：一个字都不带', () => {
  const turns = groupTurns([rec('human', 'a')]).turns
  assert.equal(buildCarryText(turns, { carryRounds: 0 }).text, '')
})

// ---------- 第一句与交接 ----------
test('第一句：带原话/不带原话，措辞不一样', () => {
  const carried = buildOpeningText({ carryText: '你：在吗', newText: '群里有人叫你', prevSession: 'session-ab12cd34-1111-2222', why: 'pause' })
  assert.ok(carried.includes('前面那段是 session-ab12cd34'))
  assert.ok(carried.includes('你：在吗'))
  assert.ok(carried.includes('群里有人叫你'))
  const bare = buildOpeningText({ carryText: '', newText: 'x', prevSession: 'session-ab12cd34-1111-2222', why: 'force' })
  assert.ok(bare.includes('没有上一段的原话'), '不带原话时不许假装她记得')
  assert.ok(bare.includes('一直有人在说话'), 'force 的理由要说出来')
})

test('交接那一行：by=auto 在行尾，四行是她的事不替她写', () => {
  const line = handoverLine({ at: '2026-11-25 20:40', fromSession: 'session-aaaa', toSession: 'session-bbbb', lastTurn: 120, why: 'pause', carried: 3 })
  assert.ok(line.endsWith('by=auto'))
  assert.ok(line.includes('跑满 120 轮'))
  assert.ok(line.includes('carried=3'))
  assert.ok(!line.includes('NEXT:'), '不许替她写 NEXT 那种话')
})

test('换段账：形状固定，by=auto', () => {
  const r = rotationRecord({ at: '2026-11-25 20:40', member: 'fish', fromSession: 'session-a', toSession: 'session-b', lastTurn: 121, why: 'force', carried: 2, dropped: 1, trimmed: 1, idleMin: 3.4 })
  assert.deepEqual(Object.keys(r).sort(), ['at', 'by', 'carried', 'dropped', 'from', 'idleMin', 'lastTurn', 'member', 'to', 'trimmed', 'why'])
  assert.equal(r.by, 'auto')
  assert.equal(r.idleMin, 3)
})

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 条没过`)
process.exit(failed === 0 ? 0 : 1)
