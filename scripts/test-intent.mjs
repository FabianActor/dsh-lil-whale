// 行为测试：她自己写下的条件（wake-on / intent）的纯逻辑。
//
// 为什么是行为测试而不是 grep 源码：判断逻辑抽在 `intent-core.js` 里，这里直接 import 真代码，
// 每条用例是一个"给定输入 → 应该得到什么"的真分支。她复现不到的东西（比如字符串参数），
// 测试要能复现 —— 这是 r87 的规矩。
//
// 跑法：node scripts/test-intent.mjs

import assert from 'node:assert/strict'
import {
  parseIntents,
  pruneIntentState,
  normalizeIntent,
  pathAllowed,
  inTimeWindow,
  cooldownOk,
  capOk,
  looksLikeSchedule,
  intentDeliveryText,
  probePending,
  probeTextAppears,
  probeFileChanged,
  INTENT_MAX,
  INTENT_GLOBAL_PER_DAY,
} from '../plugin/dsh-lil-whale-group/lib/intent-core.js'

let pass = 0
let fail = 0
const failures = []

function t(name, fn) {
  try {
    fn()
    pass += 1
  } catch (error) {
    fail += 1
    failures.push(`${name}: ${error?.message ?? error}`)
  }
}

const now = new Date(2026, 10, 14, 10, 30, 0) // 2026-11-14 10:30 本地

// ---------- 形状 ----------
t('坏形状：不是数组也不是 {items} → 留一行说明、不认条目', () => {
  const { list, notes } = parseIntents({ nope: true })
  assert.equal(list.length, 0)
  assert.equal(notes.length, 1)
  assert.match(notes[0], /intent-bad-shape/)
})

t('数组形状能读，{items:[...]} 也能读', () => {
  const a = parseIntents([{ id: 'a', kind: 'pending', why: '等消息' }])
  const b = parseIntents({ items: [{ id: 'a', kind: 'pending', why: '等消息' }] })
  assert.equal(a.list.length, 1)
  assert.equal(b.list.length, 1)
})

t('缺 why 不成立（并留痕）', () => {
  const { list, notes } = parseIntents([{ id: 'x', kind: 'pending' }])
  assert.equal(list.length, 0)
  assert.ok(notes.some((n) => /intent-without-why/.test(n)))
})

t('缺 id 不成立', () => {
  const { list, notes } = parseIntents([{ kind: 'pending', why: 'x' }])
  assert.equal(list.length, 0)
  assert.ok(notes.some((n) => /intent-without-id/.test(n)))
})

t('坏 kind 不成立', () => {
  const { list, notes } = parseIntents([{ id: 'x', kind: 'wat', why: 'x' }])
  assert.equal(list.length, 0)
  assert.ok(notes.some((n) => /intent-bad-kind/.test(n)))
})

t(`最多认 ${INTENT_MAX} 条（多出来的留一行说明）`, () => {
  const many = Array.from({ length: INTENT_MAX + 2 }, (_, i) => ({ id: `i${i}`, kind: 'pending', why: 'w' }))
  const { list, notes } = parseIntents(many)
  assert.equal(list.length, INTENT_MAX)
  assert.ok(notes.some((n) => /intent-too-many/.test(n)))
})

t('text-appears 缺 match 不成立', () => {
  const { list, notes } = parseIntents([{ id: 'x', kind: 'text-appears', why: 'w', path: 'pool/group/群.md' }])
  assert.equal(list.length, 0)
  assert.ok(notes.some((n) => /intent-without-match/.test(n)))
})

t('坏正则不成立', () => {
  const { list, notes } = parseIntents([{ id: 'x', kind: 'text-appears', why: 'w', path: 'pool/group/群.md', match: '([', regex: true }])
  assert.equal(list.length, 0)
  assert.ok(notes.some((n) => /intent-bad-regex/.test(n)))
})

t('enabled:false 直接忽略（不算坏形状）', () => {
  const { list, notes } = parseIntents([{ id: 'x', kind: 'pending', why: 'w', enabled: false }])
  assert.equal(list.length, 0)
  assert.equal(notes.length, 0)
})

t('默认值：each=once、maxPerDay=2、cooldownMin=30、minCount=1', () => {
  const spec = normalizeIntent({ id: 'x', kind: 'pending', why: 'w' })
  assert.equal(spec.each, 'once')
  assert.equal(spec.maxPerDay, 2)
  assert.equal(spec.cooldownMin, 30)
  assert.equal(spec.minCount, 1)
})

