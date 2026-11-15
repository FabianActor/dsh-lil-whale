// 睡眠逻辑的行为测试（2026-11-14 建）。
//
// 为什么要有：`gate()` 里原来那句 `withinQuietHours()` 是全局硬闸，没有测试；
// 换成"每条鱼自己的睡眠窗"之后，窗口、跨午夜、一次性睡眠、家长强制叫醒这四种
// 情况只要有一种算错，表现都是"她半夜被叫醒"或"她该醒的时候还在睡"——
// 两种都很难在日志里看出来。所以把判断抽到 `sleep-core.js`，这里直接跑真代码。
//
// 用法：node scripts/test-sleep.mjs      退出码 0 = 全过，1 = 有失败。
// 纯函数为主；最后一段"汇总视图写盘"在临时目录里真跑一次，不碰真池子。

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { refreshSleepStatus } from '../plugin/dsh-lil-whale-group/lib/sleep-status.js'
import {
  parseHm,
  windowFor,
  sleepStateOf,
  sleepLabel,
  forceAwakeUntil,
  DEFAULT_SLEEP_FROM,
  DEFAULT_SLEEP_TO,
  normalizeSleepArgs,
} from '../plugin/dsh-lil-whale-group/lib/sleep-core.js'
import { buildSleepStatus } from '../plugin/dsh-lil-whale-group/lib/sleep-status.js'

let pass = 0
let fail = 0
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass += 1
    console.log(`PASS  ${name}`)
  } else {
    fail += 1
    console.log(`FAIL  ${name}\n      期望 ${e}\n      实际 ${a}`)
  }
}

// 固定本地时刻：用带时区的 ISO 串构造，避免机器时区影响
const at = (text) => new Date(text)

// ---- parseHm ----
check('parseHm 08:30 = 510', parseHm('08:30'), 510)
check('parseHm 00:00 = 0', parseHm('00:00'), 0)
check('parseHm 23:59 = 1439', parseHm('23:59'), 1439)
check('parseHm 8:30 也认', parseHm('8:30'), 510)
check('parseHm 坏形状 → null', parseHm('24:00'), null)
check('parseHm 分钟越界 → null', parseHm('08:60'), null)
check('parseHm 空 → null', parseHm(''), null)
check('parseHm 非字符串 → null', parseHm(null), null)

// ---- windowFor：不跨午夜 ----
{
  const now = at('2026-11-14T03:00:00+08:00')
  const w = windowFor('00:00', '08:00', now)
  check('窗口 00:00–08:00 的起点', w.fromAt.toISOString(), at('2026-11-14T00:00:00+08:00').toISOString())
  check('窗口 00:00–08:00 的终点', w.toAt.toISOString(), at('2026-11-14T08:00:00+08:00').toISOString())
}
{
  // 已经过了今天的窗：应该滚到明天
  const now = at('2026-11-14T09:00:00+08:00')
  const w = windowFor('00:00', '08:00', now)
  check('过了窗之后指向明天起点', w.fromAt.toISOString(), at('2026-11-15T00:00:00+08:00').toISOString())
  check('过了窗之后指向明天终点', w.toAt.toISOString(), at('2026-11-15T08:00:00+08:00').toISOString())
}
// ---- windowFor：跨午夜 ----
{
  const now = at('2026-11-14T23:30:00+08:00')
  const w = windowFor('22:00', '07:00', now)
  check('跨午夜窗起点是今天 22:00', w.fromAt.toISOString(), at('2026-11-14T22:00:00+08:00').toISOString())
  check('跨午夜窗终点是明天 07:00', w.toAt.toISOString(), at('2026-11-15T07:00:00+08:00').toISOString())
}
{
  const now = at('2026-11-14T02:00:00+08:00')
  const w = windowFor('22:00', '07:00', now)
  check('凌晨 2 点在昨晚开的窗里', w.fromAt.toISOString(), at('2026-11-13T22:00:00+08:00').toISOString())
  check('凌晨 2 点的窗今天 07:00 结束', w.toAt.toISOString(), at('2026-11-14T07:00:00+08:00').toISOString())
}
check('坏偏好形状 → null', windowFor('nope', '08:00', at('2026-11-14T03:00:00+08:00')), null)

