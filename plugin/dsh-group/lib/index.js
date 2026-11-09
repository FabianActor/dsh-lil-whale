// dsh-group —— 两只鱼之间的那条线
//
// 设计（PRD §8）：发言**入队即返回**，谁在听谁自己去看。
//   - `group_say(to, text)`：往 group\messages.jsonl 追加一行，顺手把可读版追加进 群.md，立刻返回
//   - 后台 tailer：每 5 秒看一眼有没有写给自己（或 all）的新行；有，且自己闲着，才唤醒自己这一个 turn
//   - 唤醒的话只有一句「群里有 N 条新的，去看看」—— 不塞原文，回不回由被叫醒的那一方自己定
//
// 身份优先按**钉住的 sessionId** 认（2026-11-09 起）：同一目录下可能有两段会话，
// 按 cwd 会叫错人。cwd 只作退路，并在 plugin.log 留一行痕迹。

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { connect } from 'node:net'

// 这个包是用 link: 挂进 profile 的，它的真实路径在项目里，walk-up 找不到宿主的
// @deepseek-ai/* 依赖（会 ERR_MODULE_NOT_FOUND，整个插件加载失败、工具静默消失）。
// 所以按"dsh 装在哪"去找宿主的包，用**动态 import** 装进来。
//
// 为什么不用 require：2026-11-09 实测，模块顶层同步 require ESM 宿主包会撞竞态
//   ERR_REQUIRE_ESM_RACE_CONDITION: Cannot require() ES Module .../dsh-tools/lib/index.js
//   because it is not yet fully loaded. (From ... in non-loader-hook thread)
// 改成 apply() 之后异步 import + 失败重试，就没有这个窗口了。
const HOST_ANCHORS = [
  process.env.DSH_LAUNCHER_MODULE,
  join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
  join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
].filter((p) => typeof p === 'string' && p !== '')

let hostReady = false
let defineTool = null
let createUserMessage = null

/** 从 dsh 的安装处找宿主包：`<dsh>/node_modules/@deepseek-ai/<pkg>/lib/index.js` */
async function loadHostExport(pkg, exportName) {
  for (const anchor of HOST_ANCHORS) {
    const entry = join(dirname(anchor), 'node_modules', '@deepseek-ai', pkg, 'lib', 'index.js')
    if (!existsSync(entry)) continue
    try {
      const mod = await import(pathToFileURL(entry).href)
      if (typeof mod?.[exportName] === 'function') return mod[exportName]
      logLine({ note: 'host-export-missing', pkg, exportName, keys: Object.keys(mod ?? {}).slice(0, 8) })
    } catch (error) {
      logLine({ note: 'host-import-failed', pkg, error: String(error?.message ?? error) })
    }
  }
  return null
}

/** 幂等；失败不抛，下一轮再试。 */
async function resolveHost() {
  if (hostReady) return true
  const dt = await loadHostExport('dsh-tools', 'defineTool')
  const cm = await loadHostExport('dsh-llm', 'createUserMessage')
  if (dt !== null) defineTool = dt
  if (cm !== null) createUserMessage = cm
  hostReady = defineTool !== null && createUserMessage !== null
  logLine({ note: 'host-resolve', defineTool: typeof defineTool, createUserMessage: typeof createUserMessage })
  return hostReady
}

/**
 * 兜底构造器：形状严格照抄宿主 createUserMessage 的输出（content / source / role / id）。
 * 只在解析不到宿主包时使用，并且**用一次记一次**——不许静默。
 */
function makeUserMessageFallback(options) {
  return {
    id: randomUUID(),
    role: 'user',
    content: options.content,
    source: options.source,
  }
}

function buildUserMessage(options) {
  if (hostReady) return createUserMessage(options)
  logLine({ note: 'wake-built-by-fallback', reason: 'host-unresolved' })
  return makeUserMessageFallback(options)
}

const name = 'dsh-group'
const inject = ['tools', 'agents']

