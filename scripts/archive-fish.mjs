#!/usr/bin/env node
// 归档一条鱼（2026-11-13 他要的；2026-11-15 去掉「实验鱼」这个说法）：
//
//   node scripts/archive-fish.mjs --member fishball [--dry-run] [--mark-archived] [--subtree]
//
// --subtree：先把它的孩子（递归）归档掉，再归档它自己 —— 孩子跟着家长一起走。
//
// 只归档、不注销：`pins.json` / `members.json` 一个字节都不动 —— 要不要把她从名册里
// 拿掉是人的决定，不是脚本的。
//
// 产物在 `pool\archive\fish-<名字>-<日期>\`：
//
//   home\                她的家（工作区）整份
//   dsh-home\sessions\   名册里登记的那几段会话（只拷这几段，不是整个 sessions 目录）
//   group-slice.jsonl    群记录里 from/to 是她的那些行（原样，不改写）
//   dm\                  她参与的私聊（jsonl + 可读版）
//   manifest.json        静态清单：来源 / 时间 / 会话 id / 每样东西从哪来、多少字节、sha256
//   manifest.jsonl       事件流：archive-start → moved… → archive-done（只增不改）
//
// 为什么要有事件流（2026-11-19 r354）：一份状态文档回答不了"做到哪一步了"。拷到一半被
// 打断时，纸和成品长得一样。事件流让重跑可以「以清单为准、不重扫目录」，也让"记录和磁盘
// 对不上"变成一个能报警的事实，而不是被脚本悄悄修掉。
//
// 判据：原家不动、重跑幂等（补搬缺的、不重写已搬的）、manifest 能说清"这是谁、从哪来、
// 什么时候、搬完了没有"、gen-family.mjs --check 仍过。
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, cpSync, statSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve, dirname, basename } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadConfigOrExit } from './lib/config-path.mjs'
import {
  EVENTS_FILE,
  MANIFEST_FILE,
  startEvent,
  movedEvent,
  doneEvent,
  archiveEventLine,
  parseArchiveEvents,
  replayPlanOf,
  summarizeReplay,
  hashOfPath,
  dirBytes,
} from './lib/archive-manifest-core.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// 配置三态见 lib/config-path.mjs（r242）：env 给了但文件不在时退出，不落回真配置。
const cfg = loadConfigOrExit({ repoRoot })
const poolDir = cfg.poolDir || resolve(cfg.herHome ?? '', '..', 'lil-whale-pool')
const membersFile = cfg.membersFile || join(poolDir, 'members.json')
const groupDir = cfg.groupDir || join(poolDir, 'group')

function die(message, next = '') {
  console.error(message)
  if (next) console.error(`NEXT: ${next}`)
  process.exit(1)
}

const args = { member: '', dryRun: false, markArchived: false, subtree: false }
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i]
  const next = process.argv[i + 1]
  if (arg === '--dry-run') args.dryRun = true
  else if (arg === '--mark-archived') args.markArchived = true
  else if (arg === '--subtree') args.subtree = true
  else if (arg === '--member') { args.member = next ?? ''; i += 1 }
  else if (arg.startsWith('--member=')) args.member = arg.slice('--member='.length)
  else die(`不认识的参数：${arg}`, 'node scripts\\archive-fish.mjs --member <键> [--dry-run] [--mark-archived] [--subtree]')
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

// --subtree：孩子先归档（递归收集后代），再归档自己。
const subtreeChildren = []
if (args.subtree) {
  const parentOf = (key) => (members?.members?.[key]?.parent ?? null)
  const walk = (key) => {
    for (const childKey of Object.keys(members?.members ?? {})) {
      if (parentOf(childKey) !== key) continue
      walk(childKey)
      subtreeChildren.push(childKey)
    }
  }
  walk(args.member)
  if (subtreeChildren.length === 0) console.log(`（${args.member} 名下没有孩子，--subtree 只归档它自己）`)
  for (const childKey of subtreeChildren) {
    const childArgs = [fileURLToPath(import.meta.url), '--member', childKey, '--mark-archived']
    if (args.dryRun) childArgs.push('--dry-run')
    console.log(`--- 先归档子代 ${childKey} ---`)
    execFileSync(process.execPath, childArgs, { stdio: 'inherit' })
  }
}

const name = String(member.name || args.member)
const stamp = new Date().toLocaleDateString('sv-SE').replace(/-/g, '')
const archiveDir = join(poolDir, 'archive', `fish-${name}-${stamp}`)
const EVENTS_PATH = join(archiveDir, EVENTS_FILE)
const MANIFEST_PATH = join(archiveDir, MANIFEST_FILE)

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

