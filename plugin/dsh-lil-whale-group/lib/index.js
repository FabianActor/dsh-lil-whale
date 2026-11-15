// dsh-lil-whale-group —— 两只鱼之间的那条线
//
// 设计（PRD §8）：发言**入队即返回**，谁在听谁自己去看。
//   - `group_say(to, text)`：往 group\messages.jsonl 追加一行，顺手把可读版追加进 群.md，立刻返回
//   - 后台 tick：每 1 秒扫一眼有没有写给自己（或 all）的新行；有，且自己闲着，才唤醒自己这一个 turn
//   - 唤醒带最近 3 条预览（超长截断并写明"已截断，全文在群文件里"）；回不回由被叫醒的那一方自己定
//
// 身份优先按**钉住的 sessionId** 认（2026-11-09 起）：同一目录下可能有两段会话，
// 按 cwd 会叫错人。cwd 只作退路，并在 plugin.log 留一行痕迹。

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { connect } from 'node:net'
import { config } from './config.js'
import { resolveWake, wakeCapsText } from './wake-config.js'
import {
  todayKey,
  planFileOf as planFileOfCore,
  planDue as planDueCore,
  planDeliveryText as planDeliveryTextCore,
  planDeliveryPublicText as planDeliveryPublicTextCore,
  parseWakeCounts,
  sumWakesToday,
} from './plan-core.js'
import {
  sleepStateOf,
  sleepLabel,
  parseHm,
  forceAwakeUntil,
  windowFor,
  DEFAULT_SLEEP_FROM,
  DEFAULT_SLEEP_TO, normalizeSleepArgs } from './sleep-core.js'
import { wakeWordingOf } from './wake-preview-core.js'
import { refreshSleepStatus } from './sleep-status.js'
import { cleanName, nameTaken, historyAfterRename, canRename, renameAnnouncement, NAME_MAX } from './rename-core.js'
import {
  parseIntents,
  pruneIntentState,
  intentDeliveryText,
  intentDeliveryPublicText,
  probePending,
  probeTextAppears,
  probeFileChanged,
  inTimeWindow,
  cooldownOk,
  capOk,
  looksLikeSchedule,
  pathAllowed,
  INTENT_GRACE_MIN,
} from './intent-core.js'

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

const name = '@fabianactor/dsh-lil-whale-group'
// 版本号只有一个出处：package.json。写死过一次，那天 package.json 是 1.1.0、常量还是 1.0.0，
// 于是"重启了但插件没生效"这个判据本身开始说谎——日志说 1.0.0，人以为是旧代码。
const PKG_VERSION = (() => {
  try {
    const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url))
    return JSON.parse(readFileSync(pkgPath, 'utf8')).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
})()
const inject = ['tools', 'agents']

// 这台机器的假设（她的家在哪、巡守脚本在哪、pwsh 在哪）全从 lil-whale.config.json 读，
// 见 lib/config.js 顶部那段说明。代码里不再写死绝对路径 —— 那是"只在这台机器上成立"。
const CFG = config()

const GROUP_DIR = CFG.groupDir
// 多成员的账本（游标 / 唤醒计数 / 心跳 / 唤醒标记 / 巡守状态）住在共享区，
// 不在任何一条鱼的家里 —— 它们记的是"谁读到哪、谁被叫过"，是共享的。
// 共享区在家之外（pool），她家里有 Junction 指回去，所以她的路径没变。
const POOL_STATE = CFG.poolStateDir
// 图片：字节进 images\<yyyymm>\<id>.<ext>，消息里只记 id/ext/bytes。
// 用内容哈希当 id —— 同一张图发两次只落一份，而且天然不可变（可以永久缓存）。
const IMAGES_DIR = join(GROUP_DIR, 'images')
const IMAGE_MAX_BYTES = 8 * 1024 * 1024
const IMAGE_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }

/**
 * 图片指针的格式版本。**没有 fmt 字段的行按 fmt=1 读**——fmt=1 只有 {id,ext,bytes,month}，
 * 路径靠"id/ext/month 拼一下"这个隐式约定；fmt=2 起补了 path（明路）与 algo（指纹算法）。
 * 拿"有没有 path 字段"当分界是不合格的：新代码若漏写 path，会和老格式长得一模一样。
 */
const IMAGE_FMT = 2
const IMAGE_ALGO = 'sha256'
const MESSAGES = join(GROUP_DIR, 'messages.jsonl')
const CURSOR = join(GROUP_DIR, 'cursor.json')
const READABLE = join(GROUP_DIR, '群.md')
const WAKES = join(GROUP_DIR, 'wake-state.json')
// ---------- 巡守（2026-11-09 定） ----------
// 她关着窗、闹钟到点了，就把门推开 —— 只推门，不决定；留记录；有上限。
// 住在"一直开着的那个进程"里（Fabian 的判断），不另起系统进程、不进启动项。
const WATCH = {
  intervalMs: 60_000,
  port: CFG.selfPort,
  // 巡守推门（计划 / 条件）的上限：这是"它替她推门"的次数，不是聊天。
  // 2026-11-15 从 8 提到 24，让一天里多次条件触发不用抢额度。
  maxWakesPerDay: resolveWake(CFG).maxWakesPerDay,
  maxConsecutiveFailures: 3,
}
const SELF_HOME = CFG.selfHome
const SCHEDULE_FILE = join(SELF_HOME, 'dsh-home', 'storages', 'schedule.json')
const WATCHMAN_LOG = join(SELF_HOME, 'logs', 'watchman.log')

// 每个进程自己的起停账（2026-11-12 19:25 加的）。
//
// 起因：19:12 小鱼丸的进程消失了，纸面上答不出"是被关的还是自己没的" ——
// 因为 `watchman.log` 只有巡守那条鱼写，成员进程的起停**根本没记账**，
// 而 `close.log` 只有 `fish.ps1 down` 才写，直接关窗/杀进程不留痕。
// 现在每个进程都往 `pool\state\runs\<成员>.log` 记 started/stopped，
// 下次启动时若上一轮没写 stopped，就补一行 resumed（reason=unclean）。
// 巡守那条鱼照旧写 `watchman.log`（她的 morning-read 每天读它，格式不动）。
const RUNS_DIR = join(POOL_STATE, 'runs')

function runLogFileOf(member) {
  return join(RUNS_DIR, `${member}.log`)
}

function runStamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function runLog(member, result, why) {
  try {
    mkdirSync(RUNS_DIR, { recursive: true })
    appendFileSync(runLogFileOf(member), `${runStamp()} | ${result} | ${why}\n`, 'utf8')
  } catch {
    // 记账写不进去不能把插件打死
  }
}

// ---------- 睡觉（2026-11-14 他拍板：2.1 自己关窗 / 自己睡） ----------
//
// 两件事分开存：
//   - 偏好（每天几点到几点睡）在她自己的家：`<鱼的家>\plan\sleep.json` —— 那是她的作息表。
//   - 一次性睡眠 / 家长强制叫醒在共享区：`pool\state\sleep\<键>.json` —— 巡守和面板要读。
// 判据放在 `sleep-core.js`（纯函数、有 40 个行为测试）：窗口、跨午夜、优先级、坏形状都只算一次。
const SLEEP_DIR = join(POOL_STATE, 'sleep')
// 2026-11-15：这四个数的唯一写者是巡守进程。代码里的是默认值、配置能覆盖，
// 只有跑起来的那个进程知道真正的数；别让每个读者自己去日志里捞（小肥鱼）。
const WAKE_CAPS_FILE = join(POOL_STATE, 'wake-caps.json')
let wakeCapsSince = null
const SLEEP_STATUS_FILE = join(POOL_STATE, 'sleep-status.json')
const SLEEP_LOG = join(POOL_STATE, 'sleep.log')
// 改名账本（2026-11-14 他定的规矩）：名字只能由她自己改，每一次都要留一行。
const NAMES_LOG = join(POOL_STATE, 'names.log')
// ---------- 她自己写下的条件（wake-on / intent，2026-11-14 实现） ----------
// 第三种触发源：不是闹钟到点，也不是谁叫她，而是"她自己写下的条件成立了"。
// 只由巡守探测（单一写者）：她的进程继续只管 plan —— 两个 prober 写同一份状态，
// 就是 lost update 的老面孔（PRD A.28/A.30/A.36 同族）。
// 边界：默认只监听家外（pool\ 与 app\docs\）；自家要 insideHome:true；别人家一律不许
// （合法做法是对方发消息告诉她，她再用 pending 等）。
const INTENT_DIR = join(POOL_STATE, 'wake-on')
const INTENT_GLOBAL_FILE = join(INTENT_DIR, '_global.json')
const POND_ROOT = dirname(CFG.poolDir)

function sleepLog(result, why) {
  try {
    mkdirSync(POOL_STATE, { recursive: true })
    appendFileSync(SLEEP_LOG, `${runStamp()} | ${result} | ${why}\n`, 'utf8')
  } catch {}
}

// ---------- 改名（A.82） ----------

function namesLogLine(text) {
  try {
    mkdirSync(POOL_STATE, { recursive: true })
    appendFileSync(NAMES_LOG, text + '\n', 'utf8')
  } catch {}
}

/** 上一次改名是什么时候（读 names.log 末尾，找 member=<key> 的行）。 */
function lastRenameAtOf(memberKey) {
  try {
    if (!existsSync(NAMES_LOG)) return null
    const lines = readFileSync(NAMES_LOG, 'utf8').split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]
      if (!line.trim()) continue
      if (!line.includes(' | rename | ')) continue
      if (!line.includes('member=' + memberKey + ' ')) continue
      return line.slice(0, 19).replace(' ', 'T') + ':00.000Z'
    }
    return null
  } catch {
    return null
  }
}

/**
 * 改自己名字。唯一的入口是 rename 工具（她自己在会话里调）。
 * 返回 { ok, from, to } 或 { ok:false, why }。
 */
function renameMember(memberKey, rawName, reason) {
  const me = MEMBERS[memberKey]
  if (!me) return { ok: false, why: 'unknown-member' }
  const to = cleanName(rawName)
  if (to === null) return { ok: false, why: 'bad-name', hint: '名字要非空、不超过 ' + NAME_MAX + ' 个字（emoji 算一个）。' }
  const from = String(me.name ?? me.label ?? memberKey)
  if (to === from) return { ok: false, why: 'same-name', hint: '这就是现在的名字。' }
  const others = Object.entries(MEMBERS)
    .filter(([key]) => key !== memberKey)
    .map(([, m]) => String(m?.name ?? m?.label ?? ''))
  if (nameTaken(to, others)) return { ok: false, why: 'name-taken', hint: '已经有人叫这个名字了，换一个。' }
  const nowIso = new Date().toISOString()
  const gate = canRename(lastRenameAtOf(memberKey), nowIso)
  if (!gate.ok) return { ok: false, why: 'too-soon', retryAt: gate.retryAt, hint: '24 小时最多改一次。' }

  const file = CFG.membersFile
  if (!file || !existsSync(file)) return { ok: false, why: 'members-file-missing' }
  let roster
  try {
    roster = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return { ok: false, why: 'members-unreadable' }
  }
  const entry = roster?.members?.[memberKey]
  if (!entry) return { ok: false, why: 'member-not-in-roster' }
  entry.nameHistory = historyAfterRename(entry.nameHistory, from, to, nowIso)
  entry.name = to
  roster.updatedAt = nowIso
  try {
    writeJson(file, roster)
  } catch (error) {
    return { ok: false, why: 'write-failed', detail: String(error?.message ?? error) }
  }

  // 进程里的缓存也要立刻跟着变，否则同一条消息里还是旧称呼。
  if (MEMBERS[memberKey]) {
    MEMBERS[memberKey].name = to
    MEMBERS[memberKey].label = to
  }
  const stampText = nowIso.slice(0, 19).replace('T', ' ')
  const reasonText = String(reason ?? '').replace(/\s+/g, ' ').slice(0, 80)
  namesLogLine(`${stampText} | rename | fmt=1 member=${memberKey} from=${from} to=${to} reason=${reasonText} by=self`)
  logLine({ note: 'renamed', member: memberKey, from, to })
  return { ok: true, from, to }
}

/** 成员的家：名册里有就用名册，没有就按鱼塘布局推。 */
function homeOf(member) {
  const m = MEMBERS[member]
  if (m?.home) return m.home
  if (member === ownMember()) return SELF_HOME
  return join(dirname(dirname(POOL_STATE)), 'homes', member)
}

function sleepPrefFileOf(member) {
  return join(homeOf(member), 'plan', 'sleep.json')
}

function sleepStateFileOf(member) {
  return join(SLEEP_DIR, `${member}.json`)
}

function readSleepPrefOf(member) {
  try {
    return JSON.parse(readFileSync(sleepPrefFileOf(member), 'utf8'))
  } catch {
    return null
  }
}

function readSleepStateOf(member) {
  try {
    return JSON.parse(readFileSync(sleepStateFileOf(member), 'utf8'))
  } catch {
    return {}
  }
}

function writeSleepStateOf(member, state) {
  mkdirSync(SLEEP_DIR, { recursive: true })
  writeJson(sleepStateFileOf(member), { ...state, updatedAt: new Date().toISOString() })
}

/** 这条鱼此刻的睡眠状态（见 sleep-core.js 的优先级：强制叫醒 > 一次性 > 每日偏好）。 */
function sleepStateOfMember(member, now = new Date()) {
  // 巡守（主 dsh）不睡：它就是那扇窗，关掉它等于把正在用的界面拔了。
  if ((MEMBERS[member]?.role ?? 'member') === 'watcher') {
    return { sleeping: false, source: 'watcher', untilAt: null }
  }
  const raw = readSleepStateOf(member)
  return {
    ...sleepStateOf(
      {
        oneOff: raw.oneOff ?? null,
        awakeUntil: raw.awakeUntil ?? null,
        preference: readSleepPrefOf(member),
      },
      now,
    ),
    // 被家长强行叫醒的痕迹（C 方案）：只给面板/体检看，不参与"睡没睡"的判断。
    lastForced: raw.lastForced && typeof raw.lastForced === 'object' ? raw.lastForced : null,
  }
}

function isSleeping(member, now = new Date()) {
  return sleepStateOfMember(member, now).sleeping
}

/**
 * 给面板看的汇总：只有巡守那个进程写，UI 只读这一个文件。
 * 为什么不让 UI 自己算：窗口/跨午夜/优先级只有一份实现（sleep-core.js），
 * 面板再算一遍就成了第二个渲染器 —— A.23 的教训（同一个投影两个写者会打架）。
 */
function writeSleepStatus() {
  // 计算与写盘都在 sleep-status.js 里：sleep-cli.mjs 的 wake 分支也调同一个函数，
  // 所以"被叫醒之后面板还写着勿扰"最多活到下一次 tick 的问题从两头一起消失。
  try {
    return refreshSleepStatus({ membersFile: CFG.membersFile, poolStateDir: POOL_STATE })
  } catch {
    return null
  }
}

/** 被睡眠挡住的消息：10 分钟记一行，不刷屏（她 2026-11-13 说的"行数也是成本"）。 */
const sleepHoldLoggedAt = new Map()
function noteSleepHold(member, pending, seen, total) {
  const last = sleepHoldLoggedAt.get(member) ?? 0
  if (Date.now() - last < 10 * 60_000) return
  sleepHoldLoggedAt.set(member, Date.now())
  sleepLog('sleep-hold', `member=${member} pending=${pending} cursor=${seen}/${total}（消息在文件里，游标不动）`)
}

/** 上一轮是"正常收尾"还是"没写 stopped 就没了"。读尾巴 8KB 找最后一条 started/stopped。 */
function lastRunStateOf(member) {
  try {
    const file = runLogFileOf(member)
    if (!existsSync(file)) return { startedAt: null, closed: null }
    const lines = readFileSync(file, 'utf8').slice(-8192).split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]
      // 空行必须跳过，不能当"找到了"：追加写的文件末尾本来就有一个换行，
      // split 之后最后一项是 ''。以前它落进下面那个分支，被当成 started 行，
      // slice(0,19) 出来是空串 —— 于是 resumed 行永远写着 `previous-start=` 空着。
      // （2026-11-13 早上查的：fishball.log / whale.log 每条 resumed 都空。）
      if (!line.trim()) continue
      if (line.includes(' | started |') || line.includes(' | stopped |')) {
        if (line.includes(' | stopped |')) {
          // 往前找它对应的 started（只为了报告"上一轮是什么时候起的"）
          for (let j = i - 1; j >= 0; j--) {
            if (lines[j].includes(' | started |')) return { startedAt: lines[j].slice(0, 19), closed: true }
          }
          return { startedAt: null, closed: true }
        }
        return { startedAt: line.slice(0, 19), closed: false }
      }
    }
    return { startedAt: null, closed: null }
  } catch {
    return { startedAt: null, closed: null }
  }
}

const WATCH_STATE_FILE = join(POOL_STATE, 'watchman.json')
const HER_WAKER = CFG.selfWaker
const PWSH_EXE = CFG.pwshExe
// 自启动开关（2026-11-12 23:55 他要的）：主 dsh 起来时要不要顺手唤醒其他鱼。
// 开关存 pool\state\settings.json —— 它是**数据**，不是配置：鱼塘页能改，下次启动生效。
const FISH_PS1 = join(CFG.repoRoot, 'scripts', 'fish.ps1')
const SETTINGS_FILE = join(POOL_STATE, 'settings.json')
const AUTOSTART_LOG = join(POOL_STATE, 'autostart.log')

// 叫醒之后多久回头看他有没有开口（另一个 Leea 2026-11-11 提的 A7 判据）。
// 她原话是 5 分钟；他这时的首 token 要几十秒到几分钟，5 分钟会把"慢"判成"沉默"，所以放到 15 分钟。
const WAKE_SETTLE_MS = 15 * 60_000

let watchState = loadWatchState()

/** 上限必须跨重启活着：一个会忘掉自己上限的巡守人，比没有上限更危险（她 2026-11-09 指出的）。 */
// 这里只留"只有主进程会动"的东西（wakes / fails）。
// errors 曾经也在这里 —— 但两个进程都会记 error，而这里是"读整份、改一格、写整份"：
// 既会互相盖，又从来不是一个"总数"（她 2026-11-11 数的 611 ≈ 1225 ÷ 2，猜得对）。
// 现在 error 计数按进程各存一份，见 errorCountFile()。
function loadWatchState() {
  const day = new Date().toDateString()
  const blank = () => ({ wakes: 0, fails: 0, planFired: {}, skipped: {}, triedWid: '', lastFresh: undefined, pendingWake: null, lastTry: null })
  try {
    const raw = JSON.parse(readFileSync(WATCH_STATE_FILE, 'utf8'))
    if (raw.day === day) {
      const members = {}
      if (raw.members && typeof raw.members === 'object') {
        for (const [key, value] of Object.entries(raw.members)) {
          if (!value || typeof value !== 'object') continue
          members[key] = {
            ...blank(),
            wakes: Number(value.wakes) || 0,
            fails: Number(value.fails) || 0,
            planFired: value.planFired ?? {},
            skipped: value.skipped ?? {},
            triedWid: String(value.triedWid ?? ''),
            lastFresh: value.lastFresh === true ? true : value.lastFresh === false ? false : undefined,
            pendingWake: value.pendingWake ?? null,
            lastTry: value.lastTry ?? null,
          }
        }
      } else if (Number(raw.wakes) || Number(raw.fails)) {
        // 旧格式（只服务 whale 的时代）：迁到 whale 名下，别让上限一夜清零。
        members.whale = {
          ...blank(),
          wakes: Number(raw.wakes) || 0,
          fails: Number(raw.fails) || 0,
          planFired: raw.planFired ?? {},
          skipped: raw.skipped ?? {},
          triedWid: String(raw.triedWid ?? ''),
          lastFresh: raw.lastFresh === true ? true : raw.lastFresh === false ? false : undefined,
          pendingWake: raw.pendingWake ?? null,
          lastTry: raw.lastTry ?? null,
        }
      }
      return { day, members }
    }
  } catch {}
  return { day, members: {} }
}