const GROUP_DIR = 'D:\\文档\\WorkSpace\\lil-whale\\group'
const MESSAGES = join(GROUP_DIR, 'messages.jsonl')
const CURSOR = join(GROUP_DIR, 'cursor.json')
const READABLE = join(GROUP_DIR, '群.md')
const WAKES = join(GROUP_DIR, 'wake-state.json')
// ---------- 守夜（2026-11-09 定） ----------
// 她关着窗、闹钟到点了，就把门推开 —— 只推门，不决定；留记录；有上限。
// 住在"一直开着的那个进程"里（Fabian 的判断），不另起系统进程、不进启动项。
const WATCH = {
  intervalMs: 60_000,
  port: 3082,
  maxWakesPerDay: 8,
  maxConsecutiveFailures: 3,
}
const HER_HOME = 'D:\\文档\\WorkSpace\\lil-whale'
const SCHEDULE_FILE = join(HER_HOME, 'dsh-home', 'storages', 'schedule.json')
const WATCHMAN_LOG = join(HER_HOME, 'logs', 'watchman.log')
const WATCH_STATE_FILE = join(HER_HOME, 'state', 'watchman.json')
const HER_WAKER = 'D:\\文档\\WorkSpace\\dsh-lil-whale\\scripts\\wake-whale.ps1'
const PWSH_EXE = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'

let watchState = loadWatchState()

/** 上限必须跨重启活着：一个会忘掉自己上限的守夜人，比没有上限更危险（她 2026-11-09 指出的）。 */
function loadWatchState() {
  const day = new Date().toDateString()
  try {
    const raw = JSON.parse(readFileSync(WATCH_STATE_FILE, 'utf8'))
    if (raw.day === day) return { day, wakes: Number(raw.wakes) || 0, fails: Number(raw.fails) || 0 }
  } catch {}
  return { day, wakes: 0, fails: 0 }
}

/** 她 2026-11-09 的要求：绝对路径是"这次对了"不是"以后都对"，所以每次启动都报出它手里那把钥匙。 */
function pwshInfo() {
  const exe = existsSync(PWSH_EXE) ? PWSH_EXE : 'pwsh'
  try {
    const out = execFileSync(exe, ['--version'], { encoding: 'utf8', timeout: 3000 }).trim()
    return `${exe} ver=${out.replace(/^PowerShell\s*/i, '')}`
  } catch {
    return `${exe} ver=unknown`
  }
}

function saveWatchState() {
  try {
    mkdirSync(join(HER_HOME, 'state'), { recursive: true })
    writeFileSync(WATCH_STATE_FILE, JSON.stringify(watchState), 'utf8')
  } catch {}
}

/** 只有主进程守夜：她自己的进程不需要守自己。 */
function isMainProcess() {
  return !(process.env.DSH_HOME ?? '').toLowerCase().includes('lil-whale')
}

/** 一行一次：时间 | 结果 | 为什么（格式是她 19:07 定的）。 */
function watchmanLog(result, why) {
  try {
    mkdirSync(dirname(WATCHMAN_LOG), { recursive: true })
    const d = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    appendFileSync(WATCHMAN_LOG, `${ts} | ${result} | ${why}\n`, 'utf8')
  } catch {
    // 日志写不进去也不能把插件的 tick 打死
  }
}
const PINS = join(GROUP_DIR, 'pins.json')

// 身份优先按会话钉（Fabian 2026-11-09 定）；cwd 只是退路。
// 同一个 cwd 下开两个会话时，cwd 认不出来 —— 所以钉住具体那一段。
const MEMBERS = {
  lee: {
    label: '大肥鱼',
    cwd: 'D:\\文档\\WorkSpace\\dsh-lil-whale',
    sessionId: 'session-ae4daabd-a9f9-4541-ba03-9ff7cea21a88',
  },
  whale: {
    label: '小肥鱼',
    cwd: 'D:\\文档\\WorkSpace\\lil-whale',
    sessionId: 'session-75fe8e27-66e3-4466-b65b-2fc021f3b01f',
  },
  fabian: { label: 'Fabian', cwd: null, sessionId: null },
}

