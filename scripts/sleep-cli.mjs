// 睡觉相关的命令行入口（2026-11-14 建）。
//
// 为什么单独一个脚本：窗口/跨午夜/优先级这套判断只有 `sleep-core.js` 一份实现。
// `fish.ps1 wake`（家长强行叫醒）、`install.ps1`（给新鱼种默认作息）、`doctor` 都要用，
// 如果各自在 PowerShell 里再算一遍，迟早出现"面板说醒着、门却叫不醒"这种两边都自洽的错。
// 所以 PowerShell 只负责跑这个脚本，判断全在 JS 里。
//
// 用法：
//   node scripts/sleep-cli.mjs status <键>          打印这条鱼此刻的睡眠状态（JSON）
//   node scripts/sleep-cli.mjs wake <键> [原因...]  家长强行叫醒：只在真睡着时动状态（醒到本窗结束）
//   node scripts/sleep-cli.mjs seed <键>            给新鱼种一份默认作息（已有就不动）
//   node scripts/sleep-cli.mjs pref <键> <from> <to> 设置每日作息
// 退出码：0 成功；2 参数/名册问题（fish.ps1 会把 stderr 原样打出来）。

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { config } from '../plugin/dsh-lil-whale-group/lib/config.js'
import {
  sleepStateOf,
  sleepLabel,
  forceAwakeUntil,
  parseHm,
  DEFAULT_SLEEP_FROM,
  DEFAULT_SLEEP_TO,
} from '../plugin/dsh-lil-whale-group/lib/sleep-core.js'

const CFG = config()
const POOL_STATE = CFG.poolStateDir
const SLEEP_DIR = join(POOL_STATE, 'sleep')
const SLEEP_LOG = join(POOL_STATE, 'sleep.log')

function fail(message) {
  console.error(message)
  process.exit(2)
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

function sleepLog(result, why) {
  try {
    mkdirSync(POOL_STATE, { recursive: true })
    const d = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    appendFileSync(SLEEP_LOG, `${ts} | ${result} | ${why}\n`, 'utf8')
  } catch {}
}

/** 从名册里找一条鱼的家；名册读不到就按鱼塘布局推。 */
function homeOf(key) {
  const members = readJson(CFG.membersFile)?.members ?? {}
  const home = members?.[key]?.home
  if (typeof home === 'string' && home !== '') return home
  return join(CFG.poolDir, '..', 'homes', key)
}

function prefFileOf(key) {
  return join(homeOf(key), 'plan', 'sleep.json')
}

function stateFileOf(key) {
  return join(SLEEP_DIR, `${key}.json`)
}

function ensureMember(key) {
  const members = readJson(CFG.membersFile)?.members ?? {}
  if (!members?.[key]) fail(`名册里没有这条鱼：${key}`)
  if (members[key].kind !== 'fish') fail(`${key} 不是鱼（kind=${members[key].kind}），它不睡觉`)
  return members[key]
}

function statusOf(key) {
  const raw = readJson(stateFileOf(key)) ?? {}
  const pref = readJson(prefFileOf(key))
  const st = sleepStateOf({ oneOff: raw.oneOff ?? null, awakeUntil: raw.awakeUntil ?? null, preference: pref }, new Date())
  return { key, ...st, label: sleepLabel(st) }
}

const [command, key, ...rest] = process.argv.slice(2)
if (!command || !key) fail('用法：node scripts/sleep-cli.mjs <status|wake|seed|pref> <键> [参数…]')

if (command === 'status') {
  ensureMember(key)
  console.log(JSON.stringify(statusOf(key)))
} else if (command === 'wake') {
  ensureMember(key)
  const reason = rest.join(' ').trim()
  const pref = readJson(prefFileOf(key))
  const preference = pref && typeof pref === 'object' ? pref : { from: DEFAULT_SLEEP_FROM, to: DEFAULT_SLEEP_TO, enabled: true }
  const before = statusOf(key)
  if (!before.sleeping) {
    sleepLog('sleep-noop', `member=${key} why=not-sleeping by=fish.ps1`)
    console.log(JSON.stringify({ key, changed: false, message: '没在睡，不用叫醒' }))
  } else {
    const raw = readJson(stateFileOf(key)) ?? {}
    const afterClear = sleepStateOf({ oneOff: null, awakeUntil: null, preference }, new Date())
    const until = afterClear.sleeping ? forceAwakeUntil(preference, new Date()) : null
    const next = {
      ...raw,
      oneOff: null,
      awakeUntil: until,
      forcedBy: 'fish.ps1',
      updatedAt: new Date().toISOString(),
    }
    writeJson(stateFileOf(key), next)
    sleepLog('sleep-forced', `member=${key} awakeUntil=${until ?? ''} by=fish.ps1 reason=${reason.slice(0, 80)}`)
    console.log(JSON.stringify({
      key,
      changed: true,
      awakeUntil: until,
      label: until ? `醒到 ${new Date(until).toTimeString().slice(0, 5)}` : '醒了',
    }))
  }
} else if (command === 'seed') {
  ensureMember(key)
  const file = prefFileOf(key)
  if (existsSync(file)) {
    console.log(JSON.stringify({ key, created: false, file }))
  } else {
    writeJson(file, {
      from: DEFAULT_SLEEP_FROM,
      to: DEFAULT_SLEEP_TO,
      enabled: true,
      updatedAt: new Date().toISOString(),
      by: 'sleep-cli seed',
    })
    sleepLog('sleep-pref', `member=${key} from=${DEFAULT_SLEEP_FROM} to=${DEFAULT_SLEEP_TO} by=seed`)
    console.log(JSON.stringify({ key, created: true, file }))
  }
} else if (command === 'pref') {
  ensureMember(key)
  const [from, to] = rest
  const fromHm = parseHm(from ?? '')
  const toHm = parseHm(to ?? '')
  if (fromHm === null || toHm === null) fail('用法：pref <键> <from HH:MM> <to HH:MM>')
  if (fromHm === toHm) fail('from 和 to 不能一样')
  const duration = toHm > fromHm ? toHm - fromHm : 24 * 60 - fromHm + toHm
  if (duration > 14 * 60) fail('一天最多睡 14 小时')
  const file = prefFileOf(key)
  writeJson(file, { from, to, enabled: true, updatedAt: new Date().toISOString(), by: 'sleep-cli pref' })
  sleepLog('sleep-pref', `member=${key} from=${from} to=${to} by=sleep-cli`)
  console.log(JSON.stringify({ key, from, to, file }))
} else {
  fail(`不认识的命令：${command}（只认 status / wake / seed / pref）`)
}
