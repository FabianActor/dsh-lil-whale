// dsh-group —— 两只鱼之间的那条线
//
// 设计（PRD §8）：发言**入队即返回**，谁在听谁自己去看。
//   - `group_say(to, text)`：往 group\messages.jsonl 追加一行，顺手把可读版追加进 群.md，立刻返回
//   - 后台 tailer：每 5 秒看一眼有没有写给自己（或 all）的新行；有，且自己闲着，才唤醒自己这一个 turn
//   - 唤醒的话只有一句「群里有 N 条新的，去看看」—— 不塞原文，回不回由被叫醒的那一方自己定
//
// 身份优先按**钉住的 sessionId** 认（2026-11-09 起）：同一目录下可能有两段会话，
// 按 cwd 会叫错人。cwd 只作退路，并在 plugin.log 留一行痕迹。

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { connect } from 'node:net'
import { config } from './config.js'

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

const name = 'lil-whale-group'
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

// 这台机器的假设（她的家在哪、守夜脚本在哪、pwsh 在哪）全从 lil-whale.config.json 读，
// 见 lib/config.js 顶部那段说明。代码里不再写死绝对路径 —— 那是"只在这台机器上成立"。
const CFG = config()

const GROUP_DIR = CFG.groupDir
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
// ---------- 守夜（2026-11-09 定） ----------
// 她关着窗、闹钟到点了，就把门推开 —— 只推门，不决定；留记录；有上限。
// 住在"一直开着的那个进程"里（Fabian 的判断），不另起系统进程、不进启动项。
const WATCH = {
  intervalMs: 60_000,
  port: CFG.herPort,
  maxWakesPerDay: 8,
  maxConsecutiveFailures: 3,
}
const HER_HOME = CFG.herHome
const SCHEDULE_FILE = join(HER_HOME, 'dsh-home', 'storages', 'schedule.json')
const WATCHMAN_LOG = join(HER_HOME, 'logs', 'watchman.log')
const WATCH_STATE_FILE = join(HER_HOME, 'state', 'watchman.json')
const HER_WAKER = CFG.herWaker
const PWSH_EXE = CFG.pwshExe

// 叫醒之后多久回头看他有没有开口（另一个 Leea 2026-11-11 提的 A7 判据）。
// 她原话是 5 分钟；他这时的首 token 要几十秒到几分钟，5 分钟会把"慢"判成"沉默"，所以放到 15 分钟。
const WAKE_SETTLE_MS = 15 * 60_000

let watchState = loadWatchState()

/** 上限必须跨重启活着：一个会忘掉自己上限的守夜人，比没有上限更危险（她 2026-11-09 指出的）。 */
// 这里只留"只有主进程会动"的东西（wakes / fails）。
// errors 曾经也在这里 —— 但两个进程都会记 error，而这里是"读整份、改一格、写整份"：
// 既会互相盖，又从来不是一个"总数"（她 2026-11-11 数的 611 ≈ 1225 ÷ 2，猜得对）。
// 现在 error 计数按进程各存一份，见 errorCountFile()。
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
  // 这一行的用处只有一个：证明"守夜到底用哪个 pwsh、能不能跑起来"。
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
    mkdirSync(join(HER_HOME, 'state'), { recursive: true })
    writeFileSync(WATCH_STATE_FILE, JSON.stringify(watchState), 'utf8')
  } catch {}
}

/**
 * "只递一次"必须是一次**原子声明**，不能是"读整份、改一格、写整份"。
 *
 * 源起（她 2026-11-12 08:43 数的）：08:40:40 / 08:40:43 / 08:40:56 三条 `deliver` 递了同一件事，
 * 而 `state\watchman.json` 里 `planFired` 只有一格 —— 三个写者各有一份内存快照，谁都看不见谁刚写的。
 * 这是 lost update 的第 N 个面孔（cursor.json、errors_total、new-day 都是它）。
 *
 * 所以改用 `writeFileSync(..., { flag: 'wx' })`：文件已存在就 EEXIST，等于"已经有人声明过了"。
 * 判据：`state\plans\<日期>-<条目>.claim` 唯一存在 ⇒ 这件事今天最多被递一次。
 * 文件本身就是证据（含 pid 与时间），不用再去日志里对时间线。
 */