// ---- sleepStateOf：默认窗 ----
const prefDefault = { from: DEFAULT_SLEEP_FROM, to: DEFAULT_SLEEP_TO, enabled: true }
check('默认窗 03:00 在睡', sleepStateOf({ preference: prefDefault }, at('2026-11-14T03:00:00+08:00')).sleeping, true)
check('默认窗 09:00 醒着', sleepStateOf({ preference: prefDefault }, at('2026-11-14T09:00:00+08:00')).sleeping, false)
check('默认窗 00:00 整在睡（左闭）', sleepStateOf({ preference: prefDefault }, at('2026-11-14T00:00:00+08:00')).sleeping, true)
check('默认窗 08:00 整醒着（右开）', sleepStateOf({ preference: prefDefault }, at('2026-11-14T08:00:00+08:00')).sleeping, false)
check('没有偏好时用默认窗', sleepStateOf({}, at('2026-11-14T03:00:00+08:00')).sleeping, true)

// ---- 跨午夜偏好 ----
const prefNight = { from: '22:00', to: '07:00', enabled: true }
check('跨午夜 23:30 在睡', sleepStateOf({ preference: prefNight }, at('2026-11-14T23:30:00+08:00')).sleeping, true)
check('跨午夜 06:59 在睡', sleepStateOf({ preference: prefNight }, at('2026-11-14T06:59:00+08:00')).sleeping, true)
check('跨午夜 07:00 醒着', sleepStateOf({ preference: prefNight }, at('2026-11-14T07:00:00+08:00')).sleeping, false)
check('跨午夜 12:00 醒着', sleepStateOf({ preference: prefNight }, at('2026-11-14T12:00:00+08:00')).sleeping, false)

// ---- 一次性睡眠 ----
const oneOff = { fromAt: '2026-11-14T10:00:00+08:00', toAt: '2026-11-14T10:30:00+08:00', reason: '补觉' }
check('一次性睡眠窗内', sleepStateOf({ oneOff }, at('2026-11-14T10:15:00+08:00')).sleeping, true)
check('一次性睡眠窗内来源', sleepStateOf({ oneOff }, at('2026-11-14T10:15:00+08:00')).source, 'one-off')
check('一次性睡眠过了就醒', sleepStateOf({ oneOff }, at('2026-11-14T10:30:00+08:00')).sleeping, false)
check('一次性睡眠还没到 → 醒着+upcoming', Date.parse(sleepStateOf({ oneOff }, at('2026-11-14T09:00:00+08:00')).upcomingAt), Date.parse(oneOff.fromAt))
check(
  '一次性睡眠压过每日偏好（10:15 本是醒着）',
  sleepStateOf({ oneOff, preference: prefDefault }, at('2026-11-14T10:15:00+08:00')).sleeping,
  true,
)

// ---- 一次性睡眠覆盖默认窗（2026-11-15 小肥鱼设"睡到明早 07:00"，默认窗 00:00–08:00）----
const nightly = { fromAt: '2026-11-14T19:12:08+08:00', toAt: '2026-11-15T07:00:00+08:00', reason: '睡到明早七点' }
check('覆盖：07:00:30 醒着（默认窗里已按她的点结束）', sleepStateOf({ oneOff: nightly, preference: prefDefault }, at('2026-11-15T07:00:30+08:00')).sleeping, false)
check('覆盖：来源 one-off-ended', sleepStateOf({ oneOff: nightly, preference: prefDefault }, at('2026-11-15T07:00:30+08:00')).source, 'one-off-ended')
check('覆盖：前一晚 23:00 还在睡', sleepStateOf({ oneOff: nightly, preference: prefDefault }, at('2026-11-14T23:00:00+08:00')).sleeping, true)
check('覆盖：07:59 仍是醒着', sleepStateOf({ oneOff: nightly, preference: prefDefault }, at('2026-11-15T07:59:00+08:00')).sleeping, false)
check('覆盖：第二晚默认窗照常生效', sleepStateOf({ oneOff: nightly, preference: prefDefault }, at('2026-11-16T03:00:00+08:00')).sleeping, true)
check('覆盖：过期的一觉不误伤（结束点在窗外）', sleepStateOf({ oneOff: { fromAt: '2026-11-14T14:00:00+08:00', toAt: '2026-11-14T15:00:00+08:00' }, preference: prefDefault }, at('2026-11-15T03:00:00+08:00')).sleeping, true)
check('覆盖：窗中间小睡按她的点醒（01:00–03:00）', sleepStateOf({ oneOff: { fromAt: '2026-11-15T01:00:00+08:00', toAt: '2026-11-15T03:00:00+08:00' }, preference: prefDefault }, at('2026-11-15T03:00:05+08:00')).sleeping, false)
check('覆盖：结束点正好等于窗尾不误判', sleepStateOf({ oneOff: { fromAt: '2026-11-14T20:00:00+08:00', toAt: '2026-11-15T08:00:00+08:00' }, preference: prefDefault }, at('2026-11-15T03:00:00+08:00')).sleeping, true)
check('覆盖：跨午夜窗（22–07）在 06:30 按她的点醒', sleepStateOf({ oneOff: { fromAt: '2026-11-14T23:00:00+08:00', toAt: '2026-11-15T06:00:00+08:00' }, preference: prefNight }, at('2026-11-15T06:30:00+08:00')).sleeping, false)
check('覆盖：强制叫醒仍最高优先', sleepStateOf({ oneOff: nightly, preference: prefDefault, awakeUntil: '2026-11-15T07:30:00+08:00' }, at('2026-11-15T07:10:00+08:00')).source, 'forced-awake')

