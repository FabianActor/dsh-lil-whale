// 她自己写下的条件（wake-on / intent）的纯逻辑（2026-11-14 实现）。
//
// 由来：他 2026-11-14 请人提了一份《自主触发-素材唤醒》建议，我评审后按下面几条改：
//   - 只由巡守探测（单一写者）。鱼自己的进程继续只管 plan —— 两个 prober 会写同一份状态，
//     那就是 lost update 的老面孔（PRD A.28/A.30/A.36 同族）。
//   - kind 不叫 `unread` 叫 `pending`：游标是"投递过"，不是"读过"。名字不能说谎。
//   - 默认只监听家外（`pool\` 与 `app\docs\`）；自家要 insideHome:true；**别人家一律不许**
//     —— 合法做法是对方发消息告诉她，她再用 `pending` 等。
//   - 缺 why 不成立；坏形状留痕；额度与冷却照计划表那套。
//
// 这个文件只做判断：读文件、发消息、写日志都在 index.js。

import { parseHm } from './sleep-core.js'

/** 一次最多认几条条件（和 plan 的 3 条一样，多了一屏看不完）。 */
export const INTENT_MAX = 5
/** 单条条件每天最多触发几次。 */
export const INTENT_MAX_PER_DAY_DEFAULT = 2
/** 全池"素材触发"每天总上限（在 60/天 的总额度里再收一层）。 */
export const INTENT_GLOBAL_PER_DAY = 6
/** 同一条条件两次触发之间至少隔多久。 */
export const INTENT_COOLDOWN_MIN_DEFAULT = 30
/** 睡醒后还愿意补投的分钟数：醒来超过这个时间，那句"条件成立了"就过期了。 */
export const INTENT_GRACE_MIN = 15

// 沉默衰减（2026-11-14）：连着几天没主动说话，素材类额度自己往下走。
// 6 → 3 → 0；但闹钟（plan）和日记不归它管，照旧。
export const SILENCE_DECAY_DAYS = 3
export function globalCapFor(silentDays) {
  const d = Number(silentDays) || 0
  if (d >= SILENCE_DECAY_DAYS * 2) return 0
  if (d >= SILENCE_DECAY_DAYS) return 3
  return INTENT_GLOBAL_PER_DAY
}

// 「今天可以不想看」：机制掷骰子，她只能读结果（不能自己挑）。
// rate = 想跳过的概率；rand ∈ [0,1)。纯函数，方便测。
export function rollSkip(rate, rand) {
  const r = Number(rate)
  const x = Number(rand)
  if (!Number.isFinite(r) || !Number.isFinite(x)) return false
  return x < Math.max(0, Math.min(1, r))
}

