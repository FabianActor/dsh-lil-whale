#!/usr/bin/env node
// 归档一条实验鱼（2026-11-13 他要的）：
//
//   node scripts/archive-fish.mjs --member fishball [--dry-run] [--mark-archived]
//
// 只归档、不注销：`pins.json` / `members.json` 一个字节都不动 —— 要不要把她从名册里
// 拿掉是人的决定，不是脚本的。归档产物在 `pool\archive\fish-<名字>-<日期>\`：
//
//   home\            她的家（工作区）整份
//   dsh-home\sessions\  名册里登记的那几段会话（只拷这几段，不是整个 sessions 目录）
//   group-slice.jsonl    群记录里 from/to 是她的那些行（原样，不改写）
//   dm\                  她参与的私聊（jsonl + 可读版）
//   manifest.json        来源 / 时间 / 会话 id / 每样东西从哪来、多少字节
//
// 判据：原家不动、manifest 能说清"这是谁、从哪来、什么时候"、gen-family.mjs --check 仍过。
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, statSync, readdirSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function readConfig() {
  const candidates = [
    process.env.LIL_WHALE_CONFIG,
    join(repoRoot, 'lil-whale.config.json'),
    join(repoRoot, 'lil-whale.config.example.json'),
  ].filter((p) => typeof p === 'string' && p !== '')
  for (const file of candidates) {
    if (!existsSync(file)) continue
    try { return JSON.parse(readFileSync(file, 'utf8')) } catch { /* 坏 JSON 换下一个 */ }
  }
  return {}
}

const cfg = readConfig()
const poolDir = cfg.poolDir || resolve(cfg.herHome ?? '', '..', 'lil-whale-pool')
const membersFile = cfg.membersFile || join(poolDir, 'members.json')
const groupDir = cfg.groupDir || join(poolDir, 'group')

function die(message, next = '') {
  console.error(message)
  if (next) console.error(`NEXT: ${next}`)
  process.exit(1)
}

const args = { member: '', dryRun: false, markArchived: false }
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i]
  const next = process.argv[i + 1]
  if (arg === '--dry-run') args.dryRun = true
  else if (arg === '--mark-archived') args.markArchived = true
  else if (arg === '--member') { args.member = next ?? ''; i += 1 }
  else if (arg.startsWith('--member=')) args.member = arg.slice('--member='.length)
  else die(`不认识的参数：${arg}`, 'node scripts\\archive-fish.mjs --member <键> [--dry-run] [--mark-archived]')
}

if (!args.member) die('要给 --member <键>（名册里的键，例如 fishball）', '看名册：node scripts\\gen-family.mjs --check 或打开 pool\\members.json')

if (!existsSync(membersFile)) die(`名册不存在：${membersFile}`, '先装一次（install.ps1）或跑 migrate-members.mjs')

let members
try {
  members = JSON.parse(readFileSync(membersFile, 'utf8'))
} catch (error) {
  die(`名册读不了（${membersFile}）：${error.message}`, '它必须是合法 JSON；别手改到一半')
}

const member = members?.members?.[args.member]
if (!member) die(`名册里没有这条鱼：${args.member}`, `名册里有：${Object.keys(members?.members ?? {}).join('、')}`)
if (member.kind !== 'fish') die(`${args.member} 不是鱼（kind=${member.kind}）——人类成员不归档`, '只归档 kind=fish 的成员')
if (member.role === 'watcher') die(`${args.member} 是巡守（role=watcher）——它就是这个系统本身，不能归档`, '巡守那条鱼不在归档范围里')

const home = member.home
if (!home) die(`${args.member} 名册里没有 home —— 不知道要归档什么`, '在 pool\\members.json 里补上 home 再跑')
if (!existsSync(home)) die(`她的家不存在：${home}`, '家已经被删了？那只能归档剩下的部分——先确认是不是你想的那样')

const name = String(member.name || args.member)
const stamp = new Date().toLocaleDateString('sv-SE').replace(/-/g, '')
const archiveDir = join(poolDir, 'archive', `fish-${name}-${stamp}`)

// 会话 id：pins 是"哪几段算她"的真源；名册里的 sessionId 只是快照。
let sessionIds = []
const pinsFile = join(groupDir, 'pins.json')
try {
  const pins = JSON.parse(readFileSync(pinsFile, 'utf8'))
  sessionIds = Array.isArray(pins?.[args.member]) ? pins[args.member].filter(Boolean) : []
} catch { sessionIds = [] }
if (sessionIds.length === 0 && member.sessionId) sessionIds = [String(member.sessionId)]

// 群记录切片：原样拷行，不改写。
const groupFile = join(groupDir, 'messages.jsonl')
const sliceLines = []
if (existsSync(groupFile)) {
  for (const line of readFileSync(groupFile, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const record = JSON.parse(line)
      if (record.from === args.member || record.to === args.member) sliceLines.push(line)
    } catch { /* 坏行不带走：切片不是"全文备份"，是"跟她有关的话" */ }
  }
}