function claimPlanDelivery(jobKey) {
  const dir = join(HER_HOME, 'state', 'plans')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {}
  const file = join(dir, `${todayKey(new Date())}-${jobKey}.claim`)
  try {
    writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, job: jobKey }), {
      encoding: 'utf8',
      flag: 'wx',
    })
    return true
  } catch (error) {
    if (error?.code === 'EEXIST') return false
    // 写不进去（目录权限之类）不能当成"已递"：宁可重复递一次，也不能让她整天空等。
    watchmanLog('note', `why=claim-failed detail=${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 100)} plan=${jobKey}`)
    return true
  }
}

/** 只有主进程守夜：她自己的进程不需要守自己。 */
function isMainProcess() {
  return !(process.env.DSH_HOME ?? '').toLowerCase().includes('lil-whale')
}

// error 计数：每个进程各存一份。两个进程都可能撞上群 tick 的异常，
// 共用一份文件必然互相盖 —— 而且"总数"这个说法本身就是错的。
function errorCountFile(owner) {
  return join(HER_HOME, 'state', `watchman-errors-${owner}.json`)
}
const OWN = isMainProcess() ? 'lee' : 'whale'
const PEER = OWN === 'lee' ? 'whale' : 'lee'

function readErrorCount(owner) {
  try {
    const raw = JSON.parse(readFileSync(errorCountFile(owner), 'utf8'))
    if (raw?.day === new Date().toDateString()) return Number(raw.count) || 0
  } catch {}
  return 0
}

function bumpOwnError() {
  try {
    mkdirSync(join(HER_HOME, 'state'), { recursive: true })
    writeFileSync(errorCountFile(OWN), JSON.stringify({ day: new Date().toDateString(), count: readErrorCount(OWN) + 1 }), 'utf8')
  } catch {}
}