// ---- 家长强制叫醒 ----
const awake = { awakeUntil: '2026-11-14T09:00:00+08:00' }
check('强制叫醒期内不算睡', sleepStateOf({ preference: prefDefault, ...awake }, at('2026-11-14T03:00:00+08:00')).sleeping, false)
check('强制叫醒来源', sleepStateOf({ preference: prefDefault, ...awake }, at('2026-11-14T03:00:00+08:00')).source, 'forced-awake')
check('强制叫醒过期后回到偏好', sleepStateOf({ preference: prefDefault, awakeUntil: '2026-11-14T02:00:00+08:00' }, at('2026-11-14T03:00:00+08:00')).sleeping, true)

// ---- 关掉偏好 ----
check('enabled:false 时 03:00 醒着', sleepStateOf({ preference: { from: '00:00', to: '08:00', enabled: false } }, at('2026-11-14T03:00:00+08:00')).sleeping, false)
// ---- 坏偏好退回默认 ----
check('偏好形状坏 → 退回默认窗', sleepStateOf({ preference: { from: 'nope', to: 'bad' } }, at('2026-11-14T03:00:00+08:00')).sleeping, true)

// ---- 展示与强制叫醒 ----
check('sleepLabel 到 08:30', sleepLabel({ untilAt: '2026-11-14T08:30:00+08:00' }), '到 08:30')
check('sleepLabel 空 → 空串', sleepLabel({}), '')
{
  const until = forceAwakeUntil(prefDefault, at('2026-11-14T03:00:00+08:00'))
  check('强制叫醒落在本窗结束（08:00）', Date.parse(until), Date.parse('2026-11-14T08:00:00+08:00'))
}
{
  const until = forceAwakeUntil(prefDefault, at('2026-11-14T09:00:00+08:00'))
  check('窗外的强制叫醒给两小时', Date.parse(until), Date.parse('2026-11-14T11:00:00+08:00'))
}

// 参数归一化（2026-11-14 小肥鱼复测：她那边已经复现不到"字符串 1"，只能靠这里留证据）
{
  const { args, numOf } = normalizeSleepArgs({ minutes: 1 })
  check('归一化：对象原样', args.minutes, 1)
  check('归一化：数字 1', numOf(args.minutes), 1)
}
{
  const { args, numOf } = normalizeSleepArgs({ minutes: '1' })
  check('归一化：字符串 "1" 也收', numOf(args.minutes), 1)
}
{
  const { args, numOf } = normalizeSleepArgs('{"minutes":"3"}')
  check('归一化：整个 args 是 JSON 字符串', numOf(args.minutes), 3)
}
{
  const { args, numOf } = normalizeSleepArgs('不是 JSON')
  check('归一化：坏 JSON → 空对象', args, {})
  check('归一化：坏 JSON 下 numOf(undefined)', numOf(args.minutes), null)
}
{
  const { args, numOf } = normalizeSleepArgs(null)
  check('归一化：null → 空对象', args, {})
  check('归一化：numOf("abc")', numOf('abc'), null)
}
{
  const { numOf } = normalizeSleepArgs({})
  check('归一化：numOf("") 不算数字', numOf(''), null)
  check('归一化：numOf(NaN)', numOf(NaN), null)
}