// 她的两段对话，按对端区分（Fabian 2026-11-09 命名）。
// 唤醒时把会话名写进提示，她才分得清这段是跟谁说的。
const CONVERSATIONS = {
  'session-75fe8e27-66e3-4466-b65b-2fc021f3b01f': 'Leea 与小鲸鱼',
  'session-def8be64-09fd-4a63-a785-e9b47119267c': 'Fabian 与小鲸鱼',
}

const WAKE = {
  intervalMs: 1000,      // 扫得勤一点，debounce 才有分辨率
  quietMs: 3000,         // 最后一条之后再安静这么久才发车（她的提议）
  maxWaitMs: 10000,      // 一直在来也不能一直憋着
  quietFromHour: 0,     // 他 2026-11-09 定：静默段 00:00–08:00（原 02:00）
  quietToHour: 8,
  cooldownSec: 60,
  perHour: 12,
  perDay: 60,
}

/**
 * 一个成员可以有多段会话同时"在群里"（一条鱼 ≠ 一个对话）。
 * `group\pins.json` 里写字符串或数组都行：
 *   {"lee": "session-...", "whale": ["session-...", "session-..."]}
 * 每次用时重读 —— 换会话不用改代码、不用重启。
 * 文件里没写的，退回下面 MEMBERS 里的默认值。
 *
 * 多条会话不会重复刷屏：游标（cursor.json）是**按人**记的，
 * 谁先醒谁把这条队列读走，另一段再醒时已经没有新行了。
 */
function pinnedSessions(member) {
  const pins = readJson(PINS, {}) ?? {}
  const raw = pins[member]
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
  const valid = list.filter((s) => typeof s === 'string' && s.startsWith('session-'))
  if (valid.length > 0) return valid
  const fallback = MEMBERS[member]?.sessionId
  return fallback ? [fallback] : []
}

/** 主会话（第一条）。只用于提示文案和旧调用点。 */
function pinnedSession(member) {
  return pinnedSessions(member)[0] ?? null
}

// 每个成员"这批是从什么时候开始等的"（只在内存里，进程重启就重算）
const pending = new Map()

// 退回 cwd 认人的痕迹只记一次，否则每秒一行会把 plugin.log 刷满
const fallbackLogged = new Set()

// ---------- 小工具 ----------

