/**
 * sleep-core.js —— 「她自己决定什么时候睡着」的纯逻辑（2026-11-14）
 * ============================================================================
 * 只做判断，不碰 ctx、不写日志、不读文件 —— 这样它能被 `scripts/test-sleep.mjs`
 * 直接跑。规则都在这儿，宿主和面板都调它，两边不会各算各的。
 *
 * 三个来源，优先级从高到低：
 *   1. `awakeUntil`：家长强制叫醒。这个时刻之前，就算在睡眠窗里也不算睡。
 *   2. `oneOff`：她自己说「我现在睡到 08:30」。只在这一次生效。
 *   3. `preference`：她每天的表（`plan\sleep.json`，出生时默认 00:00–08:00）。
 *
 * 判据（PRD A.73）：
 *   - 窗口左闭右开：`[fromAt, toAt)` —— 08:00:00 整已经是醒着。
 *   - 跨午夜（22:00–07:00）算一个窗，不是两个。
 *   - 读不到/写坏了偏好，退回默认窗；不因为一个坏文件把她变成"永远醒着"或"永远睡着"。
 */

export const DEFAULT_SLEEP_FROM = '00:00'
export const DEFAULT_SLEEP_TO = '08:00'

/** "08:30" → 510（分钟）。坏形状返回 null（缺省值必须是"不知道"，不是 0）。 */
export function parseHm(text) {
  if (typeof text !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (m === null) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return hour * 60 + minute
}

/** 当天 00:00 的 Date（本地时区）。 */
function startOfDay(now) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * 把 "22:00"–"07:00" 换算成一对绝对时刻。
 * - 返回的是「包含 now 的那个窗」；now 不在窗里时返回「下一个窗」。
 * - to <= from 视为跨午夜。
 * - 形状坏返回 null。
 */
export function windowFor(fromHm, toHm, now = new Date()) {
  const from = parseHm(fromHm)
  const to = parseHm(toHm)
  if (from === null || to === null) return null
  const base = startOfDay(now)
  const fromAt = new Date(base)
  fromAt.setMinutes(from)
  const toAt = new Date(base)
  toAt.setMinutes(to)
  if (to <= from) toAt.setDate(toAt.getDate() + 1)
  // 跨午夜时，"今天 22:00 开的窗"在凌晨看是"昨晚开的窗"：
  // 现在还在窗的后半段（now < fromAt 且 now < toAt）⇒ 把窗往前挪一天。
  if (to <= from && now.getTime() < fromAt.getTime() && now.getTime() < toAt.getTime()) {
    fromAt.setDate(fromAt.getDate() - 1)
    toAt.setDate(toAt.getDate() - 1)
  }
  // 窗已经过去（toAt <= now）⇒ 滚到明天那一轮
  if (toAt.getTime() <= now.getTime()) {
    fromAt.setDate(fromAt.getDate() + 1)
    toAt.setDate(toAt.getDate() + 1)
  }
  return { fromAt, toAt }
}

function parseInstant(value) {
  if (typeof value !== 'string' || value === '') return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/**
 * 此刻她是不是在睡。
 * @param {{ oneOff?: {fromAt?:string,toAt?:string,reason?:string}|null,
 *           awakeUntil?: string|null,
 *           preference?: {from?:string,to?:string,enabled?:boolean}|null }} input
 * @param {Date} now
 * @returns {{ sleeping: boolean, source: 'forced-awake'|'one-off'|'preference'|'awake',
 *             untilAt: string|null, forcedUntil?: string|null, upcomingAt?: string|null, reason?: string }}
 */
export function sleepStateOf(input, now = new Date()) {
  const state = input ?? {}
  const nowMs = now.getTime()

  const forcedUntil = parseInstant(state.awakeUntil ?? null)
  if (forcedUntil !== null && forcedUntil > nowMs) {
    return { sleeping: false, source: 'forced-awake', untilAt: null, forcedUntil: state.awakeUntil }
  }

  const oneOff = state.oneOff ?? null
  if (oneOff !== null && typeof oneOff === 'object') {
    const fromMs = parseInstant(oneOff.fromAt ?? null)
    const toMs = parseInstant(oneOff.toAt ?? null)
    if (fromMs !== null && toMs !== null && toMs > fromMs) {
      if (nowMs >= fromMs && nowMs < toMs) {
        return {
          sleeping: true,
          source: 'one-off',
          untilAt: new Date(toMs).toISOString(),
          reason: typeof oneOff.reason === 'string' ? oneOff.reason : '',
        }
      }
      if (nowMs < fromMs) {
        return { sleeping: false, source: 'awake', untilAt: null, upcomingAt: new Date(fromMs).toISOString() }
      }
    }
  }

  const pref = state.preference ?? null
  const enabled = pref === null || pref.enabled !== false
  const fromHm = pref !== null && typeof pref.from === 'string' ? pref.from : DEFAULT_SLEEP_FROM
  const toHm = pref !== null && typeof pref.to === 'string' ? pref.to : DEFAULT_SLEEP_TO
  if (enabled) {
    // 偏好写坏了（"nope" 这种）就退回默认窗：一个坏文件不该把她变成"永远醒着"。
    const win = windowFor(fromHm, toHm, now) ?? windowFor(DEFAULT_SLEEP_FROM, DEFAULT_SLEEP_TO, now)
    if (win !== null && nowMs >= win.fromAt.getTime() && nowMs < win.toAt.getTime()) {
      return { sleeping: true, source: 'preference', untilAt: win.toAt.toISOString() }
    }
  }

  return { sleeping: false, source: 'awake', untilAt: null }
}

/** 给日志/面板用的一句话："到 08:30"。 */
export function sleepLabel(state) {
  const until = state?.untilAt ?? null
  if (typeof until !== 'string' || until === '') return ''
  const d = new Date(until)
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `到 ${hh}:${mm}`
}

/** 家长强制叫醒：这一轮窗剩下的时间都算醒着。返回要写进状态文件的 awakeUntil。 */
export function forceAwakeUntil(preference, now = new Date()) {
  const pref = preference ?? {}
  const fromHm = typeof pref.from === 'string' ? pref.from : DEFAULT_SLEEP_FROM
  const toHm = typeof pref.to === 'string' ? pref.to : DEFAULT_SLEEP_TO
  const win = windowFor(fromHm, toHm, now)
  // 只有"此刻正躺在窗里"才把强制叫醒延到窗尾；窗外的叫醒给两小时。
  if (win !== null && now.getTime() >= win.fromAt.getTime() && now.getTime() < win.toAt.getTime()) {
    return win.toAt.toISOString()
  }
  return new Date(now.getTime() + 2 * 3600_000).toISOString()
}