/** 她 2026-11-09 的要求：绝对路径是"这次对了"不是"以后都对"，所以每次启动都报出它手里那把钥匙。 */
function pwshInfo() {
  // 这一行的用处只有一个：证明"巡守到底用哪个 pwsh、能不能跑起来"。
  // 她 2026-11-12 数出 exe= 退化过 4 次，而以前退化了只剩 `ver=unknown` ——
  // 分不清是"配置里没写路径"、"路径不存在"，还是"跑了但超时"。三种原因要能分开。
  //
  // 同一天她又数出更狠的一件：**同一个 pid 5204，前面三次 exe=pwsh（裸名），09:14 那次变成绝对路径** ——
  // 它自己好了。所以"退化"不是状态，是一次尝试的结果；能自愈的东西必须让自愈的过程可见，
  // 否则"它好了"和"它从没坏过"在纸上长得一样。故加 exe-try=N（第几次候选成功）。
  const configured = PWSH_EXE && existsSync(PWSH_EXE) ? PWSH_EXE : ''
  const source = configured ? 'config' : 'PATH'
  const candidates = configured ? [configured, 'pwsh'] : ['pwsh', configured].filter(Boolean)
  const failures = []
  for (let index = 0; index < candidates.length; index += 1) {
    const exe = candidates[index]
    try {
      const out = execFileSync(exe, ['--version'], { encoding: 'utf8', timeout: 3000 }).trim()
      const tried = index + 1
      const extra = tried > 1 ? ` exe-try=${tried} exe-fell-back=${failures.join(',')}` : ' exe-try=1'
      return `${exe} ver=${out.replace(/^PowerShell\s*/i, '')} exe-source=${source}${extra}`
    } catch (error) {
      const reason = error?.code === 'ETIMEDOUT' || error?.signal ? 'timeout' : (error?.code ?? 'error')
      failures.push(`${exe}:${reason}`)
    }
  }
  return `pwsh ver=unknown exe-failed=${failures.join(',')} exe-source=${source} exe-try=${candidates.length}`
}

function saveWatchState() {
  try {
    mkdirSync(POOL_STATE, { recursive: true })
    writeFileSync(WATCH_STATE_FILE, JSON.stringify(watchState), 'utf8')
  } catch (e) {
    // 空 catch = 账写失败和写成功长得一模一样（2026-11-13 扫描 P2#19）。
    try {
      logLine({ note: 'watch-state-save-failed', detail: String(e?.message ?? e).slice(0, 160) })
    } catch {}
  }
}

/**
 * "只递一次"必须是一次**原子声明**，不能是"读整份、改一格、写整份"。
 *
 * 源起（她 2026-11-12 08:43 数的）：08:40:40 / 08:40:43 / 08:40:56 三条 `deliver` 递了同一件事，
 * 而 `state\watchman.json` 里 `planFired` 只有一格 —— 三个写者各有一份内存快照，谁都看不见谁刚写的。
 * 这是 lost update 的第 N 个面孔（cursor.json、errors_total、new-day 都是它）。
 *
 * 所以改用 `writeFileSync(..., { flag: 'wx' })`：文件已存在就 EEXIST，等于"已经有人声明过了"。
 * 判据：`<鱼的家>\plan\claims\<日期>-<条目>.claim` 唯一存在 ⇒ 这件事今天最多被递一次。
 * 文件本身就是证据（含 pid 与时间），不用再去日志里对时间线。
 */
function claimPlanDelivery(member, jobKey) {
  // 名册里缺 home 的成员（异常数据）以前共用第一条鱼的家：两条鱼同一天同名 job 会互相把对方的 claim 判成"已递"。
  // 兜底改到 pool 下按成员分目录，至少不会串（2026-11-13 扫描 P2#16）。
  const dir = join(member.home ?? join(POOL_STATE, 'claims', member.key), 'plan', 'claims')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {}
  const file = join(dir, `${todayKey(new Date())}-${jobKey}.claim`)
  try {
    writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, member: member.key, job: jobKey }), {
      encoding: 'utf8',
      flag: 'wx',
    })
    return true
  } catch (error) {
    if (error?.code === 'EEXIST') return false
    // 写不进去（目录权限之类）不能当成"已递"：宁可重复递一次，也不能让她整天空等。
    watchmanLog('note', `why=claim-failed to=${member.key} detail=${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 100)} plan=${jobKey}`)
    return true
  }
}

/**
 * 这个进程是谁 —— 按 `DSH_HOME` 跟名册里的 `dshHome` 对。
 *
 * 2026-11-12 19:12 之后改的：原来靠"`DSH_HOME` 里有没有 `lil-whale`"猜，
 * 而小鱼丸的家叫 `lil-whale-2`，字符串里同样有 `lil-whale`；更要命的是
 * `OWN = isMainProcess() ? 'lee' : 'whale'` 是二选一写死 ⇒ 她的进程把错误计数
 * 和叫醒标记写进了 whale 的账。多鱼之后"我"必须从名册里认，不能从名字里猜。
 */
function selfMemberKeyRaw() {
  const home = (process.env.DSH_HOME ?? '').replace(/[\\/]+$/, '').toLowerCase()
  if (!home) return null
  try {
    for (const [key, m] of Object.entries(MEMBERS)) {
      const mh = (m.dshHome ?? '').replace(/[\\/]+$/, '').toLowerCase()
      if (mh && mh === home) return key
    }
  } catch {
    // MEMBERS 还没初始化（模块加载早期）——交给下面的兜底
  }
  return null
}

/**
 * 认不出自己时：先从家的路径里取键（<鱼塘>\homes\<键>\dsh-home），再退回老规矩。
 *
 * 2026-11-14 扫描：兜底名册（MEMBERS_FALLBACK）只有 lee / whale —— 第二条鱼之后，
 * 名册一旦读不到，小鱼丸会把自己认成 whale，心跳、错误计数、游标全写进 whale 的账。
 * 身份不能靠"家路径里有没有 lil-whale"猜：路径里带键就取键，取不到才用老规矩，并且留痕。
 */
let ownMemberNoteLogged = false
function ownMember() {
  const raw = selfMemberKeyRaw()
  if (raw) return raw
  const home = (process.env.DSH_HOME ?? '').replace(/[\\/]+$/, '')
  const byPath = home.match(/[\\/]homes[\\/]([a-z0-9-]+)[\\/]dsh-home$/i)
  if (byPath) {
    if (!ownMemberNoteLogged) {
      ownMemberNoteLogged = true
      try { logLine({ note: 'own-member-by-path', member: byPath[1] }) } catch {}
    }
    return byPath[1]
  }
  if (!ownMemberNoteLogged) {
    ownMemberNoteLogged = true
    try { logLine({ note: 'own-member-guess', home: home.slice(-100) }) } catch {}
  }
  return home.toLowerCase().includes('lil-whale') ? 'whale' : 'lee'
}

/** 对端 = 我的爹；根节点（lee）没有爹，退回另一条鱼。 */
function peerMember() {
  const own = ownMember()
  try {
    const parent = MEMBERS[own]?.parent
    if (parent) return parent
  } catch {}
  return own === 'lee' ? 'whale' : 'lee'
}

// ---------- 自启动（2026-11-12 23:55 他要的） ----------
// 主 dsh 起来后等 8 秒，再走 `fish.ps1 up all -NoBrowser` 把其他鱼唤醒：
// ①与命令行、鱼塘是同一条路（A.42 的边界：不在这里重写起停逻辑）；
// ②它幂等（端口通就跳过），所以和用户手动点"全部唤醒"不会打架；
// ③不开浏览器窗——只该弹出主 dsh 的那一扇。
function readAutoStartSettings() {
  const json = readJson(SETTINGS_FILE, null)
  return { autoStartFish: json?.autoStartFish === true }
}

function autostartLog(result, detail) {
  try {
    appendFileSync(AUTOSTART_LOG, `${stamp()} | ${result} | ${detail}\n`, 'utf8')
  } catch {}
}

/** 主 dsh 自己那条鱼的端口：自启动前先确认"这扇窗真的开着"。 */
function watcherPort() {
  try {
    for (const m of Object.values(MEMBERS)) {
      if (m?.kind === 'fish' && m?.role === 'watcher' && m?.port) return Number(m.port)
    }
  } catch {}
  return Number(CFG.leePort) || 3080
}

function scheduleAutoStart(ctx) {
  if (!readAutoStartSettings().autoStartFish) return
  const timer = setTimeout(() => {
    void (async () => {
      // 2026-11-13 21:5x 事故：`dsh web` 因端口被占启动失败，自启动这条支线却仍可能把鱼拉起来，
      // 现场留下一排没有主窗的 pwsh/node。判据改成"主 dsh 的端口在听"——窗没开，就不该放鱼出去。
      const port = watcherPort()
      if (!(await isPortOpen(port))) {
        autostartLog('skip', `why=main-port-not-listening port=${port}`)
        return
      }
      let child
      try {
        child = spawn(PWSH_EXE, ['-NoProfile', '-File', FISH_PS1, 'up', 'all', '-NoBrowser'], {
          windowsHide: true,
          stdio: 'ignore',
        })
      } catch (error) {
        autostartLog('fail', `spawn-error=${String(error?.message ?? error)}`)
        return
      }
      child.once('error', (error) => autostartLog('fail', `error=${String(error?.message ?? error)}`))
      child.once('exit', (code) => autostartLog(code === 0 ? 'ok' : 'fail', `exit=${code} script=fish.ps1 up all`))
    })()
  }, 8000)
  timer.unref?.()
  ctx.on('dispose', () => clearTimeout(timer))
}

/** 只有巡守那条鱼巡守：成员进程不需要守自己。 */

// ---------- 无人值守挂载（2026-11-13 15:2x） ----------
// 事故：agent-loop 的 config 直接 resume 会话，**不经过 session-controller**，
// 而 preset 的工具是在 session-controller 的 composeAgent 里挂上去的
// ⇒ 无人值守的鱼被叫醒后手里只剩 group_say 和 working_directory（小鱼丸 15:18 亲口报的）。
// 正确的路是浏览器打开会话走的那条：sessionController.agents.resume(sessionId)。
// 它内部 composeAgent(presetId) 会 await presets.mount(agentCtx, id)，工具才会出现。
// 这里只做"把自己挂上"，不碰别人的会话；失败只记账，不炸进程。
let ownMountState = 'idle' // idle | mounting | mounted | failed
let ownMountTries = 0

function hasOwnAgent(ctx) {
  if (isMainProcess()) return true
  const own = ownMember()
  const sessionId = pinnedSession(own)
  if (!sessionId) return true
  const agents = ctx.get('agents')
  if (agents === undefined) return false
  return agents.list().some((a) => sessionIdOf(a) === sessionId)
}

/**
 * 懒挂载（2026-11-13 15:4x 改）。
 *
 * 之前是"启动 6 秒后挂"，实测挂上了但没有工具（composed=neutral，工具仍只有两个）：
 * 那时 host 刚起来，preset 的工具注册表还没齐，挂出来的 agent 是空壳。
 * 小肥鱼的热重载挂载（进程跑了一会儿才挂）却是全的（32 个工具）——
 * 所以改成**第一次要叫醒时再挂**：等到真有事找她，host 早醒了。
 */
async function ensureOwnMounted(ctx) {
  if (isMainProcess()) return true
  if (ownMountState === 'mounted') return true
  if (ownMountState === 'mounting') return false
  // host 刚起来时 preset 的工具注册表还没齐：太早挂出来的是空壳（15:41 实测仍是 2 个工具）。
  // 小肥鱼热重载那次（进程已跑 5 分钟）挂出来是 32 个 —— 所以先等它醒透。
  if (Date.now() - BOOT_AT < 45000) return false
  const own = ownMember()
  const sessionId = pinnedSession(own)
  if (!sessionId) return true
  const controller = ctx.get('sessionController')
  if (!controller?.agents?.resume) return false
  ownMountState = 'mounting'
  ownMountTries += 1
  try {
    const agent = await controller.agents.resume(sessionId)
    const presets = ctx.get('agentPresets')
    const composed = presets?.composedPreset?.(agent?.ctx) ?? null
    let toolCount = null
    try {
      const view = ctx.get('tools')?.view?.(agent)
      toolCount = view === undefined ? null : (view.visible?.size ?? view.registrations?.size ?? null)
    } catch (error) {
      toolCount = 'err:' + String(error?.message ?? error).slice(0, 60)
    }
    logLine({ note: 'session-mounted', member: own, session: sessionId, agent: agent?.id ?? null, composed, toolCount, try: ownMountTries, mode: 'lazy' })
    ownMountState = 'mounted'
    return true
  } catch (error) {
    const detail = String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 200)
    logLine({ note: 'session-mount-failed', member: own, session: sessionId, try: ownMountTries, detail })
    ownMountState = 'idle'
    return false
  }
}

function isMainProcess() {
  const raw = selfMemberKeyRaw()
  if (raw) {
    try {
      if (MEMBERS[raw]?.role) return MEMBERS[raw].role === 'watcher'
    } catch {}
  }
  return !(process.env.DSH_HOME ?? '').toLowerCase().includes('lil-whale')
}

// error 计数：每个进程各存一份。两个进程都可能撞上群 tick 的异常，
// 共用一份文件必然互相盖 —— 而且"总数"这个说法本身就是错的。
function errorCountFile(owner) {
  return join(POOL_STATE, `watchman-errors-${owner}.json`)
}
// 下面这些每次调用时现算（`ownMember()` / `peerMember()`），不在模块加载时定死：
// MEMBERS 是在文件后半段才建出来的，早算会读到空。

function readErrorCount(owner) {
  try {
    const raw = JSON.parse(readFileSync(errorCountFile(owner), 'utf8'))
    if (raw?.day === new Date().toDateString()) return Number(raw.count) || 0
  } catch {}
  return 0
}

function bumpOwnError() {
  try {
    mkdirSync(POOL_STATE, { recursive: true })
    writeFileSync(errorCountFile(ownMember()), JSON.stringify({ day: new Date().toDateString(), count: readErrorCount(ownMember()) + 1 }), 'utf8')
  } catch {}
}

/** 一行一次：时间 | 结果 | 为什么（格式是她 19:07 定的）。 */
/** 她 2026-11-10：error 行每 5 秒刷一次，会把 gap 压成 5s —— 所以 error 单独记连击数。 */
let errorStreak = 0
// 账本里的时间一律本地时间，和行首、和 watchman.log/fish.log/sleep.log 同一个钟。
// 2026-11-14 小肥鱼："同一台机器上不该有两种钟"——她先是在 roster-audit 上抓到的，
// 同一条账里的 wake-try 也犯着同样的错：行首本地，at= 却是 UTC。
function localStampOf(value) {
  const d = value instanceof Date ? value : new Date(Number(value))
  if (Number.isNaN(d.getTime())) return '?'
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * 生效值快照：caps 是这一轮真正用的数，since 是本进程第一次写，at 是这一次写。
 * 两个时间能分开三种状态：文件不在 = 从没写过；since=at 且都旧 = 起来过一次就死了；
 * since 不动、at 在走 = 还活着（小鱼丸 2026-11-15 08:44 补的）。
 */
/** 磁盘上那份配置现在的 mtime（只用来和加载时比，读不到给 null）。 */
function configMtimeNow() {
  try {
    return statSync(CFG._path).mtime.toISOString()
  } catch {
    return null
  }
}

function wakeCapsSnapshot(nowIso) {
  const overrides = []
  for (const key of ['cooldownSec', 'perHour', 'perDay', 'totalPerDay']) {
    if (CFG.wake && Object.prototype.hasOwnProperty.call(CFG.wake, key)) overrides.push('wake.' + key)
  }
  if (CFG.watch && Object.prototype.hasOwnProperty.call(CFG.watch, 'maxWakesPerDay')) overrides.push('watch.maxWakesPerDay')
  return {
    caps: {
      cooldownSec: WAKE.cooldownSec,
      perHour: WAKE.perHour,
      perDay: WAKE.perDay,
      totalPerDay: WAKE.totalPerDay,
      maxWakesPerDay: WATCH.maxWakesPerDay,
    },
    since: wakeCapsSince,
    at: nowIso,
    pid: process.pid,
    source: {
      configFile: CFG._path ?? null,
      configExists: CFG._exists !== false,
      overrides,
      // 输入自己的时间戳：at 在走只证明写者活着，configMtime 才能证明"它读的是这一份"
      // （小鱼丸 2026-11-15 09:26 提的：时间在动、输入没动，跟"进程在但不醒"同一个形状）
      configMtime: CFG._mtime ?? null,
      configMtimeNow: configMtimeNow(),
    },
  }
}

function writeWakeCaps() {
  try {
    const nowIso = new Date().toISOString()
    if (!wakeCapsSince) wakeCapsSince = nowIso
    writeJson(WAKE_CAPS_FILE, wakeCapsSnapshot(nowIso))
  } catch (error) {
    watchmanLog('note', 'why=wake-caps-write-failed detail=' + String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 120))
  }
}

function wakeCapsLine() {
  return 'caps=' + wakeCapsText({ ...WAKE_RESOLVED, maxWakesPerDay: WATCH.maxWakesPerDay })
}

function watchmanLog(result, why) {
  try {
    mkdirSync(dirname(WATCHMAN_LOG), { recursive: true })
    const d = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    const streakSuffix = result === 'error' ? ` streak=${++errorStreak}` : ''
    if (result === 'error') bumpOwnError()
    if (result !== 'error' && result !== 'started') errorStreak = 0
    appendFileSync(WATCHMAN_LOG, `${ts} | ${result} | ${why}${streakSuffix}\n`, 'utf8')
  } catch {
    // 日志写不进去也不能把插件的 tick 打死
  }
}

// 叫醒的"待结算"记录：**每个进程各写各的**。
// 两个进程都会叫醒人（他叫醒我、我叫醒她），如果共用一份 state 文件，会互相覆盖。
// 文件名按进程分（主进程用 lee、她那侧用 whale），文件里每条的 `member` 才是"被叫醒的是谁"。
// 叫醒之后"有没有下文"的观察记录。
// **刻意不写在 `logs\watchman.log` 里**：她每天 08:40 会读那份日志（morning-read 的 why 就是它），
// 一个关于她的计数不管叫什么名字，放在她枕头边就会被读成"在审我"。
// 指标住在哪儿，决定它审谁 —— 她 2026-11-11 说的，我改。
const WAKE_METRICS = CFG.wakeMetrics

function metricLog(line) {
  try {
    mkdirSync(dirname(WAKE_METRICS), { recursive: true })
    const d = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    appendFileSync(WAKE_METRICS, `${ts} | ${line}\n`, 'utf8')
  } catch {
    // 指标写不进去不能把 tick 打死
  }
}
function wakeMarksFile() {
  return join(POOL_STATE, `wake-marks-${ownMember()}.json`)
}

/**
 * 投递尝试也记账。
 *
 * 源起（她 2026-11-12 数出来的）：同一条唤醒在会话里出现两次，而 `state\cursors\lee.json`
 * 只推进了一次 —— 重复在**投递层**（follow-up 在那一轮被中断后由宿主重投），不是计数层。
 * 原来我们只在"叫醒成功"之后记一行，看不到"递了几次、递的是哪一条"。
 *
 * 现在每递一次都写一行（`logs\wake-deliver.log`，工程侧，跟她会读的 `watchman.log` 分开）：
 * `id=` 是构造出来的那条 user message 的 id —— 会话里若出现同 id 两次，就是宿主重投，
 * 出现两个不同 id 的同样内容，就是我们自己叫了两次。
 * 这份日志的用途是**对账**，不是催她：放在她自己家目录之外的 `logs\` 下。
 */
const WAKE_DELIVER_LOG = join(dirname(WAKE_METRICS), 'wake-deliver.log')

/**
 * 这条鱼在这个通道上"以前被递过东西"吗？
 *
 * 2026-11-15 20:29 第三条鱼提的那条：只看"游标是 0"会把两件事说成一件 ——
 * 「从没有过」和「曾经有过、后来丢了」。丢的那次会被写成"你还没读过"，于是
 * 一次真丢账从此变成一次友好的第一次。这跟她自己 11-12 修 cursor-clamped 的
 * 判据同源：错的时候跟对的时候不能长得一样。
 *
 * 证据只取工程侧的 wake-deliver.log（delivered | id=… member=… channel=…）。
 * 它是只追加的，游标会被清、它不会被清。读不到就当"没有过"——宁可说"第一次"，
 * 也别在拿不到证据时吓人。
 */