// ---------- 路径白名单 ----------
t('绝对路径一律拒', () => {
  assert.equal(pathAllowed('C:\\Windows\\x.txt').ok, false)
  assert.equal(pathAllowed('/etc/passwd').ok, false)
})

t('带 .. 的路径拒', () => {
  assert.equal(pathAllowed('pool/../homes/whale/x').ok, false)
})

t('pool/ 与 app/docs/ 允许', () => {
  assert.equal(pathAllowed('pool/group/群.md').ok, true)
  assert.equal(pathAllowed('app\\docs\\待办.md').ok, true)
})

t('自家要 insideHome:true，别人家一律不许', () => {
  assert.equal(pathAllowed('homes/whale/logs/watchman.log', { insideHome: false, ownKey: 'whale' }).ok, false)
  assert.equal(pathAllowed('homes/whale/logs/watchman.log', { insideHome: true, ownKey: 'whale' }).ok, true)
  assert.equal(pathAllowed('homes/fishball/notes/x.md', { insideHome: true, ownKey: 'whale' }).ok, false)
  assert.equal(pathAllowed('homes/fishball/notes/x.md', { insideHome: true, ownKey: 'whale' }).why, 'other-fish')
})

// ---------- 时间窗 / 冷却 / 额度 ----------
t('没写时间窗 = 全天', () => {
  assert.equal(inTimeWindow({ notBefore: null, notAfter: null }, now), true)
})

t('时间窗内 / 窗外 / 跨午夜', () => {
  assert.equal(inTimeWindow({ notBefore: 9 * 60, notAfter: 11 * 60 }, now), true)
  assert.equal(inTimeWindow({ notBefore: 11 * 60, notAfter: 12 * 60 }, now), false)
  const late = new Date(2026, 10, 14, 23, 30, 0)
  assert.equal(inTimeWindow({ notBefore: 22 * 60, notAfter: 6 * 60 }, late), true)
  const noon = new Date(2026, 10, 14, 12, 0, 0)
  assert.equal(inTimeWindow({ notBefore: 22 * 60, notAfter: 6 * 60 }, noon), false)
})

t('冷却：没触发过 → 可以；刚触发 → 不行；过了冷却 → 可以', () => {
  const spec = { cooldownMin: 30 }
  assert.equal(cooldownOk({}, spec, now), true)
  assert.equal(cooldownOk({ lastDeliveredAt: new Date(now.getTime() - 5 * 60_000).toISOString() }, spec, now), false)
  assert.equal(cooldownOk({ lastDeliveredAt: new Date(now.getTime() - 31 * 60_000).toISOString() }, spec, now), true)
})

t('额度：单条每天上限 / 全池每天上限 / 跨天重置', () => {
  const spec = { maxPerDay: 2 }
  const today = '2026-11-14'
  assert.equal(capOk({ dayStart: today, count: 0 }, spec, now, { day: today, count: 0 }).ok, true)
  assert.equal(capOk({ dayStart: today, count: 2 }, spec, now, { day: today, count: 0 }).ok, false)
  assert.equal(capOk({ dayStart: today, count: 0 }, spec, now, { day: today, count: INTENT_GLOBAL_PER_DAY }).ok, false)
  assert.equal(capOk({ dayStart: '2026-11-13', count: 9 }, spec, now, { day: '2026-11-13', count: 9 }).ok, true)
})

t('伪装日程：连续 3 天同一分钟 → isScheduleLike', () => {
  const state = { lastMinute: '10:30', lastMinuteDay: '2026-11-13', minuteStreak: 2 }
  const r = looksLikeSchedule(state, now)
  assert.equal(r.streak, 3)
  assert.equal(r.isScheduleLike, true)
  const r2 = looksLikeSchedule({ lastMinute: '09:00', lastMinuteDay: '2026-11-13', minuteStreak: 2 }, now)
  assert.equal(r2.isScheduleLike, false)
})

// ---------- 三种探测 ----------
t('pending：排除自己的话、按 from 过滤、够 minCount 才算', () => {
  const entries = [
    { from: 'lee', text: 'A' },
    { from: 'whale', text: '自己说的' },
    { from: 'lee', text: 'B' },
  ]
  assert.equal(probePending({ entries, ownKey: 'whale', from: 'lee', minCount: 2 }).hit, true)
  assert.equal(probePending({ entries, ownKey: 'whale', from: 'lee', minCount: 3 }).hit, false)
  assert.equal(probePending({ entries, ownKey: 'whale', from: 'fishball' }).hit, false)
  const hit = probePending({ entries, ownKey: 'whale', from: 'lee', minCount: 1 })
  assert.match(hit.evidence, /2 条/)
})

