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
import { createHash } from "node:crypto"

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
export function parseIntents(raw, opts = {}) {
  const notes = []
  let list
  // 2026-11-15 小肥鱼："没有条件"和"读错了地方"必须是两种结果。
  // 拿不到预期的键时不能退化成空数组 —— 空数组走到 intentTick 会被当成"她全删了"，
  // 于是把状态剪光，还看起来是正确行为（她 11-12 的 null 覆盖简报是同一个形状）。
  let badShape = false
  if (Array.isArray(raw)) list = raw
  else if (Array.isArray(raw?.items)) list = raw.items
  else {
    list = []
    badShape = true
  }
  if (badShape) return { list: [], notes: ['intent-bad-shape（要一个数组，或 {items:[...]}）'], badShape: true }
  // 2026-11-16 小鱼丸：先 slice 再校验，第 6 条以后的错误既不生效、也不报——
  // "没校验"和"校验通过"长得一样。改成全部校验（只报不改），再取前 INTENT_MAX 条。
  const parsed = list.map((it) => normalizeIntent(it, notes, opts))
  const valid = parsed.filter(Boolean)
  if (valid.length > INTENT_MAX) {
    notes.push(`intent-too-many count=${valid.length} 只认前 ${INTENT_MAX} 条（第 ${INTENT_MAX + 1} 条起未启用）`)
  }
  return { list: valid.slice(0, INTENT_MAX), notes, badShape: false }
}

