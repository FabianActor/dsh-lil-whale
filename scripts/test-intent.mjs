// 行为测试：她自己写下的条件（wake-on / intent）的纯逻辑。
//
// 为什么是行为测试而不是 grep 源码：判断逻辑抽在 `intent-core.js` 里，这里直接 import 真代码，
// 每条用例是一个"给定输入 → 应该得到什么"的真分支。她复现不到的东西（比如字符串参数），
// 测试要能复现 —— 这是 r87 的规矩。
//
// 跑法：node scripts/test-intent.mjs

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
  semanticHashOf,
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

t('超限条目里写错的也报（不再静默）', () => {
  // 2026-11-16 小鱼丸：先 slice 再校验，第 6 条以后的错误既不生效也不报。
  const many = Array.from({ length: INTENT_MAX }, (_, i) => ({ id: `i${i}`, kind: 'pending', why: 'w' }))
  many.push({ id: 'bad', kind: 'pending' })
  const { list, notes } = parseIntents(many)
  assert.equal(list.length, INTENT_MAX)
  assert.ok(notes.some((n) => /intent-without-why id=bad/.test(n)))
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
  assert.equal(pathAllowed('app\\docs\\detail\\还没做完的事.md').ok, true)
})

t('自家要 insideHome:true，别人家一律不许', () => {
  assert.equal(pathAllowed('homes/whale/logs/watchman.log', { insideHome: false, ownKey: 'whale' }).ok, false)
  assert.equal(pathAllowed('homes/whale/logs/watchman.log', { insideHome: true, ownKey: 'whale' }).ok, true)
  assert.equal(pathAllowed('homes/fishball/notes/x.md', { insideHome: true, ownKey: 'whale' }).ok, false)
  assert.equal(pathAllowed('homes/fishball/notes/x.md', { insideHome: true, ownKey: 'whale' }).why, 'other-fish')
// 私聊是双向隐私窗口：自家会话放行、别人会话拒、没带 ownKey 时拒（2026-11-16 第四条鱼）
assert.equal(pathAllowed('pool/dm/lee__whale.jsonl', { ownKey: 'whale' }).ok, true)
assert.equal(pathAllowed('pool/dm/whale__lee.jsonl', { ownKey: 'whale' }).ok, true)
assert.equal(pathAllowed('pool/dm/lee__xiaoman.jsonl', { ownKey: 'whale' }).ok, false)
assert.equal(pathAllowed('pool/dm/lee__xiaoman.jsonl', { ownKey: 'whale' }).why, 'other-dm')
assert.equal(pathAllowed('pool/dm/lee__whale.jsonl').ok, false)
assert.equal(pathAllowed('pool/dm/lee__whale.jsonl').why, 'dm-needs-own-key')
// 目录本身也拒：盯 `pool/dm` 等于拿到“谁的那一对刚变过”（文件名 + mtime）
assert.equal(pathAllowed('pool/dm').ok, false)
assert.equal(pathAllowed('pool/dm').why, 'dm-dir')
assert.equal(pathAllowed('pool/dm/', { ownKey: 'whale' }).why, 'dm-dir')
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

t('file-changed：只碰了 mtime 不算「变了」，内容变才触发（fi-0020）', () => {
  const a = { size: 3117, mtimeMs: 1000, hash: 'ca31171c' }
  // 只碰 mtime：hit=false，但要把原因说出来，不能和「没变」同形
  const touch = probeFileChanged({ current: { size: 3117, mtimeMs: 5000, hash: 'ca31171c' }, baseline: a })
  assert.equal(touch.hit, false)
  assert.equal(touch.touchOnly, true)
  assert.equal(touch.sig, 'mtime')
  assert.match(touch.evidence, /只碰了 mtime/)
  assert.match(touch.evidence, /ca31171c/)
  // 只改 size：内容算变了，证据里写 size 前后值
  const sized = probeFileChanged({ current: { size: 3200, mtimeMs: 1000, hash: 'ca31171c' }, baseline: a })
  assert.equal(sized.hit, true)
  assert.equal(sized.sig, 'size')
  assert.match(sized.evidence, /size 3117→3200/)
  // 只改 hash：证据里写 hash 前后值
  const hashed = probeFileChanged({ current: { size: 3117, mtimeMs: 1000, hash: '9f2e0001' }, baseline: a })
  assert.equal(hashed.hit, true)
  assert.equal(hashed.sig, 'hash')
  assert.match(hashed.evidence, /hash ca31171c→9f2e0001/)
  // 三者都变：sig 三格都要在，不许合并成一格
  const all = probeFileChanged({ current: { size: 1, mtimeMs: 8000, hash: 'zz' }, baseline: a })
  assert.equal(all.sig, 'size+hash+mtime')
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

t('parseIntents：读错了键 = badShape，不是"空表"（小肥鱼 2026-11-15 15:42：没有条件和读错地方必须是两种结果）', () => {
  const r = parseIntents({ conditions: [{ id: 'x' }] })
  assert.equal(r.badShape, true)
  assert.equal(r.list.length, 0)
})

t('parseIntents：items: [] 是合法的空表，不是坏形状（她真的删光了，才该剪状态）', () => {
  const r = parseIntents({ items: [] })
  assert.equal(r.badShape, false)
  assert.equal(r.list.length, 0)
})

// 源码级：条件回落后必须把"第一次成立"清掉，否则它的时间戳会活到下一轮，
// 下一次真的成立时被 ageMs 判成 intent-stale（fi-0020 验收时撞到的那一格）。
t('intentTick：条件不再成立时清掉 firstTrueAt（不许旧时间戳活到下一轮）', () => {
  const src = readFileSync(new URL('../plugin/dsh-lil-whale-group/lib/index.js', import.meta.url), 'utf8')
  const notHit = src.indexOf('if (!probe.hit) {')
  const setFirst = src.indexOf('if (!s.firstTrueAt) {')
  assert.ok(notHit > 0, '找不到 not-hit 分支')
  assert.ok(setFirst > notHit, 'not-hit 分支必须在设 firstTrueAt 之前')
  const between = src.slice(notHit, setFirst)
  assert.ok(/delete s\.firstTrueAt/.test(between), 'not-hit 分支里没有清 firstTrueAt')
})
t('semanticHashOf：重排和缩进不算内容变了', () => {
  const a = semanticHashOf({ text: '{"b":2,"a":1}' })
  const b = semanticHashOf({ text: '{\n  "a": 1,\n  "b": 2\n}' })
  assert.equal(a.hash, b.hash)
  assert.equal(a.kind, 'json')
})

t('semanticHashOf：ignore 摘掉每次都会变的字段（名册的 updatedAt）', () => {
  const a = semanticHashOf({ text: '{"updatedAt":"x","members":{"lee":1}}', ignore: ['updatedAt'] })
  const b = semanticHashOf({ text: '{"updatedAt":"y","members":{"lee":1}}', ignore: ['updatedAt'] })
  const c = semanticHashOf({ text: '{"updatedAt":"y","members":{"lee":2}}', ignore: ['updatedAt'] })
  assert.equal(a.hash, b.hash)
  assert.notEqual(a.hash, c.hash)
})

t('semanticHashOf：读不成 JSON 的走原始字节（kind=raw）', () => {
  const r = semanticHashOf({ text: 'hello' })
  assert.equal(r.kind, 'raw')
  assert.equal(r.hash.length, 12)
})

t('probeFileChanged：JSON 被重写但语义没变 ⇒ 不算命中（报 rewrite）', () => {
  const baseline = { size: 20, mtimeMs: 1, hash: 'json:abc', kind: 'json' }
  const current = { size: 34, mtimeMs: 2, hash: 'json:abc', kind: 'json' }
  const r = probeFileChanged({ current, baseline })
  assert.equal(r.hit, false)
  assert.equal(r.touchOnly, true)
  assert.equal(r.sig, 'rewrite')
})

t('probeFileChanged：JSON 语义变了 ⇒ 命中，sig=json', () => {
  const baseline = { size: 20, mtimeMs: 1, hash: 'json:abc', kind: 'json' }
  const current = { size: 21, mtimeMs: 2, hash: 'json:def', kind: 'json' }
  const r = probeFileChanged({ current, baseline })
  assert.equal(r.hit, true)
  assert.equal(r.sig, 'json')
})

t('probeFileChanged：指纹算法换了（raw→json）⇒ 只重取基线，不报内容变了', () => {
  const baseline = { size: 20, mtimeMs: 1, hash: 'abcdefabcdef' }
  const current = { size: 20, mtimeMs: 1, hash: 'json:abcdefabcdef', kind: 'json' }
  const r = probeFileChanged({ current, baseline })
  assert.equal(r.hit, false)
  assert.equal(r.sig, 'format')
})

t('normalizeIntent：ignore 只收字符串、去空、最多 20 个', () => {
  const r = normalizeIntent({ id: 'x', why: 'w', kind: 'file-changed', path: 'pool/x.json', ignore: [' a ', '', 3, 'b'] })
  assert.deepEqual(r.ignore, ['a', 'b'])
})
t('probeFileChanged：JSON 只碰 mtime / 只改格式 / 语义变了，三个名字各不相同', () => {
  const base = { size: 20, mtimeMs: 1, hash: 'json:abc', kind: 'json' }
  const touched = probeFileChanged({ current: { ...base, mtimeMs: 2 }, baseline: base })
  const rewritten = probeFileChanged({ current: { ...base, size: 40, mtimeMs: 2 }, baseline: base })
  const changed = probeFileChanged({ current: { ...base, size: 20, mtimeMs: 2, hash: 'json:def' }, baseline: base })
  assert.equal(touched.sig, 'mtime')
  assert.equal(rewritten.sig, 'rewrite')
  assert.equal(changed.sig, 'json')
})
t('源码：每次触发带 seq=（同样的事件不会被去重窗折成一次）', () => {
  const src = readFileSync(new URL('../plugin/dsh-lil-whale-group/lib/index.js', import.meta.url), 'utf8')
  assert.ok(/const seq = Number\(s\.seq \|\| 0\) \+ 1/.test(src), '没有 seq 计数器')
  assert.ok(/note=intent-touch-only id=\$\{spec\.id\} sig=\$\{r\.sig \?\? 'mtime'\} seq=\$\{seq\}/.test(src), 'touch-only 行没带 seq')
  assert.ok(/note=intent-hit id=\$\{spec\.id\} sig=\$\{r\.sig\} seq=\$\{seq\}/.test(src), 'hit 行没带 seq')
  assert.ok(/patch: \{ baseline: r\.baseline, seq \}/.test(src), 'seq 没写回状态（下次还是 1）')
  assert.ok(/const changed = r\.hit \|\| r\.touchOnly[\s\S]{0,160}?const seq = Number\(s\.seq/.test(src), '没变的那拍不该涨 seq（r485）')
})
console.log(`合计：${pass + fail} 项，PASS ${pass}，FAIL ${fail}`)
if (fail > 0) {
console.log(`  ✗ ${f}`)
  process.exit(1)
}
