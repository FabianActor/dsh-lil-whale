#!/usr/bin/env node
// 日志轮转（2026-11-14 起；2026-11-19 r390 修两处，fi-0005）：
//   1. 扫描时跳过"已经切下来的份"（`<base>.YYYYMMDD-HHMMSS.log`），否则每小时会把同一份再 rename 一次，
//      名字一路往后接，而且"同类只留 3 份"永远数不到它们。
//   2. 轮转与丢弃各落一行账到 `<池>\state\rotate.log`——巡守是 detached 起的，stdout 没人看，
//      "转了/删了"不能只打在虚空里（判据：删要落账，日志也是证据）。
//
// 为什么要它：日志都是一行一行追加的，谁也不负责收；按现在的节奏，一个月就能上到上百 MB。
// 切法：plugin.log → plugin.20261114-164500.log（同一秒再切会有重名，加序号兜底）。
// 谁跑它：巡守进程每小时起一次（`watchmanTick` 里的 maybeRotateLogs），也可以手动跑。
//
// 用法：
//   node scripts\rotate-logs.mjs                 真转（默认扫池/各鱼家/应用日志目录）
//   node scripts\rotate-logs.mjs --dry-run       只看会转什么、会删什么，不写账
//   node scripts\rotate-logs.mjs --dir <目录>    只扫给定目录（测试用；可重复）
//   node scripts\rotate-logs.mjs --state-dir <目录>  账本放哪（默认 <池>\state）
import { readdirSync, statSync, renameSync, unlinkSync, readFileSync, existsSync, appendFileSync } from 'node:fs'
import { join, dirname, basename, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url)) // <app>\scripts
const APP = dirname(HERE)                            // <app>
const POND_BY_CODE = dirname(APP)                    // 按脚本位置推的鱼塘根
const MAX_BYTES = 1024 * 1024
const KEEP = 3
const DRY = process.argv.includes('--dry-run')

// 已经切下来的份：<base>.<YYYYMMDD-HHMMSS>[-n].log
const ROTATED_RE = /\.\d{8}-\d{6}(?:-\d+)?\.log$/

function argValue(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null
}

function argValues(name) {
  const out = []
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === name && i + 1 < process.argv.length) out.push(process.argv[i + 1])
  }
  return out
}

// 2026-11-16 r195：日志在哪儿，不能只按"脚本被放在哪"推。
// 写日志的插件读 lil-whale.config.json（或 LIL_WHALE_CONFIG）；自定义布局时两套推导会分叉，
// 轮转就永远扫不到真正在长的日志（第三方装机实测 P6）。配置读得到就按配置，读不到才退回按位置推。
function rootsFromConfig() {
  const file = process.env.LIL_WHALE_CONFIG || join(APP, 'lil-whale.config.json')
  if (!existsSync(file)) return null
  try {
    const cfg = JSON.parse(readFileSync(file, 'utf8'))
    const poolDir = cfg.poolDir || (cfg.selfHome ? resolve(cfg.selfHome, '..', '..', 'pool') : null)
    if (!poolDir) return null
    const membersFile = cfg.membersFile || join(poolDir, 'members.json')
    const homes = []
    try {
      const roster = JSON.parse(readFileSync(membersFile, 'utf8'))
      for (const m of Object.values(roster?.members ?? {})) {
        if (m?.home) homes.push(m.home)
      }
    } catch {
      // 名册读不到就只扫 pool，不影响轮转
    }
    return { pond: resolve(poolDir, '..'), poolDir: resolve(poolDir), homes }
  } catch {
    return null
  }
}

const cfgRoots = rootsFromConfig()
const POND = cfgRoots?.pond ?? POND_BY_CODE
const POOL = cfgRoots?.poolDir ?? join(POND, 'pool')
const explicitDirs = argValues('--dir').map((d) => resolve(d))
const STATE_DIR = resolve(argValue('--state-dir') ?? join(POOL, 'state'))
const LEDGER = join(STATE_DIR, 'rotate.log')

function listLogs(dir) {
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith('.log') && !ROTATED_RE.test(n))
      .map((n) => join(dir, n))
  } catch {
    return []
  }
}

function homes() {
  if (cfgRoots) return cfgRoots.homes
  try {
    return readdirSync(join(POND, 'homes')).map((n) => join(POND, 'homes', n))
  } catch {
    return []
  }
}

const targets = explicitDirs.length
  ? explicitDirs.flatMap((d) => listLogs(d))
  : [
      ...listLogs(join(POOL, 'group')),
      ...listLogs(join(POOL, 'state')),
      ...listLogs(join(POOL, 'state', 'runs')),
      ...listLogs(join(POOL, 'state', 'usage')),
      ...listLogs(join(APP, 'logs')),
      ...homes().flatMap((home) => listLogs(join(home, 'logs'))),
    ]

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function localTs(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function rel(p) {
  return p.startsWith(POND + '\\') || p.startsWith(POND + '/') ? p.slice(POND.length + 1) : p
}

// r391（fi-0005 小鱼丸建议）：轮转/丢弃两行各带一个内容指纹 12 位——删掉的是唯一一份时，
// 事后想问“丢的是哪一版”，只有名字不够；与“引用要连 size+hash 一起抄”同一句判据。
function hash12(file) {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12)
  } catch {
    return 'unknown'
  }
}