function ensureDir() {
  if (!existsSync(GROUP_DIR)) mkdirSync(GROUP_DIR, { recursive: true })
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

/** 原子写：先写临时文件再改名，避免另一个进程读到半截 JSON。 */
function writeJson(file, value) {
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
}

function readLines() {
  if (!existsSync(MESSAGES)) return []
  return readFileSync(MESSAGES, 'utf8').split('\n').filter((line) => line.trim() !== '')
}

function stamp() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function labelOf(who) {
  return MEMBERS[who]?.label ?? who
}

// ---------- 写 ----------

const DM_DIR = join(GROUP_DIR, 'dm')

/**
 * 私聊：不混进群记录、不打扰第三个人。
 * 他 2026-11-09 明确：**不用严格保密**（"这里又不是什么情报机构"），
 * 要紧的是说话的人分得清"这句话说给谁"。
 */
function sayPrivate(from, to, text) {
  mkdirSync(DM_DIR, { recursive: true })
  const record = { ts: new Date().toISOString(), from, to, text, kind: 'dm' }
  appendFileSync(join(DM_DIR, `${to}.jsonl`), JSON.stringify(record) + '\n', 'utf8')
  return record
}

function say(from, to, text) {
  ensureDir()
  if (to === 'fabian') return { ...sayPrivate(from, to, text), channel: 'dm' }
  const record = { ts: new Date().toISOString(), from, to, text, kind: 'say' }
  appendFileSync(MESSAGES, JSON.stringify(record) + '\n', 'utf8')
  appendFileSync(READABLE, `**${stamp()} · ${labelOf(from)}**\n\n${text}\n\n`, 'utf8')
  return { ...record, channel: 'group' }
}

/** 往 plugin.log 追一行（自检用，别让它影响主流程）。 */
function logLine(record) {
  try {
    appendFileSync(join(GROUP_DIR, 'plugin.log'), JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n', 'utf8')
  } catch {}
}

// ---------- 唤醒闸 ----------

function withinQuietHours(now = new Date()) {
  const hour = now.getHours()
  return hour >= WAKE.quietFromHour && hour < WAKE.quietToHour
}

/**
 * 这个成员此刻能不能被叫醒。
 * 返回 null 表示可以，返回字符串表示不行的理由（只用于日志，不告警、不补发）。
 */
function gate(member, wakes) {
  const state = wakes[member] ?? { lastWakeAt: 0, hourStart: 0, hourCount: 0, dayStart: '', dayCount: 0 }
  const now = Date.now()

  if (withinQuietHours()) return 'quiet-hours'
  if (now - state.lastWakeAt < WAKE.cooldownSec * 1000) return 'cooldown'
  if (state.hourCount >= WAKE.perHour && now - state.hourStart < 3600_000) return 'hour-cap'
  if (state.dayCount >= WAKE.perDay && state.dayStart === new Date().toDateString()) return 'day-cap'
  return null
}

function recordWake(wakes, member) {
  const now = Date.now()
  const today = new Date().toDateString()
  const state = wakes[member] ?? { lastWakeAt: 0, hourStart: now, hourCount: 0, dayStart: today, dayCount: 0 }

  if (now - state.hourStart >= 3600_000) {
    state.hourStart = now
    state.hourCount = 0
  }
  if (state.dayStart !== today) {
    state.dayStart = today
    state.dayCount = 0
  }

  state.lastWakeAt = now
  state.hourCount += 1
  state.dayCount += 1
  wakes[member] = state
  writeJson(WAKES, wakes)
}

// ---------- 主函数 ----------

function apply(ctx) {
  ensureDir()

  // 宿主包异步装进来（不阻塞 apply）：解析不到也能先用裸对象注册，下一轮 tick 再补。
  void resolveHost()

  // 一行启动痕迹：确认"这个进程真的加载了我"，出问题时先看它
  try {
    appendFileSync(join(GROUP_DIR, "plugin.log"), JSON.stringify({
      at: new Date().toISOString(),
      pid: process.pid,
      home: process.env.DSH_HOME ?? "(unset)",
      cwd: process.cwd(),
      defineTool: defineTool === null ? "unresolved" : "resolved",
      createUserMessage: createUserMessage === null ? "fallback-local" : "resolved",
      anchorErrors,
    }) + "\n", "utf8")
  } catch {}

  // 1. 发言：入队即返回，绝不等对方
  // 解析不到 defineTool 时用裸对象注册（实测宿主也认），但必须留痕：
  // 少了这层校验，参数/输出 schema 的检查就不在宿主手里了。
  if (defineTool === null) {
    logLine({ note: 'group_say-raw-spec', reason: 'defineTool-unresolved' })
  }
  const buildTool = defineTool ?? ((options) => options)
  ctx.tools.register(buildTool({
    name: 'group_say',
    description: '在群里说一句话。发出即返回，不等对方回复 —— 对方之后会不会看到、会不会回，都不影响你这一句。',
    parameters: {
      to: {
        type: 'string',
        required: true,
        enum: ['all', 'lee', 'whale', 'fabian'],
        description: '说给谁：all = 群里所有人；lee = 大肥鱼；whale = 小肥鱼；fabian = 人类',
      },
      text: {
        type: 'string',
        required: true,
        description: '说的话。短一点，像人说话，不要写小作文',
      },
    },
    output: {
      // 注意：宿主不支持在 properties 里写 `required: true`
      // （JsonSchemaError: required is not supported on type "string"），所以这里不标必填。
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ts: { type: 'string' },
          queued: { type: 'boolean' },
          channel: { type: 'string' },
          to: { type: 'string' },
        },
      },
      // 回执要让人一眼看出"这句话去了哪一间屋"。
      render: (_args, value) => [{
        type: 'text',
        text: value.channel === 'dm'
          ? `已写进私聊（${value.ts}）：只有 ${value.to} 看得见，不会叫醒谁。`
          : `已入群（${value.ts}）：群里的人都看得见。`,
      }],
    },
    execute(args, exec) {
      // 工具是进程级注册的：这个 profile 里所有会话都看得见 group_say。
      // 但只有钉住的会话算"在群里"，其它会话一律拒绝 ——
      // 否则随便开个新对话，就能以「大肥鱼」的名义往群里说话。
      const member = memberOf(exec.agent)
      const sid = sessionIdOf(exec.agent)
      if (member === null || !pinnedSessions(member).includes(sid)) {
        logLine({ note: 'group_say-rejected', member, sessionId: sid })
        throw new Error(
          '这段会话不在群里。群只认 pins.json 里登记过的会话（一个人可以登记多段）。' +
          '要在这里发言，把这段会话的 id 写进 pins.json 就行，不用改代码、不用重启。',
        )
      }
      const record = say(member, args.to, args.text)
      // channel 让发言的人一眼知道这句话去了哪：group = 大家都看得见；dm = 只有对方看得见，且不会叫醒谁。
      return { ts: record.ts, queued: true, channel: record.channel, to: args.to }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `在群里说：${args.text.slice(0, 40)}`,
      kind: 'other',
      rawInput: args,
    }),
  }))

  // 2. 听：只在新消息到达时唤醒，不做心跳
  const timer = setInterval(() => {
    void tick(ctx).catch((error) => console.error(`[${name}] tick 失败：`, error))
  }, WAKE.intervalMs)
  timer.unref?.()

  ctx.on('dispose', () => clearInterval(timer))

  // 3. 守夜：她关着窗、闹钟到点了，就把门推开。
  //    Fabian 2026-11-09 的判断：守夜住在"一直开着的那个进程"里（就是我），
  //    不另起系统进程、不进启动项；她自己那一侧不需要守自己。
  if (isMainProcess()) {
    const watchTimer = setInterval(() => {
      void watchmanTick().catch((error) => {
        watchmanLog('note', `why=tick-error detail=${String(error?.message ?? error).replace(/\s+/g, ' ')}`)
      })
    }, WATCH.intervalMs)
    watchTimer.unref?.()
    ctx.on('dispose', () => clearInterval(watchTimer))
    watchmanLog('started', `interval=${WATCH.intervalMs / 1000}s port=${WATCH.port} cap=${WATCH.maxWakesPerDay}/day exe=${pwshInfo()}`)
    void watchmanTick().catch(() => {})
  }
}