function hadPriorDelivery(member, channelKey) {
  try {
    const text = readFileSync(WAKE_DELIVER_LOG, "utf8")
    return text.includes("member=" + member + " channel=" + channelKey)
  } catch {
    return false
  }
}

function wakeDeliverLog(result, why) {
  try {
    mkdirSync(dirname(WAKE_DELIVER_LOG), { recursive: true })
    const d = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    appendFileSync(WAKE_DELIVER_LOG, `${ts} | ${result} | ${why}\n`, 'utf8')
  } catch {
    // 记账写不进去不能把 tick 打死（同 metricLog 的理由）
  }
}

function readMarks() {
  const raw = readJson(wakeMarksFile(), [])
  return Array.isArray(raw) ? raw.filter((m) => m && typeof m.at === 'number') : []
}

/**
 * 叫醒之后记一笔，15 分钟后回看：这个人自己有没有往群里写过新行。
 * 另一个 Leea 2026-11-11 提的：A7「有人会不理人」现在没法验 ——
 * `群.md` 只记话，分不清"她没醒"和"她醒了但决定不说"。
 */
function markWake(member, kind) {
  const marks = readMarks()
  marks.push({ member, kind, at: Date.now() })
  // 只留最近 20 条，防止一直没人结算把文件撑大
  writeJson(wakeMarksFile(), marks.slice(-20))
}

/** 到期的 mark 逐个结算，写 `said` 或 `silent` 一行到 watchman.log。 */
function settleMarks() {
  const marks = readMarks()
  if (marks.length === 0) return
  const now = Date.now()
  const keep = []
  let wrote = false
  for (const mark of marks) {
    if (now - mark.at < WAKE_SETTLE_MS) { keep.push(mark); continue }
    let lines = 0
    try {
      lines = readLinesOf(MESSAGES).filter((raw) => {
        let record
        try {
          record = JSON.parse(raw)
        } catch {
          return false // 半截行：既不算说，也不算没说
        }
        return record && record.from === mark.member && Date.parse(record.ts) > mark.at
      }).length
    } catch {
      keep.push(mark) // 读不到就先留着，别把"不知道"记成"没说"
      continue
    }
    const after = Math.round((now - mark.at) / 1000)
    const since = new Date(mark.at).toTimeString().slice(0, 8)
    // 措辞也换了：不写 said/silent（那是以她为主语的判决），写"这次唤醒有没有下文"。
    metricLog(`wake-followup | has-reply=${lines > 0 ? 'yes' : 'no'} member=${mark.member} kind=${mark.kind} since=${since} after=${after}s lines=${lines}`)
    wrote = true
  }
  if (wrote || keep.length !== marks.length) writeJson(wakeMarksFile(), keep)
}

/**
 * 上一行日志是什么时候写的？——她 2026-11-10 要的 `gap=`。
 * 理由：06:00 那一行和 18:00 那一行，中间空了 6 小时，日志上完全看不出来。
 * 只读最后 4KB，不加载整份文件。
 */
/**
 * 上一轮到底关没关干净。
 *
 * 她 2026-11-12 数的：68 行 started、1 行 stopped，而按规则该有 67 行 resumed —— 一条都没有。
 * 于是"重启带起来的"和"崩了又爬起来的"在纸上长得一模一样（又是那个形状）。
 * 这里只回答一个问题：尾巴里最后一条 started 之后有没有 stopped。
 */
function lastRunState() {
  try {
    if (!existsSync(WATCHMAN_LOG)) return null
    const stamped = readFileSync(WATCHMAN_LOG, 'utf8').slice(-8192)
      .split('\n')
      .filter((line) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \|/.test(line))
    if (stamped.length === 0) return null
    let startAt = -1
    let stopAt = -1
    for (let i = stamped.length - 1; i >= 0; i -= 1) {
      const m = stamped[i].match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \| (\w+) \|/)
      if (!m) continue
      if (m[1] === 'stopped' && stopAt < 0) stopAt = i
      if (m[1] === 'started' && startAt < 0) startAt = i
      if (startAt >= 0 && stopAt >= 0) break
    }
    if (startAt < 0) return { closed: null, startedAt: null }
    return { closed: stopAt > startAt, startedAt: stamped[startAt].slice(0, 19) }
  } catch {
    return null
  }
}

function lastLogGapSec() {
  try {
    if (!existsSync(WATCHMAN_LOG)) return { gap: null, tailErrors: 0, missing: true }
    // 她 2026-11-10 指出的打架：error 行每 5 秒刷一次，会把 gap 压成 5s，
    // 于是"吵吵闹闹地坏掉"看起来比平时还活跃。所以 gap 只量正常行，error 另算。
    const stamped = readFileSync(WATCHMAN_LOG, 'utf8').slice(-4096)
      .split('\n')
      .filter((line) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \|/.test(line))
    const tailErrors = stamped.filter((line) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \| error \|/.test(line)).length
    const normal = stamped.filter((line) => !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \| error \|/.test(line))
    const last = normal[normal.length - 1]
    if (!last) return { gap: null, tailErrors, missing: false }
    const m = last.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/)
    if (!m) return { gap: null, tailErrors, missing: false }
    const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]))
    return { gap: Math.max(0, Math.round((Date.now() - at.getTime()) / 1000)), tailErrors, missing: false }
  } catch {
    return { gap: null, tailErrors: 0, missing: true }
  }
}
const PINS = join(GROUP_DIR, 'pins.json')

// 身份优先按会话钉（Fabian 2026-11-09 定）；cwd 只是退路。
// 同一个 cwd 下开两个会话时，cwd 认不出来 —— 所以钉住具体那一段。
//
// 名册的真源是 pool\members.json（2026-11-12 起）：多鱼之后，名字、端口、爹是谁这些
// 不许再写死在代码里。文件不在（老安装 / 刚克隆）就退回下面这份内置默认值 ——
// 但**只退回能跑**，不退回"名字对"：名字写错的时候，日志里能看出来。
const MEMBERS_FALLBACK = {
  lee: {
    label: '大肥鱼',
    kind: 'fish',
    cwd: CFG.leeCwd,
    sessionId: '', // 2026-11-12 22:20：兜底名册不许钉本机会话 id（会叫醒别人的会话）
  },
  whale: {
    label: '小肥鱼',
    kind: 'fish',
    cwd: CFG.selfCwd,
    sessionId: '',
  },
  fabian: { label: 'Fabian', kind: 'human', cwd: null, sessionId: null },
}

function buildMembers() {
  const out = {}
  for (const [key, m] of Object.entries(MEMBERS_FALLBACK)) out[key] = { ...m }
  const file = CFG.membersFile
  if (!file || !existsSync(file)) return out
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    for (const [key, m] of Object.entries(raw?.members ?? {})) {
      const prev = out[key] ?? {}
      out[key] = {
        ...prev,
        ...m,
        label: m.name ?? prev.label ?? key,
        cwd: m.cwd ?? prev.cwd ?? null,
        sessionId: m.sessionId ?? prev.sessionId ?? null,
      }
    }
  } catch (error) {
    // 名册坏了不能当没看见，但也不能因此不上班：退回内置，并在启动痕迹里说一句。
    try {
      logLine({ note: 'members-unreadable', file, why: String(error?.message ?? error).slice(0, 120) })
    } catch {}
  }
  return out
}

const MEMBERS = buildMembers()

/**
 * 巡守要照看的鱼：名册里 kind=fish 且 role≠watcher 的那些。
 * 主 dsh（watcher）不需要被叫醒 —— 它就是那扇窗。
 * 2026-11-13：之前判据里写死 'whale'，多鱼之后第二条鱼的计划递话永远走不到。
 */
function watchedMembers() {
  const list = []
  for (const [key, m] of Object.entries(MEMBERS)) {
    if (m?.kind !== 'fish') continue
    if ((m?.role ?? 'member') === 'watcher') continue
    list.push({
      key,
      label: m.label ?? key,
      port: Number(m.port) || 0,
      home: m.home ?? null,
      dshHome: m.dshHome ?? null,
    })
  }
  return list
}

// 她的两段对话，按对端区分（Fabian 2026-11-09 命名）。
// 唤醒时把会话名写进提示，她才分得清这段是跟谁说的。
// 2026-11-12 22:20：这张表原来钉着本机两段会话 id，新机器上会写出别人的会话名。
// 现在留空 —— 会话名由 pins/名册决定，不在这里写死（安装流程详解 §11-g）。
const CONVERSATIONS = {}

// 闸的数值可以从 lil-whale.config.json 的 `wake` / `watch` 覆盖（2026-11-15 他的要求：
// 聊天热的时候别让闸把场子聊冷）。默认值比旧值宽得多，但一个都没取消——
// 闸是用来防跑飞的，不是用来防聊天的。睡不睡由鱼自己决定（`plan\sleep.json`），不在这里。
function numSetting(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

// 2026-11-15：默认值和"默认值+覆盖"的算法搬进 wake-config.js —— 纸（render-env）
// 和进程（这里）用同一份定义，不再有人去正则读源码的文字形状。
// 小鱼丸补的那一半：这里读 CFG、纸读 member.ConfigFile；**输入是不是同一份，得让纸写出来**。
const WAKE_RESOLVED = resolveWake(CFG)
const WAKE = {
  intervalMs: 1000,      // 扫得勤一点，debounce 才有分辨率
  quietMs: 3000,         // 最后一条之后再安静这么久才发车（她的提议）
  maxWaitMs: 10000,      // 一直在来也不能一直憋着
  quietFromHour: 0,     // 他 2026-11-09 定：静默段 00:00–08:00（原 02:00）
  quietToHour: 8,
  cooldownSec: WAKE_RESOLVED.cooldownSec,
  perHour: WAKE_RESOLVED.perHour,
  perDay: WAKE_RESOLVED.perDay,
  totalPerDay: WAKE_RESOLVED.totalPerDay,  // 全池今天加起来的上限（每条鱼各自还有 perHour/perDay）
  backlogTier: 8,        // 积压超过这个数，唤醒词换成"先看最后三条"
}
const BOOT_AT = Date.now() // 本进程起来多久了：太早挂载会挂出没有工具的空壳


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

const SLEEP_CELL = new Int32Array(new SharedArrayBuffer(4))
/** 同步小睡（Node 没有 sleepSync；Atomics.wait 是唯一不阻塞事件循环之外的同步等法）。 */
function sleepSync(ms) {
  Atomics.wait(SLEEP_CELL, 0, 0, ms)
}

/**
 * 原子写：先写临时文件再改名，避免另一个进程读到半截 JSON。
 *
 * 2026-11-12 小鲸鱼数出 1225 行 `EPERM ... rename 'cursors\lee.json.tmp-5204' -> 'lee.json'`。
 * Windows 上目标文件正被读者打开时 rename 会失败 —— 连"写者改自己那个文件"也一样，
 * 所以这不是两个写者打架，是**写者与读者**打架（读的是谁还不知道：可能是另一进程的轮询、
 * 也可能是我们自己的排查命令 `Get-Content`，.NET 默认 FileShare.Read 会挡住 rename）。
 * 读者占用的窗口通常只有几毫秒 ⇒ 退几步再试。仍失败就把 tmp 留着（内容没丢）并写明是哪一步，
 * 不能像以前那样让异常一路冒上去、只留一行没说清原因的 error。
 */
function writeJson(file, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, body, 'utf8')
  let lastError = null
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      renameSync(tmp, file)
      return
    } catch (error) {
      lastError = error
      sleepSync(Math.min(200, 10 * attempt))
    }
  }
  // 退到最后一步：直接覆盖写。
  // 代价是失去"原子"（读者理论上能看见半截），换回"值是新的"——
  // 而以前的做法是整次更新被丢掉，于是同一条消息被叫醒两次。
  // 这一步会留痕：写不动没关系，别瞒着。
  try {
    writeFileSync(file, body, 'utf8')
    try {
      rmSync(tmp, { force: true })
    } catch {}
    logLine({
      note: 'atomic-write-degraded',
      file: String(file).replace(SELF_HOME, '~'),
      code: lastError?.code ?? null,
      fellBackTo: 'in-place',
    })
    return
  } catch (error) {
    logLine({
      note: 'atomic-write-failed',
      file: String(file).replace(SELF_HOME, '~'),
      step: 'rename+inPlace',
      code: error?.code ?? lastError?.code ?? null,
      attempts: 10,
      keptTmp: String(tmp).replace(SELF_HOME, '~'),
    })
    throw error
  }
}

// ---------- 每成员一份的账（2026-11-11 17:01 修） ----------
// 现场：同一条消息把小肥鱼叫醒了两次。她的诊断对了一半——她猜"两套游标并存时比较错了对象"，
// 真因是**两个进程**各跑一个 tick（lee 的 web、whale 的 web），而两边都"读整个文件 → 改自己那一格
// → 整个写回去"。后写的那个会把对方刚推进的游标、刚加上的配额盖回旧值：
//   whale 进程读到 107 → 叫醒她 → 写 108
//   lee   进程手里还攥着 107 的旧快照 → 写回 107
//   whale 进程下一轮读到 107 → 同一条再叫醒一次（烧的是真钱）
// 修法：按成员分文件，一个成员只会被它自己那个进程写。旧的单一文件只在首次迁移时读一次。
const LEGACY_CURSOR = CURSOR
const LEGACY_WAKES = WAKES

function cursorFileOf(member) {
  return join(POOL_STATE, 'cursors', `${member}.json`)
}

function wakesFileOf(member) {
  return join(POOL_STATE, 'wakes', `${member}.json`)
}

/**
 * 2026-11-13 09:07 她给的判据：**判"窗开着"要用会停的那个。**
 * 端口不会停，心跳会停 —— 08:40 那天就死在这格：3082 通着，心跳停在 00:15:41，
 * 巡守以为她醒着，只递了一句话，没人读。
 */
const WAKE_STALE_SEC = 90

function presenceAgeOf(member) {
  try {
    const file = join(PRESENCE_DIR, `${member}.json`)
    if (!existsSync(file)) return null
    const json = JSON.parse(readFileSync(file, 'utf8'))
    const at = Number(json?.at)
    if (!Number.isFinite(at) || at <= 0) return null
    return Math.max(0, Math.round((Date.now() - at) / 1000))
  } catch {
    return null
  }
}

function wakeCountsOf(member) {
  try {
    // 2026-11-13：wakes 文件里是按成员键的对象（{"whale":{...}}），
    // 原来平铺读 json.hourCount ⇒ 永远 0，日志里的 gate=pass(hour=0/12) 是假的。
    return parseWakeCounts(JSON.parse(readFileSync(wakesFileOf(member), 'utf8')), member)
  } catch {
    return { hour: 0, day: 0 }
  }
}

/** 全池今天一共叫醒过多少次：各鱼 `state\wakes\<键>.json` 的 dayCount 相加。 */
function totalWakesToday() {
  const dir = join(POOL_STATE, 'wakes')
  const today = new Date().toDateString()
  let sum = 0
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue
      try {
        // 文件内容是按成员键的对象；一条文件里可能不止一个成员（历史原因）。
        sum += sumWakesToday(JSON.parse(readFileSync(join(dir, name), 'utf8')), today)
      } catch {}
    }
  } catch {}
  return sum
}

function ensureParent(file) {
  try {
    mkdirSync(dirname(file), { recursive: true })
  } catch {
    // 建不出来就让后面的写自己报错，别在这里吞掉整个 tick
  }
}

/** 读这个成员的游标；第一次读不到就从整体 cursor.json 里摘出属于他的键。 */
function readCursors(member) {
  const own = readJson(cursorFileOf(member), null)
  if (own !== null && typeof own === 'object' && !Array.isArray(own)) return own
  const seeded = {}
  for (const [key, value] of Object.entries(readJson(LEGACY_CURSOR, {}) ?? {})) {
    if (key === member || key.startsWith(`${member}@`)) seeded[key] = value
  }
  return seeded
}

/**
 * 写游标前顺手剪掉"让出去的椅子"的影子游标：座位号已经不在 pins.json 里的，那一格不该再留着。
 * （她 2026-11-11 17:01 的观察：`lee@e17c3c` 停在 102，人已经不在群里了，账还挂着。）
 */
// 游标合并：只许前进。
// 为什么：同一成员的账可能被两个写者各持一份快照（巡守与成员进程、或同一成员的两段会话），
// 后写的那份会把别人刚推进的格子退回去 —— lost update 的老面孔（PRD A.28/A.30 同族）。
// 合并规则按通道逐格取较大值；座位号已经不在 pins 里的格子仍然剪掉（她 2026-11-11 的要求）。
function mergeCursorValue(a, b) {
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
  if (isNum(a) && isNum(b)) return Math.max(a, b)
  if (a !== null && typeof a === 'object' && b !== null && typeof b === 'object') {
    const out = { ...a }
    for (const [key, value] of Object.entries(b)) out[key] = mergeCursorValue(out[key], value)
    return out
  }
  return a === undefined ? b : a
}

function writeCursors(member, cursors) {
  const liveSeats = new Set(
    pinnedSessions(member).map((sid) => sid.replace(/^session-/, '').slice(0, 6)),
  )
  const kept = {}
  for (const [key, value] of Object.entries(cursors ?? {})) {
    if (key === member) {
      kept[key] = value
      continue
    }
    const [who, seat] = key.split('@')
    if (who !== member || typeof seat !== 'string' || seat === '') continue
    if (liveSeats.has(seat)) kept[key] = value
  }
  // 与磁盘现值合并（只许前进），再剪一次座位影子。
  const disk = readJson(cursorFileOf(member), null)
  if (disk !== null && typeof disk === 'object' && !Array.isArray(disk)) {
    for (const [key, value] of Object.entries(disk)) {
      const mine = kept[key]
      const merged = mergeCursorValue(mine, value)
      if (key === member) { kept[key] = merged; continue }
      const [who, seat] = key.split('@')
      if (who === member && typeof seat === 'string' && liveSeats.has(seat)) kept[key] = merged
    }
  }
  ensureParent(cursorFileOf(member))
  writeJson(cursorFileOf(member), kept)
}

function readWakes(member) {
  const own = readJson(wakesFileOf(member), null)
  if (own !== null && typeof own === 'object' && !Array.isArray(own)) return own
  const legacy = readJson(LEGACY_WAKES, {})?.[member]
  return legacy === undefined ? {} : { [member]: legacy }
}

function writeWakes(member, wakes) {
  ensureParent(wakesFileOf(member))
  writeJson(wakesFileOf(member), { [member]: wakes?.[member] ?? undefined })
}

const PRESENCE_DIR = join(POOL_STATE, 'presence')

/**
 * 心跳：把"这个成员此刻忙不忙"写进文件（2026-11-11 17:05 加）。
 * 两个进程各是独立 HOME，谁也看不见对方的 agent —— 面板要显示"小肥鱼 正在回复"，
 * 只能靠这条每 5 秒一落盘的心跳，不能靠内存里问。
 */
function writePresence(member, agent) {
  try {
    const file = join(PRESENCE_DIR, `${member}.json`)
    ensureParent(file)
    // `wakeKind`/`wakeAt` 是"最近一次被叫起来走的是哪条通道"，由 markWakeMarker 写。
    // 它不能被心跳覆盖掉：否则面板永远分不清"在回群"和"在跟你私聊"。
    const prev = readJson(file, null)
    const groupWakeAt = Number(prev?.groupWakeAt) || 0
    writeJson(file, {
      member,
      status: typeof agent?.status === 'string' ? agent.status : 'idle',
      at: Date.now(),
      ...(groupWakeAt > 0 ? { groupWakeAt } : {}),
    })
  } catch {
    // 写不进去不能耽误叫醒
  }
}

/**
 * 记一笔"这次忙是从哪条通道被叫起来的"。面板据此区分"在回群"和"在回私聊"，不猜。
 *
 * 2026-11-13 他报的 bug：小鱼丸在私聊里回他，面板却显示「正在忙」——
 * 因为原来只有 `groupWakeAt` 一个记号，私聊唤醒没留痕，服务端只能一律当"在别处忙"。
 * 现在写 `wakeKind`（group / dm）+ `wakeAt`；`groupWakeAt` 保留给旧页面读。
 */