const lines = []
function account(level, text) {
  lines.push(`${localTs(new Date())} | ${level} | ${text}`)
}

function flushLedger() {
  if (DRY || lines.length === 0) return
  try {
    appendFileSync(LEDGER, lines.join('\n') + '\n', 'utf8')
  } catch (error) {
    // 账本自己写不进去，只能打在 stdout（巡守那边是 ignore，但至少手动跑时能看见）
    console.log(`ledger-failed ${rel(LEDGER)} why=${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 120)}`)
  }
}

const scannedDirs = new Set()
for (const d of explicitDirs.length
  ? explicitDirs
  : [join(POOL, 'group'), join(POOL, 'state'), join(POOL, 'state', 'runs'), join(POOL, 'state', 'usage'), join(APP, 'logs'), ...homes().map((h) => join(h, 'logs'))]) {
  scannedDirs.add(d)
}

let rotated = 0
let dropped = 0
let failed = 0
for (const file of targets) {
  if (file === LEDGER) continue
  let st
  try {
    st = statSync(file)
  } catch {
    continue
  }
  if (!st.isFile() || st.size < MAX_BYTES) continue
  const dir = dirname(file)
  const base = basename(file, '.log')
  const ts = stamp(new Date())
  let dest = join(dir, `${base}.${ts}.log`)
  let n = 1
  while (true) {
    try {
      statSync(dest)
      dest = join(dir, `${base}.${ts}-${n++}.log`)
    } catch {
      break
    }
  }
  if (DRY) {
    console.log(`would-rotate ${rel(file)} (${(st.size / 1024).toFixed(0)} KB) -> ${basename(dest)}`)
    rotated++
    continue
  }
  let fromHash = 'unknown'
  try {
    fromHash = hash12(file)
  } catch {
    fromHash = 'unknown'
  }
  try {
    renameSync(file, dest)
    rotated++
    account('note', `note=log-rotate-rotated from=${rel(file)} bytes=${st.size} to=${basename(dest)} hash=${fromHash}`)
    console.log(`rotated ${rel(file)} (${(st.size / 1024).toFixed(0)} KB) -> ${basename(dest)}`)
  } catch (error) {
    failed++
    account('error', `note=log-rotate-failed from=${rel(file)} reason=${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 120)}`)
    console.log(`rotate-failed ${rel(file)} why=${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 120)}`)
    continue
  }
}

// 同类只留最近 KEEP 份：按目录把"切下来的份"按 base 分组，每组的第 KEEP+1 份起删掉。
// r390 起每次都会扫一遍（不只在新切了一份之后），这样历史上堆下来的也能落回 3 份。
for (const dir of scannedDirs) {
  let names
  try {
    names = readdirSync(dir)
  } catch {
    continue
  }
  const groups = new Map()
  for (const name of names) {
    const m = /^(.+)\.\d{8}-\d{6}(?:-\d+)?\.log$/.exec(name)
    if (!m) continue
    const group = groups.get(m[1]) ?? []
    group.push(join(dir, name))
    groups.set(m[1], group)
  }
  for (const [base, files] of groups) {
    let sorted
    try {
      sorted = files
        .map((f) => ({ f, mtimeMs: statSync(f).mtimeMs, bytes: statSync(f).size, hash: hash12(f) }))
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
    } catch {
      continue
    }
    for (const old of sorted.slice(KEEP)) {
      if (DRY) {
        console.log(`would-drop ${rel(old.f)}`)
        dropped++
        continue
      }
      try {
        unlinkSync(old.f)
        dropped++
        account('note', `note=log-rotate-dropped file=${rel(old.f)} bytes=${old.bytes} hash=${old.hash} base=${base}`)
        console.log(`dropped ${rel(old.f)}`)
      } catch (error) {
        failed++
        account('error', `note=log-rotate-drop-failed file=${rel(old.f)} reason=${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 120)}`)
        console.log(`drop-failed ${rel(old.f)} why=${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 120)}`)
      }
    }
  }
}

// 一行汇总：让"这一小时干了什么"不用逐行拼。
account('note', `note=log-rotate rotated=${rotated} dropped=${dropped} failed=${failed} scanned=${targets.length} roots=${explicitDirs.length ? 'args' : cfgRoots ? 'config' : 'code'} pid=${process.pid}`)
flushLedger()

console.log(
  `${DRY ? 'dry-run ' : ''}done rotated=${rotated} dropped=${dropped} failed=${failed} scanned=${targets.length} roots=${explicitDirs.length ? 'args' : cfgRoots ? 'config' : 'code'}${DRY ? '' : ' ledger=' + rel(LEDGER)}`,
)