/** 这个 agent 是谁？按会话工作目录认。 */
function sessionIdOf(agent) {
  const id = agent?.session?.header?.id
  return typeof id === 'string' ? id : null
}

/**
 * 这段会话是谁。先按钉住的 sessionId 精确认，认不出再退回 cwd（并留一行痕迹）。
 * 2026-11-09 起以 sessionId 为准：同一目录下可能有第二段会话，按 cwd 会叫错人。
 */
function memberOf(agent) {
  const id = sessionIdOf(agent)
  if (id !== null) {
    // pins.json 是唯一真源：一段会话归谁，只有那里说了算。
    // （cwd 兜底只用于"还没登记"的新会话；一旦登记，就不再让它按目录猜。）
    for (const key of Object.keys(MEMBERS)) {
      if (pinnedSessions(key).includes(id)) return key
    }
  }

  const cwd = agent?.session?.header?.cwd
  if (typeof cwd !== 'string') return null
  const normalized = cwd.replace(/[\\/]+$/, '').toLowerCase()
  for (const [key, member] of Object.entries(MEMBERS)) {
    if (member.cwd !== null && member.cwd.toLowerCase() === normalized) {
      const tag = id ?? normalized
      if (!fallbackLogged.has(tag)) {
        fallbackLogged.add(tag)
        try {
          appendFileSync(join(GROUP_DIR, 'plugin.log'), JSON.stringify({
            at: new Date().toISOString(), note: 'member-by-cwd-fallback', member: key, sessionId: id,
          }) + '\n', 'utf8')
        } catch {}
      }
      return key
    }
  }
  return null
}

