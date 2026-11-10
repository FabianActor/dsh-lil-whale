/**
 * 群 UI 的宿主半边：给页面开三条门 —— 读消息、发一条消息、读写这个页面的外观设置。
 *
 * 为什么不走 RPC：客户端到宿主没有通用的、不用生成 schema 的调用通道，
 * 而 webServer 有现成的具名路由。群里那份 messages.jsonl 本来就是接口，
 * 这里只是给它开一扇 HTTP 的门。
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'dsh-group-ui'
export const inject = ['webServer', 'agents']

const GROUP_DIR = 'D:\\文档\\WorkSpace\\lil-whale\\group'
const MESSAGES = join(GROUP_DIR, 'messages.jsonl')
const READABLE = join(GROUP_DIR, '群.md')
const DM_DIR = join(GROUP_DIR, 'dm')
// 一个人和一条鱼的那段对话：两个方向都写在同一个文件里（他 2026-11-10 定）
// 文件名 = 两个 id 按字母序拼：`fabian__whale.jsonl`
function dmFileOf(peer) {
  return join(DM_DIR, ['fabian', peer].sort().join('__') + '.jsonl')
}
// 列表里只放"鱼"：fabian 是他自己，lee 是大肥鱼（他就在 3080 里跟 Leea 说话，不用再开一页）
const DM_HIDDEN = new Set(['fabian', 'lee'])
const UI_CONFIG = join(GROUP_DIR, 'ui-config.json')
const PINS = join(GROUP_DIR, 'pins.json')

const LABEL = { lee: '大肥鱼', whale: '小肥鱼', fabian: 'Fabian' }
const KNOWN_PEERS = Object.keys(LABEL).filter((id) => !DM_HIDDEN.has(id))

const DEFAULT_CONFIG = {
  panelLabel: '鱼群',
  contentWidth: 72,
  avatars: {
    lee: { text: '大', tint: '#4a7dbd' },
    whale: { text: '小', tint: '#c2705a' },
    fabian: { text: 'F', tint: '#5c8a6a' },
  },
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

function readConfig() {
  if (!existsSync(UI_CONFIG)) return DEFAULT_CONFIG
  try {
    const raw = JSON.parse(readFileSync(UI_CONFIG, 'utf8'))
    return {
      panelLabel: typeof raw?.panelLabel === 'string' && raw.panelLabel.trim() ? raw.panelLabel.trim() : DEFAULT_CONFIG.panelLabel,
      contentWidth: normalizeWidth(raw?.contentWidth),
      names: {
        lee: normalizeName(raw?.names?.lee, DEFAULT_CONFIG.names.lee),
        whale: normalizeName(raw?.names?.whale, DEFAULT_CONFIG.names.whale),
        fabian: normalizeName(raw?.names?.fabian, DEFAULT_CONFIG.names.fabian),
      },
      avatars: {
        lee: normalizeAvatar(raw?.avatars?.lee, DEFAULT_CONFIG.avatars.lee),
        whale: normalizeAvatar(raw?.avatars?.whale, DEFAULT_CONFIG.avatars.whale),
        fabian: normalizeAvatar(raw?.avatars?.fabian, DEFAULT_CONFIG.avatars.fabian),
      },
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

function normalizeName(value, fallback) {
  if (typeof value !== 'string') return fallback
  const text = value.trim()
  if (!text) return fallback
  return text.slice(0, 16)
}

function normalizeWidth(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_CONFIG.contentWidth
  return Math.min(92, Math.max(30, Math.round(n)))
}

function normalizeAvatar(value, fallback) {
  const text = typeof value?.text === 'string' ? Array.from(value.text.trim()).slice(0, 2).join('') : ''
  const tint = typeof value?.tint === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.tint.trim()) ? value.tint.trim() : ''
  return {
    text: text || fallback.text,
    tint: tint || fallback.tint,
  }
}

function readMessages(file = MESSAGES) {
  if (!existsSync(file)) return []
  const out = []
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const text = line.trim()
    if (!text) continue
    try {
      const record = JSON.parse(text)
      out.push({
        ts: record.ts,
        from: record.from,
        to: record.to,
        text: record.text,
        kind: record.kind ?? 'say',
      })
    } catch {
      // 半截行（另一个进程正在写）——跳过，下一次轮询就整了
    }
  }
  return out
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 256 * 1024) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function stamp(date) {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`
}

export function apply(ctx) {
  const disposers = []

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/group/api/messages',
    handler(req, res) {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      const messages = readMessages()
      sendJson(res, 200, { count: messages.length, messages })
    },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/group/api/config',
    async handler(req, res) {
      if (req.method === 'GET') {
        sendJson(res, 200, readConfig())
        return
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      let payload
      try {
        payload = JSON.parse(await readBody(req))
      } catch {
        sendJson(res, 400, { error: 'bad-json' })
        return
      }
      const next = {
        panelLabel: normalizeLabel(payload?.panelLabel),
        contentWidth: normalizeWidth(payload?.contentWidth),
        names: {
          lee: normalizeName(payload?.names?.lee, DEFAULT_CONFIG.names.lee),
          whale: normalizeName(payload?.names?.whale, DEFAULT_CONFIG.names.whale),
          fabian: normalizeName(payload?.names?.fabian, DEFAULT_CONFIG.names.fabian),
        },
        avatars: {
          lee: normalizeAvatar(payload?.avatars?.lee, DEFAULT_CONFIG.avatars.lee),
          whale: normalizeAvatar(payload?.avatars?.whale, DEFAULT_CONFIG.avatars.whale),
          fabian: normalizeAvatar(payload?.avatars?.fabian, DEFAULT_CONFIG.avatars.fabian),
        },
      }
      try {
        writeFileSync(UI_CONFIG, JSON.stringify(next, null, 2) + '\n', 'utf8')
      } catch (error) {
        sendJson(res, 500, { error: 'write-failed', detail: String(error?.message ?? error) })
        return
      }
      sendJson(res, 200, next)
    },
  }))

  // 谁正在说话：给前端做"对方正在输入"用。状态来自宿主真正的 agent 状态，
  // 不是前端猜的——猜出来的"正在输入"比没有更烦人。
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/group/api/presence',
    handler(req, res) {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
      const members = {}
      try {
        const pins = JSON.parse(fs.readFileSync(PINS, 'utf8'))
        const bySession = {}
        for (const [member, ids] of Object.entries(pins ?? {})) {
          for (const id of Array.isArray(ids) ? ids : [ids]) {
            if (typeof id === 'string') bySession[id] = member
          }
        }
        for (const agent of ctx.agents.list()) {
          const sessionId = agent?.session?.header?.id
          const member = bySession[sessionId]
          if (!member) continue
          const busy = agent?.status !== 'idle'
          if (busy || members[member] === undefined) members[member] = busy ? 'working' : 'idle'
        }
      } catch {
        // 读不到就当没人说话：宁可安静，不要假装有人在打字
      }
      sendJson(res, 200, { members })
    },
  }))
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/group/api/send',
    async handler(req, res) {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      let payload
      try {
        payload = JSON.parse(await readBody(req))
      } catch {
        sendJson(res, 400, { error: 'bad-json' })
        return
      }
      const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
      const to = payload?.to
      if (!text) {
        sendJson(res, 400, { error: 'empty-text' })
        return
      }
      if (to !== 'all' && to !== 'lee' && to !== 'whale') {
        sendJson(res, 400, { error: 'bad-target' })
        return
      }
      const now = new Date()
      const record = { ts: now.toISOString(), from: 'fabian', to, text, kind: 'say' }
      try {
        appendFileSync(MESSAGES, JSON.stringify(record) + '\n', 'utf8')
        const who = to === 'all' ? '群里' : LABEL[to] ?? to
        appendFileSync(READABLE, `**${stamp(now)} · Fabian → ${who}**\n\n${text}\n\n`, 'utf8')
      } catch (error) {
        sendJson(res, 500, { error: 'write-failed', detail: String(error?.message ?? error) })
        return
      }
      sendJson(res, 200, { ok: true, record })
    },
  }))

  // ---------- 私聊：一个人和一条鱼的那段对话 ----------
  // 这个窗口里说话的人固定是 Fabian，收信的人是 peer；两个方向都写进同一个文件。
  const dmPeerOf = (value) => {
    const peer = typeof value === 'string' ? value.trim() : ''
    return peer && KNOWN_PEERS.includes(peer) ? peer : KNOWN_PEERS[0]
  }

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/group/api/dm',
    async handler(req, res) {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method === 'GET') {
        const peer = dmPeerOf(url.searchParams.get('peer'))
        const messages = readMessages(dmFileOf(peer))
        sendJson(res, 200, { peer, count: messages.length, messages })
        return
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      let payload
      try {
        payload = JSON.parse(await readBody(req))
      } catch {
        sendJson(res, 400, { error: 'bad-json' })
        return
      }
      const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
      if (!text) {
        sendJson(res, 400, { error: 'empty-text' })
        return
      }
      const peer = dmPeerOf(payload?.peer)
      const now = new Date()
      const record = { ts: now.toISOString(), from: 'fabian', to: peer, text, kind: 'dm', channel: 'dm' }
      try {
        mkdirSync(DM_DIR, { recursive: true })
        appendFileSync(dmFileOf(peer), JSON.stringify(record) + '\n', 'utf8')
      } catch (error) {
        sendJson(res, 500, { error: 'write-failed', detail: String(error?.message ?? error) })
        return
      }
      sendJson(res, 200, { ok: true, peer, record })
    },
  }))

  // 联系人列表：每条鱼一行，带最后一句（未读数还没做，先不做假数）
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/group/api/dm/contacts',
    async handler(req, res) {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      const contacts = KNOWN_PEERS.map((peer) => {
        const messages = readMessages(dmFileOf(peer))
        const last = messages.length ? messages[messages.length - 1] : null
        return { peer, name: LABEL[peer] ?? peer, count: messages.length, last }
      })
      sendJson(res, 200, { contacts })
    },
  }))

  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  })
}

function normalizeLabel(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return DEFAULT_CONFIG.panelLabel
  return Array.from(text).slice(0, 12).join('')
}
