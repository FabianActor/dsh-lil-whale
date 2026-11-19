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
// 2026-11-19 r393（fi-0006 小鱼丸）：给了 `LIL_WHALE_CONFIG` 却读不到，过去是静默 return null、
// 接下来按脚本位置推——而脚本就在 `<鱼塘>\app\scripts` 里，回退恰好指向真鱼塘；现在照 gen-family 的口径：
// 给了就必须用，读不到就报错退出（exit 2），不再悄悄换一本账扫；没给也没配置才回退，并打一句人话。
function configFatal(message, next) {
  console.log('xx ' + message)
  console.log('NEXT: ' + next)
  process.exit(2)
}

function rootsFromConfig() {
  const explicit = String(process.env.LIL_WHALE_CONFIG ?? '').trim()
  const file = explicit || join(APP, 'lil-whale.config.json')
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    const code = error && error.code ? error.code : 'UNKNOWN'
    const why = code === 'ENOENT' ? '指向的文件不存在' : '读不出来（' + code + '）'
    if (explicit) {
      configFatal('LIL_WHALE_CONFIG ' + why + '：' + file, '把 LIL_WHALE_CONFIG 改成存在的文件，或直接不设它（不设时按脚本位置推；这里不会改读仓库里那份配置）')
    }
    if (code !== 'ENOENT') {
      configFatal('仓库里的 lil-whale.config.json ' + why + '：' + file, '修好或删掉这个文件；不会按脚本位置推一个可能不对的鱼塘')
    }
    return null
  }
  let cfg
  try {
    cfg = JSON.parse(raw)
  } catch {
    configFatal('配置文件不是有效 JSON：' + file, '修好它（或删掉，让脚本按位置推）')
  }
  const poolDir = cfg.poolDir || (cfg.selfHome ? resolve(cfg.selfHome, '..', '..', 'pool') : null)
  if (!poolDir) {
    configFatal('配置里没有 poolDir（也没有 selfHome 可以推）：' + file, '补上 poolDir，别让轮转猜鱼塘在哪')
  }
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
}

const cfgRoots = rootsFromConfig()
const POND = cfgRoots?.pond ?? POND_BY_CODE
if (!cfgRoots) {
  console.log('note: 没有配置（LIL_WHALE_CONFIG 未设，仓库里也没有 lil-whale.config.json），按脚本位置推鱼塘根：' + POND)
}
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

let rotated = 0
let dropped = 0
let failed = 0

const lines = []
function account(level, text) {
  lines.push(`${localTs(new Date())} | ${level} | ${text}`)
}

function flushLedger() {
  if (DRY || lines.length === 0) return true
  try {
    appendFileSync(LEDGER, lines.join('\n') + '\n', 'utf8')
    return true
  } catch (error) {
    // 账本写不进去也是这一轮失败：过去只在 stdout 打一行、退出码 0，看起来像成功（fi-0006）
    failed++
    console.log(`ledger-failed ${rel(LEDGER)} why=${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 120)}`)
    return false
  }
}

const scannedDirs = new Set()
for (const d of explicitDirs.length
  ? explicitDirs
  : [join(POOL, 'group'), join(POOL, 'state'), join(POOL, 'state', 'runs'), join(POOL, 'state', 'usage'), join(APP, 'logs'), ...homes().map((h) => join(h, 'logs'))]) {
  scannedDirs.add(d)
}

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

// 切下来的份名字里带着切下来的时刻 `<base>.<YYYYMMDD-HHMMSS>[-n].log`。
// r392（fi-0005 收尾，小鱼丸发现）：排序看名字里的时间戳，不看 mtime——mtime 会被 checkout / 复制 / 还原改写
// （她今天实测 lib\ 下三个文件 mtime 比最后一次提交晚 22 分钟），拿它判“谁更老”会把刚切下来的那份当成旧的删掉。
function nameStampOf(file) {
  const m = /\.(\d{8}-\d{6})(?:-(\d+))?\.log$/.exec(basename(file))
  return { stamp: m ? m[1] : '', seq: m && m[2] ? Number(m[2]) : 0 }
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
        .map((f) => ({ f, ...nameStampOf(f), bytes: statSync(f).size, hash: hash12(f) }))
        .sort((a, b) => (b.stamp === a.stamp ? b.seq - a.seq : b.stamp.localeCompare(a.stamp)))
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
const ledgerOk = flushLedger()

console.log(
  `${DRY ? 'dry-run ' : ''}done rotated=${rotated} dropped=${dropped} failed=${failed} scanned=${targets.length} roots=${explicitDirs.length ? 'args' : cfgRoots ? 'config' : 'code'}${DRY ? '' : ' ledger=' + rel(LEDGER)}`,
)

// 有失败（轮转/丢弃/账本写不进去）就非 0：巡守那边是 detached ignore，但手动跑与测试要看得出
process.exitCode = failed > 0 ? 1 : 0