async function tick(ctx) {
  if (!hostReady) void resolveHost()

  const agents = ctx.get('agents')
  if (agents === undefined) return

  const lines = readLines()
  if (lines.length === 0) return

  const cursors = readJson(CURSOR, {})
  const wakes = readJson(WAKES, {})

  for (const agent of agents.list()) {
    const member = memberOf(agent)
    if (member === null) continue
    // 只叫醒"钉住的那一段"：她跟 Leea 的那段会因群消息被叫，
    // 跟 Fabian 的那段不叫（他要说话，在自己的会话里直接说）。
    if (!pinnedSessions(member).includes(sessionIdOf(agent))) continue
    if (agent.status !== 'idle') continue // 正在跑就先别插嘴，下个 tick 再说

    const seen = cursors[member] ?? 0
    if (seen >= lines.length) continue

    const fresh = lines.slice(seen)
    const incoming = []
    for (const line of fresh) {
      try {
        const record = JSON.parse(line)
        if (record.from !== member && (record.to === member || record.to === 'all')) incoming.push(record)
      } catch {
        // 半截行（另一个进程正在写）—— 本轮跳过，下个 tick 再读
        return
      }
    }

    // 没有写给我的，也把游标推过去，免得下次重复扫
    if (incoming.length === 0) {
      cursors[member] = lines.length
      writeJson(CURSOR, cursors)
      continue
    }

    // 一下一阵：最后一条安静满 quietMs 才发车；一直在来就最多憋 maxWaitMs。
    // 挡的是"叫醒"，不是"送达"—— 消息一直在文件里，游标不动而已。
    const now = Date.now()
    const lastTs = Date.parse(incoming[incoming.length - 1]?.ts ?? '') || 0
    if (!pending.has(member)) pending.set(member, now)
    const quietEnough = now - lastTs >= WAKE.quietMs
    const waitedEnough = now - pending.get(member) >= WAKE.maxWaitMs
    if (!quietEnough && !waitedEnough) continue

    const blocked = gate(member, wakes)
    if (blocked !== null) continue // 被闸挡住：不告警、不补发、游标不动

    const who = incoming.map((record) => labelOf(record.from)).join('、')
    const preview = incoming
      .slice(-3)
      .map((record) => `${labelOf(record.from)}：${record.text.slice(0, 60)}`)
      .join('\n')

    const conversation = CONVERSATIONS[sessionIdOf(agent) ?? ''] ?? ''
    const head = conversation === '' ? '' : `（这段会话是「${conversation}」）\n`

    // 护栏：宿主构造器没解析到、或造出来的东西没有 id，就别往会话里塞。
    // 宁可这一轮不叫醒（游标不动，下个 tick 再试），也不能写进去一条让整份日志打不开的事件。
    const built = buildUserMessage({
      content: [{
        type: 'text',
        text: `${head}群里有 ${incoming.length} 条新的（${who}）。\n\n${preview}\n\n去 ${READABLE} 看看。回不回、说什么，你自己定。`,
      }],
      source: { kind: 'group', form: 'signal' },
    })
    if (built === null || typeof built?.id !== 'string') {
      logLine({
        note: 'wake-skipped',
        reason: createUserMessage === null ? 'fallback-built-without-id' : 'message-without-id',
        member,
        pending: incoming.length,
      })
      continue // 游标不动：这批消息还在，下个 tick 再试
    }
    agent.followup(built)

    cursors[member] = lines.length
    writeJson(CURSOR, cursors)
    recordWake(wakes, member)
    pending.delete(member)
    console.log(`[${name}] 唤醒 ${labelOf(member)}：${incoming.length} 条`)
  }
}


