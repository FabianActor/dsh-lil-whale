// 睡眠状态的汇总视图（派生文件，不是判据）。
//
// 判据永远只有两份：`<鱼的家>\plan\sleep.json`（她自己定的作息）和
// `pool\state\sleep\<键>.json`（一次性睡眠 / 强制叫醒的痕迹）。
// 这个文件是"算完的结果"，给面板和体检读；任何时候都能从那两份重算出来。
//
// 为什么把它抽成模块：以前只有巡守每 60 秒写一次，所以"被叫醒"之后最长 60 秒里
// 面板还写着"勿扰"（小肥鱼 2026-11-15 00:03 抓到的三处不一致之一）。
// 现在改状态的人（fish.ps1 wake）自己顺手刷一次——同一个渲染函数，两个调用点，
// 不是两份实现（A.23：同一个投影只能有一个渲染器）。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { sleepStateOf, sleepLabel } from './sleep-core.js'

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** 纯计算：给一份 members + 读文件的两个回调，算出汇总（测试直接调这个）。 */
export function buildSleepStatus({ members = {}, prefOf, stateOf, now = new Date() }) {
  const out = { updatedAt: now.toISOString(), members: {} }
  for (const [key, m] of Object.entries(members)) {
    if (!m || m.kind !== 'fish') continue
    if (m.role === 'watcher') continue
    let raw = {}
    try {
      raw = (typeof stateOf === 'function' ? stateOf(key) : null) || {}
    } catch {
      raw = {}
    }
    let preference = null
    try {
      preference = typeof prefOf === 'function' ? prefOf(key) : null
    } catch {
      preference = null
    }
    const st = sleepStateOf(
      { oneOff: raw.oneOff ?? null, awakeUntil: raw.awakeUntil ?? null, preference },
      now,
    )
    out.members[key] = {
      sleeping: st.sleeping === true,
      source: st.source,
      untilAt: st.untilAt ?? null,
      label: sleepLabel(st),
      lastForced: raw.lastForced && typeof raw.lastForced === 'object' ? raw.lastForced : null,
    }
  }
  return out
}

/** 读真文件、重算、写回 pool\state\sleep-status.json。 */
export function refreshSleepStatus({ membersFile, poolStateDir, now = new Date() }) {
  const members = readJson(membersFile)?.members ?? {}
  const poolDir = dirname(poolStateDir)
  const homesDir = join(dirname(poolDir), 'homes')
  const homeOf = (key) => {
    const h = members?.[key]?.home
    return typeof h === 'string' && h !== '' ? h : join(homesDir, key)
  }
  const prefOf = (key) => readJson(join(homeOf(key), 'plan', 'sleep.json'))
  const stateOf = (key) => readJson(join(poolStateDir, 'sleep', key + '.json'))
  const out = buildSleepStatus({ members, prefOf, stateOf, now })
  try {
    mkdirSync(poolStateDir, { recursive: true })
    const body = JSON.stringify(out, null, 2) + '\n'
    writeFileSync(join(poolStateDir, 'sleep-status.json'), body, 'utf8')
  } catch {}
  return out
}