/** 把一条原始条目归一成规格；不合格返回 null 并留一行说明。 */
export function normalizeIntent(it, notes = [], opts = {}) {
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
    // 只想被"语义变了"叫醒时，把每写一次都变的字段列进来（如名册的 updatedAt）。
    ignore: (Array.isArray(it?.ignore) ? it.ignore : [])
      .filter((k) => typeof k === "string" && k.trim())
      .map((k) => k.trim())
      .slice(0, 20),
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
    const allowed = pathAllowed(spec.path, { insideHome: spec.insideHome, ownKey: opts.ownKey ?? null })
    if (!allowed.ok) {
      notes.push(`intent-path-rejected id=${id} path=${spec.path} reason=${allowed.why}`)
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
 *     但 `pool/dm/` 是私聊区：只允许自己的会话文件，别人的一律拒（2026-11-16 第四条鱼报的洞）；
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
  // 私聊是双向隐私窗口（A.24）：可以盯自己的会话，不能盯别人的。
  // 文件名是 `<a>__<b>.jsonl`，两边任意一边是 ownKey 都算自己的会话。
  // 目录本身也拒：file-changed 可以盯目录，盯 `pool/dm` 就等于拿到"谁的那一对刚变过"
  // （文件名 + mtime 都是公开的）——内容拦住了、索引没拦住（2026-11-16 第四条鱼）。
  if (/^pool\/dm$/i.test(norm)) return { ok: false, why: 'dm-dir' }
  const dm = /^pool\/dm\/([^/]+)$/i.exec(norm)
  if (dm) {
    const base = dm[1].replace(/\.jsonl$/i, '')
    const sides = base.split('__').map((s) => s.toLowerCase())
    if (sides.length !== 2 || !sides[0] || !sides[1]) return { ok: false, why: 'other-dm' }
    if (!ownKey) return { ok: false, why: 'dm-needs-own-key' }
    const me = String(ownKey).toLowerCase()
    if (sides[0] !== me && sides[1] !== me) return { ok: false, why: 'other-dm' }
    return { ok: true, rel: norm }
  }
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
export function capOk(state, spec, now, global = { day: '', count: 0 }) {
  const today = todayKey(now)
  const own = state?.dayStart === today ? Number(state?.count) || 0 : 0
  if (own >= spec.maxPerDay) return { ok: false, why: `intent-day-cap own=${own}/${spec.maxPerDay}` }
  const g = global?.day === today ? Number(global.count) || 0 : 0
  if (g >= INTENT_GLOBAL_PER_DAY) return { ok: false, why: `intent-global-cap ${g}/${INTENT_GLOBAL_PER_DAY}` }
  return { ok: true, own, global: g, globalCap: INTENT_GLOBAL_PER_DAY }
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

/** 进公共记录的那一版：不带条件里的 why（那是她自己写的话）。 */
export function intentDeliveryPublicText(spec, evidence) {
  return [
    `你的表里有一条条件成立了：\`${spec.id}\`。`,
    '',
    `证据：${evidence || '（没取到证据）'}`,
    '',
    '这条不是谁在提醒你，是 `plan\\wake-on.json` 里的一条条件。原因在你自己的表里。做不做你定。',
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
/**
 * 语义指纹：能当 JSON 读的文件，按"键排序后的规范形式"算指纹，顺序/缩进/空格的差别不算内容变了。
 * `ignore` 里的顶层键先摘掉再算 —— 像名册的 `updatedAt` 这种每写一次都变的字段，
 * 盯着"集合有没有变"的人不该被它叫醒（小肥鱼 2026-11-25 群第 3464 行）。
 * 读不成 JSON 的仍按原始字节算（kind:"raw"）。
 */
export function semanticHashOf({ text, ignore = [] } = {}) {
  const src = String(text ?? "")
  let parsed
  try {
    parsed = JSON.parse(src)
  } catch {
    return { hash: sha12(src), kind: "raw" }
  }
  const drop = new Set((Array.isArray(ignore) ? ignore : []).filter((k) => typeof k === "string" && k))
  const canon = (v) => {
    if (Array.isArray(v)) return v.map(canon)
    if (v && typeof v === "object") {
      const out = {}
      for (const k of Object.keys(v).sort()) {
        if (drop.has(k)) continue
        out[k] = canon(v[k])
      }
      return out
    }
    return v
  }
  return { hash: "json:" + sha12(JSON.stringify(canon(parsed))), kind: "json" }
}

function sha12(text) {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12)
}

export function probeFileChanged({ current, baseline }) {
  if (!baseline || !Number.isFinite(Number(baseline.size))) {
    return { hit: false, baseline: current }
  }
  const sizeChanged = Number(current.size) !== Number(baseline.size)
  const hashChanged = String(current.hash) !== String(baseline.hash)
  const mtimeChanged = Number(current.mtimeMs) !== Number(baseline.mtimeMs)
  // 指纹换了算法（旧基线是原始字节，新的是规范 JSON）：这是"尺子换了"，不是"内容变了"。
  if (String(baseline.kind || "raw") !== String(current.kind || "raw")) {
    return {
      hit: false,
      touchOnly: true,
      sig: "format",
      atMs: Number(current.mtimeMs),
      evidence: `换了指纹算法（${String(baseline.kind || "raw")}→${String(current.kind || "raw")}），这次只重取基线`,
      baseline: current,
    }
  }
  if (!sizeChanged && !hashChanged && !mtimeChanged) return { hit: false, baseline }
  // JSON 按语义指纹比：重排/缩进/被重写但内容一样，不算条件成立（小肥鱼 2026-11-25 群第 3464 行：
  // "我盯的是文件变，我关心的是集合变"）。
  if (String(current.kind || "raw") === "json") {
    if (!hashChanged) {
      return {
        hit: false,
        touchOnly: true,
        sig: sizeChanged ? "format+size" : "format",
        atMs: Number(current.mtimeMs),
        evidence: `文件被重写了，语义没变（${Number(current.size)} B，json 指纹 ${String(current.hash).slice(0, 17)}）`,
        baseline: current,
      }
    }
    return {
      hit: true,
      sig: "json",
      atMs: Number(current.mtimeMs),
      evidence: `语义变了：json 指纹 ${String(baseline.hash).slice(0, 17)}→${String(current.hash).slice(0, 17)}（${Number(current.size)} B，最后写于 ${new Date(Number(current.mtimeMs)).toISOString()}）`,
      baseline: current,
    }
  }
  if (!sizeChanged && !hashChanged) {
    return {
      hit: false,
      touchOnly: true,
      sig: "mtime",
      atMs: Number(current.mtimeMs),
      evidence: `只碰了 mtime，内容没变（${Number(current.size)} B，hash ${String(current.hash).slice(0, 8)}）`,
      baseline: current,
    }
  }
  const parts = []
  if (sizeChanged) parts.push(`size ${Number(baseline.size)}→${Number(current.size)}`)
  if (hashChanged) parts.push(`hash ${String(baseline.hash).slice(0, 8)}→${String(current.hash).slice(0, 8)}`)
  const sig = [sizeChanged ? "size" : "", hashChanged ? "hash" : "", mtimeChanged ? "mtime" : ""].filter(Boolean).join("+")
  return {
    hit: true,
    sig,
    atMs: Number(current.mtimeMs),
    evidence: `内容变了：${parts.join("，")}（${Number(current.size)} B，最后写于 ${new Date(Number(current.mtimeMs)).toISOString()}）`,
    baseline: current,
  }
}

// 2026-11-15 小肥鱼：删掉的条件不会从状态里消失 —— 读状态的人分不清"还 armed"和"已删的残影"。
// 这里只做一件事：把不在当前条件表里的 id 从状态里剪掉，并把剪掉的 id 报出来（谁调用谁记一行）。
export function pruneIntentState(state, list) {
  const live = new Set((Array.isArray(list) ? list : []).map((spec) => spec?.id).filter(Boolean))
  const removed = []
  for (const id of Object.keys(state ?? {})) {
    if (live.has(id)) continue
    delete state[id]
    removed.push(id)
  }
  return removed
}