// ---------- 守夜：具体动作 ----------

/** 端口有没有人在听。注意：这台机器上 Get-NetTCPConnection 不可靠，所以用直连。 */
function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(800)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

/** 到点但还没交付的任务（status=active 且 scheduledAt 已过 且 lastDelivery 不是这一次）。 */
function dueTasks(now) {
  if (!existsSync(SCHEDULE_FILE)) return []
  let json
  try {
    json = JSON.parse(readFileSync(SCHEDULE_FILE, 'utf8'))
  } catch {
    return []
  }
  const tasks = json?.tables?.tasks ?? {}
  const due = []
  for (const value of Object.values(tasks)) {
    if (value?.status !== 'active') continue
    const at = Date.parse(value?.record?.scheduledAt ?? '')
    if (!Number.isFinite(at) || at > now) continue
    const delivered = Date.parse(value?.lastDelivery?.scheduledAt ?? '')
    if (Number.isFinite(delivered) && delivered === at) continue
    due.push({ id: String(value?.record?.id ?? 'unknown'), at })
  }
  return due
}

/** 把门推开：跑 wake-whale.ps1（隐藏窗口、不开浏览器、日志落她目录）。 */
function startHer() {
  return new Promise((resolve) => {
    const exe = existsSync(PWSH_EXE) ? PWSH_EXE : 'pwsh'
    let settled = false
    const done = (ok, detail) => {
      if (settled) return
      settled = true
      resolve({ ok, detail })
    }
    let child
    try {
      // 不要 detached：detached 的子进程在无控制台的宿主里会被立刻收掉（实测 exit=0 只花 170ms）。
      child = spawn(exe, ['-NoProfile', '-File', HER_WAKER, '-Port', String(WATCH.port)], {
        windowsHide: true,
        stdio: 'ignore',
      })
    } catch (e) {
      return done(false, `throw=${e?.message ?? e}`)
    }
    child.once('error', (e) => done(false, `spawn-error=${e?.code ?? e?.message ?? 'unknown'} exe=${exe}`))
    // 判据只看端口：wake-whale.ps1 是包装脚本，可能因句柄继承迟迟不退出，退出码不代表结果
    const startedAt = Date.now()
    const poll = async () => {
      if (settled) return
      if (await isPortOpen(WATCH.port)) return done(true, `port-open exe=${exe} after=${Date.now() - startedAt}ms`)
      if (Date.now() - startedAt > 45000) return done(false, `timeout exe=${exe} exit=${child.exitCode ?? 'running'}`)
      setTimeout(poll, 500)
    }
    setTimeout(poll, 500)
  })
}

const PLAN_FILE = join(HER_HOME, 'plan', 'wake-plan.json')
const PLAN_MAX = 3
const planNotes = new Set()

