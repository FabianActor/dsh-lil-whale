// 计划逻辑的行为测试（2026-11-13 建）。
//
// 为什么要有：`verify-pending.ps1` 原来靠 grep 源码字符串（`totalPerDay:\s*120`、
// `function selfPlanTick`）来判断"机制在不在"。那种检查有两条骗法：
//   1) 改名就误报 FAIL —— 机制好好的，检查却红；
//   2) 注释里写一行 `totalPerDay: 120` 也能 PASS —— 证明的是"这串字存在"，不是"这机制在跑"。
// 所以把判断逻辑抽到 `plugin/dsh-lil-whale-group/lib/plan-core.js`，这里直接 import 真代码，
// 用真文件跑真分支。改名会红，注释骗不过去。
//
// 用法：node scripts/test-plan.mjs      退出码 0 = 全过，1 = 有失败。
// 只读临时目录，不碰任何鱼的家。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  todayKey,
  planFileOf,
  planDue,
  planDeliveryText,
  planDeliveryPublicText,
  parseWakeCounts,
  sumWakesToday,
} from '../plugin/dsh-lil-whale-group/lib/plan-core.js'

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

const root = mkdtempSync(join(tmpdir(), 'plan-test-'))
const home = join(root, 'fish')
const planDir = join(home, 'plan')
mkdirSync(planDir, { recursive: true })
const member = { key: 'testfish', home }
const homeRoot = join(root, 'fallback-home')
const writePlan = (data) => writeFileSync(join(planDir, 'wake-plan.json'), JSON.stringify(data), 'utf8')
const at = (h, m) => {
  const d = new Date(2026, 10, 13, h, m, 0, 0) // 2026-11-13 本地时间
  return d
}
const TODAY = '2026-11-13'
const notes = []
const onNote = (msg) => notes.push(msg)
const due = (now, opts = {}) => planDue({ member, st: opts.st ?? {}, now, graceMin: opts.graceMin ?? 1, homeRoot, maxItems: opts.maxItems ?? 3, onNote })

