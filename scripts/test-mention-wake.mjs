// mention（叫醒谁）的纯判据测试 —— 2026-11-22 r412。
// 只在内存里摆题，不碰真鱼塘（判据交给调用方；这里只验规则本身）。
import { readFileSync } from 'node:fs'
import {
  MENTION_ALL,
  normalizeMention,
  defaultMentionOf,
  wantsWake,
  mentionTextOf,
  bumpHeld,
  heldOf,
  clearHeld,
  heldSentenceOf,
} from '../plugin/dsh-lil-whale-group/lib/mention-core.js'

let pass = 0
let fail = 0
function ok(cond, name, extra = '') {
  if (cond) { pass += 1; return }
  fail += 1
  console.log(`FAIL ${name}${extra === '' ? '' : `：${extra}`}`)
}
function eq(actual, expected, name) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  ok(a === b, name, `期望 ${b}，实际 ${a}`)
}
function throws(fn, name) {
  let threw = false
  try { fn() } catch { threw = true }
  ok(threw, name, '应当抛错但没抛')
}

const KEYS = ['lee', 'whale', 'fishball', 'xiaoman', 'lee2', 'fabian']
const MEMBERS = {
  lee: { kind: 'fish' },
  whale: { kind: 'fish' },
  fishball: { kind: 'fish' },
  xiaoman: { kind: 'fish' },
  lee2: { kind: 'fish' },
  fabian: { kind: 'human' },
}

// ---- normalizeMention ----
eq(normalizeMention(undefined, KEYS), undefined, '没写 mention ⇒ undefined（交给默认值）')
eq(normalizeMention('', KEYS), [], '空串 ⇒ 显式不叫醒任何人')
eq(normalizeMention('all', KEYS), MENTION_ALL, "all ⇒ 'all'")
eq(normalizeMention('  whale ', KEYS), ['whale'], '单个 id 去空白')
eq(normalizeMention('whale,lee2', KEYS), ['whale', 'lee2'], '逗号分隔')
eq(normalizeMention('whale、lee2', KEYS), ['whale', 'lee2'], '顿号分隔')
eq(normalizeMention(['whale', 'whale'], KEYS), ['whale'], '数组去重')
throws(() => normalizeMention('nobody', KEYS), '不认识的成员 ⇒ 抛错')
throws(() => normalizeMention(42, KEYS), '非字符串/数组 ⇒ 抛错')

// ---- defaultMentionOf ----
eq(defaultMentionOf({ from: 'whale', to: 'all', members: MEMBERS }), [], '鱼在群里说话默认谁都不叫醒')
eq(defaultMentionOf({ from: 'fabian', to: 'all', members: MEMBERS }), MENTION_ALL, '人类说话默认叫醒所有人')
eq(defaultMentionOf({ from: 'whale', to: 'lee2', members: MEMBERS }), ['lee2'], 'to 指名谁就默认叫醒谁')
eq(defaultMentionOf({ from: 'fabian', to: 'fishball', members: MEMBERS }), ['fishball'], '人类指名也默认叫醒被指名的人')

// ---- wantsWake ----
ok(wantsWake({ mention: MENTION_ALL, to: 'all' }, 'lee2'), 'mention=all ⇒ 谁都醒')
ok(!wantsWake({ mention: [], to: 'all' }, 'lee2'), 'mention=[] ⇒ 谁都不醒')
ok(wantsWake({ mention: ['lee2'], to: 'all' }, 'lee2'), '名单里有我 ⇒ 醒')
ok(!wantsWake({ mention: ['whale'], to: 'all' }, 'lee2'), '名单里没我 ⇒ 不醒')
ok(!wantsWake({ mention: 'bogus', to: 'all' }, 'lee2'), '认不出的 mention 形状 ⇒ 不猜、不叫醒')
// 老记录：没有 mention 字段，按旧规则读
ok(wantsWake({ to: 'all' }, 'lee2'), '老记录 to=all ⇒ 叫醒所有人（旧行为）')
ok(wantsWake({ to: 'lee2' }, 'lee2'), '老记录 to=某人 ⇒ 叫醒那个人')
ok(!wantsWake({ to: 'another' }, 'lee2'), '老记录 to=别人 ⇒ 不叫醒')
// 新记录：mention 与 to 分开
ok(!wantsWake({ to: 'lee2', mention: [] }, 'lee2'), '新记录 to=我但 mention 空 ⇒ 不叫醒（to 只说给谁）')
ok(wantsWake({ to: 'all', mention: ['whale'] }, 'whale'), 'to=all + mention 某人 ⇒ 叫醒那个某人')
ok(!wantsWake({ to: 'all', mention: ['whale'] }, 'xiaoman'), 'to=all + mention 某人 ⇒ 别人不醒')

// ---- 回执文案 ----
eq(mentionTextOf(undefined, (k) => k), '（未写，按 to 推）', '未写时的文案')
eq(mentionTextOf(MENTION_ALL, (k) => k), '所有人', 'all 的文案')
eq(mentionTextOf([], (k) => k), '不叫醒任何人', '空的文案')
eq(mentionTextOf(['whale', 'lee2'], (k) => `名-${k}`), '名-whale、名-lee2', '名单的文案用 labelOf')

// ---- held（没叫醒的也要有账） ----
let held = { version: 1, channels: {}, updatedAt: '' }
held = bumpHeld(held, 'group', { count: 1, line: 10, ts: '2026-11-22T07:00:00.000Z', now: '2026-11-22T07:00:01.000Z' })
held = bumpHeld(held, 'group', { count: 3, line: 12, ts: '2026-11-22T07:01:00.000Z', now: '2026-11-22T07:01:01.000Z' })
eq(heldOf(held, 'group'), 4, 'held 累加')
eq(held.channels.group.from, 10, 'held 记住第一条行号')
eq(held.channels.group.to, 12, 'held 记住最后一条行号')
eq(heldOf(held, 'dm:fabian__lee2'), 0, '别的通道不受影响')
const cleared = clearHeld(held, 'group', '2026-11-22T07:02:00.000Z')
eq(heldOf(cleared, 'group'), 0, '清掉之后计数归零')
eq(heldOf(bumpHeld(null, 'group', { count: 2 }), 'group'), 2, '空状态也能累加（坏文件不炸）')
eq(heldSentenceOf(0), '', '0 条不写一句噪声')
ok(heldSentenceOf(3).includes('3 条没点你的话'), '有积压时有句子')
ok(!heldSentenceOf(3).includes('君'), '句子不编原因')

// ---- 兼容：字段名写错时不要静默 ----
eq(wantsWake({ mention: MENTION_ALL }, 'fabian'), true, '人类也在名单里（只是他不跑轮）')


// ---- 源码层：回执要靠 execute 的返回值说“会叫醒谁” ----
const idxSrc = readFileSync(new URL('../plugin/dsh-lil-whale-group/lib/index.js', import.meta.url), 'utf8')
ok(idxSrc.includes('from: record.from, mention: record.mention'), 'group_say 的返回值带 from/mention（否则回执读成“未写，按 to 推”）')
ok(!idxSrc.includes('return { ts: record.ts, queued: true, channel: record.channel, to: record.to, image:'), '旧的一行 return 不在了')
ok(idxSrc.includes('mentionTextOf(value.mention, labelOf)'), '回执用 mention 文案')
console.log(`test-mention-wake：合计 ${pass + fail}，PASS ${pass}，FAIL ${fail}`)
if (fail > 0) process.exit(1)