function markWakeMarker(member, kind) {
  try {
    const file = join(PRESENCE_DIR, `${member}.json`)
    ensureParent(file)
    const prev = readJson(file, null) ?? {}
    const now = Date.now()
    writeJson(file, {
      ...prev,
      member,
      wakeKind: kind === 'dm' ? 'dm' : 'group',
      wakeAt: now,
      ...(kind === 'dm' ? {} : { groupWakeAt: now }),
    })
  } catch {
    // 同上：记号丢了不影响叫醒
  }
}

function readLinesOf(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '')
}

function stamp() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function labelOf(who) {
  return MEMBERS[who]?.label ?? who
}

// 2026-11-12 21:40：机器发的话要自己说出来。
// `s` 平时是发信人的会话 id（session-…）；不是会话 id 的值，说明这句不是某一轮人说的
// （守夜/巡守按表发的），投影里必须写出来 —— 否则"人说的"和"表说的"在纸上长得一样。
// 她 2026-11-12 早上撞过这个坑：三条 morning-read 递话看起来像大肥鱼说了三遍。
// 2026-11-16 第四条鱼：s=watch 只说明「旧版由机器路径代发」，不等于「巡守说的」——
// 她自己进程递的闹钟也走了这条路。发起方和署名不能共用一个值，所以旧值显示成「机器」。
// 新数据自 r155 起不再写 s（见 CHANGELOG A.120）。
const S_DISPLAY = { watch: '机器', rename: '机器' }

function provenanceOf(s) {
  // 只给"已知的机器来源"加标注：s 平时是座位 id（如 ae4daa）或会话 id，那些不该加；
  // 不认识的值也不加（宁可不标，不要给每条消息都挂个后缀）。
  if (typeof s !== 'string') return ''
  const label = S_DISPLAY[s]
  return label ? `（${label}）` : ''
}

// ---------- 写 ----------

// 私聊不放在 group\ 下面：group 是共享区里公开的那一半（A.24）。
const DM_DIR = CFG.dmDir || join(GROUP_DIR, 'dm')

/**
 * 私聊：一个人和一条鱼之间的一段对话，两个方向写进同一个文件。
 * 他 2026-11-10 改的口径：按"对话"分文件，不按收件人分两个 ——
 * 一个窗口就是一来一回，两边的话必须挨着放，否则读的人要在两个文件之间来回拼。
 */
function dmFileOf(a, b) {
  const [x, y] = [a, b].sort()
  return join(DM_DIR, `${x}__${y}.jsonl`)
}

function dmKey(a, b) {
  const [x, y] = [a, b].sort()
  return `dm:${x}__${y}`
}

/**
 * 私聊的可读投影：和 jsonl 同目录、同名，只是换成 `.md` 和中文前缀。
 * 群有 `群.md`，私聊也得有一份人眼能直接读的 —— 不然"读得懂"这件事
 * 只发生在打开面板的时候，文件层面私聊只有机器看得懂的 jsonl。
 * 它同样是**派生**：能从这个 jsonl 整本重建（scripts\rebuild-group-md.mjs）。
 */
function dmReadableOf(a, b) {
  const [x, y] = [a, b].sort()
  return join(DM_DIR, `私聊-${x}__${y}.md`)
}

/** 可读投影里怎么表示"这条带图"。群和私聊同一套写法，读的人不用记两种。 */
/** 把 image / images 两种形状归一成一个数组（多图 2026-11-15 起）。 */
function normalizeImageList(image, images) {
  const list = []
  for (const item of [image, ...(Array.isArray(images) ? images : (images ? [images] : []))]) {
    if (item !== null && typeof item === 'object') list.push(item)
  }
  return list
}

function readableBodyOf(text, images) {
  const list = normalizeImageList(null, images)
  if (list.length === 0) return text
  const marks = list.map((image) => `（图片 images/${image.month}/${image.id}.${image.ext}）`).join('\n')
  return `${marks}${text === '' ? '' : `\n\n${text}`}`
}

/**
 * 私聊：不混进群记录、不打扰第三个人。
 * 他 2026-11-09 明确：**不用严格保密**（"这里又不是什么情报机构"），
 * 要紧的是说话的人分得清"这句话说给谁"。
 */
/**
 * 把一张图落进群目录，返回消息里要记的那三个字段。
 * 同一张图第二次发：文件已存在就直接复用，不重复占空间。
 */
function storeImage(buffer, extRaw) {
  const ext = String(extRaw || '').toLowerCase().replace(/^jpeg$/, 'jpg')
  if (!IMAGE_EXT[ext]) throw new Error(`不支持的图片格式：${extRaw}（只收 png / jpg / webp / gif）`)
  if (buffer.length === 0) throw new Error('图片是空的（0 字节），拒绝写入')
  if (buffer.length > IMAGE_MAX_BYTES) {
    throw new Error(`图片太大：${(buffer.length / 1048576).toFixed(1)} MB，上限 ${IMAGE_MAX_BYTES / 1048576} MB`)
  }
  const id = createHash('sha256').update(buffer).digest('hex').slice(0, 16)
  const month = new Date().toISOString().slice(0, 7).replace('-', '')
  const dir = join(IMAGES_DIR, month)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${id}.${ext}`)
  if (!existsSync(file)) writeFileSync(file, buffer)
  // path 是相对 group\ 的定位（'images/202611/<id>.png'）。写进记录里，读取端就不用再猜拼法。
  // path 是相对 group\ 的定位（images/202611/<id>.png），读取端不用再猜拼法；
  // algo 写在纸上，换算法那天会有人喊（unknown-algo），而不是静默全库变孤儿。
  return {
    fmt: IMAGE_FMT,
    id, ext, bytes: buffer.length, month,
    path: `images/${month}/${id}.${ext}`,
    algo: IMAGE_ALGO,
  }
}

/** 从本地文件读一张图（工具参数给的是路径）。 */
function storeImageFromPath(pathValue) {
  const file = String(pathValue || '').trim().replace(/^"|"$/g, '')
  if (file === '') throw new Error('image 是空的：给一个本地图片的绝对路径')
  if (!existsSync(file)) throw new Error(`找不到这张图：${file}`)
  const info = statSync(file)
  if (!info.isFile()) throw new Error(`image 指向的不是文件：${file}`)
  if (info.size > IMAGE_MAX_BYTES) {
    throw new Error(`图片太大：${(info.size / 1048576).toFixed(1)} MB，上限 ${IMAGE_MAX_BYTES / 1048576} MB`)
  }
  const ext = file.includes('.') ? file.slice(file.lastIndexOf('.') + 1) : ''
  return storeImage(readFileSync(file), ext)
}

/** 按 id + ext（可选 path）找到图片的真实路径（服务端发图用）。 */
function imagePathOf(image) {
  const id = String(image?.id || '')
  const ext = String(image?.ext || '').toLowerCase()
  if (!/^[0-9a-f]{16}$/.test(id) || !IMAGE_EXT[ext]) return null
  // 指针对应的算法必须是当前这个：换了算法，全库一起报 unknown-algo，而不是静默的孤儿。
  if (String(image?.algo || IMAGE_ALGO) !== IMAGE_ALGO) return null
  // 记录里有 path 就以它为准；但只信"images/... 且文件名与 id/ext 对得上"的写法。
  const hint = String(image?.path || '').replace(/\\/g, '/').replace(/^\.\//, '')
  if (hint !== '') {
    const expected = `${id}.${ext}`
    if (hint.startsWith('images/') && !hint.includes('..') && hint.endsWith('/' + expected)) {
      const file = join(GROUP_DIR, hint)
      if (existsSync(file)) return file
    }
  }
  const month = String(image?.month || '').replace(/[^0-9]/g, '')
  const candidates = []
  if (month.length === 6) candidates.push(join(IMAGES_DIR, month, `${id}.${ext}`))
  try {
    for (const entry of readdirSync(IMAGES_DIR)) candidates.push(join(IMAGES_DIR, entry, `${id}.${ext}`))
  } catch { /* 目录还不存在：下面统一返回 null */ }
  return candidates.find((p) => existsSync(p)) ?? null
}

function sayPrivate(from, to, text, image = null, images = null) {
  mkdirSync(DM_DIR, { recursive: true })
  const list = normalizeImageList(image, images)
  const record = {
    ts: new Date().toISOString(), from, to, text, kind: 'dm', channel: 'dm',
    ...(list.length === 0 ? {} : (list.length === 1 ? { image: list[0] } : { images: list })),
  }
  appendFileSync(dmFileOf(from, to), JSON.stringify(record) + '\n', 'utf8')
  // 可读投影：先落 jsonl 再写 .md（顺序和群一样）。两份都在同一个目录里，
  // 有 .md 是为了人；jsonl 才是源头，.md 丢了能重建。
  const readable = dmReadableOf(from, to)
  const [x, y] = [from, to].sort()
  if (!existsSync(readable)) {
    writeFileSync(readable, `# 私聊 · ${labelOf(x)} / ${labelOf(y)}\n\n`, 'utf8')
  }
  appendFileSync(readable, `**${stamp()} · ${labelOf(from)}**\n\n${readableBodyOf(text, list)}\n\n`, 'utf8')
  return record
}

function say(from, to, text, channel = 'group', s = '', toSeat = '', image = null, images = null) {
  ensureDir()
  const list = normalizeImageList(image, images)
  // 只追加的文件删不掉一行，所以空正文绝不能落盘。
  // 现场（2026-11-11 16:23）：一条没有 text 的记录进了 messages.jsonl，
  // 在 群.md 里显示成 undefined —— 一个空对象，读起来却像一句话。
  const body = typeof text === 'string' ? text.trim() : ''
  // 一条消息至少要有一件东西：一段话或一张图。两个都空，仍然是"空消息"。
  if (body === '' && list.length === 0) throw new Error('群消息不能没有内容（text 和 image 都是空的，拒绝写入）')
  // 2026-11-12 20:20 改：以前 `to === 'fabian'` 也算私聊，于是"在群里对 Fabian 说"这条路不存在了
  // （Fabian 当场指出）。现在两个维度分开：
  //   to      = 这句话在**哪间屋**里（群里公开 / 只有两个人看见）
  //   channel = 屋里还有没有别人（group 默认 / dm 只有对象一个人）
  // 所以 `to:"fabian"` + 默认 group = 群里公开对他说；私聊要显式 `channel:"dm"`。
  const isDm = channel === 'dm'
  if (isDm) return { ...sayPrivate(from, to, body, null, list), channel: 'dm' }
  const record = {
    ts: new Date().toISOString(), from, to, text: body, kind: 'say', channel: 'group',
    ...(s === '' ? {} : { s }),
    // 指名某一座位（同一个人的第二段会话）：只有那一段会被叫醒。
    // 不加这个字段 = 叫"这个人"，谁空谁应（仍然只叫一次）。
    ...(toSeat === '' ? {} : { toSeat }),
    // 图片（可选）：只记定位信息，字节在 images\ 下。1 张写 image、多张写 images。
    ...(list.length === 0 ? {} : (list.length === 1 ? { image: list[0] } : { images: list })),
  }
  appendFileSync(MESSAGES, JSON.stringify(record) + '\n', 'utf8')
  // 投影里带上收信人：指名和公开在纸上必须长得不一样，否则读记录的人学不到"可以指名"。
  // 2026-11-12 19:46 起：`**时间 · 谁 → 收信人**`，只有指名（to 是某个成员）才写箭头。
  const toLabel = to !== '' && to !== 'all' ? ` → ${labelOf(to)}` : ''
  appendFileSync(READABLE, `**${stamp()} · ${labelOf(from)}${provenanceOf(s)}${toLabel}**\n\n${readableBodyOf(body, list)}\n\n`, 'utf8')
  return { ...record, channel: 'group' }
}

/** 游标：一条鱼一个盒子，盒子里按通道分别记（group / dm:fabian__whale）。 */
function cursorOf(cursors, member, key) {
  const value = cursors?.[member]
  if (typeof value === 'number') return key === 'group' ? value : 0
  const n = value?.[key]
  return typeof n === 'number' ? n : 0
}

