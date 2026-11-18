#!/usr/bin/env node
/**
 * presence 忙态判据（2026-11-19 r353）。
 *
 * 他报的 bug：LeeaCP 在回私聊时，群内显示「正在回复」、私聊显示「正在忙」。
 * 根因是心跳每 5 秒重写文件时只把 groupWakeAt 抄回来，wakeKind/wakeAt 被洗掉，
 * 读取端只剩「十分钟内从群叫醒过」这一条线索 ⇒ 所有鱼、所有时刻都会读成 group。
 *
 * 这个测试只测两份纯函数和接线，不碰真文件：
 *   1) mergeHeartbeat：心跳只改 status/at，别的字段原样留着；
 *   2) presenceReasonOf：dm / group / self 三种输入各自读对；
 *   3) 接线：写入端用 mergeHeartbeat，读取端用 presenceReasonOf，本进程覆盖不压 reason。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { presenceReasonOf, WAKE_REASON_TTL_MS } from '../plugin/dsh-lil-whale-group-ui/lib/presence-core.js'
import { mergeHeartbeat } from '../plugin/dsh-lil-whale-group/lib/presence-core.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const HOST_SRC = readFileSync(join(ROOT, 'plugin/dsh-lil-whale-group/lib/index.js'), 'utf8')
const UI_SRC = readFileSync(join(ROOT, 'plugin/dsh-lil-whale-group-ui/lib/index.js'), 'utf8')

let total = 0
let failed = 0
function ok(name, cond, detail = '') {
  total += 1
  if (cond) return
  failed += 1
  console.error(`xx ${name}${detail ? `：${detail}` : ''}`)
}
function eq(name, actual, expected) {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  ok(name, same, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}

// ── 1. mergeHeartbeat：心跳不能洗掉唤醒记号 ─────────────────────────────
const T = 1_000_000
const prev = {
  member: 'lee2',
  status: 'idle',
  at: T - 5000,
  wakeKind: 'dm',
  wakeAt: T - 1000,
  groupWakeAt: T - 90_000,
  futureField: 'keep-me',
}
const merged = mergeHeartbeat(prev, 'working', T + 5000, 'lee2')
eq('心跳保留 wakeKind', merged.wakeKind, 'dm')
eq('心跳保留 wakeAt', merged.wakeAt, T - 1000)
eq('心跳保留 groupWakeAt', merged.groupWakeAt, T - 90_000)
eq('心跳保留未知字段', merged.futureField, 'keep-me')
eq('心跳更新 status', merged.status, 'working')
eq('心跳更新 at', merged.at, T + 5000)
eq('心跳带上 member', merged.member, 'lee2')

const fromNull = mergeHeartbeat(null, 'idle', T, 'whale')
eq('没有旧文件时只写必要字段', fromNull, { member: 'whale', status: 'idle', at: T })
const badStatus = mergeHeartbeat({}, undefined, T, 'whale')
eq('status 不是字符串时按 idle 写', badStatus.status, 'idle')

// ── 2. presenceReasonOf：三种输入 → 三种结果 ───────────────────────────
const now = 10_000_000
eq('刚从私聊叫醒：dm', presenceReasonOf({ wakeKind: 'dm', wakeAt: now - 1000 }, now), 'dm')
eq('刚从群叫醒：group', presenceReasonOf({ wakeKind: 'group', wakeAt: now - 1000 }, now), 'group')
eq('有 wakeAt 没 wakeKind：只能当群（旧形状）', presenceReasonOf({ wakeAt: now - 1000 }, now), 'group')
eq('wakeAt 超过保鲜期：self', presenceReasonOf({ wakeKind: 'dm', wakeAt: now - WAKE_REASON_TTL_MS - 1 }, now), 'self')
eq('保鲜期边界（等于 TTL）仍算新鲜', presenceReasonOf({ wakeKind: 'dm', wakeAt: now - WAKE_REASON_TTL_MS }, now), 'dm')
eq('只有旧 groupWakeAt（老进程）：group', presenceReasonOf({ groupWakeAt: now - 1000 }, now), 'group')
eq('旧 groupWakeAt 过期：self', presenceReasonOf({ groupWakeAt: now - WAKE_REASON_TTL_MS - 1 }, now), 'self')
eq('空心跳：self', presenceReasonOf(null, now), 'self')
eq('dm 比旧 groupWakeAt 优先', presenceReasonOf({ wakeKind: 'dm', wakeAt: now - 1000, groupWakeAt: now - 2000 }, now), 'dm')

// ── 3. 接线 ─────────────────────────────────────────────────────────────
ok('写入端 import mergeHeartbeat', HOST_SRC.includes("from './presence-core.js'") && HOST_SRC.includes('mergeHeartbeat'))
ok('writePresence 用整条合并', HOST_SRC.includes('mergeHeartbeat(prev, agent?.status, Date.now(), member)'), '没找到 mergeHeartbeat(...) 调用')
ok('写入端不再手抄 groupWakeAt', !HOST_SRC.includes('const groupWakeAt = Number(prev?.groupWakeAt)'), '旧写法还在')
ok('读取端 import presenceReasonOf', UI_SRC.includes('presenceReasonOf'))
ok('读取端用 presenceReasonOf', UI_SRC.includes('reason: presenceReasonOf(beat, Date.now())'), '路由里没找到调用')
ok('本进程覆盖保留 reason', UI_SRC.includes('...(prev ?? {}), status: \'working\''), '覆盖逻辑没保留上一份 reason')

console.log(`test-presence-reason：合计 ${total}，PASS ${total - failed}，FAIL ${failed}`)
process.exit(failed === 0 ? 0 : 1)