export function todayKey(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function hhmm(now) {
  const p = (n) => String(n).padStart(2, '0')
  return `${p(now.getHours())}:${p(now.getMinutes())}`
}

/**
 * 读她写的那份条件表。坏形状不抛、只留一行说明。
 * @returns {{list: object[], notes: string[]}}
 */
export function parseIntents(raw) {
  const notes = []
  let list
  if (Array.isArray(raw)) list = raw
  else if (Array.isArray(raw?.items)) list = raw.items
  else return { list: [], notes: ['intent-bad-shape（要一个数组，或 {items:[...]}）'] }
  if (list.length > INTENT_MAX) notes.push(`intent-too-many count=${list.length} 只认前 ${INTENT_MAX} 条`)
  const out = []
  for (const it of list.slice(0, INTENT_MAX)) {
    const spec = normalizeIntent(it, notes)
    if (spec) out.push(spec)
  }
  return { list: out, notes }
}

/** 把一条原始条目归一成规格；不合格返回 null 并留一行说明。 */
export function normalizeIntent(it, notes = []) {
  const id = String(it?.id ?? '').trim()
  if (!id) {
    notes.push('intent-without-id')
    return null
  }
  if (!it?.why) {
    notes.push(`intent-without-why id=${id}`)
    return null
  }
  if (it?.enabled === false) return null
  const kind = String(it?.kind ?? '')
  if (!['pending', 'text-appears', 'file-changed'].includes(kind)) {
    notes.push(`intent-bad-kind id=${id} kind=${kind || '（空）'}`)
    return null
  }
  const each = String(it?.each ?? 'once') === 'per-change' ? 'per-change' : 'once'
  const maxPerDay = Number.isFinite(Number(it?.maxPerDay)) && Number(it.maxPerDay) > 0
    ? Math.min(10, Math.floor(Number(it.maxPerDay)))
    : INTENT_MAX_PER_DAY_DEFAULT
  const cooldownMin = Number.isFinite(Number(it?.cooldownMin)) && Number(it.cooldownMin) >= 0
    ? Math.floor(Number(it.cooldownMin))
    : INTENT_COOLDOWN_MIN_DEFAULT
  const spec = {
    id,
    kind,
    why: String(it.why),
    each,
    maxPerDay,
    cooldownMin,
    notBefore: it?.notBefore === undefined ? null : parseHm(it.notBefore),
    notAfter: it?.notAfter === undefined ? null : parseHm(it.notAfter),
    until: it?.until ? String(it.until) : null,
    insideHome: it?.insideHome === true,
    from: it?.from ? String(it.from) : null,
    minCount: Number.isFinite(Number(it?.minCount)) && Number(it.minCount) > 0 ? Math.floor(Number(it.minCount)) : 1,
    path: it?.path ? String(it.path) : null,
    match: it?.match ? String(it.match) : null,
    regex: it?.regex === true,
  }
  if (kind === 'pending') {
    if (!spec.from && !it?.anyFrom) {
      // 不写 from = 任何人发来的都算（但仍排除她自己）
    }
  } else {
    if (!spec.path) {
      notes.push(`intent-without-path id=${id} kind=${kind}`)
      return null
    }
    const allowed = pathAllowed(spec.path, { insideHome: spec.insideHome, ownKey: null })
    if (!allowed.ok) {
      notes.push(`intent-path-rejected id=${id} path=${spec.path} why=${allowed.why}`)
      return null
    }
  }
  if (kind === 'text-appears' && !spec.match) {
    notes.push(`intent-without-match id=${id}`)
    return null
  }
  if (spec.regex && spec.match) {
    try {
      new RegExp(spec.match)
    } catch {
      notes.push(`intent-bad-regex id=${id}`)
      return null
    }
  }
  if (spec.notBefore === null && it?.notBefore !== undefined) notes.push(`intent-bad-time id=${id} notBefore=${it.notBefore}`)
  if (spec.notAfter === null && it?.notAfter !== undefined) notes.push(`intent-bad-time id=${id} notAfter=${it.notAfter}`)
  return spec
}

/**
 * 路径白名单（v1 的边界）：
 *   - `pool/...` 与 `app/docs/...`：允许（共享区与文档，本来就是大家看的）；
 *   - `homes/<自己的键>/...`：只有 insideHome:true 才允许；
 *   - `homes/<别人的键>/...`：**一律不许** —— 想看对方的东西，让对方发消息告诉你。
 * @param {string} rel 相对鱼塘根的路径
 * @param {{insideHome: boolean, ownKey: string|null}} opts
 * @returns {{ok: boolean, why?: string, rel?: string}}
 */
export function pathAllowed(rel, { insideHome = false, ownKey = null } = {}) {
  const raw = String(rel ?? '').trim().replace(/\\/g, '/')
  if (!raw) return { ok: false, why: 'empty' }
  if (/^[A-Za-z]:/.test(raw) || raw.startsWith('/')) return { ok: false, why: 'absolute' }
  const segs = raw.split('/')
  if (segs.some((s) => s === '..')) return { ok: false, why: 'dotdot' }
  const norm = segs.filter((s) => s && s !== '.').join('/')
  if (!norm) return { ok: false, why: 'empty' }
  if (norm.startsWith('pool/') || norm === 'pool' || norm.startsWith('app/docs/') || norm === 'app/docs') {
    return { ok: true, rel: norm }
  }
  const m = /^homes\/([a-z0-9-]+)(\/|$)/i.exec(norm)
  if (m) {
    const who = m[1].toLowerCase()
    if (!insideHome) return { ok: false, why: 'needs-inside-home' }
    if (!ownKey || who !== String(ownKey).toLowerCase()) return { ok: false, why: 'other-fish' }
    return { ok: true, rel: norm }
  }
  return { ok: false, why: 'not-allowed' }
}

/** 现在在不在 notBefore / notAfter 之间（没写就是全天）。 */
export function inTimeWindow(spec, now) {
  const mins = now.getHours() * 60 + now.getMinutes()
  const from = spec.notBefore
  const to = spec.notAfter
  if (from === null && to === null) return true
  if (from !== null && to !== null) {
    if (from <= to) return mins >= from && mins <= to
    return mins >= from || mins <= to
  }
  if (from !== null) return mins >= from
  return mins <= to
}

/** 冷却：同一条条件两次触发之间至少隔 cooldownMin。 */
export function cooldownOk(state, spec, now) {
  const last = Date.parse(state?.lastDeliveredAt ?? '')
  if (!Number.isFinite(last)) return true
  return now.getTime() - last >= spec.cooldownMin * 60_000
}

/** 额度：单条每天 maxPerDay，全池每天 INTENT_GLOBAL_PER_DAY。 */
export function capOk(state, spec, now, global = { day: '', count: 0 }, globalCap = INTENT_GLOBAL_PER_DAY) {
  const today = todayKey(now)
  const own = state?.dayStart === today ? Number(state?.count) || 0 : 0
  if (own >= spec.maxPerDay) return { ok: false, why: `intent-day-cap own=${own}/${spec.maxPerDay}` }
  const g = global?.day === today ? Number(global.count) || 0 : 0
  const cap = Number.isFinite(Number(globalCap)) ? Number(globalCap) : INTENT_GLOBAL_PER_DAY
  if (g >= cap) return { ok: false, why: `intent-global-cap ${g}/${cap}` }
  return { ok: true, own, global: g, globalCap: cap }
}

/**
 * 这条条件看起来像不像一条伪装成事件的日程？
 * 判据：连续 3 天在同一分钟触发。只记录（`intent-looks-like-schedule`），不拦。
 */
export function looksLikeSchedule(state, now) {
  const minute = hhmm(now)
  const day = todayKey(now)
  const lastDay = state?.lastMinuteDay ?? ''
  const streak = state?.lastMinute === minute && lastDay === yesterdayKey(now) ? (Number(state?.minuteStreak) || 1) + 1 : 1
  return { streak, minute, day, isScheduleLike: streak >= 3 }
}

function yesterdayKey(now) {
  const d = new Date(now.getTime() - 24 * 3600_000)
  return todayKey(d)
}

/** 递给她的话。s='watch' 那层在 say() 里标，正文写清"这是你自己写的条件"。 */
export function intentDeliveryText(spec, evidence) {
  return [
    `你的表里有一条条件成立了：\`${spec.id}\`（${spec.why}）。`,
    '',
    `证据：${evidence || '（没取到证据）'}`,
    '',
    '这条不是谁在提醒你，是 `plan\\wake-on.json` 里的一条条件。做不做你定。',
  ].join('\n')
}

/**
 * pending：还没进她窗口的话有多少条。
 * @param {object} opts
 * @param {{from: string, text: string, ts?: string}[]} opts.entries 游标之后的消息
 * @param {string} opts.ownKey 她自己（自己的话不算）
 * @param {string|null} [opts.from] 只看某个人发来的
 * @param {number} [opts.minCount=1]
 */
export function probePending({ entries, ownKey, from = null, minCount = 1 }) {
  const hits = (entries ?? []).filter((e) => e && e.from !== ownKey && (!from || e.from === from))
  if (hits.length < Math.max(1, minCount)) return { hit: false, count: hits.length }
  const last = hits[hits.length - 1]
  const preview = String(last?.text ?? '').replace(/\s+/g, ' ').slice(0, 120)
  // atMs = 让它成立的那条消息的时间（"事情发生的那一刻"，不是"巡守看见的那一刻"）。
  const atMs = Number.isFinite(Date.parse(String(last?.ts ?? ''))) ? Date.parse(String(last.ts)) : null
  return {
    hit: true,
    count: hits.length,
    atMs,
    evidence: `有 ${hits.length} 条还没进你窗口的话；最后一条来自 ${last?.from ?? '?'}：${preview}`,
  }
}

/**
 * text-appears：某个文件里出现了某句话（从上次读到的位置往后找，不追溯）。
 * @returns {{hit: boolean, evidence?: string, nextOffset?: number}}
 */
export function probeTextAppears({ content, offset = 0, spec, atMs = null }) {
  const text = String(content ?? '')
  const start = Math.max(0, Math.min(Number(offset) || 0, text.length))
  const slice = text.slice(start)
  if (!slice) return { hit: false, nextOffset: start }
  let index = -1
  let matched = ''
  if (spec.regex) {
    const re = new RegExp(spec.match)
    const m = re.exec(slice)
    if (m) {
      index = m.index
      matched = m[0]
    }
  } else {
    index = slice.indexOf(spec.match)
    matched = spec.match
  }
  if (index < 0) return { hit: false, nextOffset: text.length }
  const lineStart = slice.lastIndexOf('\n', index) + 1
  const lineEnd = slice.indexOf('\n', index + matched.length)
  const line = slice.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).trim().slice(0, 200)
  return {
    hit: true,
    atMs,
    evidence: `文件里出现了「${matched.slice(0, 60)}」：${line}`,
    nextOffset: start + index + matched.length,
  }
}

/**
 * file-changed：某个文件/目录变了（第一次看到只记基线，不触发 —— 不追溯）。
 * @param {{size:number, mtimeMs:number, hash:string}} current
 * @param {{size:number, mtimeMs:number, hash:string}|null} baseline
 */
export function probeFileChanged({ current, baseline }) {
  if (!baseline || !Number.isFinite(Number(baseline.size))) {
    return { hit: false, baseline: current }
  }
  const changed =
    Number(current.size) !== Number(baseline.size) ||
    Number(current.mtimeMs) !== Number(baseline.mtimeMs) ||
    String(current.hash) !== String(baseline.hash)
  if (!changed) return { hit: false, baseline }
  return {
    hit: true,
    atMs: Number(current.mtimeMs),
    evidence: `文件变了：${current.size} B，最后写于 ${new Date(current.mtimeMs).toISOString()}`,
    baseline: current,
  }
}