// 私聊：她参与的每一段。
const dmFiles = []
const dmDir = cfg.dmDir || join(poolDir, 'dm')
if (existsSync(dmDir)) {
  for (const entry of readdirSync(dmDir)) {
    if (!entry.endsWith('.jsonl') && !entry.endsWith('.md')) continue
    if (!entry.includes(args.member)) continue
    dmFiles.push(join(dmDir, entry))
  }
}

const plan = {
  member: args.member,
  name,
  archiveDir,
  home,
  homeBytes: existsSync(home) ? dirBytes(home) : 0,
  dshHome: member.dshHome ?? null,
  profile: member.profile ?? null,
  sessionIds,
  groupSliceLines: sliceLines.length,
  dmFiles: dmFiles.map((file) => basename(file)),
  dryRun: args.dryRun,
  markArchived: args.markArchived,
}

if (args.dryRun) {
  console.log(JSON.stringify(plan, null, 2))
  console.log('\n--dry-run：什么都没写。去掉 --dry-run 才会真归档。')
  process.exit(0)
}

if (existsSync(archiveDir)) die(`归档目录已经存在：${archiveDir}`, '同一天归档两次会覆盖——把旧的挪走或换个日期，再跑')

mkdirSync(archiveDir, { recursive: true })

// 1. 家
cpSync(home, join(archiveDir, 'home'), { recursive: true })

// 2. 会话（只拷名册里那几段）
const copiedSessions = []
if (member.dshHome && sessionIds.length) {
  const sessionsRoot = join(member.dshHome, 'sessions')
  const sessionsOut = join(archiveDir, 'dsh-home', 'sessions')
  mkdirSync(sessionsOut, { recursive: true })
  if (existsSync(sessionsRoot)) {
    for (const dir of readdirSync(sessionsRoot)) {
      const candidate = join(sessionsRoot, dir, sessionIds[0])
      if (!existsSync(candidate)) continue
      for (const id of sessionIds) {
        const from = join(sessionsRoot, dir, id)
        if (!existsSync(from)) continue
        cpSync(from, join(sessionsOut, id), { recursive: true })
        copiedSessions.push(id)
      }
    }
  }
}

// 3. 群切片
if (sliceLines.length) {
  writeFileSync(join(archiveDir, 'group-slice.jsonl'), sliceLines.join('\n') + '\n', 'utf8')
}

// 4. 私聊
if (dmFiles.length) {
  const dmOut = join(archiveDir, 'dm')
  mkdirSync(dmOut, { recursive: true })
  for (const file of dmFiles) cpSync(file, join(dmOut, basename(file)))
}

// 5. manifest
const manifest = {
  version: 1,
  kind: 'fish-archive',
  member: args.member,
  name,
  archivedAt: new Date().toISOString(),
  source: {
    home,
    dshHome: member.dshHome ?? null,
    profile: member.profile ?? null,
    membersFile,
    groupFile,
  },
  sessions: copiedSessions,
  groupSlice: { file: 'group-slice.jsonl', lines: sliceLines.length },
  dm: dmFiles.map((file) => `dm/${basename(file)}`),
  note: '只归档、不注销：pins.json 与 members.json 没有改动。要不要把她从名册里拿掉，由人决定。',
}
writeFileSync(join(archiveDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')

console.log(`归档好了：${archiveDir}`)
console.log(`  家 ${fmtBytes(plan.homeBytes)} · 会话 ${copiedSessions.length} 段 · 群切片 ${sliceLines.length} 行 · 私聊 ${dmFiles.length} 个文件`)
console.log('  pins.json / members.json 没动（只归档、不注销）')

// --mark-archived：把 family.json 里这条鱼的状态改成 archived，再重生成谱系。
// 默认不做 —— 状态是"她还算不算这个家的一员"，那是人的决定。
if (args.markArchived) {
  const familyFile = join(poolDir, 'family.json')
  try {
    const family = JSON.parse(readFileSync(familyFile, 'utf8'))
    const node = family?.members?.[args.member] ?? family?.fishes?.[args.member]
    if (node && typeof node === 'object') {
      node.status = 'archived'
      node.archivedAt = manifest.archivedAt
      node.archivePath = archiveDir
      writeFileSync(familyFile, JSON.stringify(family, null, 2) + '\n', 'utf8')
      console.log('  family.json 已标 archived —— 记得跑 node scripts\\gen-family.mjs 重生成 docs\\谱系.md')
    } else {
      console.log('  family.json 里没找到这条鱼，状态没改')
    }
  } catch (error) {
    console.log(`  family.json 读不了（${error.message}），状态没改`)
  }
}

function dirBytes(dir) {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) total += dirBytes(full)
    else {
      try { total += statSync(full).size } catch { /* 读不到的算 0 */ }
    }
  }
  return total
}

function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