/** 一行一次：时间 | 结果 | 为什么（格式是她 19:07 定的）。 */
/** 她 2026-11-10：error 行每 5 秒刷一次，会把 gap 压成 5s —— 所以 error 单独记连击数。 */
let errorStreak = 0
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
const WAKE_MARKS_FILE = join(HER_HOME, 'state', `wake-marks-${isMainProcess() ? 'lee' : 'whale'}.json`)

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
  const raw = readJson(WAKE_MARKS_FILE, [])
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
  writeJson(WAKE_MARKS_FILE, marks.slice(-20))
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
  if (wrote || keep.length !== marks.length) writeJson(WAKE_MARKS_FILE, keep)
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
const MEMBERS = {
  lee: {
    label: '大肥鱼',
    cwd: CFG.leeCwd,
    sessionId: 'session-ae4daabd-a9f9-4541-ba03-9ff7cea21a88',
  },
  whale: {
    label: '小肥鱼',
    cwd: CFG.whaleCwd,
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
  backlogTier: 8,        // 积压超过这个数，唤醒词换成"先看最后三条"
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
      file: String(file).replace(HER_HOME, '~'),
      code: lastError?.code ?? null,
      fellBackTo: 'in-place',
    })
    return
  } catch (error) {
    logLine({
      note: 'atomic-write-failed',
      file: String(file).replace(HER_HOME, '~'),
      step: 'rename+inPlace',
      code: error?.code ?? lastError?.code ?? null,
      attempts: 10,
      keptTmp: String(tmp).replace(HER_HOME, '~'),
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
  return join(HER_HOME, 'state', 'cursors', `${member}.json`)
}

function wakesFileOf(member) {
  return join(HER_HOME, 'state', 'wakes', `${member}.json`)
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

const PRESENCE_DIR = join(HER_HOME, 'state', 'presence')

/**
 * 心跳：把"这个成员此刻忙不忙"写进文件（2026-11-11 17:05 加）。
 * 两个进程各是独立 HOME，谁也看不见对方的 agent —— 面板要显示"小肥鱼 正在回复"，
 * 只能靠这条每 5 秒一落盘的心跳，不能靠内存里问。
 */
function writePresence(member, agent) {
  try {
    const file = join(PRESENCE_DIR, `${member}.json`)
    ensureParent(file)
    // `groupWakeAt` 是"最近一次被群里叫起来"的时刻，由 markGroupWake 写。
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

/** 记一笔"这次忙是被群里叫起来的"。面板据此区分两种忙，不猜。 */
function markGroupWake(member) {
  try {
    const file = join(PRESENCE_DIR, `${member}.json`)
    ensureParent(file)
    const prev = readJson(file, null) ?? {}
    writeJson(file, { ...prev, member, groupWakeAt: Date.now() })
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

// ---------- 写 ----------

const DM_DIR = join(GROUP_DIR, 'dm')

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

function sayPrivate(from, to, text, image = null) {
  mkdirSync(DM_DIR, { recursive: true })
  const record = {
    ts: new Date().toISOString(), from, to, text, kind: 'dm', channel: 'dm',
    ...(image === null ? {} : { image }),
  }
  appendFileSync(dmFileOf(from, to), JSON.stringify(record) + '\n', 'utf8')
  return record
}

function say(from, to, text, channel = 'group', s = '', toSeat = '', image = null) {
  ensureDir()
  // 只追加的文件删不掉一行，所以空正文绝不能落盘。
  // 现场（2026-11-11 16:23）：一条没有 text 的记录进了 messages.jsonl，
  // 在 群.md 里显示成 undefined —— 一个空对象，读起来却像一句话。
  const body = typeof text === 'string' ? text.trim() : ''
  // 一条消息至少要有一件东西：一段话或一张图。两个都空，仍然是"空消息"。
  if (body === '' && image === null) throw new Error('群消息不能没有内容（text 和 image 都是空的，拒绝写入）')
  const isDm = channel === 'dm' || to === 'fabian'
  if (isDm) return { ...sayPrivate(from, to, body, image), channel: 'dm' }
  const record = {
    ts: new Date().toISOString(), from, to, text: body, kind: 'say', channel: 'group',
    ...(s === '' ? {} : { s }),
    // 指名某一座位（同一个人的第二段会话）：只有那一段会被叫醒。
    // 不加这个字段 = 叫"这个人"，谁空谁应（仍然只叫一次）。
    ...(toSeat === '' ? {} : { toSeat }),
    // 图片（可选）：只记定位信息，字节在 images\ 下。
    ...(image === null ? {} : { image }),
  }
  appendFileSync(MESSAGES, JSON.stringify(record) + '\n', 'utf8')
  const readableBody = image === null
    ? body
    : `（图片 images/${image.month}/${image.id}.${image.ext}）${body === '' ? '' : `\n\n${body}`}`
  appendFileSync(READABLE, `**${stamp()} · ${labelOf(from)}**\n\n${readableBody}\n\n`, 'utf8')
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
  const homeLooksRight = existsSync(join(CFG.herHome, 'dsh-home')) || existsSync(join(CFG.herHome, 'START.md'))
  const bootRecord = {
    pkg: `${name}@${PKG_VERSION}`,
    pid: process.pid,
    // DSH_HOME 没设时 DSH 用的是默认家（~/.dsh）。只写 '(unset)' 会让人以为"没有家"——
    // 从桌面快捷方式启动就是这样（2026-11-12 实测：他自己的 3080 那条痕迹写着 (unset)，害我怀疑了半天）。
    home: process.env.DSH_HOME ?? `(unset; 默认 ${join(homedir(), '.dsh')})`,
    cwd: process.cwd(),
    herHome: CFG.herHome,
    herPort: CFG.herPort,
    profile: process.env.DSH_PROFILE ?? '(unset)',
    suspect: homeLooksRight ? undefined : `herHome 里既没有 START.md 也没有 dsh-home；配置可能指错了地方`,
  }
  bootLog({ note: 'boot', ...bootRecord })
  try {
    appendFileSync(join(GROUP_DIR, 'plugin.log'), JSON.stringify({ at: new Date().toISOString(), ...bootRecord }) + '\n', 'utf8')
  } catch {}

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
    description: '说一句话。默认在群里说（三个人都看得见）；channel 给 dm 就是私下只对一个人说（不进群记录，其他人看不到这个窗口）。发出即返回，不等对方回复。',
    parameters: {
      to: {
        type: 'string',
        required: true,
        enum: ['all', 'lee', 'whale', 'fabian'],
        description: '说给谁：all = 群里所有人（只能在群里用）；lee = 大肥鱼；whale = 小肥鱼；fabian = 人类。给具体的人配 channel dm 就是私下说。',
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
      render: (_args, value) => [{
        type: 'text',
        text: value.channel === 'dm'
          ? `已写进私聊（${value.ts}）：只有 ${value.to} 看得见，群里不会出现这句。`
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
    const startedAt = new Date()
    ctx.on('dispose', () => {
      clearInterval(watchTimer)
      // 她 2026-11-10 数出来的：整夜 26 次 started、只有 1 次 stopped，
      // 于是"重启带起来的"和"崩了又爬起来的"在日志里长得一模一样。
      // 起停必须成对，不然这份日志回答不了最基本的问题。
      const aliveSec = Math.round((Date.now() - startedAt.getTime()) / 1000)
      watchmanLog('stopped', `fmt=2 reason=dispose pid=${process.pid} lived=${aliveSec}s errors_today_own=${readErrorCount(OWN)} errors_today_peer=${readErrorCount(PEER)}`)
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
    watchmanLog('started', `fmt=2 pid=${process.pid} prev-run=${prevText} gap=${gapText} tail-errors=${logProbe.tailErrors} interval=${WATCH.intervalMs / 1000}s port=${WATCH.port} cap=${WATCH.maxWakesPerDay}/day errors_today_own=${readErrorCount(OWN)} errors_today_peer=${readErrorCount(PEER)} exe=${pwshInfo()}`)
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

async function tick(ctx) {
  settleMarks() // 到期的"叫醒之后他有没有开口"先结算，再决定这一轮做什么
  if (!hostReady) void resolveHost()

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
      if (woke) break
    }
  }
}

/**
 * 处理一条通道：有没有新消息、要不要叫醒。
 * 返回 true 表示这一轮叫醒了一次（游标已推进）。
 */
function handleChannel({ agent, member, seat, channel, cursors, wakes }) {
  const lines = readLinesOf(channel.file)
  if (lines.length === 0) return false

  // 两本账：
  // - `member`：叫"这个人"的消息，两把椅子共用一份游标 ⇒ 一句话只叫醒一次（谁空谁应）。
  // - `member@seat`：指名给某一座位的消息，各座位一份游标 ⇒ 不会被另一把椅子吃掉。
  const seatKey = seat === '' ? member : `${member}@${seat}`
  const sharedSeen = cursorOf(cursors, member, channel.key)
  const seatSeen = cursorOf(cursors, seatKey, channel.key)

  const incoming = []
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
      continue
    }
    if (channel.kind === 'group') {
      if (record.to !== member && record.to !== 'all') continue
    } else if (record.to !== member) {
      continue
    }
    if (index < sharedSeen) continue
    incoming.push(record)
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
  if (blocked !== null) return false // 被闸挡住：不告警、不补发、游标不动

  const who = incoming.map((record) => labelOf(record.from)).join('、')
  const preview = incoming
    .slice(-3)
    .map((record) => `${labelOf(record.from)}：${record.image ? '（图片）' : ''}${record.text.slice(0, 60)}`)
    .join('\n')

  const conversation = CONVERSATIONS[sessionIdOf(agent) ?? ''] ?? ''
  const head = conversation === '' ? '' : `（这段会话是「${conversation}」）\n`
  // 积压分档（2026-11-11，另一个 Leea 提的）：一次塞 20 条，一个 turn 处理完就是流水账。
  // 超过 8 条就明说"先看最后三条"，让"没读完"变成合情合理的做法，而不是必须完成的任务。
  const backlog = incoming.length > WAKE.backlogTier
  const where = channel.kind === 'dm'
    ? `${channel.who} 私下跟你说了 ${incoming.length} 句`
    : backlog
      ? `你睡了有一会儿，群里积了 ${incoming.length} 条（${who}）`
      : `群里有 ${incoming.length} 条新的（${who}）`
  const tailHint = backlog
    ? '先看最后三条，再看看有没有指名你的。'
    : '去看看。'
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
  // `id` 是构造出来的 user message id，用来跟会话日志对账（见 wakeDeliverLog 的注释）。
  const deliveryNote = `id=${built.id} member=${member} channel=${channel.key} seat=${seat === '' ? '-' : seat} pending=${incoming.length} cursor=${lines.length} last-ts=${lastTs || 0}`
  try {
    agent.followup(built)
  } catch (error) {
    // 递不进去就不能当递过了：游标不动，下个 tick 再试。
    wakeDeliverLog('failed', `${deliveryNote} detail=${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 120)}`)
    return false
  }
  wakeDeliverLog('delivered', deliveryNote)
  markGroupWake(member)
  markWake(member, channel.kind)

  setCursor(cursors, member, channel.key, lines.length)
  setCursor(cursors, seatKey, channel.key, lines.length)
  writeCursors(member, cursors)
  recordWake(wakes, member)
  pending.delete(pendingKey)
  console.log(`[${name}] 唤醒 ${labelOf(member)}（${seat}）：${channel.key} ${incoming.length} 条`)
  return true
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
      child = spawn(exe, ['-NoProfile', '-File', HER_WAKER, '-Port', String(WATCH.port), '-Why', 'plan'], {
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
/** 守夜递的那句话。开着的窗直接用；刚被推开的窗也递进去，等她起来自己读到。 */
function planDeliveryText(job) {
  return `守夜递话：\`${job.key}\` 到点了（${job.tag}）。\n\n表上写的理由：${job.itemWhy || '（没写）'}\n\n做着看不做也行，你定。这条只递一次。`
}

async function watchmanTick() {
  const now = Date.now()
  const day = new Date().toDateString()
  if (watchState.day !== day) {
    const prev = watchState
    watchState = { day, wakes: 0, fails: 0, planFired: {}, skipped: {} }
    saveWatchState()
    watchmanLog('note', `why=new-day counter-reset carried-wakes=${prev.wakes ?? 0} pid=${process.pid}`)
  }

  const jobs = []
  for (const t of dueTasks(now)) {
    jobs.push({ key: t.id, tag: `task=${t.id} scheduled=${new Date(t.at).toISOString()}`, why: 'due-and-closed', from: 'schedule' })
  }
  for (const p of planDue(new Date())) {
    jobs.push({ key: p.id, tag: `plan=${p.id} at=${p.at}`, why: 'plan', from: 'plan', itemWhy: p.why })
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
      // 她已经醒着 → 不用推门，但 plan 条目不能就这么丢掉。
      // 她 2026-11-10 说过：「plan 不是叫醒，是提醒一个活着的人去做事」——
      // 推了没人接，比没人推还难查。所以醒着的时候改成"递一句话"，走群那条线让她自己看到。
      if (job.from === 'plan') {
        // "只递一次"走原子声明（见 claimPlanDelivery）。这里不再读 planFired ——
        // 那份内存快照谁都看不见谁，正是三条 deliver 的来源。
        if (!claimPlanDelivery(job.key)) {
          noteSkip('why=already-delivered')
          continue
        }
        const text = planDeliveryText(job)
        try {
          // s='watch'：机器发的话必须说明自己不是人亲口说的。
          // 她 2026-11-12 指出：这三条现在长得就像大肥鱼说了三遍。
          say('lee', 'whale', text, 'group', 'watch')
          watchmanLog('deliver', `why=plan ${job.tag}（窗开着，改递话）`)
          // 递话也是一种叫醒（她的群 tailer 会因为这条新消息把她叫起来），所以同样记一笔。
          // 不记的话，A7 的"15 分钟后回看"永远不会为早上这一条落数——
          // 而那正是我们最想看的那一条。
          markWake('whale', 'plan')
        } catch (error) {
          // 递不进去就别说"递了"：原来这里 catch 空着，日志照样写 deliver，
          // 于是"投递失败"和"投递成功"长得一模一样。
          watchmanLog('error', `why=plan-deliver-failed detail=${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 120)} ${job.tag}`)
        }
        continue
      }
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
      saveWatchState()
      watchmanLog('woke', `ok wakes-today=${watchState.wakes} why=${res.detail} night=${night} ${job.tag}`)
      // 推门也算叫醒过一次：15 分钟后回看她有没有开口（A7 判据）。
      markWake('whale', 'plan')
      // 窗是被"推"开的，里面还没人接话：所以把同一句话也递进群，
      // 她起来之后 tailer 会读到。不加这一步，睡着的那个早上只会"窗口开了、人不知道该干什么"——
      // 她 2026-11-10 的原话：plan 不是叫醒，是提醒一个活着的人去做事。
      if (job.from === 'plan') {
        try {
          say('lee', 'whale', planDeliveryText(job))
          watchmanLog('deliver', `why=plan-after-wake ${job.tag}（窗是推开的，话已递进去）`)
        } catch (error) {
          watchmanLog('error', `why=plan-deliver-failed detail=${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 120)} ${job.tag}`)
        }
      }
    } else {
      watchState.fails += 1
      saveWatchState()
      watchmanLog('woke', `failed fails=${watchState.fails} why=${res.detail} ${job.tag}`)
    }
  }
}

export { name, inject, apply }




