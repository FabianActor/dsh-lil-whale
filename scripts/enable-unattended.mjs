#!/usr/bin/env node
/**
 * 把一条鱼改成「无人值守」：host 启动就 resume 会话、挂载 agent，不需要开浏览器窗。
 *
 *   node scripts\enable-unattended.mjs --member whale [--dry-run] [--force]
 *
 * 为什么需要它：端口通 ≠ 窗开着。会话要等客户端打开才挂载 agent；没有 agent，
 * 心跳没人写、叫醒没人接（2026-11-13 08:40 事故，见 PRD A.45）。
 * dsh 自带的办法是在 profile patch 里覆盖 `agent-loop` 行的 config：
 *
 *   - id: agent-loop
 *     name: "@deepseek-ai/dsh-agent-loop"
 *     config:
 *       agents:
 *         - id: <成员键>
 *           resumeSessionId: <pins.json 里那段会话>
 *           cwd: <她的工作区>
 *
 * 规矩：
 *   - 改 profile patch 会让长活进程**热重载**（工具会被抽走），所以端口开着时拒绝执行，
 *     必须先 `fish.ps1 down <键>`。
 *   - 只改这一块（用 marker 定位），重跑等于更新，不会叠加。
 *   - 会话 id 从 `pins.json` 现读（真源），不从名册快照读。
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConnection } from 'node:net'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MARK_BEGIN = '# ---- 无人值守（scripts/enable-unattended.mjs 维护，别手改） ----'
const MARK_END = '# ---- 无人值守结束 ----'

function die(message) {
  console.error(message)
  console.error('NEXT: ' + message.replace(/^NEXT:\s*/, ''))
  process.exit(1)
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function readConfig() {
  const candidates = [
    process.env.LIL_WHALE_CONFIG,
    join(REPO, 'lil-whale.config.json'),
    join(REPO, 'lil-whale.config.example.json'),
  ].filter(Boolean)
  for (const file of candidates) {
    if (!existsSync(file)) continue
    const json = readJson(file)
    if (json) return { file, json }
  }
  return die('NEXT: 找不到 lil-whale.config.json（或用 LIL_WHALE_CONFIG 指定）')
}

function argsOf(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      args[token.slice(2)] = next
      i++
    } else {
      args[token.slice(2)] = true
    }
  }
  return args
}

function portOpen(port) {
  return new Promise((done) => {
    if (!port) return done(false)
    const socket = createConnection({ host: '127.0.0.1', port })
    const settle = (value) => {
      socket.removeAllListeners()
      socket.destroy()
      done(value)
    }
    socket.setTimeout(700)
    socket.once('connect', () => settle(true))
    socket.once('timeout', () => settle(false))
    socket.once('error', () => settle(false))
  })
}

const args = argsOf(process.argv.slice(2))
const memberKey = typeof args.member === 'string' ? args.member : ''
if (!memberKey) die('NEXT: 用 --member <成员键> 指定是哪条鱼（例：--member whale）')

const { json: cfg } = readConfig()
const membersFile = cfg.membersFile || join(cfg.poolDir || '', 'members.json')
const pinsFile = cfg.pinsFile || join(cfg.groupDir || join(cfg.poolDir || '', 'group'), 'pins.json')
const members = readJson(membersFile)?.members ?? readJson(membersFile) ?? {}
const member = members?.[memberKey]
if (!member) die(`NEXT: 名册里没有 "${memberKey}"（${membersFile}）`)
if (member.kind === 'human') die(`NEXT: "${memberKey}" 是人，不是鱼`)

const dshHome = member.dshHome || ''
const profile = member.profile || memberKey
const port = Number(member.port) || 0
if (!dshHome) die(`NEXT: 名册里 "${memberKey}" 没有 dshHome`)
if (!existsSync(dshHome)) die(`NEXT: 她的 DSH_HOME 不存在：${dshHome}`)

const patchFile = join(dshHome, 'profiles', profile, 'cordis.patch.yml')
if (!existsSync(patchFile)) die(`NEXT: profile patch 不存在：${patchFile}`)

const pins = readJson(pinsFile) ?? {}
const sessions = Array.isArray(pins?.[memberKey]) ? pins[memberKey] : []
if (sessions.length === 0) die(`NEXT: pins.json 里 "${memberKey}" 没有会话 —— 先让她开一次窗、拿到会话 id 再入册`)
if (sessions.length > 1) die(`NEXT: pins.json 里 "${memberKey}" 有 ${sessions.length} 段会话，无人值守只能挂一段，先清到一段`)
const sessionId = String(sessions[0])
const cwd = member.home || member.cwd || ''
if (!cwd) die(`NEXT: 名册里 "${memberKey}" 没有 home/cwd`)

const block = [
  MARK_BEGIN,
  '# 无人值守：host 启动就 resume 这段会话、挂载 agent，不需要任何浏览器窗（PRD A.45）。',
  '- id: agent-loop',
  '  name: "@deepseek-ai/dsh-agent-loop"',
  '  config:',
  '    agents:',
  `      - id: ${memberKey}`,
  `        resumeSessionId: ${sessionId}`,
  `        cwd: ${cwd.replace(/\\/g, '/')}`,
  MARK_END,
  '',
].join('\n')

let text = readFileSync(patchFile, 'utf8')
const eol = text.includes('\r\n') ? '\r\n' : '\n'
const lf = text.replace(/\r\n/g, '\n')
const begin = lf.indexOf(MARK_BEGIN)
const end = lf.indexOf(MARK_END)
let next
if (begin >= 0 && end > begin) {
  // 有 marker：整块换掉。
  next = lf.slice(0, begin) + block + lf.slice(end + MARK_END.length).replace(/^\n+/, '\n')
} else {
  // 没有 marker 但已经有一条 `- id: agent-loop`（早期手写的）：从那一行换到下一个顶层条目。
  const lines = lf.split('\n')
  const start = lines.findIndex((line) => /^- id:\s*agent-loop\s*$/.test(line))
  if (start >= 0) {
    let stop = start + 1
    while (stop < lines.length && !/^- (id|insert|group|disabled):/.test(lines[stop])) stop++
    next = [...lines.slice(0, start), ...block.split('\n'), ...lines.slice(stop)].join('\n')
  } else {
    next = lf.trimEnd() + '\n\n' + block
  }
}
if (eol === '\r\n') next = next.replace(/\n/g, '\r\n')

if (next === text) {
  console.log(`已经装过了：${memberKey} → ${sessionId}`)
  process.exit(0)
}

if (args['dry-run']) {
  console.log(`[dry-run] 会写 ${patchFile}：\n`)
  console.log(block)
  process.exit(0)
}

const open = await portOpen(port)
if (open && !args.force) {
  die(`NEXT: ${memberKey} 的 ${port} 端口开着 —— 改 profile patch 会热重载、把她这轮的工具抽走。先 fish.ps1 down ${memberKey}，改完再 up。`)
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const backup = `${patchFile}.bak-unattended-${stamp}`
copyFileSync(patchFile, backup)
writeFileSync(patchFile, next, 'utf8')
console.log(`已写入：${patchFile}`)
console.log(`备份：${backup}`)
console.log(`会话：${sessionId}`)
console.log(`工作区：${cwd}`)
console.log(`NEXT: fish.ps1 up ${memberKey} -NoBrowser（这次启动就不需要窗口了）`)
