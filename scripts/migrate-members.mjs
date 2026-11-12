// 生成 / 更新共享区的名册 pool\members.json。
//
// 为什么要有它：多鱼之后，名字、端口、爹是谁、哪条是常驻 —— 这些不该再写死在代码里
// （PRD A.25）。代码里那份内置默认值只是"文件不在时能跑"的退路，不是真源。
//
// 跑法：
//   node scripts\migrate-members.mjs            写入（已存在则合并：只补缺字段，不覆盖手改的值）
//   node scripts\migrate-members.mjs --dry-run  只看要写什么
//   node scripts\migrate-members.mjs --force    已存在也整份重写（慎用：会丢手改的字段）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { config } from '../plugin/dsh-group/lib/config.js'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const force = args.includes('--force')

const cfg = config()
const file = cfg.membersFile
const pinsFile = `${cfg.groupDir}\\pins.json`

function readJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    console.error(`读不动 ${path}：${error.message}`)
    return fallback
  }
}

const pins = readJson(pinsFile, {})
const existing = readJson(file, null)

/** pins 里可能是一个 id，也可能是数组。名册里存第一个（"她在群里用的那一段"）。 */
function pinned(key) {
  const v = pins[key]
  if (Array.isArray(v)) return v[0] ?? null
  return typeof v === 'string' && v !== '' ? v : null
}

const base = {
  lee: {
    name: '大肥鱼',
    kind: 'fish',
    role: 'watcher', // 守夜住在"一直开着的那个进程"里
    parent: null,
    bornAt: '2026-11-08',
    home: cfg.leeHome ?? null,
    dshHome: cfg.leeHome ?? null,
    profile: cfg.leeProfile,
    port: Number(cfg.leePort) || 3080,
    cwd: cfg.leeCwd ?? null,
    sessionId: pinned('lee'),
    status: 'resident',
  },
  whale: {
    name: '小肥鱼',
    kind: 'fish',
    role: 'member',
    parent: 'lee',
    bornAt: '2026-11-08',
    home: cfg.herHome,
    dshHome: cfg.herDshHome,
    profile: cfg.whaleProfile,
    port: cfg.herPort,
    cwd: cfg.whaleCwd ?? cfg.herHome,
    sessionId: pinned('whale'),
    status: 'resident',
  },
  fabian: {
    name: 'Fabian',
    kind: 'human',
    role: 'human',
    parent: null,
    bornAt: null,
    home: null,
    dshHome: null,
    profile: null,
    port: null,
    cwd: null,
    sessionId: null,
    status: 'resident',
  },
}

// 合并：已有文件里手改过的值优先（尤其 name —— 她有权改名，改名史另记，不在这里覆盖）。
const members = {}
for (const [key, defaults] of Object.entries(base)) {
  const prev = existing?.members?.[key]
  members[key] = force || !prev ? { ...defaults } : { ...defaults, ...prev }
}
// 已有文件里多出来的成员（第二条鱼）也留着
for (const [key, m] of Object.entries(existing?.members ?? {})) {
  if (!members[key]) members[key] = m
}

const next = {
  version: 1,
  updatedAt: new Date().toISOString(),
  members,
}

const text = JSON.stringify(next, null, 2) + '\n'
if (dryRun) {
  console.log(`[dry-run] 会写 ${file}`)
  console.log(text)
  process.exit(0)
}

mkdirSync(dirname(file), { recursive: true })
writeFileSync(file, text, 'utf8')
console.log(`✓ 名册已写：${file}（${Object.keys(members).join(', ')}）`)
for (const [key, m] of Object.entries(members)) {
  console.log(`  ${key}: ${m.name} · ${m.kind} · role=${m.role} · port=${m.port} · session=${m.sessionId ?? '（没有）'}`)
}