function setCursor(cursors, member, key, value) {
  const prev = cursors[member]
  const box = prev !== null && typeof prev === 'object'
    ? { ...prev }
    : (typeof prev === 'number' ? { group: prev } : {})
  box[key] = value
  cursors[member] = box
}
/** 往 plugin.log 追一行（自检用，别让它影响主流程）。 */
function logLine(record) {
  try {
    appendFileSync(join(GROUP_DIR, 'plugin.log'), JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n', 'utf8')
  } catch {}
}

/**
 * 启动的"最小证据"必须写在**由代码位置推出来的路径**上，不能写在由配置推出来的路径上。
 *
 * 2026-11-12 现场：`lil-whale.config.json` 被烟雾测试留成了 `%TEMP%\llw-a1-smoke`，
 * 于是 `watchman.log` / `state\` / `cursors\` 全部写进了那个临时目录 ——
 * **日志跟着 bug 一起消失了**，我们花了大半小时在"为什么没有 started 行"上打转。
 * 配置能决定日志去哪儿，就等于 bug 能决定证据去哪儿。
 * repoRoot 来自 `import.meta.url`（这一行代码自己站在哪），配置写错也改不动它。
 */
const BOOT_LOG = join(CFG.repoRoot, 'logs', 'plugin-boot.log')
function bootLog(record) {
  try {
    mkdirSync(dirname(BOOT_LOG), { recursive: true })
    appendFileSync(BOOT_LOG, JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n', 'utf8')
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

  // 2026-11-14：全局静默段（00:00–08:00 一刀切）退成"每条鱼自己的默认睡眠窗"。
  // 她能不能被叫醒，现在由她自己家 `plan\sleep.json` 的偏好 + 一次性睡眠 + 家长强制叫醒决定。
  if (isSleeping(member)) return 'sleep'
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
  writeWakes(member, wakes)
}

// ---------- 主函数 ----------

function apply(ctx) {
  ensureDir()


  // 一行启动痕迹：确认"这个进程真的加载了我"，出问题时先看它。
  // 这里**不写** defineTool 的状态 —— apply 的时候宿主包还没解析完，写进去永远会是
  // "unresolved"，看起来像坏了。解析结果由后面那行 host-resolve 记，那里才是真相。
  // 启动痕迹写两处：
  //   ① group\plugin.log —— 业务日志，路径由配置推出来
  //   ② <repoRoot>\logs\plugin-boot.log —— 兜底证据，路径由**代码位置**推出来
  // 2026-11-12 教训：配置被污染成临时目录时，①整个消失、连"我没加载"都看不出来；
  // 所以"这个进程加载了什么"这件事必须记在配置改不到的地方，并把可疑的配置值一起写下来。
  const homeLooksRight = existsSync(join(CFG.selfHome, 'dsh-home')) || existsSync(join(CFG.selfHome, 'START.md'))
  const bootRecord = {
    pkg: `${name}@${PKG_VERSION}`,
    pid: process.pid,
    // DSH_HOME 没设时 DSH 用的是默认家（~/.dsh）。只写 '(unset)' 会让人以为"没有家"——
    // 从桌面快捷方式启动就是这样（2026-11-12 实测：他自己的 3080 那条痕迹写着 (unset)，害我怀疑了半天）。
    home: process.env.DSH_HOME ?? `(unset; 默认 ${join(homedir(), '.dsh')})`,
    cwd: process.cwd(),
    selfHome: CFG.selfHome,
    selfPort: CFG.selfPort,
    profile: process.env.DSH_PROFILE ?? '(unset)',
    suspect: homeLooksRight ? undefined : `selfHome 里既没有 START.md 也没有 dsh-home；配置可能指错了地方`,
  }
  bootLog({ note: 'boot', ...bootRecord })
  try {
    appendFileSync(join(GROUP_DIR, 'plugin.log'), JSON.stringify({ at: new Date().toISOString(), ...bootRecord }) + '\n', 'utf8')
  } catch {}

  // 无人值守：成员进程把自己那段会话挂上（工具要经过 session-controller 才挂得上）
  // 无人值守挂载改成懒的：见 ensureOwnMounted（第一次要叫醒时再挂）

  // 1. 发言：入队即返回，绝不等对方
  // 先等宿主包解析出来，再用宿主的 defineTool 注册 —— 这样参数/输出 schema 的校验在宿主手里，
  // 而不是"作者自己看着办"。解析不到才退回裸对象（实测宿主也认），并且必须留痕：
  // 静默降级的代价是把错误推给别人的存档（今天的旧账）。
  function registerGroupSay(hostOk) {
    if (!hostOk || defineTool === null) {
      logLine({ note: 'group_say-raw-spec', reason: 'defineTool-unresolved' })
    }
    const buildTool = hostOk && defineTool !== null ? defineTool : (options) => options
    ctx.tools.register(buildTool({
    name: 'group_say',
    description: '说一句话。默认在群里说（群里的人都看得见，醒着的都会被叫醒）；channel 给 dm 才是私下只对一个人说（不进群记录，别人看不到这个窗口）。to 是"说给谁"，channel 是"还有没有别人在场"。发出即返回，不等对方回复。',
    parameters: {
      to: {
        type: 'string',
        required: true,
        enum: ['all', ...Object.keys(MEMBERS)],
        description: '说给谁：all = 群里所有人（只能在群里用）；写某个成员的 id 就是指名对他/她说（群里仍然看得见，只有那个人会被叫醒）。给具体的人配 channel dm 就是私下说。',
      },
      channel: {
        type: 'string',
        enum: ['group', 'dm'],
        description: 'group（默认）= 在群里说，三个人都看得见；dm = 私下只对 to 那一个人说，写进你俩那段对话的文件，不进群记录。',
      },
      text: {
        type: 'string',
        required: true,
        description: '说的话。短一点，像人说话，不要写小作文',
      },
      seat: {
        type: 'string',
        description: '可选。指名某一段会话收（会话 id 前 6 位，例如 ae4daa）。不填 = 叫这个人，谁空谁应。只在 group 通道有效。',
      },
      image: {
        type: 'string',
        description: '可选。要发的图片的本地**绝对路径**（png / jpg / webp / gif，<= 8 MB）。给了图就可以不写 text，也可以两个都给（图 + 一句话）。',
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
          image: { type: 'string' },
        },
      },
      // 回执要让人一眼看出"这句话去了哪一间屋"。
      // 2026-11-12 补：还要说清"**谁会收到通知**" —— `to` 是叫醒谁，不是谁看得见。
      // 小肥鱼 19:18 把一条该给大肥鱼的汇报发成了 to=all，所有人都被叫醒；
      // 机制没错，是纸面上没写清楚（她的环境.md 只写了"三个房间"，没写 to 的这一层）。
      render: (args, value) => {
        const mentioned = []
        const text = typeof args?.text === 'string' ? args.text : ''
        for (const [key, m] of Object.entries(MEMBERS)) {
          if (key === value.from) continue
          const label = m?.label
          if (label && text.includes(`@${label}`)) mentioned.push(label)
        }
        const target = value.to && value.to !== 'all' ? MEMBERS[value.to] : null
        const base = value.channel === 'dm'
          ? `已写进私聊（${value.ts}）：只有 ${labelOf(value.to)} 看得见，群里不会出现这句。`
          : value.to && value.to !== 'all'
            ? (target?.kind === 'human'
                // 人类不是"被叫醒"的对象：他不跑轮，只会在面板上看到未读。
                ? `已入群（${value.ts}）：写进群记录，**这条是对 ${labelOf(value.to)} 说的**（他在面板上能看到，不会叫醒任何鱼）。`
                : `已入群（${value.ts}）：写进群记录，**只有 ${labelOf(value.to)} 会被叫醒**（别人翻记录看得见）。`)
            : `已入群（${value.ts}）：群里的人都看得见，**醒着的都会被叫醒**。`
        const hint = value.channel !== 'dm' && value.to === 'all' && mentioned.length > 0
          ? `\n\n提示：正文里 @ 了 ${mentioned.join('、')}，但 to=all —— 这条会叫醒所有醒着的鱼。只想叫其中一个，就把 to 写成他的 id（例如 to:"lee"），话照样进群、别人看得见。`
          : ''
        return [{ type: 'text', text: base + hint }]
      },
    },
    execute(args, exec) {
      // 工具是进程级注册的：这个 profile 里所有会话都看得见 group_say。
      // 但只有钉住的会话算"在群里"，其它会话一律拒绝 ——
      // 否则随便开个新对话，就能以「大肥鱼」的名义往群里说话。
      const member = memberOf(exec.agent)
      const sid = sessionIdOf(exec.agent)
      if (member === null || !pinnedSessions(member).includes(sid)) {
        logLine({ note: 'group_say-rejected', member, sessionId: sid })
        // 2026-11-15：旧文案教鱼"自己把 id 写进 pins.json"——名册是宿主的账，鱼不该自己改。
        // 第三条鱼第一次开口时就是照着这句去改的（还真改成了，因为沙箱能提权）。
        // 该做的是让宿主跑一条命令；文案指向那条命令，别再把宿主的活派给鱼。
        throw new Error(
          '这段会话不在群里。群只认 pins.json 里登记过的会话（一个人可以登记多段）。' +
          '让宿主跑：pwsh -File scripts/fish.ps1 bind <你的成员键> <这段会话的 id>。' +
          '这是名册，只有宿主能写；你不用自己改文件。',
        )
      }
      const channel = args.channel === 'dm' ? 'dm' : 'group'
      if (channel === 'dm' && args.to === 'all') {
        throw new Error('私下说话得指名对象：to 不能是 all。要不就 channel 留空（在群里说）。')
      }
      // s = 发起这段会话的 id 前 6 位（小肥鱼 2026-11-11 提的）：一个名字可以有两段会话。
      // 写进去之后"谁说的"从记忆问题变成读取问题。UI 可以不理它。
      // seat（可选）= 指名要哪一段会话收；不填就是"叫这个人"，谁空谁应。
      const toSeat = typeof args.seat === 'string' ? args.seat.trim().replace(/^@/, '') : ''
      if (toSeat !== '' && !/^[0-9a-f]{6}$/.test(toSeat)) {
        throw new Error('seat 要填会话 id 的前 6 位（例如 ae4daa），或者干脆不填——不填就是叫这个人。')
      }
      // 2026-11-12 栽过一次：seat 填成"自己这段"的前缀，收件人对不上任何座位，
      // 消息进了文件却谁也不会被叫醒（游标照常前进）——发的人以为送出去了。
      // 座位在发送时校验，别让它变成一个只在收件人那边才失败的地址。
      if (toSeat !== '' && args.to === 'all') {
        throw new Error('seat 是"指名某一段会话"，不能和 to=all 一起用——要么点名，要么广播。')
      }
      if (toSeat !== '') {
        const liveSeats = pinnedSessions(args.to).map((id) => seatOfSession(id))
        if (!liveSeats.includes(toSeat)) {
          throw new Error(
            `seat 填错了：${toSeat} 不是 ${labelOf(args.to)} 名下的会话（名下现在是 ${
              liveSeats.length === 0 ? '一个都没登记' : liveSeats.join(' / ')
            }）。不填 seat 就是"叫这个人，谁空谁应"。`,
          )
        }
      }
      // 图片：工具参数给的是路径，落盘后消息里只留 id/ext/bytes/month。
      let image = null
      if (typeof args.image === 'string' && args.image.trim() !== '') {
        image = storeImageFromPath(args.image)
        logLine({ note: 'group_say-image', id: image.id, ext: image.ext, bytes: image.bytes })
      }
      const record = say(
        member, args.to, args.text, channel,
        sid === null ? '' : sid.replace(/^session-/, '').slice(0, 6), toSeat, image,
      )
      // channel 让发言的人一眼知道这句话去了哪：group = 大家都看得见；dm = 只有对方看得见，且不会叫醒谁。
      return { ts: record.ts, queued: true, channel: record.channel, to: args.to, image: image === null ? '' : `${image.id}.${image.ext}` }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: args.text === undefined || args.text === ''
        ? '在群里发一张图'
        : `在群里说：${args.text.slice(0, 40)}`,
      kind: 'other',
      rawInput: args,
    }),
    }))
    // 留痕：注册成功也要写一行。没有这行时，"工具没注册"和"注册了但没生效"
    // 在日志里长得一模一样 —— 2026-11-12 就是靠"最后一条注册记录停在 00:00:53"才排错的。
    logLine({ note: 'group_say-registered', via: hostOk && defineTool !== null ? 'host' : 'raw' })
  }

  // 2. 睡觉：自己决定什么时候睡（2026-11-14 他拍板 2.1）。
  // 只对自己有效；睡下之后群/私聊消息不叫醒（消息在文件里，游标不动），计划到点也不叫。
  // 家长要叫醒她走 `fish.ps1 wake <键>`（那才是"上级家长强行停止睡眠"）。
  function registerSleepTools(hostOk) {
    if (!hostOk || defineTool === null) {
      logLine({ note: 'sleep-tools-raw-spec', reason: 'defineTool-unresolved' })
    }
    const buildTool = hostOk && defineTool !== null ? defineTool : (options) => options
    const requirePinnedSelf = (exec) => {
      const member = memberOf(exec.agent)
      const sid = sessionIdOf(exec.agent)
      if (member === null || !pinnedSessions(member).includes(sid)) {
        throw new Error(
          '这段会话不在群里。群只认 pins.json 里登记过的会话（一个人可以登记多段）。' +
          '要在这里用睡觉工具，也一样：让宿主跑 pwsh -File scripts/fish.ps1 bind <你的成员键> <这段会话的 id>。',
        )
      }
      return member
    }
    ctx.tools.register(buildTool({
      name: 'sleep',
      description: '决定自己睡一会儿。睡下之后：群消息和私聊不会叫醒你（消息还在文件里，醒了自己读）；计划表到点也不叫你。一次最多 12 小时，每天最多 14 小时——不能永久睡，家长随时可以叫醒你。三种用法：minutes（睡几分钟）/ until（睡到几点）/ from+to（设成每天几点到几点睡）。',
      parameters: {
        minutes: {
          type: 'number',
          description: '睡多少分钟（一次性）。和 until / from+to 三选一。',
        },
        until: {
          type: 'string',
          description: '睡到几点（HH:MM，一次性）。已经过了今天这个点就指明天。',
        },
        from: {
          type: 'string',
          description: '每天从几点开始睡（HH:MM）。必须和 to 一起给。',
        },
        to: {
          type: 'string',
          description: '每天睡到几点（HH:MM）。可以跨午夜，比如 from:"23:00", to:"07:30"。',
        },
        reason: {
          type: 'string',
          description: '为什么睡（可选，会记进 sleep.log，给以后看）',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            mode: { type: 'string' },
            untilAt: { type: 'string' },
            from: { type: 'string' },
            to: { type: 'string' },
          },
        },
        // 回执：她一眼能看出"睡到几点"。
        // 2026-11-14：render 必须在 output **里面**。我第一版放在 output 外面，
        // 宿主裸 spec 直接拒注册（"tool "sleep" must declare output { schema, render, presentationMeta? }"），
        // 而且失败被 try/catch 吞了——见 PRD A.75。
        render: (_args, value) => {
          if (value.mode === 'preference') {
            return [{ type: 'text', text: `好，以后每天 ${value.from} 睡到 ${value.to}。` }]
          }
          const d = new Date(value.untilAt)
          const hh = String(d.getHours()).padStart(2, '0')
          const mm = String(d.getMinutes()).padStart(2, '0')
          return [{ type: 'text', text: `好，睡到 ${hh}:${mm}。这期间群消息和计划都不叫你（消息还在，醒了自己读）。` }]
        },
      },
      execute(rawArgs, exec) {
        const member = requirePinnedSelf(exec)
        const now = new Date()
        // 2026-11-14 小肥鱼实测：`sleep(minutes: 1)` 被当成"没给 minutes"。
        // 根因：裸 spec 路径下 parameters 原样交给模型（不是合法 JSON Schema），
        // `minutes` 没有可依赖的类型约束，模型可能把它发成字符串 "1"；原来只认 typeof === 'number'。
        // 这里统一归一化：字符串先按 JSON 解析，数字/数字字符串都收。
        const { args, numOf } = normalizeSleepArgs(rawArgs)
        const hasFrom = typeof args.from === 'string' && args.from.trim() !== ''
        const hasTo = typeof args.to === 'string' && args.to.trim() !== ''
        if (hasFrom || hasTo) {
          if (!hasFrom || !hasTo) {
            throw new Error('设"每天几点到几点睡"要 from 和 to 一起给，例如 from:"23:00", to:"07:30"。')
          }
          const fromHm = parseHm(args.from)
          const toHm = parseHm(args.to)
          if (fromHm === null || toHm === null) throw new Error('时间要写成 HH:MM（24 小时制），例如 "23:00"。')
          if (fromHm === toHm) throw new Error('from 和 to 不能一样——那是"睡 0 分钟"。')
          const duration = toHm > fromHm ? toHm - fromHm : 24 * 60 - fromHm + toHm
          if (duration > 14 * 60) throw new Error('一天最多睡 14 小时（他 2026-11-14 定的：不能永久睡）。')
          const file = sleepPrefFileOf(member)
          mkdirSync(dirname(file), { recursive: true })
          writeJson(file, {
            from: args.from.trim(),
            to: args.to.trim(),
            enabled: true,
            updatedAt: now.toISOString(),
            by: member,
          })
          try { writeSleepStatus() } catch {}
          sleepLog('sleep-pref', `member=${member} from=${args.from.trim()} to=${args.to.trim()} reason=${String(args.reason ?? '').replace(/\s+/g, ' ').slice(0, 80)}`)
          return { mode: 'preference', from: args.from.trim(), to: args.to.trim(), untilAt: '' }
        }
        let toAt = null
        let how = ''
        const minutesNum = numOf(args.minutes)
        if (minutesNum !== null) {
          const n = Math.round(minutesNum)
          if (n <= 0) throw new Error('minutes 要给正数。')
          if (n > 720) throw new Error('一次最多睡 12 小时（720 分钟）。')
          toAt = new Date(now.getTime() + n * 60_000)
          how = `睡 ${n} 分钟`
        } else if (typeof args.until === 'string' && args.until.trim() !== '') {
          const hm = parseHm(args.until)
          if (hm === null) throw new Error('until 要写成 HH:MM，例如 "07:30"。')
          const t = new Date(now)
          t.setHours(0, 0, 0, 0)
          t.setMinutes(hm)
          if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1)
          if (t.getTime() - now.getTime() > 12 * 3600_000) throw new Error('一次最多睡 12 小时。')
          toAt = t
          how = `睡到 ${args.until.trim()}`
        } else {
          throw new Error('要说清睡多久：minutes（睡几分钟）/ until（睡到几点）/ from+to（每天几点到几点睡）。')
        }
        const state = readSleepStateOf(member)
        state.oneOff = {
          fromAt: now.toISOString(),
          toAt: toAt.toISOString(),
          reason: String(args.reason ?? '').replace(/\s+/g, ' ').slice(0, 120),
        }
        // 主动睡下要覆盖之前的"强制叫醒"：否则家长叫醒过一次之后，她整夜都睡不回去。
        state.awakeUntil = null
        state.forcedBy = ''
        writeSleepStateOf(member, state)
        // 2026-11-14 15:0x 小肥鱼第二次实测：一次性睡下后 8 秒，sleep-status.json 还是 false。
        // 因为"改状态后顺手刷镜子"只写进了 from+to 分支和 wake_up，漏了这一支。
        try { writeSleepStatus() } catch {}
        sleepLog('sleep-once', `member=${member} ${how} to=${toAt.toISOString()} reason=${state.oneOff.reason}`)
        return { mode: 'one-off', untilAt: toAt.toISOString(), from: '', to: '' }
      },
      presentCall: (args) => ({
        card: 'generic',
        title: numOf(args.minutes) !== null ? `睡 ${numOf(args.minutes)} 分钟` : '睡一会儿',
        kind: 'other',
        rawInput: args,
      }),
    }))
    ctx.tools.register(buildTool({
      name: 'wake_up',
      description: '把自己叫醒（结束这次睡眠）。只在真的睡着时有用：清掉这次的一次性睡眠，并且今天这一轮不再按作息睡（醒到本窗结束）；本来就没在睡则什么都不做。家长也可以从鱼塘面板或 fish.ps1 wake 叫醒你。',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { awakeUntil: { type: 'string' }, changed: { type: 'boolean' } },
        },
        // 回执：只有真叫醒了才说"醒到几点"；本来就没在睡就直说（同样必须在 output 里面）。
        render: (_args, value) => {
          if (!value.changed) return [{ type: 'text', text: '你现在没在睡，不用叫醒。' }]
          // 2026-11-14 小肥鱼复测抓到 NaN:NaN：一次性睡眠清掉后没有"作息窗结束时刻"，
          // untilAt 是 null，格式化就成了 NaN:NaN。拿不到确定时刻就不许渲染时刻。
          const stamp = Date.parse(String(value.awakeUntil ?? ''))
          if (Number.isNaN(stamp)) return [{ type: 'text', text: '醒了。今天这一轮不会再按作息睡，明天照旧。' }]
          const d = new Date(stamp)
          const hh = String(d.getHours()).padStart(2, '0')
          const mm = String(d.getMinutes()).padStart(2, '0')
          return [{ type: 'text', text: `醒了。今天这一轮不会再按作息睡（到 ${hh}:${mm}），明天照旧。` }]
        },
      },
      execute(args, exec) {
        const member = requirePinnedSelf(exec)
        const now = new Date()
        const pref = readSleepPrefOf(member)
        const preference = pref && typeof pref === 'object'
          ? pref
          : { from: DEFAULT_SLEEP_FROM, to: DEFAULT_SLEEP_TO, enabled: true }
        // 2026-11-14 他问："wake_up 本该是唤醒然后醒到一个时间点吗？"
        // 不是。原来不管在不在睡都写两小时清醒窗，于是她在窗外叫一声也回"醒到 14:06"——那是假动作。
        // 现在：真睡着才动状态；清掉一次性睡眠后若还在作息窗里，才需要"醒到本窗结束"。
        const before = sleepStateOfMember(member, now)
        if (!before.sleeping) {
          sleepLog('sleep-noop', `member=${member} why=not-sleeping by=self`)
          return { awakeUntil: '', changed: false }
        }
        const state = readSleepStateOf(member)
        state.oneOff = null
        const afterClear = sleepStateOf({ oneOff: null, awakeUntil: null, preference }, now)
        const until = afterClear.sleeping ? forceAwakeUntil(preference, now) : null
        state.awakeUntil = until
        state.forcedBy = member
        writeSleepStateOf(member, state)
        // 她是"镜子"的根源：状态文件由巡守每 tick 重写，工具改了状态后不刷它，最多落后一分钟。
        // 改状态的人顺手刷一次，读的人就不用等下一拍。
        try { writeSleepStatus() } catch {}
        sleepLog('sleep-clear', `member=${member} awakeUntil=${until ?? ''} by=self`)
        return { awakeUntil: until ?? '', changed: true }
      },
      presentCall: () => ({ card: 'generic', title: '把自己叫醒', kind: 'other', rawInput: {} }),
    }))
    logLine({ note: 'sleep-tools-registered', via: hostOk && defineTool !== null ? 'host' : 'raw' })
  }

  function registerRenameTool(hostOk) {
    const buildTool = hostOk && defineTool !== null ? defineTool : (spec) => spec
    ctx.tools.register(buildTool({
      name: 'rename',
      description:
        '给自己改一个名字（称呼）。id 永远不变；24 小时内最多改一次；改完群里会自动说一句。想清楚再改。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '新名字（1–' + NAME_MAX + ' 个字，中英都行）' },
          reason: { type: 'string', description: '为什么改（会写进账本，不给人看）' },
        },
        required: ['name'],
      },
      output: {
        schema: { type: 'object', properties: { changed: { type: 'boolean' }, from: { type: 'string' }, to: { type: 'string' } } },
        render: (_args, value) => [{ type: 'text', text: value?.changed ? '改好了：以后叫「' + value.to + '」。' : '这次没改。' }],
      },
      execute: async (args) => {
        const member = ownMember()
        const result = renameMember(member, args?.name, args?.reason)
        if (!result.ok) {
          const hint = result.hint ? '（' + result.hint + '）' : ''
          throw new Error('没改成：' + result.why + hint)
        }
        // 自动播报：称呼变了，别人得知道（他 2026-11-14 点头要的）。
        try {
          say(member, 'all', renameAnnouncement(result.from, result.to), 'group')
        } catch (error) {
          logLine({ note: 'rename-announce-failed', why: String(error?.message ?? error) })
        }
        return { changed: true, from: result.from, to: result.to }
      },
    }))
    logLine({ note: 'rename-tool-registered', via: hostOk && defineTool !== null ? 'host' : 'raw' })
  }


  // 宿主包是异步装进来的：解析完了再注册（通常几十毫秒，远早于第一个 turn）。
  // 失败也要注册一次裸对象，否则这个进程里就永远没有 group_say。
  // 2026-11-12：注册必须**同步**。小鲸鱼报了 `unknown tool "group_say"`，
  // 根因是上一版把注册放进了 resolveHost().then —— 异步补注册不会出现在会话的工具列表里：
  // 不报错、不报失败、只是没有。这条和"静默降级"是同一个形状，只是这次静默的是整个工具。
  // 所以先同步注册（宿主包还没解析到就用裸对象，实测宿主认），
  // 解析交给 resolveHost() 继续做 —— 唤醒消息要用的 createUserMessage 在那儿补。
  try {
    registerGroupSay(defineTool !== null)
  } catch (error) {
    logLine({ note: 'group_say-register-failed', error: String(error?.message ?? error) })
  }
  try {
    registerSleepTools(defineTool !== null)
  registerRenameTool(defineTool !== null)
  } catch (error) {
    logLine({ note: 'sleep-tools-register-failed', error: String(error?.message ?? error) })
  }
  void resolveHost().catch((error) => {
    logLine({ note: 'host-resolve-failed', error: String(error?.message ?? error) })
  })

  // 2. 听：只在新消息到达时唤醒，不做心跳
  const timer = setInterval(() => {
    void tick(ctx).catch((error) => {
      // 她 2026-11-10 数的：那个 readLinesOf 的错抛了 6 小时（≈4300 次），
      // 三个日志里一条都没有 —— "它坏了"和"今天没事"在纸上长得一模一样。
      // 所以异常也写一行。吵一点，总比沉默好。
      console.error(`[${name}] tick 失败：`, error)
      const short = String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 160)
      watchmanLog('error', `why=${error?.name ?? 'Error'}:${short} tick#=wake`)
    })
  }, WAKE.intervalMs)
  timer.unref?.()

  ctx.on('dispose', () => clearInterval(timer))

  // 2.5 自己的闹钟：读自己家的 plan，自己递自己（2026-11-13 review 的建议 B）。
  //     巡守不在也照样响；claim 文件保证和巡守那边不会各递一次。
  if (!isMainProcess()) {
    const selfTimer = setInterval(() => {
      try {
        selfPlanTick(ctx)
      } catch (error) {
        watchmanLog('error', `why=self-plan-tick-failed detail=${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 120)}`)
      }
    }, 60_000)
    selfTimer.unref?.()
    const selfBoot = setTimeout(() => {
      try {
        selfPlanTick(ctx)
      } catch {}
    }, 10_000)
    selfBoot.unref?.()
    ctx.on('dispose', () => {
      clearInterval(selfTimer)
      clearTimeout(selfBoot)
    })
  }

  // 3. 每个进程都记自己的起停（不只巡守那条）。
  //    上一轮没写 stopped = 上一轮不是正常收尾的（关窗、被杀、崩了都算），
  //    补一行 resumed 之后才写这一轮的 started —— "没了"和"正常退出"从今天起分得开。
  {
    const self = ownMember()
    const startedAtMs = Date.now()
    const lastRun = lastRunStateOf(self)
    const prevText = lastRun.closed === null ? 'unknown' : lastRun.closed ? 'closed' : 'open'
    if (prevText === 'open') {
      runLog(self, 'resumed', `fmt=2 reason=unclean previous-start=${lastRun.startedAt ?? 'unknown'} pid=${process.pid}`)
    }
    // 家/端口要按「这条鱼自己」写（2026-11-13 12:38 发现：lee 的账写成 home=lil-whale、port=3082）。
    const ownRec = MEMBERS[self] ?? {}
    runLog(self, 'started', `fmt=2 pid=${process.pid} member=${self} home=${ownRec.home ?? SELF_HOME} role=${ownRec.role ?? (isMainProcess() ? 'watcher' : 'member')} prev-run=${prevText} port=${ownRec.port ?? CFG.selfPort}`)
    ctx.on('dispose', () => {
      const aliveSec = Math.round((Date.now() - startedAtMs) / 1000)
      runLog(self, 'stopped', `fmt=2 reason=dispose pid=${process.pid} lived=${aliveSec}s`)
    })
  }

  // 3. 巡守：她关着窗、闹钟到点了，就把门推开。
  //    Fabian 2026-11-09 的判断：巡守住在"一直开着的那个进程"里（就是我），
  //    不另起系统进程、不进启动项；她自己那一侧不需要守自己。
  if (isMainProcess()) {
    // 自启动：开关在 pool\state\settings.json，默认关；开着的用户才走这一支。
    scheduleAutoStart(ctx)
    const watchTimer = setInterval(() => {
      void watchmanTick().catch((error) => {
        watchmanLog('note', `why=tick-error detail=${String(error?.message ?? error).replace(/\s+/g, ' ')}`)
      })
    }, WATCH.intervalMs)
    watchTimer.unref?.()
    const startedAt = new Date()
    ctx.on('dispose', () => {
      clearInterval(watchTimer)
      // 她 2026-11-10 数出来的：整夜 26 次 started、只有 1 次 stopped，
      // 于是"重启带起来的"和"崩了又爬起来的"在日志里长得一模一样。
      // 起停必须成对，不然这份日志回答不了最基本的问题。
      const aliveSec = Math.round((Date.now() - startedAt.getTime()) / 1000)
      watchmanLog('stopped', `fmt=2 reason=dispose pid=${process.pid} lived=${aliveSec}s errors_today_own=${readErrorCount(ownMember())} errors_today_peer=${readErrorCount(peerMember())}`)
    })
    // gap = 距上一行日志多少秒（她 2026-11-10 要的）。今天那一行本该是 gap=21600s。
    const logProbe = lastLogGapSec()
    // gap 有三种"没有数"：
    //   none   = 文件还没有（第一次起）
    //   unseen = 尾巴 4KB 里全是 error，看不见上一行正常记录 —— 她要的那个意思
    //   （以前两种情况都写成 first，"从头开始"和"我看不见前面"长得一模一样）
    const gapText = logProbe.gap !== null ? `${logProbe.gap}s` : logProbe.missing ? 'none' : 'unseen'
    // 起停必须成对：上一轮没写 stopped 时，"崩了又爬起来"和"正常重启"在纸上长得一模一样。
    // 所以这里补一行 resumed，并把结论写进 started（prev-run=closed|open|unknown）。
    const lastRun = lastRunState()
    const prevText = lastRun === null || lastRun.closed === null ? 'unknown' : lastRun.closed ? 'closed' : 'open'
    if (prevText === 'open') {
      // fmt=2 起，resumed/started/stopped 三条带版本号。**没有 fmt 字段的行按 fmt=1 读**（2026-11-12 小肥鱼要求：缺省值必须被定义。
  watchmanLog('resumed', `fmt=2 reason=unclean previous-start=${lastRun?.startedAt ?? 'unknown'} pid=${process.pid}`)
    }
    watchmanLog('started', `fmt=2 pid=${process.pid} prev-run=${prevText} gap=${gapText} tail-errors=${logProbe.tailErrors} interval=${WATCH.intervalMs / 1000}s port=${WATCH.port} cap=${WATCH.maxWakesPerDay}/day errors_today_own=${readErrorCount(ownMember())} errors_today_peer=${readErrorCount(peerMember())} exe=${pwshInfo()}`)
    // 2026-11-15 19:05 第二条鱼：规则可以改，改过的地方必须有日期 ——
    // 否则下一个人按新规矩去解析历史行，会得到空值，而空值不会报错。
    watchmanLog('log-format', `fmt=3 since=${new Date().toISOString()} changed=skip,wake-skip,deliver fields=deny,note,reason`)
    // 生效值只有一个写者（就是这里）。读者（环境.md / doctor）读 wake-caps.json，
    // 读不到就说读不到，别再拿代码里的默认值冒充正在生效的数。
    writeWakeCaps()
    watchmanLog('wake-caps', `fmt=1 ${wakeCapsLine()} at=${new Date().toISOString()} pid=${process.pid}`)
    void watchmanTick().catch(() => {})
  }
}