try {
  // ---- todayKey / planFileOf ----
  check('todayKey 用本地日期', todayKey(at(9, 5)), TODAY)
  check('planFileOf 优先 member.home', planFileOf(member, homeRoot), join(home, 'plan', 'wake-plan.json'))
  check('planFileOf 缺 home 时退回 homeRoot', planFileOf({ key: 'x' }, homeRoot), join(homeRoot, 'plan', 'wake-plan.json'))

  // ---- planDue 的窗口 ----
  writePlan([{ id: 'morning', at: '08:40', why: '读夜里的账' }])
  check('正好这一分钟（grace=1）命中', due(at(8, 40)).map((x) => x.id), ['morning'])
  check('正好这一分钟（grace=15）命中', due(at(8, 40), { graceMin: 15 }).map((x) => x.id), ['morning'])
  check('迟到 5 分钟：宽 15 命中', due(at(8, 45), { graceMin: 15 }).map((x) => x.id), ['morning'])
  check('迟到 5 分钟：宽 1 不命中', due(at(8, 45), { graceMin: 1 }), [])
  check('迟到 20 分钟：不补', due(at(9, 0), { graceMin: 15 }), [])
  check('还没到点：不命中', due(at(8, 39), { graceMin: 15 }), [])

  // ---- 该跳过的条目 ----
  writePlan([{ id: 'expired', at: '08:40', why: 'x', until: '2026-11-12' }])
  check('until 已过期：跳过', due(at(8, 40), { graceMin: 15 }), [])
  writePlan([{ id: 'nowhy', at: '08:40' }])
  check('没写 why：跳过', due(at(8, 40), { graceMin: 15 }), [])
  writePlan([{ id: 'off', at: '08:40', why: 'x', enabled: false }])
  check('enabled:false：跳过', due(at(8, 40), { graceMin: 15 }), [])
  writePlan([{ id: 'fired', at: '08:40', why: 'x' }])
  check('今天已推过：跳过', due(at(8, 40), { graceMin: 15, st: { planFired: { fired: TODAY } } }), [])

  // ---- days 过滤 ----
  // 2026-11-13 是周五
  writePlan([{ id: 'weekly', at: '21:00', why: 'x', days: ['sun'] }])
  check('days 不含今天：跳过', due(at(21, 0), { graceMin: 15 }), [])
  writePlan([{ id: 'weekly', at: '21:00', why: 'x', days: ['fri'] }])
  check('days 含今天：命中', due(at(21, 0), { graceMin: 15 }).map((x) => x.id), ['weekly'])

  // ---- 形状与上限 ----
  writePlan({ nope: 1 })
  check('坏形状：返回空', due(at(8, 40), { graceMin: 15 }), [])
  check('坏形状留痕', notes.some((m) => m.includes('plan-bad-shape')), true)
  writePlan([
    { id: 'a', at: '08:40', why: '1' },
    { id: 'b', at: '08:40', why: '2' },
    { id: 'c', at: '08:40', why: '3' },
    { id: 'd', at: '08:40', why: '4' },
  ])
  notes.length = 0
  check('超过上限只认前三条', due(at(8, 40), { graceMin: 15 }).map((x) => x.id), ['a', 'b', 'c'])
  check('超过上限留痕', notes.some((m) => m.includes('plan-too-many')), true)

  // ---- 唤醒额度读数 ----
  check('wakes：按成员键读', parseWakeCounts({ testfish: { hourCount: 3, dayCount: 9 } }, 'testfish'), { hour: 3, day: 9 })
  check('wakes：兼容旧平铺格式', parseWakeCounts({ hourCount: 1, dayCount: 2 }, 'testfish'), { hour: 1, day: 2 })
  check('wakes：文件里没有这条鱼', parseWakeCounts({ other: { hourCount: 5 } }, 'testfish'), { hour: 0, day: 0 })
  const todayStr = new Date(2026, 10, 13).toDateString()
  check('全局合计：只加今天', sumWakesToday({ a: { dayStart: todayStr, dayCount: 4 }, b: { dayStart: 'Mon Nov 12 2026', dayCount: 100 } }, todayStr), 4)
  check('全局合计：多成员相加', sumWakesToday({ a: { dayStart: todayStr, dayCount: 4 }, b: { dayStart: todayStr, dayCount: 2 } }, todayStr), 6)

  // ---- 递话措辞 ----
  const text = planDeliveryText({ key: 'morning', tag: 'plan=morning', itemWhy: '读账', by: 'self' })
  check('自执行的闹钟写"自己的闹钟"', text.startsWith('自己的闹钟'), true)
  check('巡守递话写"巡守递话"', planDeliveryText({ key: 'm', tag: 't', itemWhy: '', by: 'watch' }).startsWith('巡守递话'), true)

  // ---- 滞后要念进句子（2026-11-27 LeeaCP：账上 lag=332s，递到面前只写"到点了"）----
  const late = planDeliveryText({ key: 'morning', tag: 'plan=morning at=08:00', itemWhy: '', by: 'self', lagSec: 332 })
  check('晚 5 分 32 秒写进句子', late.includes('晚了 5 分 32 秒'), true)
  check('机器字段 lag=Ns 也在同一句', late.includes('lag=332s'), true)
  check('一分钟以内不念', planDeliveryText({ key: 'm', tag: 't', itemWhy: '', by: 'self', lagSec: 45 }).includes('晚了'), false)
  check('刚好一分钟开始念', planDeliveryText({ key: 'm', tag: 't', itemWhy: '', by: 'self', lagSec: 60 }).includes('晚了 1 分（lag=60s）'), true)
  check('半小时写成 30 分', planDeliveryText({ key: 'm', tag: 't', itemWhy: '', by: 'self', lagSec: 1800 }).includes('晚了 30 分（lag=1800s）'), true)
  check('lag 读不到就不念', planDeliveryText({ key: 'm', tag: 't', itemWhy: '', by: 'self', lagSec: null }).includes('晚了'), false)
  check('公共记录那版也念', planDeliveryPublicText({ key: 'm', tag: 't', by: 'self', lagSec: 90 }).includes('晚了 1 分 30 秒（lag=90s）'), true)
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log(`\n合计：${pass + fail} 项，PASS ${pass}，FAIL ${fail}`)
if (fail > 0) process.exit(1)