t('text-appears：从 offset 往后找、不追溯；命中后 offset 前进', () => {
  const content = '第一行\n结论：可以\n第三行\n'
  const first = probeTextAppears({ content, offset: 0, spec: { match: '结论：可以' } })
  assert.equal(first.hit, true)
  assert.match(first.evidence, /结论：可以/)
  assert.equal(first.nextOffset, content.indexOf('结论：可以') + '结论：可以'.length)
  const again = probeTextAppears({ content, offset: first.nextOffset, spec: { match: '结论：可以' } })
  assert.equal(again.hit, false)
})

t('text-appears：正则模式', () => {
  const r = probeTextAppears({ content: 'x\nyes: 42\n', offset: 0, spec: { match: 'yes:\\s*\\d+', regex: true } })
  assert.equal(r.hit, true)
  assert.match(r.evidence, /yes: 42/)
})

t('file-changed：第一次只记基线不触发；变了才触发；没变不触发', () => {
  const a = { size: 10, mtimeMs: 1000, hash: 'h1' }
  const first = probeFileChanged({ current: a, baseline: null })
  assert.equal(first.hit, false)
  assert.deepEqual(first.baseline, a)
  const changed = probeFileChanged({ current: { size: 11, mtimeMs: 2000, hash: 'h2' }, baseline: a })
  assert.equal(changed.hit, true)
  assert.deepEqual(changed.baseline, { size: 11, mtimeMs: 2000, hash: 'h2' })
  assert.equal(probeFileChanged({ current: a, baseline: a }).hit, false)
})

t('at= 记的是"事情发生的那一刻"：file-changed 用 mtime', () => {
  const a = { size: 10, mtimeMs: 1000, hash: 'h1' }
  const changed = probeFileChanged({ current: { size: 11, mtimeMs: 2000, hash: 'h2' }, baseline: a })
  assert.equal(changed.hit, true)
  assert.equal(changed.atMs, 2000)
  // 没变的时候不给 atMs：没有"发生"，就别编一个时刻
  assert.equal(probeFileChanged({ current: a, baseline: a }).atMs, undefined)
})

t('at= 记的是"事情发生的那一刻"：pending 用让它成立的那条消息的 ts', () => {
  const entries = [
    { from: 'fishball', text: '第一条', ts: '2026-11-14T02:00:00.000Z' },
    { from: 'fishball', text: '第二条', ts: '2026-11-14T02:05:00.000Z' },
  ]
  const r = probePending({ entries, ownKey: 'whale' })
  assert.equal(r.hit, true)
  assert.equal(r.atMs, Date.parse('2026-11-14T02:05:00.000Z'))
})

t('at= 记的是"事情发生的那一刻"：text-appears 用调用方给的文件 mtime', () => {
  const r = probeTextAppears({ content: 'a\n结论\n', offset: 0, spec: { match: '结论' }, atMs: 1234 })
  assert.equal(r.hit, true)
  assert.equal(r.atMs, 1234)
})

t('递话文本带 id / why / 证据，并说清是"你的表里的一条条件"（不是替她认领）', () => {
  const text = intentDeliveryText({ id: 'watch-x', why: '等它出结论' }, '文件变了：12 B')
  assert.match(text, /watch-x/)
  assert.match(text, /等它出结论/)
  assert.match(text, /文件变了：12 B/)
  assert.match(text, /你的表里/)
  assert.equal(/你自己写的/.test(text), false)
})

t('pruneIntentState 剪掉已删除的条件、保留还在的（小肥鱼 2026-11-15 提的残影）', () => {
  const state = { kept: { count: 1 }, gone: { baseline: 12, count: 3 } }
  const removed = pruneIntentState(state, [{ id: 'kept' }])
  assert.deepEqual(removed, ['gone'])
  assert.deepEqual(Object.keys(state), ['kept'])
  assert.equal(state.kept.count, 1)
})

t('pruneIntentState 空条件表 = 全部剪掉（她删光了，状态也该空）', () => {
  const state = { a: {}, b: {} }
  assert.deepEqual(pruneIntentState(state, []), ['a', 'b'])
  assert.deepEqual(Object.keys(state), [])
})

console.log(`合计：${pass + fail} 项，PASS ${pass}，FAIL ${fail}`)
if (fail > 0) {
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