function nowIso() {
  return new Date().toISOString()
}

function itemsOf() {
  const items = [{ name: 'home', src: home, kind: 'home' }]
  if (member.dshHome && sessionIds.length) items.push({ name: 'dsh-home', src: join(member.dshHome, 'sessions'), kind: 'sessions' })
  if (sliceLines.length) items.push({ name: 'group-slice.jsonl', src: groupFile, kind: 'slice' })
  if (dmFiles.length) items.push({ name: 'dm', src: dmDir, kind: 'dm' })
  return items
}

function copyItem(item) {
  mkdirSync(archiveDir, { recursive: true })
  if (item.kind === 'home') {
    cpSync(item.src, join(archiveDir, 'home'), { recursive: true })
    return
  }
  if (item.kind === 'sessions') {
    const sessionsRoot = item.src
    const sessionsOut = join(archiveDir, 'dsh-home', 'sessions')
    mkdirSync(sessionsOut, { recursive: true })
    if (!existsSync(sessionsRoot)) throw new Error(`sessions 目录不在：${sessionsRoot}`)
    for (const dir of readdirSync(sessionsRoot)) {
      for (const id of sessionIds) {
        const from = join(sessionsRoot, dir, id)
        if (!existsSync(from)) continue
        cpSync(from, join(sessionsOut, id), { recursive: true })
      }
    }
    return
  }
  if (item.kind === 'slice') {
    writeFileSync(join(archiveDir, 'group-slice.jsonl'), sliceLines.join('\n') + '\n', 'utf8')
    return
  }
  if (item.kind === 'dm') {
    const dmOut = join(archiveDir, 'dm')
    mkdirSync(dmOut, { recursive: true })
    for (const dmFile of dmFiles) cpSync(dmFile, join(dmOut, basename(dmFile)))
    return
  }
  throw new Error(`不认识的归档条目：${item.name}`)
}

function itemByName(itemName, items) {
  return items.find((item) => item.name === itemName) ?? null
}

function appendEvent(event) {
  appendFileSync(EVENTS_PATH, archiveEventLine(event) + '\n', 'utf8')
}

function eventsLineCount() {
  if (!existsSync(EVENTS_PATH)) return 0
  return readFileSync(EVENTS_PATH, 'utf8').split(/\r?\n/).filter((line) => line.trim()).length
}

function writeManifest(files, status, extra = {}) {
  const manifest = {
    version: 2,
    kind: 'fish-archive',
    member: args.member,
    name,
    archivedAt: nowIso(),
    status,
    source: {
      home,
      dshHome: member.dshHome ?? null,
      profile: member.profile ?? null,
      membersFile,
      groupFile,
    },
    sessions: sessionIds.slice(),
    groupSlice: { file: 'group-slice.jsonl', lines: sliceLines.length },
    dm: dmFiles.map((dmFile) => `dm/${basename(dmFile)}`),
    files,
    events: { file: EVENTS_FILE, lines: eventsLineCount() },
    note: '只归档、不注销：pins.json 与 members.json 没有改动。要不要把她从名册里拿掉，由人决定。',
    subtree: args.subtree ? subtreeChildren : undefined,
    ...extra,
  }
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  return manifest
}

function copyOfSessions() {
  // 只用于清单可读性：实际拷了几段在 dsh-home\sessions 下
  const out = join(archiveDir, 'dsh-home', 'sessions')
  if (!existsSync(out)) return []
  return readdirSync(out)
}

function dirBytesSafe(target) {
  try { return dirBytes(target) } catch { return 0 }
}

function markArchived() {
  // --mark-archived：清单写成 complete 之后才改状态（先有证据，再说"她不在这个家了"）。
  if (!args.markArchived) return
  const familyFile = join(poolDir, 'family.json')
  try {
    const family = JSON.parse(readFileSync(familyFile, 'utf8'))
    // gen-family.mjs 的节点在 family.nodes 下（早期版本写过 members/fishes，一起兼容）
    const node = family?.nodes?.[args.member] ?? family?.members?.[args.member] ?? family?.fishes?.[args.member]
    if (node && typeof node === 'object') {
      node.lifecycle = 'archived'
      node.archivedAt = nowIso()
      node.archivePath = archiveDir
      writeFileSync(familyFile, JSON.stringify(family, null, 2) + '\n', 'utf8')
      console.log('  family.json 已标 archived —— 记得跑 node scripts\\gen-family.mjs 重生成 docs\\detail\\鱼塘谱系.md')
    } else {
      console.log('  family.json 里没找到这条鱼，状态没改')
    }
  } catch (error) {
    console.log(`  family.json 读不了（${error.message}），状态没改`)
  }
}

