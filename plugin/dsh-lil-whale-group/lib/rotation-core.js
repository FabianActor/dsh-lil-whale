/**
 * 换段（自动轮换会话）的算法：只有这一份，不碰文件、不碰会话。
 *
 * 为什么单独一层：这件事有三处要问"现在该不该换"——引擎递话那一刻、面板上"当前生效值"那一格、
 * 测试。三处各写一遍判据，早晚分叉；分叉之后最糟的不是报错，是面板说"还要 3 轮"、引擎已经换了。
 * 这里只做纯函数：给定轮数、时间、原话，回答"换不换、带哪几句"。IO 全在调用方（index.js）。
 *
 * 一条边界写在最前面：**换段只落在对话缝隙里**。
 * 轮数到了还不够，还要等一次停顿（最后一句话过去 pauseMin 分钟没人接）；
 * 一直连着聊就最多再延 forceExtra 轮强制换。理由是有人正在说话时换房，
 * 等于把她从这句话中间搬走——她自己会看到"上一句还没答完，这里已经换了段"。
 */

/** 默认值。写在这里而不是散在 index.js：面板、测试、文档都读这一份。 */
export const ROTATION_DEFAULTS = {
  /** 聊满多少轮换一段。0 = 永不自动换（靠 compaction 压，原话会一层层丢，但不会崩）。 */
  rounds: 80,
  /** 换段时带几轮原话进新段。0 = 不带。 */
  carryRounds: 3,
  /** 最后一句话安静满多少分钟才换。 */
  pauseMin: 20,
  /** 一直连着聊时，最多再延几轮就强制换（不能无限延）。 */
  forceExtra: 10,
  /** 带原话的轮数上限：再多就不是"接得上话"，是把旧段搬过去了。 */
  maxCarryRounds: 10,
  /** 每一轮旧原话被裁到多少字（最后 1 轮不裁）。 */
  trimChars: 40,
  /** 开局片段的总字数窗口：轮数越多窗口越大，但有上界。 */
  budgetBase: 400,
  budgetStep: 80,
  budgetMax: 1200,
}

function intOr(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n))
}

/**
 * 生效值 = 默认值 ← 总控（lil-whale.config.json 的 `rotation` 段）← 这一条鱼（`pool\state\rotation\<键>.json`）。
 * 只认数字，认不出的键退回上一层 —— 一份写坏的设置不该把所有人的换段关掉。
 * 返回 `sources`，让面板能说清"这个数从哪来"（和 wake-caps 同一条规矩：生效值只有一个写者，
 * 但"它跑出来是多少、为什么"必须答得上来）。
 */
export function resolveRotation(globalRotation, memberRotation) {
  const g = globalRotation && typeof globalRotation === 'object' ? globalRotation : {}
  const m = memberRotation && typeof memberRotation === 'object' ? memberRotation : {}
  const sources = []
  // 顺序是"单鱼 → 总控 → 默认"。写坏的那一层不是"用了"，是"没读到"：
  // 不许它把整条链掐断（一份 `rounds: "abc"` 不该让所有人的换段一起关掉）。
  const pick = (key) => {
    if (m[key] !== undefined && m[key] !== null && m[key] !== '') {
      const value = intOr(m[key], undefined)
      if (value !== undefined) {
        sources.push(`member.${key}`)
        return value
      }
    }
    if (g[key] !== undefined && g[key] !== null && g[key] !== '') {
      const value = intOr(g[key], undefined)
      if (value !== undefined) {
        sources.push(`global.${key}`)
        return value
      }
    }
    return undefined
  }
  const roundsRaw = pick('rounds')
  const carryRaw = pick('carryRounds')
  const pauseRaw = pick('pauseMin')
  const extraRaw = pick('forceExtra')
  const rounds = clamp(roundsRaw === undefined ? ROTATION_DEFAULTS.rounds : roundsRaw, 0, 100000)
  const carryRounds = clamp(carryRaw === undefined ? ROTATION_DEFAULTS.carryRounds : carryRaw, 0, ROTATION_DEFAULTS.maxCarryRounds)
  const pauseMin = clamp(pauseRaw === undefined ? ROTATION_DEFAULTS.pauseMin : pauseRaw, 0, 24 * 60)
  const forceExtra = clamp(extraRaw === undefined ? ROTATION_DEFAULTS.forceExtra : extraRaw, 0, 1000)
  return {
    rounds,
    carryRounds,
    pauseMin,
    forceExtra,
    maxCarryRounds: ROTATION_DEFAULTS.maxCarryRounds,
    trimChars: ROTATION_DEFAULTS.trimChars,
    enabled: rounds > 0,
    sources,
  }
}

