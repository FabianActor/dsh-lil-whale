/**
 * 绑定（pins）的规则与写入形状。
 *
 * 为什么单独一层：这件事有三条入口——会话行的「⋯」菜单、面板的 HTTP 路由、命令行的
 * `bind-member.mjs --unbind`。三个地方各写一遍"这段会话是不是这条鱼的"，早晚会分叉；
 * 分叉之后最糟的不是报错，是三个入口各认一个答案。
 *
 * 规则（fi-0017）：
 *   - 只有 `kind === "fish"` 的成员能被绑；人类不行（他没有会话）。
 *   - 会话必须真的在那个成员的 `dshHome` 里：`<dshHome>\sessions\<项目>\<session-id>`。
 *     绑一段别人的会话 = 把别人的名字顶到她头上，比绑不上难查得多。
 *   - 菜单里"绑"= 替换（pins[成员] = [这段会话]）；一个成员多段会话这门语言还不支持。
 *   - 解绑 = pins[成员] = []，members.json 的 sessionId 一起清空；两处必须一起改。
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** 会话 id 的形状：`session-` + uuid。和 scripts/bind-member.mjs 用同一条。 */
export const SESSION_RE = /^session-[0-9a-f-]{20,}$/

/** 读进来的值可能带空白、可能不是字符串：合法就返回去空白后的 id，否则 null。 */
export function sessionIdOf(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  return SESSION_RE.test(text) ? text : null
}

/** 这条鱼的家（dshHome 优先；老名册只有 home 时按 `<home>\dsh-home` 推）。 */
export function homeOfMember(member) {
  if (!member) return null
  if (typeof member.dshHome === 'string' && member.dshHome.trim()) return member.dshHome.trim()
  if (typeof member.home === 'string' && member.home.trim()) return join(member.home.trim(), 'dsh-home')
  return null
}

/**
 * 这段会话在不在这个家里。
 *
 * 只认目录：`<dshHome>\sessions\**\session-<id>`。不读会话内容 —— 判"归属"不该顺带
 * 把别人的话翻开（A.24 私聊那条同一条边界）。
 */
export function sessionExistsInHome(home, sessionId) {
  const id = sessionIdOf(sessionId)
  if (!home || !id) return false
  const root = join(home, 'sessions')
  if (!existsSync(root)) return false
  let projects
  try {
    projects = readdirSync(root, { withFileTypes: true })
  } catch {
    return false
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const dir = join(root, project.name, id)
    if (existsSync(join(dir, 'session.v4.jsonl.zstd'))) return true
    // 会话目录存在但文件还没落（刚建的空会话）：也算"在这里"，否则第一次绑会莫名其妙被拒。
    if (existsSync(dir)) return true
  }
  return false
}

/** 名册里的鱼（按 kind 挑，不按名字猜）。保持名册顺序，菜单的次序就是出场的次序。 */
export function fishOf(roster) {
  const members = roster?.members ?? roster ?? {}
  return Object.entries(members)
    .filter(([, m]) => m && m.kind === 'fish')
    .map(([key, m]) => ({
      key,
      name: typeof m.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 16) : key,
      role: m.role === 'watcher' ? 'watcher' : 'member',
      dshHome: homeOfMember(m),
    }))
}

/** 这段会话现在绑给谁（pins 里允许一个成员多段，返回第一个命中的）。 */
export function findBinding(pins, sessionId) {
  for (const [member, raw] of Object.entries(pins ?? {})) {
    const list = Array.isArray(raw) ? raw : raw ? [raw] : []
    if (list.includes(sessionId)) return { member, sessionId }
  }
  return null
}

/**
 * 能不能绑。返回 null 表示可以；否则给出给人看的理由（HTTP 状态 + 机器码 + 人话）。
 * 人话里带上"这段会话不在谁家里"，别只说 400。
 */
export function bindingProblem({ roster, memberKey, sessionId }) {
  const id = sessionIdOf(sessionId)
  if (!id) return { status: 400, error: 'bad-session-id', message: '会话 id 形如 session-xxxxxxxx-…' }
  const member = (roster?.members ?? roster ?? {})[memberKey]
  if (!member) return { status: 400, error: 'no-member', message: `名册里没有成员：${memberKey}` }
  if (member.kind !== 'fish') return { status: 400, error: 'not-fish', message: `${memberKey} 不是鱼（kind=${member.kind}），不能绑会话` }
  const home = homeOfMember(member)
  if (!home) return { status: 400, error: 'no-home', message: `名册里没有 ${memberKey} 的 dshHome` }
  if (!sessionExistsInHome(home, id)) {
    const name = typeof member.name === 'string' && member.name.trim() ? member.name.trim() : memberKey
    return { status: 400, error: 'session-not-in-home', message: `这段会话不在 ${name} 的家里（${home}），不绑` }
  }
  return null
}

/** 能不能解绑：只查"现在是不是真绑着"，不查会话还在不在（会话删了也要能解）。 */
export function unbindProblem({ pins, memberKey, sessionId }) {
  const id = sessionIdOf(sessionId)
  if (!id) return { status: 400, error: 'bad-session-id', message: '会话 id 形如 session-xxxxxxxx-…' }
  const list = Array.isArray(pins?.[memberKey]) ? pins[memberKey] : pins?.[memberKey] ? [pins[memberKey]] : []
  if (!list.includes(id)) {
    return { status: 409, error: 'not-bound', message: `${memberKey} 现在没有绑这段会话（${id}）` }
  }
  return null
}

/** 绑：pins[成员] = [这段会话]（替换）。同一段会话同时只归一个人 —— 别人手里的同一段要摘掉。 */
export function applyBind(pins, memberKey, sessionId) {
  const id = sessionIdOf(sessionId)
  const next = {}
  for (const [member, raw] of Object.entries(pins ?? {})) {
    const list = Array.isArray(raw) ? raw : raw ? [raw] : []
    next[member] = member === memberKey ? [id] : list.filter((x) => x !== id)
  }
  if (!Object.prototype.hasOwnProperty.call(next, memberKey)) next[memberKey] = [id]
  return next
}

/** 解绑：pins[成员] = []。返回新对象。 */
export function applyUnbind(pins, memberKey) {
  const next = { ...(pins ?? {}) }
  next[memberKey] = []
  return next
}

/**
 * 面板要的一份视图：鱼列表 + 当前 pins + 每段被绑会话到底还在不在盘上。
 * `stale` 的会话照样列出来并标出来（"已绑给 X（会话已不存在）"），不假装没这回事。
 */
export function bindingsView({ roster, pins, liveKeys = [], exists = () => true }) {
  const fish = fishOf(roster).map((m) => ({ ...m, live: liveKeys.includes(m.key) }))
  const bound = []
  for (const [member, raw] of Object.entries(pins ?? {})) {
    const list = Array.isArray(raw) ? raw : raw ? [raw] : []
    for (const id of list) {
      if (typeof id !== 'string') continue
      bound.push({ member, sessionId: id, exists: Boolean(exists(id)) })
    }
  }
  return { members: fish, pins: { ...(pins ?? {}) }, bound }
}

/** 账单里的一行。和 scripts/bind-member.mjs 的 bind/unbind 行同形，`by=` 说清是谁干的。 */
export function stateLogLine({ ts, action, memberKey, sessionId, by = 'panel' }) {
  const id = sessionIdOf(sessionId) ?? String(sessionId ?? '')
  return `${ts} | ${action} | fmt=1 member=${memberKey} session=${id} by=${by}`
}