const items = itemsOf()

// 归档目录已经存在 ⇒ 这是重跑：以事件流为准重放，不重扫目录。
if (existsSync(archiveDir)) {
  if (!existsSync(EVENTS_PATH)) {
    die(`归档目录已存在，但没有事件流：${archiveDir}`,
      '这是旧版（或手动放的）归档目录，脚本不自动重放——请人看一眼再决定：是补一份 manifest.jsonl，还是换个日期重来')
  }
  const hashOf = (itemName) => {
    const target = join(archiveDir, itemName)
    if (!existsSync(target)) return null
    try { return hashOfPath(target) } catch { return null }
  }
  let state = parseArchiveEvents(readFileSync(EVENTS_PATH, 'utf8').split(/\r?\n/))
  if (!state.start) die(`事件流里没有 archive-start：${EVENTS_PATH}`, '文件被改过？这份归档需要人看')
  let replay = replayPlanOf(state, hashOf)
  if (replay.mismatched.length) {
    die(`归档记录与磁盘对不上（不修，先报）：${summarizeReplay(replay)}`,
      'moved 说搬过了、盘上却不是那份：有人动过归档。别让脚本改记录——记录本身就是证据')
  }
  for (const file of replay.missing) {
    const item = itemByName(file.name, items)
    if (!item) die(`清单里有一件这次算不出来（源不在了？）：${file.name}`, '先确认她的家还在不在，再决定怎么补')
    console.log(`补搬：${file.name}`)
    copyItem(item)
    const target = join(archiveDir, file.name)
    appendEvent(movedEvent({ at: nowIso(), name: file.name, bytes: dirBytesSafe(target), sha256: hashOfPath(target) }))
  }
  state = parseArchiveEvents(readFileSync(EVENTS_PATH, 'utf8').split(/\r?\n/))
  replay = replayPlanOf(state, hashOf)
  if (replay.missing.length) die(`重放之后还有没搬完的：${summarizeReplay(replay)}`, '再跑一次；还不行就得人看')
  const replayedFiles = (state.start.files ?? []).map((file) => ({ name: file.name, src: file.src, sha256: hashOf(file.name) }))
  if (!state.done) appendEvent(doneEvent({ at: nowIso(), member: args.member }))
  writeManifest(replayedFiles, 'complete', { replayed: true, sessions: copyOfSessions() })
  console.log(`归档已重放完成：${archiveDir}`)
  markArchived()
  process.exit(0)
}

mkdirSync(archiveDir, { recursive: true })
appendEvent(startEvent({ at: nowIso(), member: args.member, name, archiveDir, files: items }))

const writtenFiles = []
let copyError = null
for (const item of items) {
  try {
    copyItem(item)
    const target = join(archiveDir, item.name)
    const hash = hashOfPath(target)
    appendEvent(movedEvent({ at: nowIso(), name: item.name, bytes: dirBytesSafe(target), sha256: hash }))
    writtenFiles.push({ name: item.name, src: item.src, sha256: hash, bytes: dirBytesSafe(target) })
  } catch (error) {
    appendEvent(movedEvent({ at: nowIso(), name: item.name, error: error.message }))
    copyError = { item: item.name, message: error.message }
    break
  }
}

if (copyError) {
  writeManifest(writtenFiles, 'partial', { error: copyError.message })
  die(`归档中途失败（${copyError.item}）：${copyError.message}`,
    '已经搬的部分留在原地、事件流里有记录；修好原因后重跑，脚本会接着补（不重扫、不改记录）')
}

appendEvent(doneEvent({ at: nowIso(), member: args.member }))
writeManifest(writtenFiles, 'complete')

console.log(`归档好了：${archiveDir}`)
console.log(`  家 ${fmtBytes(plan.homeBytes)} · 会话 ${sessionIds.length} 段 · 群切片 ${sliceLines.length} 行 · 私聊 ${dmFiles.length} 个文件`)
console.log('  pins.json / members.json 没动（只归档、不注销）')
console.log(`  清单：${MANIFEST_FILE} + ${EVENTS_FILE}（事件流，只增不改）`)

markArchived()

function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