/**
 * 该不该换。`lastTurn` 是这段会话已经跑过的轮数（`ctx.agents.turnBoundaryOf().lastTurn`），
 * `lastActivityMs` 是这条鱼两条通道上最后一句话的时间（群 + 私聊，谁说的都算）。
 * 返回 `why` 的取值就是日志里会出现的词，别改名字：
 *   off          开关关着
 *   not-yet      还没到轮数
 *   waiting      轮数到了，但刚有人说过话，等停顿
 *   pause        轮数到了，且已经安静够久 → 换
 *   force        一直连着聊，已经延到上限 → 换
 *   no-turns     turnBoundaryOf 没给出轮数（读不到就不换，不猜）
 */
export function rotationDue({ rounds, lastTurn, pauseMin, forceExtra, lastActivityMs, nowMs }) {
  const settings = resolveRotation({ rounds, pauseMin, forceExtra }, null)
  if (!settings.enabled) return { due: false, why: 'off', idleMin: null }
  if (!Number.isFinite(lastTurn) || lastTurn < 0) return { due: false, why: 'no-turns', idleMin: null }
  if (lastTurn < settings.rounds) return { due: false, why: 'not-yet', idleMin: null, remaining: settings.rounds - lastTurn }
  const idleMin = Number.isFinite(lastActivityMs) ? (nowMs - lastActivityMs) / 60000 : null
  if (idleMin !== null && idleMin >= settings.pauseMin) return { due: true, why: 'pause', idleMin, lastTurn }
  if (lastTurn >= settings.rounds + settings.forceExtra) return { due: true, why: 'force', idleMin, lastTurn }
  return { due: false, why: 'waiting', idleMin, lastTurn, waitMin: idleMin === null ? null : Math.max(0, settings.pauseMin - idleMin) }
}

/** 开局片段的总字数窗口（轮数越多越大，有上界）。0 轮 = 0 字。 */
export function carryBudgetChars(carryRounds) {
  const k = clamp(intOr(carryRounds, 0), 0, ROTATION_DEFAULTS.maxCarryRounds)
  if (k <= 0) return 0
  return Math.min(
    ROTATION_DEFAULTS.budgetMax,
    ROTATION_DEFAULTS.budgetBase + ROTATION_DEFAULTS.budgetStep * (k - 1),
  )
}

/** 裁到 max 字，裁过就说出来（带省略号）——"截断的引文"和"完整的引文"不能长得一样。 */
export function trimText(text, max) {
  const body = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (max <= 0) return ''
  if (body.length <= max) return body
  return `${body.slice(0, Math.max(0, max - 1))}…`
}

/**
 * 把通道记录拼成"轮"：同一个人的连续几句话算一轮（她连发三条算她一轮里说了三句）。
 * 记录形状就是群/私聊文件的形状：`{ from, text, ts }`。没有 text 的跳过（图片等），但记一笔
 * `nonText` 让调用方知道这里丢过东西（不假装没有）。
 */
export function groupTurns(records, { labelOf = (key) => key } = {}) {
  const turns = []
  let nonText = 0
  for (const record of Array.isArray(records) ? records : []) {
    const from = typeof record?.from === 'string' ? record.from : ''
    const text = typeof record?.text === 'string' ? record.text.trim() : ''
    if (text === '') {
      nonText += 1
      continue
    }
    const last = turns[turns.length - 1]
    if (last && last.from === from) {
      last.texts.push(text)
      last.ts = record?.ts ?? last.ts
      continue
    }
    turns.push({ from, speaker: labelOf(from), texts: [text], ts: record?.ts ?? null })
  }
  return { turns, nonText }
}

/** 只留最后 K 轮（K 夹在 [0, maxCarryRounds]）。多留的从最早那头丢，并在返回值里说明丢了几轮。 */
export function pickCarryTurns(turns, carryRounds) {
  const list = Array.isArray(turns) ? turns : []
  const k = clamp(intOr(carryRounds, 0), 0, ROTATION_DEFAULTS.maxCarryRounds)
  if (k === 0) return { turns: [], dropped: list.length }
  const kept = list.slice(-k)
  return { turns: kept, dropped: Math.max(0, list.length - kept.length) }
}

/**
 * 开局片段：`她：……` 换行 `你：……`，最后 1 轮不裁，再往前每轮裁到 trimChars 字，
 * 总字数不超过 budget —— 超了从**最早**那轮开始丢（近处比远处重要）。
 * 返回 `{ text, dropped, trimmed }`：dropped = 丢掉的轮数，trimmed = 裁过的轮数，
 * 两个都进账（"带了几轮"这句话才有人核得动）。
 */
