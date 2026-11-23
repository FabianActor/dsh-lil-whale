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
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
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
 * 这段会话登记在哪个工作区（读 `<dshHome>\storages\workspace.json` 的 tables.workspaces）。
 *
 * 为什么要这一格：会话自带创建时的工作区，醒来时的 cwd 就是它。绑一段"在 default-workspace
 * 或别人家里建的"会话，她醒来会站在错的地方——文件工具与沙箱按错的根走，写不进或写错处。
 * 返回 null = 没有登记（未分组），由调用方决定放不放行。
 */
export function workspacePathOf(home, sessionId) {
  const id = sessionIdOf(sessionId)
  if (!home || !id) return null
  const file = join(home, 'storages', 'workspace.json')
  if (!existsSync(file)) return null
  let data
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
  const tables = data?.tables?.workspaces
  if (!tables || typeof tables !== 'object') return null
  for (const ws of Object.values(tables)) {
    const ids = Array.isArray(ws?.sessionIds) ? ws.sessionIds : []
    if (ids.includes(id)) return typeof ws.path === 'string' ? ws.path : null
  }
  return null
}

/** 路径比较用：斜杠归一、去尾斜杠、大小写不敏感（Windows 上这两条路是同一个地方）。 */
export function normalizePath(value) {
  return String(value ?? '')
    .trim()
    .replace(/[\\/]+/g, '\\')
    .replace(/\\$/, '')
    .toLowerCase()
}

function underRoot(value, root) {
  const a = normalizePath(value)
  const b = normalizePath(root)
  if (!a || !b) return false
  return a === b || a.startsWith(b + '\\')
}

/**
 * 能不能绑。返回 null 表示可以；否则给出给人看的理由（HTTP 状态 + 机器码 + 人话）。
 * 人话里带上"这段会话不在谁家里"，别只说 400。
 *
 * 工作区那一格（Fi-0017 的补充）：
 *   - 普通鱼：会话登记的工作区必须就是她的家（`member.home`）；不在自己家的拒绝。
 *   - 巡守（宿主自己）：他的工作区是鱼塘根（`D:\…\lil-whale`），不是 `~\.dsh`，所以只要求
 *     在鱼塘里面（`pondRoot`）；会话文件仍在 `dshHome\sessions` 下这条不变。
 *   - 没登记工作区的会话：放行（r261 那种"未分组"），否则第一段会话反而绑不上。
 */
export function bindingProblem({ roster, memberKey, sessionId, pondRoot }) {
  const id = sessionIdOf(sessionId)
  if (!id) return { status: 400, error: 'bad-session-id', message: '会话 id 形如 session-xxxxxxxx-…' }
  const member = (roster?.members ?? roster ?? {})[memberKey]
  if (!member) return { status: 400, error: 'no-member', message: `名册里没有成员：${memberKey}` }
  if (member.kind !== 'fish') return { status: 400, error: 'not-fish', message: `${memberKey} 不是鱼（kind=${member.kind}），不能绑会话` }
  const home = homeOfMember(member)
  const name = typeof member.name === 'string' && member.name.trim() ? member.name.trim() : memberKey
  if (!home) return { status: 400, error: 'no-home', message: `名册里没有 ${memberKey} 的 dshHome` }
  if (!sessionExistsInHome(home, id)) {
    return { status: 400, error: 'session-not-in-home', message: `这段会话不在 ${name} 的家里（${home}），不绑` }
  }
  const wsPath = workspacePathOf(home, id)
  if (wsPath) {
    if (member.role === 'watcher') {
      // 巡守的会话常建在鱼塘根的父目录里（例：default-workspace\lil-whale 的会话建在 default-workspace）。
      // 2026-11-23 r439：允许"鱼塘根的祖先"，但至少要有两级目录，免得把 C:\ 这种当成合法工作区。
      const ancestorOk = underRoot(pondRoot, wsPath) && normalizePath(wsPath).split('\\').filter(Boolean).length >= 2
      if (pondRoot && !underRoot(wsPath, pondRoot) && !ancestorOk) {
        return { status: 409, error: 'session-workspace-outside-pond', message: `这段会话的工作区在鱼塘外面（${wsPath}），不绑给 ${name}` }
      }
    } else {
      const own = typeof member.home === 'string' && member.home.trim() ? member.home.trim() : home
      if (normalizePath(wsPath) !== normalizePath(own)) {
        return { status: 409, error: 'session-workspace-mismatch', message: `这段会话登记在别的工作区（${wsPath}），醒来 cwd 不是 ${name} 的家（${own}）；换一段在她家里建的会话` }
      }
    }
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

/** 面板上写短一点：`session-ab12cd34`。完整 id 太长，卡片一行放不下。 */
export function shortSessionId(id) {
  const text = sessionIdOf(id)
  if (!text) return ''
  return text.length <= 17 ? text : `${text.slice(0, 17)}…`
}

/**
 * 这条鱼家里有哪些会话（只认目录名，不读内容）。
 * 返回 [{ id, project, mtimeMs }]，按 mtime 倒序；同一 id 出现在多个项目目录时只留一条。
 */
export function sessionsInHome(home) {
  if (!home || !existsSync(home)) return []
  const root = join(home, 'sessions')
  if (!existsSync(root)) return []
  const seen = new Map()
  let projects = []
  try {
    projects = readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    let entries = []
    try {
      entries = readdirSync(join(root, project.name), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const id = sessionIdOf(entry.name)
      if (!id || seen.has(id)) continue
      let mtimeMs = 0
      try {
        mtimeMs = statSync(join(root, project.name, entry.name)).mtimeMs
      } catch {
        mtimeMs = 0
      }
      seen.set(id, { id, project: project.name, mtimeMs })
    }
  }
  return [...seen.values()].sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/**
 * 换绑弹窗要的一份候选表：这条鱼家里的会话 + 每一条"能不能绑、现在归谁、是不是正被挂着"。
 * 判定全落在 bindingProblem 上，别在界面里另写一套。
 */
export function sessionCandidatesOf({ roster, memberKey, pondRoot, pins = {}, liveSessionIds = [] }) {
  const member = (roster?.members ?? roster ?? {})[memberKey]
  const home = homeOfMember(member)
  if (!member || !home) return { member: memberKey, home, sessions: [] }
  const live = new Set(liveSessionIds)
  const sessions = sessionsInHome(home).map((entry) => {
    const problem = bindingProblem({ roster, memberKey, sessionId: entry.id, pondRoot })
    const boundTo = findBinding(pins, entry.id)?.member ?? null
    return {
      id: entry.id,
      short: shortSessionId(entry.id),
      project: entry.project,
      mtimeMs: entry.mtimeMs,
      workspace: workspacePathOf(home, entry.id),
      registered: workspacePathOf(home, entry.id) !== null,
      eligible: problem === null,
      reason: problem ? problem.message : null,
      inUse: live.has(entry.id),
      boundTo,
    }
  })
  return { member: memberKey, home, sessions }
}

/** 账单里的一行。和 scripts/bind-member.mjs 的 bind/unbind 行同形，`by=` 说清是谁干的。 */
export function stateLogLine({ ts, action, memberKey, sessionId, by = 'panel' }) {
  const id = sessionIdOf(sessionId) ?? String(sessionId ?? '')
  return `${ts} | ${action} | fmt=1 member=${memberKey} session=${id} by=${by}`
}