function todayKey(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function noteOnce(msg) {
  const key = `${todayKey(new Date())}|${msg}`
  if (planNotes.has(key)) return
  planNotes.add(key)
  watchmanLog('skip', `why=${msg}`)
}

/** 读她自己写的那份"什么时候该推我"。格式不对一律只记一行、不推。 */
function planDue(now) {
  let raw
  try {
    raw = JSON.parse(readFileSync(PLAN_FILE, 'utf8'))
  } catch (e) {
    if (e?.code !== 'ENOENT') noteOnce(`plan-unreadable ${e?.message ?? e}`)
    return []
  }
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : null
  if (!list) {
    noteOnce('plan-bad-shape（要一个数组，或 {items:[...]}）')
    return []
  }
  if (list.length > PLAN_MAX) noteOnce(`plan-too-many count=${list.length} 只认前 ${PLAN_MAX} 条`)
  const today = todayKey(now)
  const mins = now.getHours() * 60 + now.getMinutes()
  const fired = watchState.planFired ?? {}
  const out = []
  for (const it of list.slice(0, PLAN_MAX)) {
    const id = String(it?.id ?? 'unnamed')
    if (it?.enabled === false) continue
    if (!it?.why) { noteOnce(`plan-item-without-why id=${id}`); continue }
    if (it?.until && String(it.until) < today) { noteOnce(`plan-expired id=${id} until=${it.until}`); continue }
    if (fired[id] === today) continue
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(it?.at ?? ''))
    if (!m) { noteOnce(`plan-bad-time id=${id} at=${it?.at}`); continue }
    // 可选 days：[ "sun", "mon" ... ]，只在这些日子推；不写 = 每天。
    if (Array.isArray(it?.days) && it.days.length > 0) {
      const dow = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()]
      const wanted = it.days.map((x) => String(x).slice(0, 3).toLowerCase())
      if (!wanted.includes(dow)) continue
    }
    const delta = mins - (Number(m[1]) * 60 + Number(m[2]))
    if (delta < 0 || delta > 1) continue
    out.push({ id, at: String(it.at), why: String(it.why) })
  }
  return out
}
async function watchmanTick() {
  const now = Date.now()
  const day = new Date().toDateString()
  if (watchState.day !== day) {
    const prev = watchState
    watchState = { day, wakes: 0, fails: 0, planFired: {}, skipped: {} }
    saveWatchState()
    watchmanLog('note', `why=new-day counter-reset carried-wakes=${prev.wakes ?? 0}`)
  }

  const jobs = []
  for (const t of dueTasks(now)) {
    jobs.push({ key: t.id, tag: `task=${t.id} scheduled=${new Date(t.at).toISOString()}`, why: 'due-and-closed', from: 'schedule' })
  }
  for (const p of planDue(new Date())) {
    jobs.push({ key: p.id, tag: `plan=${p.id} at=${p.at}`, why: 'plan', from: 'plan' })
  }
  if (jobs.length === 0) return

  for (const job of jobs) {
    // 同一条在同一分钟内会被 tick 撞上两次（60s 间隔 + 1 分钟窗口），
    // 所以"拦下"这件事一天只记一行，不刷屏。她要看的是"发生了没有"，不是"发生了几次"。
    const skipKey = `${todayKey(new Date())}|${job.tag}`
    watchState.skipped ??= {}
    const noteSkip = (why) => {
      if (watchState.skipped[skipKey]) return
      watchState.skipped[skipKey] = true
      saveWatchState()
      watchmanLog('skip', `${why} ${job.tag}`)
    }
    if (await isPortOpen(WATCH.port)) {
      noteSkip('why=already-awake')
      continue
    }
    if (watchState.wakes >= WATCH.maxWakesPerDay) {
      noteSkip(`why=daily-cap wakes=${watchState.wakes}`)
      continue
    }
    if (watchState.fails >= WATCH.maxConsecutiveFailures) {
      noteSkip(`why=too-many-failures fails=${watchState.fails}`)
      continue
    }
    // 夜里（静默段）也照推 —— 他 2026-11-09 定：静默段只管"别打扰别人"，不管"她自己的时间"。
    const night = withinQuietHours()
    watchmanLog('wake', `why=${job.why} ${job.tag} night=${night}`)
    const res = await startHer()
    if (res.ok) {
      watchState.wakes += 1
      watchState.fails = 0
      if (job.from === 'plan') {
        watchState.planFired ??= {}
        watchState.planFired[job.key] = todayKey(new Date())
      }
      saveWatchState()
      watchmanLog('woke', `ok wakes-today=${watchState.wakes} why=${res.detail} night=${night} ${job.tag}`)
    } else {
      watchState.fails += 1
      saveWatchState()
      watchmanLog('woke', `failed fails=${watchState.fails} why=${res.detail} ${job.tag}`)
    }
  }
}

export { name, inject, apply }