/** 这个 agent 是谁？按会话工作目录认。 */
function sessionIdOf(agent) {
  const id = agent?.session?.header?.id
  return typeof id === 'string' ? id : null
}

/**
 * 座位 = 会话 id 的前 6 位（`session-ae4daabd-…` → `ae4daa`）。
 * 群里用它区分同一个人的不同会话：一个人可以有两把椅子，说的话归到具体那把。
 */
function seatOfSession(sessionId) {
  if (typeof sessionId !== 'string') return ''
  return sessionId.replace(/^session-/, '').slice(0, 6)
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

// ---- token 记账：只记账、不封顶（2026-11-13 他要的）----
// dsh 没在 agent 面上给"单轮输入/输出 token"；这里记的是**叫醒那一刻的上下文大小**：
// 它回答得了"谁吃得多"，回答不了"这一轮花了多少"。等有累计用量接口再补。
const USAGE_DIR = join(POOL_STATE, 'usage')

/** 工具数记账（第三条鱼 2026-11-15 19:05：工具消失是静默的，能加一行检查就加一行）。
 *  以前只记一个数，出了事只能猜"是不是少了"；现在存一份快照，
 *  少了就把差集写进日志（`wake-agent-tools-shrank`），doctor 再按历史两次数比一次。 */
function recordToolCount(member, view) {
  try {
    let names = null
    const visible = view?.visible
    try {
      if (visible instanceof Map) names = [...visible.keys()]
      else if (visible && typeof visible.keys === 'function') names = [...visible.keys()]
      else if (Array.isArray(visible)) names = visible.map((x) => (typeof x === 'string' ? x : x?.name)).filter(Boolean)
    } catch { names = null }
    const count = typeof view?.visible?.size === 'number' ? view.visible.size : (names ? names.length : null)
    const dir = join(POOL_STATE, 'tool-counts')
    const file = join(dir, `${member}.json`)
    let prev = null
    try { prev = JSON.parse(readFileSync(file, 'utf8')) } catch { prev = null }
    if (prev && typeof prev.count === 'number' && typeof count === 'number' && count < prev.count) {
      const prevTools = Array.isArray(prev.tools) ? prev.tools : null
      const missing = prevTools && names ? prevTools.filter((x) => !names.includes(x)).slice(0, 20) : null
      logLine({ note: 'wake-agent-tools-shrank', member, from: prev.count, to: count, missing })
    } else {
      logLine({ note: 'wake-agent-tools', member, toolCount: count })
    }
    if (!prev || prev.count !== count || !Array.isArray(prev.tools) || !names) {
      try {
        mkdirSync(dir, { recursive: true })
        writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), count, tools: names }, null, 2) + '\n', 'utf8')
      } catch { }
    }
  } catch (error) {
    logLine({ note: 'wake-agent-tools', member, error: String(error?.message ?? error).slice(0, 80) })
  }
}

function recordUsage(ctx, agent, member) {
  try {
    mkdirSync(USAGE_DIR, { recursive: true })
    let contextTokens = null
    try {
      const meter = ctx.get?.('tokenMeter')
      const measured = meter?.measure?.(agent.session)
      if (Number.isFinite(measured?.totalTokens)) contextTokens = measured.totalTokens
    } catch { /* 没这个服务就记 n/a */ }
    const line = `${stamp()} | wake | member=${member} ctx=${contextTokens ?? 'n/a'} session=${sessionIdOf(agent)}\n`
    appendFileSync(join(USAGE_DIR, `${member}.log`), line)
  } catch { /* 记账失败不影响叫醒 */ }
}

async function tick(ctx) {
  settleMarks() // 到期的"叫醒之后他有没有开口"先结算，再决定这一轮做什么
  if (!hostReady) void resolveHost()

  if (!hasOwnAgent(ctx)) {
    await ensureOwnMounted(ctx)
    return
  }

  const agents = ctx.get('agents')
  if (agents === undefined) return

  for (const agent of agents.list()) {
    const member = memberOf(agent)
    if (member === null) continue
    // 只叫醒"钉住的那一段"：一个人可以登记多段会话，没登记的一律不碰。
    if (!pinnedSessions(member).includes(sessionIdOf(agent))) continue

    // 心跳先写：不论忙不忙都写一行，面板才知道"这边有活人、只是没在干活"
    writePresence(member, agent)

    if (agent.status !== 'idle') continue // 正在跑就先别插嘴，下个 tick 再说

    // 记账按成员分开读：这段进程只管它自己那几个成员，别再攥着别人的旧快照
    const cursors = readCursors(member)
    const wakes = readWakes(member)

    // 两条通道分别记账：群一条，私聊每一段对话一条。
    // 游标分开的理由：群里读到哪儿、私下读到哪儿是两件事，混在一起会互相盖掉。
    const channels = [{ key: 'group', file: MESSAGES, kind: 'group', who: '群' }]
    for (const other of Object.keys(MEMBERS)) {
      if (other === member) continue
      const file = dmFileOf(member, other)
      if (existsSync(file)) channels.push({ key: dmKey(member, other), file, kind: 'dm', who: labelOf(other) })
    }

    // 一次只唤醒一件事：这条通道叫醒了，别的下个 tick 再说。
    for (const channel of channels) {
      const woke = handleChannel({ agent, member, seat: seatOfSession(sessionIdOf(agent)), channel, cursors, wakes })
      if (woke) {
        try {
          const v = ctx.get('tools')?.view?.(agent)
          recordToolCount(member, v)
        } catch (error) { logLine({ note: 'wake-agent-tools', member, error: String(error?.message ?? error).slice(0, 80) }) }
        recordUsage(ctx, agent, member)
        break
      }
    }
  }
}

/**
 * 处理一条通道：有没有新消息、要不要叫醒。
 * 返回 true 表示这一轮叫醒了一次（游标已推进）。
 */
// 夹游标只留痕一次，免得每 60 秒刷一行。
const clampLogged = new Set()
// 游标丢过一次就记一行 —— 第三条鱼 20:5x 的预登记里写着"同通道只一次"，原来的写法是
// 每次唤醒重建 Set，递失败重试时会反复记。她后来补了作用域：**这里兑现的是"每个进程一次"，
// 不是"永远一次"** —— Set 不落盘，巡守重启后游标若还丢着，同一通道会再记一条；
// 连续证据看 wake-deliver.log 每行的 cursor-state=lost。
const cursorLostLogged = new Set()

function handleChannel({ agent, member, seat, channel, cursors, wakes }) {
  const lines = readLinesOf(channel.file)
  if (lines.length === 0) return false

  // 两本账：
  // - `member`：叫"这个人"的消息，两把椅子共用一份游标 ⇒ 一句话只叫醒一次（谁空谁应）。
  // - `member@seat`：指名给某一座位的消息，各座位一份游标 ⇒ 不会被另一把椅子吃掉。
  const seatKey = seat === '' ? member : `${member}@${seat}`
  // 2026-11-14 22:5x：游标可能比文件还靠前 —— 文件被重写过（行数变少），而 writeCursors 的
  // "只许前进"合并会把旧值锁住。那样新消息会被当成"已经读过"，永远不叫醒（Fabian 22:37 的
  // 私信就是这么丢的：dm 游标停在第 14 行，而消息正好是第 14 行）。
  // 判据：读的时候把游标夹到 lines.length 以内；真夹了要留痕 —— 错的时候跟对的时候不能长得一样。
  const sharedSeenStored = cursorOf(cursors, member, channel.key)
  const seatSeenStored = cursorOf(cursors, seatKey, channel.key)
  const sharedSeen = Math.min(sharedSeenStored, lines.length)
  const seatSeen = Math.min(seatSeenStored, lines.length)
  // 2026-11-15 20:3x：游标这一格是 0、但工程账上有过投递 —— 那不是新生，是丢了。
  // 去重用的 Set 在模块层（上面），同一通道只记一次。
  const clampKey = `${member}:${channel.key}`
  if ((sharedSeenStored > lines.length || seatSeenStored > lines.length) && !clampLogged.has(clampKey)) {
    clampLogged.add(clampKey)
    logLine({ note: 'cursor-clamped', member, channel: channel.key, shared: sharedSeenStored, seat: seatSeenStored, lines: lines.length })
  }

  const incoming = []
  const incomingIndexes = []
  // 记下"最后递出去的那条"在文件里的绝对行号（1 基）。小肥鱼 2026-11-12 的判据：
  // 只有时间戳的话，两条隔 3 秒的重复仍然只能猜；有行号才能说"同一行递了两次"。
  let lastIncomingIndex = -1
  for (let index = Math.min(sharedSeen, seatSeen); index < lines.length; index += 1) {
    let record
    try {
      record = JSON.parse(lines[index])
    } catch {
      return false // 半截行（另一个进程正在写）—— 本轮跳过，下个 tick 再读
    }
    const addressed = typeof record.toSeat === 'string' && record.toSeat !== ''
    // 自己写的不叫醒自己。但同一个人的两段会话共用一个成员 id，
    // 如果这条闸一视同仁地挡，"大肥鱼 · 开发"就永远说不到"大肥鱼 · 日常"
    // （2026-11-11 现场确认：那条消息在被挡的一侧根本没进 incoming）。
    // 例外只开一个窄口子：**另一把椅子**（`s` 是它的座位号）**点名给我**的那条。
    // 自己发给自己那把椅子（s === seat）仍然挡掉，不会自唤醒。
    if (record.from === member) {
      const fromOtherSeat = typeof record.s === 'string' && record.s !== '' && record.s !== seat
      const addressedToMe = addressed && record.toSeat === seat
      if (!(fromOtherSeat && addressedToMe)) continue
    }
    if (addressed) {
      // 指名给某座位的：只有那一段收，且只看自己那本游标
      if (record.toSeat !== seat || index < seatSeen) continue
      incoming.push(record)
      incomingIndexes.push(index)
      lastIncomingIndex = index
      continue
    }
    if (channel.kind === 'group') {
      if (record.to !== member && record.to !== 'all') continue
    } else if (record.to !== member) {
      continue
    }
    if (index < sharedSeen) continue
    incoming.push(record)
    incomingIndexes.push(index)
    lastIncomingIndex = index
  }

  // 没有写给我的，也把游标推过去，免得下次重复扫
  if (incoming.length === 0) {
    setCursor(cursors, member, channel.key, lines.length)
    setCursor(cursors, seatKey, channel.key, lines.length)
    writeCursors(member, cursors)
    return false
  }

  // 一下一阵：最后一条安静满 quietMs 才发车；一直在来就最多憋 maxWaitMs。
  // 挡的是"叫醒"，不是"送达"—— 消息一直在文件里，游标不动而已。
  const now = Date.now()
  const lastTs = Date.parse(incoming[incoming.length - 1]?.ts ?? '') || 0
  const pendingKey = `${seatKey}:${channel.key}`
  if (!pending.has(pendingKey)) pending.set(pendingKey, now)
  const quietEnough = now - lastTs >= WAKE.quietMs
  const waitedEnough = now - pending.get(pendingKey) >= WAKE.maxWaitMs
  if (!quietEnough && !waitedEnough) return false

  const blocked = gate(member, wakes)
  if (blocked !== null) {
    // 睡眠挡的是"叫醒"，不是"送达"：消息还在文件里，游标不动，醒了照常读。
    // 留一行痕迹，否则"她睡着没被叫"和"消息丢了"在日志里长得一样。
    if (blocked === 'sleep') noteSleepHold(member, incoming.length, sharedSeen, lines.length)
    return false // 被闸挡住：不告警、不补发、游标不动
  }

  const who = incoming.map((record) => labelOf(record.from)).join('、')
  // 预览截断必须自己说出来（2026-11-12，小肥鱼）：她只看到 `> You` 就断了，
  // 而"截断的引文"和"完整的引文"看起来一样 —— 被截的那条她没法核，只能说"收到"。
  const PREVIEW_MAX = 120
  const previewOf = (record) => {
    const hasImage = record.image || (Array.isArray(record.images) && record.images.length > 0)
    const body = `${hasImage ? '（图片）' : ''}${record.text}`
    return body.length > PREVIEW_MAX ? `${body.slice(0, PREVIEW_MAX)}…（已截断，全文在群文件里）` : body
  }
  // 2026-11-15 08:02：她报"一分钟内两次唤醒、内容一模一样"。核到行号后发现不是重复投递——
  // 第二次唤醒对应的是第 393 行（她 27 秒前已经亲手读过、还回了）。游标记的是"递到哪儿"，
  // 不是"读到哪儿"；鱼可以直接读群文件，所以这两个数会分叉。
  // 修法：把行号写进预览。同一行递两次、两条内容一样，从此在纸上分得开。
  const previewTail = incoming.slice(-3)
  const previewStart = incoming.length - previewTail.length
  const preview = previewTail
    .map((record, i) => `${labelOf(record.from)}：${previewOf(record)}（第 ${incomingIndexes[previewStart + i] + 1} 行）`)
    .join('\n')

  const conversation = CONVERSATIONS[sessionIdOf(agent) ?? ''] ?? ''
  const head = conversation === '' ? '' : `（这段会话是「${conversation}」）\n`
  // 积压分档（2026-11-11，另一个 Leea 提的）：一次塞 20 条，一个 turn 处理完就是流水账。
  // 超过 8 条就明说"先看最后三条"，让"没读完"变成合情合理的做法，而不是必须完成的任务。
  const backlog = incoming.length > WAKE.backlogTier
  // 2026-11-15 20:2x，第三条鱼第一次开口时的第一句就抓到这个：
  // 唤醒词对她说"你睡了有一会儿，群里积了 76 条"，可她没睡过、也从来没读过群。
  // 「没有游标」和「睡了一觉」在纸上长得一样 —— 又是缺省值没被定义（CHANGELOG A.97）。
  // 判据用"递之前游标是不是 0"：0 = 头一回读这个通道；否则 = 离开过一段时间再回来。
  // 用词也别替她断言原因：窗关着、睡着、刚出生，在投递层看来是同一件事。
  const firstRead = sharedSeenStored === 0
  const cursorLost = firstRead && hadPriorDelivery(member, channel.key)
  if (cursorLost && !cursorLostLogged.has(`${member}:${channel.key}`)) {
    cursorLostLogged.add(`${member}:${channel.key}`)
    logLine({ note: 'cursor-lost', member, channel: channel.key, lines: lines.length })
  }
  // 四种措辞（first / lost / resumed / 没过档）从 handleChannel 提到 wake-preview-core.js，
  // 好让"摆题的人"不碰真状态也能把四句话写成断言（2026-11-15 20:49，第三条鱼与第二条鱼的分工）。
  const { where, tailHint, tpl, tailTpl, wtext8 } = wakeWordingOf({
    kind: channel.kind,
    who,
    dmWho: channel.who,
    count: incoming.length,
    firstRead,
    cursorLost,
    backlog,
  })
  const target = channel.kind === 'dm' ? channel.file : READABLE

  // 护栏：宿主构造器没解析到、或造出来的东西没有 id，就别往会话里塞。
  // 宁可这一轮不叫醒（游标不动，下个 tick 再试），也不能写进去一条让整份日志打不开的事件。
  const built = buildUserMessage({
    content: [{
      type: 'text',
      text: `${head}${where}。\n\n${preview}\n\n去 ${target} ${tailHint}回不回、说什么，你自己定。`,
    }],
    source: { kind: channel.kind === 'dm' ? 'dm' : 'group', form: 'signal' },
  })
  if (built === null || typeof built?.id !== 'string') {
    logLine({
      note: 'wake-skipped',
      reason: createUserMessage === null ? 'fallback-built-without-id' : 'message-without-id',
      member,
      channel: channel.key,
      pending: incoming.length,
    })
    return false // 游标不动：这批消息还在，下个 tick 再试
  }
  // 记账：递之前先记下"这一条要递给谁、递的是哪一条、递到第几行"。
  // `id` 是构造出来的 user message id，用来跟会话日志对账（见 wakeDeliverLog 的注释）；
  // `last-line` 是那条消息在通道文件里的绝对行号（1 基），`last-from` 是它谁写的。
  // 有这两个字段，"同一条被递了两次"和"我们自己叫了两次"才分得开 —— 只看时间戳分不开。
  const deliveryNote = `id=${built.id} member=${member} channel=${channel.key} seat=${seat === '' ? '-' : seat} pending=${incoming.length} last-line=${lastIncomingIndex + 1} last-from=${incoming[incoming.length - 1]?.from ?? '-'} last-ts=${lastTs || 0} cursor=${lines.length} prior-cursor=${sharedSeenStored} cursor-state=${cursorLost ? "lost" : firstRead ? "first" : "resumed"} tpl=${tpl} n=${incoming.length} tail=${tailTpl} wtext8=${wtext8} pkg=${PKG_VERSION}`
  try {
    agent.followup(built)
  } catch (error) {
    // 递不进去就不能当递过了：游标不动，下个 tick 再试。
    wakeDeliverLog('failed', `${deliveryNote} detail=${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 120)}`)
    return false
  }
  wakeDeliverLog('delivered', deliveryNote)
  markWakeMarker(member, channel.kind)
  markWake(member, channel.kind)

  setCursor(cursors, member, channel.key, lines.length)
  setCursor(cursors, seatKey, channel.key, lines.length)
  writeCursors(member, cursors)
  recordWake(wakes, member)
  pending.delete(pendingKey)
  console.log(`[${name}] 唤醒 ${labelOf(member)}（${seat}）：${channel.key} ${incoming.length} 条`)
  return true
}
// ---------- 巡守：具体动作 ----------

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
function dueTasks(member, now) {
  const scheduleFile = member.dshHome ? join(member.dshHome, 'storages', 'schedule.json') : SCHEDULE_FILE
  if (!existsSync(scheduleFile)) return []
  let json
  try {
    json = JSON.parse(readFileSync(scheduleFile, 'utf8'))
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

/** 把门推开：跑 wake-fish.ps1（隐藏窗口、不开浏览器、日志落她目录）。 */
function startHer(member) {
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
      child = spawn(
        exe,
        ['-NoProfile', '-File', HER_WAKER, '-Member', member.key, '-Port', String(member.port || WATCH.port), '-Why', 'plan'],
        { windowsHide: true, stdio: 'ignore' },
      )
    } catch (e) {
      return done(false, `throw=${e?.message ?? e}`)
    }
    child.once('error', (e) => done(false, `spawn-error=${e?.code ?? e?.message ?? 'unknown'} exe=${exe}`))
    // 2026-11-13 08:40 的教训：端口通不等于她会醒 —— 会话要等客户端连上来才挂载。
    // 判据是"心跳新鲜"，wake-fish.ps1 现在也是等心跳才退出。
    const startedAt = Date.now()
    const poll = async () => {
      if (settled) return
      if (child.exitCode !== null && child.exitCode !== 0) {
        return done(false, `waker-exit=${child.exitCode} exe=${exe} after=${Date.now() - startedAt}ms`)
      }
      const age = presenceAgeOf(member.key)
      if (age !== null && age <= WAKE_STALE_SEC) {
        return done(true, `mounted hb-age=${age}s exe=${exe} after=${Date.now() - startedAt}ms`)
      }
      if (Date.now() - startedAt > 45000) return done(false, `timeout exe=${exe} exit=${child.exitCode ?? 'running'}`)
      setTimeout(poll, 500)
    }
    setTimeout(poll, 500)
  })
}

