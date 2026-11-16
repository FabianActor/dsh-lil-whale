#!/usr/bin/env node
// 日志轮转（2026-11-14 起）：单个文件超过 MAX_BYTES 就切一份，同类只留 KEEP 份。
//
// 为什么要它：日志都是一行一行追加的，谁也不负责收；按现在的节奏，一个月就能上到上百 MB。
// 切法：plugin.log → plugin.20261114-164500.log（同一秒再切会有重名，加序号兜底）。
// 谁跑它：巡守进程每小时起一次（`watchmanTick` 里的 maybeRotateLogs），也可以手动跑。
//
// 用法：
//   node scripts\rotate-logs.mjs           真转
//   node scripts\rotate-logs.mjs --dry-run 只看会转什么
import { readdirSync, statSync, renameSync, unlinkSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname, basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url)) // <app>\scripts
const APP = dirname(HERE)                            // <app>
const POND_BY_CODE = dirname(APP)                    // 按脚本位置推的鱼塘根
const MAX_BYTES = 1024 * 1024
const KEEP = 3
const DRY = process.argv.includes('--dry-run')

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

function listLogs(dir) {
  try {
    return readdirSync(dir).filter((n) => n.endsWith('.log')).map((n) => join(dir, n))
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

const targets = [
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

function rel(p) {
  return p.startsWith(POND + '\\') || p.startsWith(POND + '/') ? p.slice(POND.length + 1) : p
}

let rotated = 0
let dropped = 0
for (const file of targets) {
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
  try {
    renameSync(file, dest)
    rotated++
    console.log(`rotated ${rel(file)} (${(st.size / 1024).toFixed(0)} KB) -> ${basename(dest)}`)
  } catch (error) {
    console.log(`rotate-failed ${rel(file)} why=${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 120)}`)
    continue
  }
  // 同类只留最近 KEEP 份
  const prefix = `${base}.`
  const olds = readdirSync(dir)
    .filter((n) => n.startsWith(prefix) && n.endsWith('.log'))
    .map((n) => join(dir, n))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  for (const old of olds.slice(KEEP)) {
    try {
      unlinkSync(old)
      dropped++
      console.log(`dropped ${rel(old)}`)
    } catch {
      /* 删不掉就算了，下次再来 */
    }
  }
}

console.log(`${DRY ? 'dry-run ' : ''}done rotated=${rotated} dropped=${dropped} scanned=${targets.length} roots=${cfgRoots ? 'config' : 'code'}`)