export function buildCarryText(turns, { carryRounds, labels = {}, trimChars = ROTATION_DEFAULTS.trimChars, budgetChars } = {}) {
  const budget = Number.isFinite(budgetChars) ? budgetChars : carryBudgetChars(carryRounds)
  const picked = pickCarryTurns(turns, carryRounds)
  if (picked.turns.length === 0 || budget <= 0) return { text: '', dropped: picked.dropped, trimmed: 0 }
  const lines = picked.turns.map((turn) => {
    const who = turn.speaker || labels[turn.from] || turn.from || '？'
    const body = (turn.texts ?? []).join(' / ')
    return { who, body }
  })
  let trimmed = 0
  // 先按"最后 1 轮不裁、再往前每轮 trimChars"裁一遍。
  for (let i = 0; i < lines.length; i += 1) {
    const isLast = i === lines.length - 1
    if (isLast) continue
    const cut = trimText(lines[i].body, trimChars)
    if (cut !== lines[i].body) trimmed += 1
    lines[i].body = cut
  }
  let droppedTurns = picked.dropped
  const render = (arr) => arr.map((line) => `${line.who}：${line.body}`).join('\n')
  let text = render(lines)
  // 还超预算：从最早那头丢整轮，直到装得下。全丢完只剩最后一轮还超，就硬裁最后一轮。
  while (text.length > budget && lines.length > 1) {
    lines.shift()
    droppedTurns += 1
    text = render(lines)
  }
  if (text.length > budget && lines.length === 1) {
    const only = lines[0]
    const room = Math.max(0, budget - `${only.who}：`.length)
    const cut = trimText(only.body, room)
    if (cut !== only.body) trimmed += 1
    only.body = cut
    text = render(lines)
  }
  return { text, dropped: droppedTurns, trimmed }
}

/**
 * 递给新段的第一句。三种情形不一样，措辞不能混：
 *   carried  带着原话来的 —— 只说"上一段聊到这儿，这是接下去的事"
 *   bare     没带原话（carryRounds=0）—— 只说换了段，别假装她记得
 *   nothing  连新消息都没有（不该发生：只在真要递话时才换），退化成一句说明
 * 不提"你失忆了"这种替她下结论的话：她读得到 `notes\交接.md`，读得到自己的话。
 */
export function buildOpeningText({ carryText = '', newText = '', prevSession = null, why = 'pause', at = null } = {}) {
  const head = prevSession === null
    ? '（换了一段会话，前面那段不再用了。）'
    : `（换了一段会话，前面那段是 ${prevSession}，不再用了。）`
  const reason = why === 'force'
    ? '轮数早就到了，一直有人在说话，就等到这会儿换的。'
    : '聊满一段了，趁这会儿没人说话换的。'
  const carried = String(carryText ?? '').trim()
  const parts = [`${head}${reason}`]
  if (carried !== '') parts.push(`上一段最后这几轮：\n${carried}`)
  else parts.push('这段会话里没有上一段的原话（换段时没带）。要接前面的线，去读 `notes\\交接.md`。')
  const fresh = String(newText ?? '').trim()
  if (fresh !== '') parts.push(fresh)
  return parts.join('\n\n')
}

/**
 * 交接文件里那一行。`by=auto` 必须在行尾：她读到这一行要知道"这是机器写的"，
 * 不是谁在跟她交代事情。后面留空给她 —— 四行交接是她的事。
 */
export function handoverLine({ at, fromSession, toSession, lastTurn, why, carried = 0, dropped = 0, carriedFrom = '' }) {
  const when = typeof at === 'string' && at !== '' ? at : new Date().toISOString()
  const reason = why === 'force' ? 'force' : 'pause'
  const carry = carried > 0
    ? `carried=${carried}${dropped > 0 ? `+dropped=${dropped}` : ''}${carriedFrom === '' ? '' : ` from=${carriedFrom}`}`
    : 'carried=0'
  return `- ${when} | 自动换段 | 上一段 ${fromSession ?? '？'} 跑满 ${lastTurn ?? '？'} 轮（${reason}） | 这一段 ${toSession} | ${carry} | by=auto`
}

/** 换段账的一行（JSON 形状，写进 `pool\state\rotations\<键>.json` 的 `last`）。 */
export function rotationRecord({ at, member, fromSession, toSession, lastTurn, why, carried, dropped, trimmed, idleMin }) {
  return {
    at: typeof at === 'string' && at !== '' ? at : new Date().toISOString(),
    member,
    from: fromSession,
    to: toSession,
    lastTurn,
    why,
    carried: carried ?? 0,
    dropped: dropped ?? 0,
    trimmed: trimmed ?? 0,
    idleMin: Number.isFinite(idleMin) ? Math.round(idleMin) : null,
    by: 'auto',
  }
}