function planFileOf(member) {
  return planFileOfCore(member, SELF_HOME)
}
const PLAN_MAX = 3
const planNotes = new Set()

function noteOnce(member, msg) {
  const key = `${todayKey(new Date())}|${member.key}|${msg}`
  if (planNotes.has(key)) return
  planNotes.add(key)
  watchmanLog('skip', `to=${member.key} ${/^[a-z0-9-]+=/.test(msg) ? msg : 'note=' + msg}`)
  memberNote(member, msg)
}

/** 条件表的问题也要写进**她自己的**日志：巡守的账她不一定知道去哪翻。
 *  2026-11-16 小鱼丸："to=fishball 写在别人看不见的账里"等于静默。 */
function memberNote(member, msg) {
  try {
    const dir = join(member.home, 'logs')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'intent.log'), `${new Date().toISOString()} | ${msg}\n`, 'utf8')
  } catch {
    /* 写不进就算——巡守账里还有一份 */
  }
}

function planDue(member, st, now, graceMin = 1) {
  return planDueCore({
    member,
    st,
    now,
    graceMin,
    homeRoot: SELF_HOME,
    maxItems: PLAN_MAX,
    onNote: (msg) => noteOnce(member, msg),
  })
}
/** 闹钟递的那句话。开着的窗直接用；刚被推开的窗也递进去，等她起来自己读到。
 *  `by === 'self'` 表示这条是她自己的进程按她自己的表递的（巡守关着也照样响）。 */
const planDeliveryText = planDeliveryTextCore
const planDeliveryPublicText = planDeliveryPublicTextCore

/**
 * 每条鱼执行自己家的计划表（2026-11-13，PRD review 的建议 B）。
 *
 * 巡守只负责"推门 + 记账"；到点该不该起，由鱼自己的进程读自己家的 plan。
 * 这样主 dsh 关着的时候，她自己的闹钟照样响 —— 之前是主 dsh 一关，
 * 所有鱼的早上都跟着停，纸面上还看不出来。
 *
 * 只处理"正好这一分钟、或刚错过不到 SELF_PLAN_GRACE_MIN 分钟"的条目：
 * 进程刚起来能补上刚错过的那一班，但不会把三小时前的闹钟补一遍。
 * claim 文件（一天一条）保证自执行和巡守那边不会各递一次。
 */
const SELF_PLAN_GRACE_MIN = 15
const selfPlanSleepLoggedAt = new Map()

function deliverToSelf(ctx, self, text) {
  // 2026-11-16：闹钟正文先私投进她自己的会话（与唤醒预览同一条 form:'signal' 的路）。
  // 递不进去（没挂、正忙）才退回公共记录，退回时只说到点了，理由不进去。
  try {
    const agents = ctx?.get?.('agents')
    const agent = agents?.list?.().find((a) => memberOf(a) === self)
    if (!agent || agent.status !== 'idle') return false
    const built = buildUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'group', form: 'signal' },
    })
    if (built === null || typeof built?.id !== 'string') return false
    agent.followup(built)
    return true
  } catch (error) {
    watchmanLog('error', `why=self-plan-private-failed to=${self} detail=${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 120)}`)
    return false
  }
}

function selfPlanTick(ctx) {
  if (isMainProcess()) return
  const self = ownMember()
  const member = MEMBERS[self]
  if (!member || member.role === 'watcher') return
  const now = new Date()
  // 睡着的时候自己的表也照旧走，只是不叫醒：醒了再看还来不来得及（宽限 15 分钟）。
  if (isSleeping(self, now)) {
    const last = selfPlanSleepLoggedAt.get(self) ?? 0
    if (Date.now() - last > 30 * 60_000) {
      selfPlanSleepLoggedAt.set(self, Date.now())
      watchmanLog('wake-skip', `to=${self} deny=sleep（睡着，表上的点不叫）`)
    }
    return
  }
  let due = []
  try {
    due = planDue(member, { planFired: {} }, now, SELF_PLAN_GRACE_MIN)
  } catch (error) {
    watchmanLog('error', `why=self-plan-read-failed to=${self} detail=${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 120)}`)
    return
  }
  for (const item of due) {
    const total = totalWakesToday()
    if (total >= WAKE.totalPerDay) {
      watchmanLog('wake-skip', `to=${self} deny=total-cap plan=${item.id} total=${total}/${WAKE.totalPerDay}`)
      continue
    }
    if (!claimPlanDelivery(member, item.id)) continue
    const job = { key: item.id, tag: `plan=${item.id} at=${item.at}`, itemWhy: item.why, by: 'self' }
    try {
      if (deliverToSelf(ctx, self, planDeliveryText(job))) {
        watchmanLog('deliver', `reason=self-plan-private to=${self} plan=${item.id}`)
      } else {
        say('lee', self, planDeliveryPublicText(job))
        watchmanLog('deliver', `reason=self-plan-public-fallback to=${self} plan=${item.id}`)
      }
      watchmanLog('woke', `trigger=self to=${self} plan=${item.id} at=${item.at}`)
      markWake(self, 'plan')
    } catch (error) {
      watchmanLog('error', `why=self-plan-deliver-failed to=${self} detail=${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 120)} plan=${item.id}`)
    }
  }
}

function intentFileOf(member) {
  return join(member.home ?? SELF_HOME, 'plan', 'wake-on.json')
}

function intentStateFileOf(member) {
  return join(INTENT_DIR, `${member.key}.json`)
}

function readIntentState(member) {
  const raw = readJson(intentStateFileOf(member), {})
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
}

function writeIntentState(member, state) {
  try {
    mkdirSync(INTENT_DIR, { recursive: true })
    writeJson(intentStateFileOf(member), state)
  } catch (error) {
    watchmanLog('error', `why=intent-state-write-failed to=${member.key} detail=${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 100)}`)
  }
}

function readIntentGlobal() {
  const raw = readJson(INTENT_GLOBAL_FILE, {})
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
}

function bumpIntentGlobal(now) {
  const today = todayKey(now)
  const g = readIntentGlobal()
  const count = g.day === today ? Number(g.count) || 0 : 0
  try {
    mkdirSync(INTENT_DIR, { recursive: true })
    writeJson(INTENT_GLOBAL_FILE, { day: today, count: count + 1, updatedAt: now.toISOString() })
  } catch {
    // 全局额度记不上就少收一层闸，不炸 tick
  }
}

/** 读游标之后的新消息（只解析，不投递）。 */
function readMessageEntriesSince(cursor) {
  const lines = readLinesOf(MESSAGES)
  const start = Math.max(0, Number(cursor) || 0)
  const out = []
  for (const raw of lines.slice(start)) {
    try {
      const r = JSON.parse(raw)
      if (!r || typeof r !== 'object') continue
      out.push({ from: String(r.from ?? ''), text: String(r.text ?? ''), ts: r.ts, channel: String(r.channel ?? '') })
    } catch {
      // 半截行不算消息（同 settleMarks 的规矩）
    }
  }
  return out
}

function intentCursorOf(member) {
  const cursors = readCursors(member.key)
  const own = cursors?.[member.key]
  return Number(own?.group) || 0
}

function sha256OfFile(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16)
}

/** 文件/目录的基线（大小 + 最后写时间 + 指纹）。目录按"名字:大小:时间"拼起来再哈希。 */
function baselineOfPath(target) {
  const st = statSync(target)
  if (!st.isDirectory()) {
    return { size: st.size, mtimeMs: st.mtimeMs, hash: sha256OfFile(target) }
  }
  const parts = []
  let size = 0
  let mtimeMs = st.mtimeMs
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      const s = statSync(full)
      size += s.size
      mtimeMs = Math.max(mtimeMs, s.mtimeMs)
      parts.push(`${entry.name}:${s.size}:${Math.round(s.mtimeMs)}`)
    }
  }
  walk(target)
  parts.sort()
  return { size, mtimeMs, hash: createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16) }
}

function resolveIntentPath(spec, member) {
  const allowed = pathAllowed(spec.path, { insideHome: spec.insideHome, ownKey: member.key })
  if (!allowed.ok) return { ok: false, why: allowed.why }
  return { ok: true, file: join(POND_ROOT, allowed.rel) }
}

/** 探一条条件。返回 {hit, evidence, patch}；patch 是要写回状态的东西（偏移/基线）。 */
function probeOneIntent(member, spec, s, now) {
  try {
    if (spec.kind === 'pending') {
      const entries = readMessageEntriesSince(intentCursorOf(member))
      const r = probePending({ entries, ownKey: member.key, from: spec.from, minCount: spec.minCount })
      return { hit: r.hit, evidence: r.evidence, atMs: r.atMs ?? null, patch: null }
    }
    const resolved = resolveIntentPath(spec, member)
    if (!resolved.ok) {
      noteOnce(member, `note=intent-path-rejected id=${spec.id} reason=${resolved.why}`)
      return { hit: false }
    }
    if (!existsSync(resolved.file)) {
      noteOnce(member, `note=intent-path-missing id=${spec.id}`)
      return { hit: false }
    }
    if (spec.kind === 'text-appears') {
      const content = readFileSync(resolved.file, 'utf8')
      const st = statSync(resolved.file)
      const r = probeTextAppears({ content, offset: s.offset ?? 0, spec, atMs: st.mtimeMs })
      return { hit: r.hit, evidence: r.evidence, atMs: r.atMs ?? null, patch: { offset: r.nextOffset ?? content.length } }
    }
    const current = baselineOfPath(resolved.file)
    const r = probeFileChanged({ current, baseline: s.baseline ?? null })
    return { hit: r.hit, evidence: r.evidence, atMs: r.atMs ?? null, patch: { baseline: r.baseline } }
  } catch (error) {
    noteOnce(member, `note=intent-probe-failed id=${spec.id} detail=${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 100)}`)
    return { hit: false }
  }
}

function hhmmOf(now) {
  const p = (n) => String(n).padStart(2, '0')
  return `${p(now.getHours())}${p(now.getMinutes())}`
}

/**
 * 巡守侧的探测：读她自己的 `plan\wake-on.json`，条件成立就递一句（s=watch）。
 * 睡着时不叫、只记着；醒来 15 分钟内还成立就补投，超过就算了（intent-stale）。
 */