// ---- buildSleepStatus（面板读的那份汇总；2026-11-15 加） ----
// 为什么测它：她抓到"被叫醒后 sleep-status 还写着睡"——汇总视图错了，
// 面板和体检就一起说谎。这里只测纯计算，不碰文件。
{
  const now = at('2026-11-15T03:00:00+08:00')
  const members = {
    lee: { kind: 'fish', role: 'watcher', home: 'X:/lee' },
    whale: { kind: 'fish', home: 'X:/whale' },
    fabian: { kind: 'human' },
  }
  const out = buildSleepStatus({ members, prefOf: () => null, stateOf: () => ({}), now })
  check('汇总：巡守不出现', Object.keys(out.members).includes('lee'), false)
  check('汇总：人不出现', Object.keys(out.members).includes('fabian'), false)
  check('汇总：默认窗里在睡', out.members.whale.sleeping, true)
  check('汇总：默认窗来源 preference', out.members.whale.source, 'preference')
}
{
  const now = at('2026-11-15T03:00:00+08:00')
  const members = { whale: { kind: 'fish', home: 'X:/whale' } }
  const stateOf = () => ({
    oneOff: { fromAt: '2026-11-15T02:00:00+08:00', toAt: '2026-11-15T05:00:00+08:00', reason: '测试' },
  })
  const out = buildSleepStatus({ members, prefOf: () => null, stateOf, now })
  check('汇总：一次性睡眠 source one-off', out.members.whale.source, 'one-off')
}
{
  const now = at('2026-11-15T03:00:00+08:00')
  const members = { whale: { kind: 'fish', home: 'X:/whale' } }
  const stateOf = () => ({
    awakeUntil: '2026-11-15T08:00:00+08:00',
    lastForced: { at: '2026-11-15T00:01:47.000Z', by: 'fabian', reason: '面板「叫醒」' },
  })
  const out = buildSleepStatus({ members, prefOf: () => null, stateOf, now })
  check('汇总：被叫醒后 sleeping=false', out.members.whale.sleeping, false)
  check('汇总：被叫醒后 source forced-awake', out.members.whale.source, 'forced-awake')
  check('汇总：lastForced 原样带出', out.members.whale.lastForced.by, 'fabian')
}
{
  const now = at('2026-11-15T03:00:00+08:00')
  const members = { whale: { kind: 'fish', home: 'X:/whale' } }
  const stateOf = () => {
    throw new Error('读坏了')
  }
  const out = buildSleepStatus({ members, prefOf: () => null, stateOf, now })
  check('汇总：状态读坏不炸，按偏好算', out.members.whale.sleeping, true)
}
{
  const now = at('2026-11-15T03:00:00+08:00')
  const members = { whale: { kind: 'fish', home: 'X:/whale' } }
  const out = buildSleepStatus({
    members,
    prefOf: () => ({ from: '00:00', to: '08:00', enabled: false }),
    stateOf: () => ({}),
    now,
  })
  check('汇总：偏好关掉就是醒着', out.members.whale.sleeping, false)
}

// ---- refreshSleepStatus（真写盘；临时目录，不碰真池子） ----
// 为什么连写盘也测：她抓到的那处不一致，就发生在"改了状态但没刷纸"的那一下。
{
  const root = mkdtempSync(join(tmpdir(), 'llw-status-'))
  const stateDir = join(root, 'pool', 'state')
  const home = join(root, 'homes', 'whale')
  mkdirSync(join(stateDir, 'sleep'), { recursive: true })
  mkdirSync(join(home, 'plan'), { recursive: true })
  const membersFile = join(root, 'pool', 'members.json')
  writeFileSync(
    membersFile,
    JSON.stringify({
      members: {
        lee: { kind: 'fish', role: 'watcher', home: join(root, 'homes', 'lee') },
        whale: { kind: 'fish', home },
        fabian: { kind: 'human' },
      },
    }),
  )
  writeFileSync(join(home, 'plan', 'sleep.json'), JSON.stringify({ from: '00:00', to: '08:00', enabled: true }))
  const now = at('2026-11-15T03:00:00+08:00')
  writeFileSync(
    join(stateDir, 'sleep', 'whale.json'),
    JSON.stringify({ oneOff: { fromAt: '2026-11-15T02:00:00+08:00', toAt: '2026-11-15T05:00:00+08:00' } }),
  )
  let out = refreshSleepStatus({ membersFile, poolStateDir: stateDir, now })
  check('写盘：睡着时汇总说在睡', out.members.whale.sleeping, true)
  writeFileSync(
    join(stateDir, 'sleep', 'whale.json'),
    JSON.stringify({
      oneOff: null,
      awakeUntil: '2026-11-15T08:00:00+08:00',
      lastForced: { at: '2026-11-15T00:01:47.000Z', by: 'fabian', reason: '面板「叫醒」' },
    }),
  )
  out = refreshSleepStatus({ membersFile, poolStateDir: stateDir, now })
  check('写盘：叫醒后立刻说醒着', out.members.whale.sleeping, false)
  check('写盘：by 与 reason 分开', out.members.whale.lastForced.reason, '面板「叫醒」')
  const disk = JSON.parse(readFileSync(join(stateDir, 'sleep-status.json'), 'utf8'))
  check('写盘：文件里也是醒着', disk.members.whale.sleeping, false)
  check('写盘：巡守不进汇总', Object.keys(disk.members).includes('lee'), false)
  rmSync(root, { recursive: true, force: true })
}

console.log(`\n合计：${pass + fail} 项，PASS ${pass}，FAIL ${fail}`)
process.exit(fail === 0 ? 0 : 1)