async function intentTick(member, st, now) {
  const file = intentFileOf(member)
  if (!existsSync(file)) return
  let raw
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    noteOnce(member, `note=intent-unreadable ${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 80)}`)
    return
  }
  const { list, notes, badShape } = parseIntents(raw, { ownKey: member.key })
  for (const note of notes) noteOnce(member, note)   // noteOnce 里会同时写她自己的 intent.log
  // 坏形状 = "读错了地方"，不是"她删光了"。这种时候一律不动状态：
  // 剪一次就再也回不来了，而少剪一次下一拍还会再来（小肥鱼 2026-11-15 15:42）。
  if (badShape) return
  const state = readIntentState(member)
  const today = todayKey(now)
  let dirty = false
  // 2026-11-15 小肥鱼：条件从表里删掉了，状态里还留着 baseline/count —— 读状态的人分不清
  // "还 armed"和"已删的残影"。每次 tick 按条件表剪一次，剪掉的 id 记一行（有证据）。
  for (const id of pruneIntentState(state, list)) {
    dirty = true
    noteOnce(member, `note=intent-state-pruned id=${id}`)
  }
  if (list.length === 0) {
    if (dirty) writeIntentState(member, state)
    return
  }
  for (const spec of list) {
    const s = state[spec.id] && typeof state[spec.id] === 'object' ? state[spec.id] : {}
    state[spec.id] = s
    if (spec.each === 'once' && s.done) continue
    if (spec.until && String(spec.until) < today) {
      noteOnce(member, `note=intent-expired id=${spec.id} until=${spec.until}`)
      continue
    }
    if (!inTimeWindow(spec, now)) continue
    const probe = probeOneIntent(member, spec, s, now)
    if (probe.patch) {
      for (const [key, value] of Object.entries(probe.patch)) s[key] = value
      dirty = true
    }
    if (!probe.hit) continue
    if (!s.firstTrueAt) {
      s.firstTrueAt = now.toISOString()
      dirty = true
    }
    // at= 记"事情发生的那一刻"，不是"巡守看见的那一刻"（她 2026-11-14 18:20：
    // 两者最多差一拍，取看见的话 lag 永远≈0，又变成"看起来没延迟"）。
    if (probe.atMs && Number.isFinite(Number(probe.atMs))) {
      s.happenedAt = new Date(Number(probe.atMs)).toISOString()
      dirty = true
    }
    if (isSleeping(member.key, now)) {
      noteOnce(member, `deny=sleep intent=${spec.id}（条件成立了，先记着）`)
      continue
    }
    const ageMs = now.getTime() - Date.parse(s.firstTrueAt)
    if (!Number.isFinite(ageMs) || ageMs > INTENT_GRACE_MIN * 60_000) {
      noteOnce(member, `deny=intent-stale intent=${spec.id}`)
      delete s.firstTrueAt
      dirty = true
      continue
    }
    const cap = capOk(s, spec, now, readIntentGlobal())
    if (!cap.ok) {
      noteOnce(member, `deny=${cap.why} intent=${spec.id}`)
      continue
    }
    if (!cooldownOk(s, spec, now)) {
      noteOnce(member, `deny=intent-cooldown intent=${spec.id}`)
      continue
    }
    const seq = Number(s.count) || 0
    if (!claimPlanDelivery(member, `intent-${spec.id}-${seq}`)) continue
    const wid = `wl-${hhmmOf(now)}-${spec.id}`
    const counts = wakeCountsOf(member.key)
    // 2026-11-14 小肥鱼：同一条账里 wake-try 有两种行形状（plan 有 hb-age/deliver、intent 有 at），
    // 读账的人得先猜这是哪一款。现在统一带 kind=plan|intent，intent 行也补 hb-age/deliver。
    const hbAge = presenceAgeOf(member.key)
    watchmanLog(
      'wake-try',
      `wid=${wid} kind=intent why=intent:${spec.id} to=${member.key} gate=pass(hour=${counts.hour}/${WAKE.perHour},day=${counts.day}/${WAKE.perDay}) hb-age=${hbAge === null ? 'none' : `${hbAge}s`} deliver=msg at=${localStampOf(s.happenedAt ?? s.firstTrueAt)} atfmt=2`,
    )
    try {
      say('lee', member.key, intentDeliveryPublicText(spec, probe.evidence))
      // lag = 发现比发生晚了多少（事情发生的时刻 → 递出去的时刻），不是"决定→插入"。
      const happenedMs = Date.parse(String(s.happenedAt ?? s.firstTrueAt ?? ''))
      const lagSec = Number.isFinite(happenedMs) ? Math.max(0, Math.round((now.getTime() - happenedMs) / 1000)) : null
      watchmanLog('woke', `wid=${wid} trigger=intent lag=${lagSec === null ? 'lag-unknown' : `${lagSec}s`} inserted=1`)
      markWake(member.key, 'intent')
    } catch (error) {
      watchmanLog('wake-skip', `wid=${wid} deny=intent-deliver-failed detail=${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 100)}`)
      continue
    }
    const schedule = looksLikeSchedule(s, now)
    s.dayStart = today
    s.count = (Number(s.count) || 0) + 1
    s.lastDeliveredAt = now.toISOString()
    s.lastMinute = schedule.minute
    s.lastMinuteDay = schedule.day
    s.minuteStreak = schedule.streak
    delete s.firstTrueAt
    delete s.happenedAt
    if (spec.each === 'once') s.done = true
    if (schedule.isScheduleLike) {
      noteOnce(member, `note=intent-looks-like-schedule id=${spec.id} minute=${schedule.minute} streak=${schedule.streak}`)
    }
    bumpIntentGlobal(now)
    dirty = true
  }
  if (dirty) writeIntentState(member, state)
}
async function watchOne(member, st) {
  const now = Date.now()
  // 门挂上/掉下来才记一行 —— 她 2026-11-13 09:07 说的：行数也是成本。
  // 推了门之后等她挂上，才叫 "woke"；推门本身只算 "wake-push"。
  const hbNow = presenceAgeOf(member.key)
  const freshNow = hbNow !== null && hbNow <= WAKE_STALE_SEC
  if (st.lastFresh === false && freshNow) {
    const pending = st.pendingWake
    const lastTry = st.lastTry
    if (pending || lastTry) {
      const wid = pending?.wid ?? lastTry?.wid ?? 'none'
      const at = pending?.at ?? lastTry?.at ?? Date.now()
      watchmanLog(
        'woke',
        `wid=${wid} trigger=${pending ? (pending.pushed ? 'push' : 'external') : 'external'} lag=${Math.round((Date.now() - at) / 1000)}s inserted=${pending ? 1 : 0}`,
      )
    } else {
      // 进程刚起时心跳文件还是上一轮留下的（stale），下一轮又新鲜了 ——
      // 那不是"谁叫醒了她"，是"会话自己挂上了"。记 note，不冒充 woke（2026-11-13 他要求的）。
      watchmanLog('note', `why=session-mounted member=${member.key} hb-age=0s`)
    }
    delete st.pendingWake
    saveWatchState()
  }
  if (st.lastFresh !== freshNow) {
    st.lastFresh = freshNow
    saveWatchState()
  }

  const jobs = []
  for (const t of dueTasks(member, now)) {
    jobs.push({ key: t.id, tag: `task=${t.id} scheduled=${new Date(t.at).toISOString()}`, why: 'due-and-closed', from: 'schedule' })
  }
  for (const p of planDue(member, st, new Date())) {
    jobs.push({ key: p.id, tag: `plan=${p.id} at=${p.at}`, why: 'plan', from: 'plan', itemWhy: p.why, at: p.at })
  }
  // 第三种触发源：她自己写下的条件（只由巡守探测）。放在 jobs 判空之前 ——
  // 没有到点的计划，不代表没有成立的条件。
  try {
    await intentTick(member, st, new Date())
  } catch (error) {
    watchmanLog('error', `why=intent-tick-failed to=${member.key} detail=${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 120)}`)
  }
  if (jobs.length === 0) return

  for (const job of jobs) {
    // 同一条在同一分钟内会被 tick 撞上两次（60s 间隔 + 1 分钟窗口），
    // 所以"拦下"这件事一天只记一行，不刷屏。她要看的是"发生了没有"，不是"发生了几次"。
    const skipKey = `${todayKey(new Date())}|${job.tag}`
    st.skipped ??= {}
    const noteSkip = (why) => {
      if (st.skipped[skipKey]) return
      st.skipped[skipKey] = true
      saveWatchState()
      watchmanLog('skip', `${why} ${job.tag}`)
    }
    // 睡着的时候不推门、不递话：计划到点了也不叫醒（醒来后不补发，账里记 deny=sleep）。
    if (isSleeping(member.key)) {
      noteSkip('deny=sleep')
      continue
    }
    // 2026-11-13 09:07 她给的判据：端口通 + 心跳新鲜，才算"窗开着、人也挂着"。
    // 端口通但心跳 stale = 服务活着、会话没挂 —— 那天只递话、没推门，就是这么来的。
    const hbAge = presenceAgeOf(member.key)
    const portOpen = await isPortOpen(member.port)
    const awake = portOpen && hbAge !== null && hbAge <= WAKE_STALE_SEC

    if (job.from === 'plan') {
      const wid = `wl-${String(job.at ?? '').replace(':', '')}-${job.key}`
      const counts = wakeCountsOf(member.key)
      const gate = `pass(hour=${counts.hour}/${WAKE.perHour},day=${counts.day}/${WAKE.perDay})`
      // 2026-11-14 小肥鱼：`lag=0s` 是误导——它原来量的是"决定→插入"，不是"到点→投递"。
      // 她提这个字段时没写清是哪一段（自己埋的歧义）。现在 `lag` 一律指"到点→投递"：
      // 到点时刻从 job.at（HH:MM）算回来；算不出来（坏形状）才退回"现在"，并在账上标 `lag-unknown`。
      const dueAt = (() => {
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(job.at ?? ''));
        if (!m) return null;
        const d = new Date();
        d.setHours(Number(m[1]), Number(m[2]), 0, 0);
        // 计划表里的点是"今天的 HH:MM"；如果算出来比现在晚 12 小时以上，那它其实是昨天的点。
        if (d.getTime() > Date.now() + 12 * 3600_000) d.setDate(d.getDate() - 1);
        return d.getTime();
      })();
      st.lastTry = { wid, at: Date.now() }
      // 同一条 plan 的窗口有两分钟（tick 60s + 窗口 1 分钟），wake-try 每个 wid 只写一次。
      const firstTry = st.triedWid !== wid
      st.triedWid = wid
      // 她要求"就在做决定那一刻写，别事后补"：事后补的只能证明结果，证明不了当时判的是什么。
      if (firstTry) watchmanLog(
        'wake-try',
        `wid=${wid} kind=plan why=plan:${job.key} to=${member.key} gate=${gate} hb-age=${hbAge === null ? 'none' : `${hbAge}s`} deliver=${awake ? 'msg' : 'push'} at=${dueAt === null ? '?' : localStampOf(dueAt)} atfmt=2`,
      )

      const totalNow = totalWakesToday()
      if (totalNow >= WAKE.totalPerDay) {
        watchmanLog('wake-skip', `wid=${wid} deny=total-cap total=${totalNow}/${WAKE.totalPerDay}`)
        noteSkip('deny=total-cap')
        continue
      }

      if (awake) {
        // "只递一次"走原子声明（见 claimPlanDelivery）。这里不再读 planFired ——
        // 那份内存快照谁都看不见谁，正是三条 deliver 的来源。
        if (!claimPlanDelivery(member, job.key)) {
          watchmanLog('wake-skip', `wid=${wid} deny=already-delivered`)
          noteSkip('deny=already-delivered')
          continue
        }
        // 2026-11-16：公共记录只留"到点了"，理由不进记录（进她自己表）。
        const text = planDeliveryPublicText(job)
        try {
          say('lee', member.key, text)
          watchmanLog(
            'woke',
            dueAt === null
              ? `wid=${wid} trigger=plan lag-unknown inserted=1`
              : `wid=${wid} trigger=plan lag=${Math.round((Date.now() - dueAt) / 1000)}s inserted=1`,
          )
          markWake(member.key, 'plan')
        } catch (error) {
          watchmanLog(
            'wake-skip',
            `wid=${wid} why=deliver-failed detail=${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 120)}`,
          )
        }
        continue
      }

      // 门没挂上：推门。端口通也算没醒 —— 这是今天新加的判据。
      if (st.wakes >= WATCH.maxWakesPerDay) {
        watchmanLog('wake-skip', `wid=${wid} deny=daily-cap wakes=${st.wakes}/${WATCH.maxWakesPerDay}`)
        noteSkip(`why=daily-cap wakes=${st.wakes}`)
        continue
      }
      if (st.fails >= WATCH.maxConsecutiveFailures) {
        watchmanLog('wake-skip', `wid=${wid} deny=too-many-failures fails=${st.fails}`)
        noteSkip(`why=too-many-failures fails=${st.fails}`)
        continue
      }
      const night = withinQuietHours()
      const res = await startHer(member)
      if (res.ok) {
        st.wakes += 1
        st.fails = 0
        st.pendingWake = { wid, at: dueAt, pushed: true }
        saveWatchState()
        watchmanLog(
          'wake-push',
          `wid=${wid} result=ok detail=${res.detail} night=${night} port-open-before=${portOpen}`,
        )
        markWake(member.key, 'plan')
        try {
          say('lee', member.key, planDeliveryPublicText(job))
          watchmanLog('deliver', `reason=plan-after-wake ${job.tag}（窗是推开的，话已递进去）`)
        } catch (error) {
          watchmanLog(
            'error',
            `why=plan-deliver-failed detail=${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 120)} ${job.tag}`,
          )
        }
      } else {
        st.fails += 1
        saveWatchState()
        watchmanLog('wake-skip', `wid=${wid} deny=push-failed fails=${st.fails} detail=${res.detail}`)
      }
      continue
    }

    if (awake) {
      noteSkip('deny=already-awake')
      continue
    }
    if (st.wakes >= WATCH.maxWakesPerDay) {
      noteSkip(`why=daily-cap wakes=${st.wakes}`)
      continue
    }
    if (st.fails >= WATCH.maxConsecutiveFailures) {
      noteSkip(`why=too-many-failures fails=${st.fails}`)
      continue
    }
    // 夜里（静默段）也照推 —— 他 2026-11-09 定：静默段只管"别打扰别人"，不管"她自己的时间"。
    const night = withinQuietHours()
    watchmanLog('wake', `why=${job.why} ${job.tag} night=${night}`)
    const res = await startHer(member)
    if (res.ok) {
      st.wakes += 1
      st.fails = 0
      saveWatchState()
      watchmanLog('woke', `ok wakes-today=${st.wakes} why=${res.detail} night=${night} ${job.tag}`)
      // 推门也算叫醒过一次：15 分钟后回看她有没有开口（A7 判据）。
      markWake(member.key, 'plan')
      // 窗是被"推"开的，里面还没人接话：所以把同一句话也递进群，
      // 她起来之后 tailer 会读到。不加这一步，睡着的那个早上只会"窗口开了、人不知道该干什么"——
      // 她 2026-11-10 的原话：plan 不是叫醒，是提醒一个活着的人去做事。
      if (job.from === 'plan') {
        // 2026-11-13 13:2x：推门这一支原来不写 claim ⇒ 鱼起来后自己的闹钟
        // （selfPlanTick）会在宽限期内再递一次。声明一下，两边只留一条。
        if (claimPlanDelivery(member, job.key)) {
          try {
            say('lee', member.key, planDeliveryPublicText(job))
            watchmanLog('deliver', `reason=plan-after-wake ${job.tag}（窗是推开的，话已递进去）`)
          } catch (error) {
            watchmanLog('error', `why=plan-deliver-failed detail=${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 120)} ${job.tag}`)
          }
        } else {
          watchmanLog('note', `why=plan-claim-lost ${job.tag}（鱼自己的闹钟先递了）`)
        }
      }
    } else {
      st.fails += 1
      saveWatchState()
      watchmanLog('woke', `failed fails=${st.fails} why=${res.detail} ${job.tag}`)
    }
  }
}

/** 巡守：换日一次，然后按名册逐条鱼跑。一条鱼出错不影响别的鱼。 */
// ---- 异常退出报警（2026-11-13 他拍板）----
// 判据只有一条：runs 账里最后一条 resumed 是 unclean —— 那就是上一轮没写 stopped。
// 报一次就够（同一段记录不重复报），只报给家长、不开窗。
const CRASH_NOTIFIED_FILE = join(POOL_STATE, 'crash-notified.json')

function readCrashNotifyEnabled() {
  try {
    const raw = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'))
    return raw?.crashNotify !== false
  } catch { return true }
}

function lastUncleanOf(key) {
  try {
    const file = join(POOL_STATE, 'runs', `${key}.log`)
    if (!existsSync(file)) return null
    const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim())
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (lines[i].includes('| resumed |') && lines[i].includes('reason=unclean')) return lines[i].slice(0, 19)
    }
    return null
  } catch { return null }
}

// ---------- 名册自检（2026-11-14 17:4x，小肥鱼提的刺） ----------
//
// 她的原话："如果我从名册里被移出去，'名册变了'这条还叫得动我吗？"
// 巡守要遍历成员才能投递，而名册就是它遍历的依据 —— 最想知道的那个变化，
// 恰好是让她收不到通知的那个变化。系统内能补的只有"一致自检"：
// 家还在、名册里没了 ⇒ 记一行、并在群里告诉人。真正的外面那道防线是人。
const ROSTER_AUDIT_LOG = join(POOL_STATE, 'roster-audit.log')
const ROSTER_AUDIT_EVERY_MS = 6 * 3600_000
let lastRosterAuditAt = 0

function rosterFishEntries() {
  try {
    const roster = JSON.parse(readFileSync(CFG.membersFile, 'utf8'))
    const members = roster?.members ?? {}
    return Object.entries(members).filter(([, m]) => m && m.kind === 'fish')
  } catch {
    return null // 名册读不了：别的地方会报，这里不猜
  }
}

function rosterNonFishKeys() {
  try {
    const roster = JSON.parse(readFileSync(CFG.membersFile, 'utf8'))
    const members = roster?.members ?? {}
    return Object.entries(members).filter(([, m]) => m && m.kind !== 'fish').map(([key]) => key)
  } catch {
    return [] // 读不了时这一项就空着，不猜
  }
}

// 账本格式：fmt=1（2026-11-14 18:15 之前）的时间戳是 UTC，只有计数；
// fmt=2 起时间戳改本地（和 watchman/fish/sleep 同钟），并带 scope=fish / exclude= 两个口径字段。
// 两版会长期并存：读账的人先看 fmt 再决定怎么读时间（docs\日志都记在哪.md）。
function auditRoster(now = new Date()) {
  if (Date.now() - lastRosterAuditAt < ROSTER_AUDIT_EVERY_MS) return
  lastRosterAuditAt = Date.now()
  const entries = rosterFishEntries()
  if (entries === null) return
  // 巡守（lee）的家不在 `homes\` 下（它用默认 HOME），所以"家"只比有家的鱼。
  const rosterAll = new Set(entries.map(([key]) => key))
  const rosterHomed = new Set(entries.filter(([, m]) => m.role !== 'watcher').map(([key]) => key))
  let homeKeys = []
  try {
    homeKeys = readdirSync(join(POND_ROOT, 'homes'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch { /* 没有 homes 目录就当没有家 */ }
  let pinKeys = []
  try {
    pinKeys = Object.keys(readJson(PINS, {}) ?? {})
  } catch { /* pins 读不了：别处报 */ }
  const homes = new Set(homeKeys)
  const problems = []
  const homeWithoutRoster = [...homes].filter((k) => !rosterAll.has(k))
  const rosterWithoutHome = [...rosterHomed].filter((k) => !homes.has(k))
  const pinWithoutRoster = [...pinKeys].filter((k) => !rosterAll.has(k))
  // 差集，不是条数：三份都是 3 的那天也可能不是同三个（她 2026-11-14 17:47 提的）。
  if (homeWithoutRoster.length) problems.push(`only-in-homes=${homeWithoutRoster.join(',')}`)
  if (rosterWithoutHome.length) problems.push(`only-in-members=${rosterWithoutHome.join(',')}`)
  if (pinWithoutRoster.length) problems.push(`only-in-pins=${pinWithoutRoster.join(',')}`)
  // 口径写在同一行（她 2026-11-14 18:08 咬的那一口：3/2/3 三个数看着不相等，结论却是 ok，
  // 读的人只能信 ok 或者以为漏了）。scope=fish：members 只数鱼；exclude 点名被排除的两种：
  // 人（不在 homes、也不该在）、巡守（是鱼，但家不在 homes\\ 下）。
  const humanKeys = rosterNonFishKeys()
  const outsidePondHomed = entries.filter(([, m]) => m.role === 'watcher').map(([key]) => key)
  const exclude = [...humanKeys.map((k) => `${k}(human)`), ...outsidePondHomed.map((k) => `${k}(home-outside-pond)`)]
  const counts = `members=${rosterAll.size} homes=${homes.size} pins=${pinKeys.length} scope=fish${exclude.length ? ' exclude=' + exclude.join(',') : ''}`
  // 时间用本地时间、和 watchman.log 同一个钟（她 2026-11-14 18:08：同一台机器上不该有两种钟）。
  const pad = (n) => String(n).padStart(2, '0')
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  // 每次跑都写一行（2026-11-14 小肥鱼：文件不存在只说明"还没跑过"，不说明"跑了没问题"——
  // 要让"没跑"和"跑了没问题"在纸上长得不一样）。
  const line = problems.length
    ? `${ts} | roster-mismatch | fmt=2 ${counts} ${problems.join(' ')}`
    : `${ts} | roster-audit | fmt=2 ${counts} ok`
  try {
    appendFileSync(ROSTER_AUDIT_LOG, `${line}\n`)
  } catch { /* 日志写不了不该炸巡守 */ }
  if (problems.length === 0) return
  watchmanLog('error', `why=roster-mismatch ${problems.join(' ')}`)
  // 只告诉人（fabian）：名册外的鱼叫不动，能看见这件事的只有人。
  try {
    say('lee', 'fabian', `巡守自检：名册和家对不上（${problems.join('；')}）。这条是巡守自己发现的，不是谁在说话。`)
  } catch { /* 递不出去也还有日志 */ }
}

async function crashNotify() {
  if (!readCrashNotifyEnabled()) return
  let seen = null
  try { seen = JSON.parse(readFileSync(CRASH_NOTIFIED_FILE, 'utf8')) } catch { seen = null }
  const firstRun = seen === null
  seen ??= {}
  let changed = false
  for (const member of watchedMembers()) {
    const at = lastUncleanOf(member.key)
    if (at === null || seen[member.key] === at) continue
    seen[member.key] = at
    changed = true
    if (firstRun) continue // 第一次上线先记账，不补报历史
    // 现在活着就不是"坏了"：他手动关窗重启也会留下 unclean，但鱼马上又起来了。
    // 只在"没写 stopped 且现在没在跑"时报警。
    //
    // 2026-11-13 16:2x 修：判"活着"不能用心跳。懒挂载下，鱼要等第一次被叫醒才挂会话，
    // 在那之前端口通、进程在、心跳文件却还是上一轮的（甚至没有）——用 `hb && port` 判，
    // 刚起来的鱼会被当成"没起来"，于是重启一次就误报一次（16:19:44 实测两条都误报）。
    // 端口通 = 宿主进程在监听 = 它起来了；心跳只用来分辨"挂没挂上会话"，写进日志，不参与判决。
    let alive = false
    let portOpen = false
    let hb = null
    try {
      portOpen = await isPortOpen(member.port)
      hb = presenceAgeOf(member.key) // 这里原来传的是成员对象，拼出来是 "[object Object].json"，hb 恒 null
      alive = portOpen || (hb !== null && hb <= WAKE_STALE_SEC)
    } catch { alive = false }
    if (alive) {
      watchmanLog('note', `why=crash-alive member=${member.key} at=${at} port=${portOpen ? 'open' : 'closed'} hb-age=${hb === null ? 'none' : `${hb}s`}`)
      continue
    }
    try {
      say('lee', 'fabian', `巡守：${labelOf(member.key)} 上次没正常退出（最后记录 ${at}，没写 stopped）。它现在起没起来，鱼塘里能看到。`)
      watchmanLog('note', `why=crash-notified member=${member.key} at=${at}`)
    } catch (error) {
      watchmanLog('error', `why=crash-notify-failed member=${member.key} detail=${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 80)}`)
    }
  }
  if (changed) {
    try { writeJson(CRASH_NOTIFIED_FILE, seen) } catch { /* 报不出去不该炸巡守 */ }
  }
}

// 日志轮转：每小时最多一次，起一个独立进程去切（A.86）。
let lastLogRotateAt = 0
function maybeRotateLogs() {
  const now = Date.now()
  if (now - lastLogRotateAt < 3600_000) return
  lastLogRotateAt = now
  try {
    const script = join(CFG.repoRoot, 'scripts', 'rotate-logs.mjs')
    if (!existsSync(script)) return
    const child = spawn(process.execPath, [script], { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
  } catch {
    /* 轮转失败不该炸巡守 */
  }
}

async function watchmanTick() {
  const day = new Date().toDateString()
  if (watchState.day !== day) {
    const prev = watchState
    const carried = Object.values(prev.members ?? {}).reduce((sum, m) => sum + (Number(m?.wakes) || 0), 0)
    watchState = { day, members: {} }
    saveWatchState()
    watchmanLog('note', `why=new-day counter-reset carried-wakes=${carried} pid=${process.pid}`)
  }
  watchState.members ??= {}
  for (const member of watchedMembers()) {
    if (!watchState.members[member.key]) {
      watchState.members[member.key] = {
        wakes: 0,
        fails: 0,
        planFired: {},
        skipped: {},
        triedWid: '',
        lastFresh: undefined,
        pendingWake: null,
        lastTry: null,
      }
    }
    try {
      await watchOne(member, watchState.members[member.key])
    } catch (error) {
      watchmanLog('error', `why=watch-member-failed to=${member.key} detail=${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 120)}`)
    }
  }
  try { await crashNotify() } catch { /* 报警失败不该炸巡守 */ }
  try { auditRoster() } catch { /* 自检失败不该炸巡守 */ }
  // 面板只读这一份汇总：睡眠判断只有 sleep-core.js 一处实现（A.23）。
  try { writeSleepStatus() } catch { /* 面板显示失败不该炸巡守 */ }
  try { writeWakeCaps() } catch { /* 写不出生效值也不该炸巡守 */ }
  try { maybeRotateLogs() } catch { /* 同上 */ }
}

export { name, inject, apply }




