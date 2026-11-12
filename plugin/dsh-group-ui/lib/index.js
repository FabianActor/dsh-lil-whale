/**
 * 群 UI 的宿主半边：给页面开三条门 —— 读消息、发一条消息、读写这个页面的外观设置。
 *
 * 为什么不走 RPC：客户端到宿主没有通用的、不用生成 schema 的调用通道，
 * 而 webServer 有现成的具名路由。群里那份 messages.jsonl 本来就是接口，
 * 这里只是给它开一扇 HTTP 的门。
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { config } from './config.js'

export const name = 'lil-whale-group-ui'
export const inject = ['webServer', 'agents']

// 她的家在哪从 lil-whale.config.json 读（见本包 lib/config.js）
const GROUP_DIR = config().groupDir
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
// 「看到哪儿了」的游标：只在面板里看，不影响她那边读群的游标
const UI_READ = join(GROUP_DIR, 'ui-read.json')
const PINS = join(GROUP_DIR, 'pins.json')
// 跨进程心跳：dsh-group 插件在各自那个进程里每 5 秒写一份 `state\presence\<成员>.json`。
// 面板要显示"小肥鱼 正在回复"，只能读这个 —— 这个进程里的 ctx.agents 只有大肥鱼自己的会话。
const PRESENCE_DIR = join(GROUP_DIR, '..', 'state', 'presence')
const PRESENCE_FRESH_MS = 20_000
// 群唤醒之后多久之内还算「在回群里」。要比一次长回合宽：首 token 几十秒到几分钟。
const GROUP_WAKE_TTL_MS = 10 * 60_000

// 头像照片：一个人一张，文件名固定 `<成员>.<扩展名>`，换一张就覆盖旧的。
// 上限 1.5 MB —— 够一张头像了；再大就是有人把整张截图塞进来，不该让群目录跟着长胖。
const AVATAR_DIR = join(GROUP_DIR, 'avatars')
// 群图片：和宿主侧同一套布局（images\<yyyymm>\<id>.<ext>），id 是内容哈希。
const IMAGES_DIR = join(GROUP_DIR, 'images')
const IMAGE_MAX_BYTES = 8 * 1024 * 1024
const IMAGE_EXT = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }

/**
 * 读不到的图片必须留痕，否则"没有图"和"图丢了"看起来一样（小肥鱼的原话：
 * 校验的价值不在拦住坏路径，在让坏路径有痕迹）。
 */
function logImageIssue(why, detail) {
  try {
    const line = JSON.stringify({ at: new Date().toISOString(), note: 'image-path-invalid', why, ...detail }) + '\n'
    appendFileSync(join(GROUP_DIR, 'plugin.log'), line, 'utf8')
  } catch {
    // 日志写不进去不该让看图的请求挂掉；这条的痕迹就只剩下面的 404 了。
  }
}

/**
 * 按 id + ext（可选 path）找图片；月份不知道就扫目录（一个群不会有很多月份）。
 * 返回 { file, why }：file 为 null 时 why 说清卡在哪一步，调用方负责写日志。
 */
function imagePathOf(id, ext, pathHint) {
  const safeId = String(id || '')
  const safeExt = String(ext || '').toLowerCase()
  if (!/^[0-9a-f]{16}$/.test(safeId) || !IMAGE_EXT[safeExt]) return { file: null, why: 'bad-id-or-ext' }

  // 记录里有 path 就以它为准；但只信"images/ 开头、不含 ..、文件名对得上"的写法。
  const hint = String(pathHint || '').replace(/\\/g, '/').replace(/^\.\//, '')
  let hintWhy = null
  if (hint !== '') {
    if (!hint.startsWith('images/') || hint.includes('..') || !hint.endsWith('/' + safeId + '.' + safeExt)) {
      hintWhy = 'path-rejected'
    } else {
      const hinted = join(GROUP_DIR, hint)
      if (existsSync(hinted)) return { file: hinted, why: null }
      hintWhy = 'path-missing' // 记录说有、盘上没有
    }
  }

  // 没有 path 的老记录（或 path 校验没过）：按月份扫一遍，能救就救。
  try {
    for (const month of readdirSync(IMAGES_DIR)) {
      const candidate = join(IMAGES_DIR, month, `${safeId}.${safeExt}`)
      if (existsSync(candidate)) return { file: candidate, why: hintWhy }
    }
  } catch { /* 目录还不存在：当作没找到 */ }
  return { file: null, why: hintWhy ?? 'not-found' }
}

/** 把前端传来的 data URL 落盘，返回消息里要记的字段。 */
function storeImageDataUrl(dataUrl) {
  const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''))
  if (!match) throw new Error('图片格式不认：只收 png / jpg / webp / gif 的 data URL')
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
  const buffer = Buffer.from(match[2], 'base64')
  if (buffer.length === 0) throw new Error('图片是空的（0 字节）')
  if (buffer.length > IMAGE_MAX_BYTES) {
    throw new Error(`图片太大：${(buffer.length / 1048576).toFixed(1)} MB，上限 ${IMAGE_MAX_BYTES / 1048576} MB`)
  }
  const id = createHash('sha256').update(buffer).digest('hex').slice(0, 16)
  const month = new Date().toISOString().slice(0, 7).replace('-', '')
  const dir = join(IMAGES_DIR, month)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${id}.${ext}`)
  if (!existsSync(file)) writeFileSync(file, buffer)
  return { id, ext, bytes: buffer.length, month, path: `images/${month}/${id}.${ext}` }
}
/**
 * 把前端传来的 image 指针变成要写进记录的字段（补齐 path）。
 * 没有图返回 null；指针无效抛错，错误码 unknown-image。
 * 两处（群发 / 私聊）共用，别各写一份——各写一份就会各漂各的。
 */
function imageFieldOf(rawImage) {
  if (!rawImage || typeof rawImage !== 'object') return null
  const found = imagePathOf(rawImage.id, rawImage.ext, rawImage.path)
  if (found.file === null) {
    logImageIssue(found.why, { phase: 'send', id: rawImage.id, ext: rawImage.ext, hint: rawImage.path })
    throw new Error('先调 /group/api/image 上传，再带 id/ext 发消息')
  }
  const file = found.file
  const id = String(rawImage.id)
  const ext = String(rawImage.ext).toLowerCase()
  const month = String(rawImage.month || file.split(/[\\/]/).slice(-2)[0] || '')
  return { id, ext, bytes: statSync(file).size, month, path: `images/${month}/${id}.${ext}` }
}

const AVATAR_MAX_BYTES = 1.5 * 1024 * 1024
const AVATAR_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }

const LABEL = { lee: '大肥鱼', whale: '小肥鱼', fabian: 'Fabian' }
const KNOWN_PEERS = Object.keys(LABEL).filter((id) => !DM_HIDDEN.has(id))

const DEFAULT_CONFIG = {
  panelLabel: '鱼群',
  names: { lee: '大肥鱼', whale: '小肥鱼', fabian: 'Fabian' },
  /**
   * 座位名：同一个人可能有几段会话同时在群里（`lee` 就有两段）。
   * 键是会话 id 的前 6 位（`session-e17c3c91-…` → `e17c3c`），值是这段会话在群里显示的名字。
   * 找不到座位名就回落到 `names[成员]` —— 所以不填也不影响用，只是看不出是哪一段说的。
   * 打包给别人时这里应该是空对象，由用户在自己机器上填。
   */
  seats: {},
  /** 未读口径：'all' = 所有不是自己说的话；'mentions' = 只算 @ 到我的（to 是 all 或 fabian）。 */
  notifyScope: 'all',
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
      notifyScope: raw?.notifyScope === 'mentions' ? 'mentions' : 'all',
      names: {
        lee: normalizeName(raw?.names?.lee, DEFAULT_CONFIG.names.lee),
        whale: normalizeName(raw?.names?.whale, DEFAULT_CONFIG.names.whale),
        fabian: normalizeName(raw?.names?.fabian, DEFAULT_CONFIG.names.fabian),
      },
      seats: normalizeSeats(raw?.seats),
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

/** 座位名：键必须是 6 位十六进制（会话 id 前 6 位）或 'ui'（面板发的），值最多 16 字。 */
function normalizeSeats(value) {
  const out = {}
  if (!value || typeof value !== 'object') return out
  for (const [key, name] of Object.entries(value)) {
    if (!/^[0-9a-f]{6}$|^ui$/.test(key)) continue
    if (typeof name !== 'string') continue
    const text = name.trim()
    if (!text) continue
    out[key] = text.slice(0, 16)
  }
  return out
}

function normalizeAvatar(value, fallback) {
  const text = typeof value?.text === 'string' ? Array.from(value.text.trim()).slice(0, 2).join('') : ''
  const tint = typeof value?.tint === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.tint.trim()) ? value.tint.trim() : ''
  // 照片：只记扩展名，真正的字节在 `group\avatars\<成员>.<扩展名>`。
  // `version` 是换图时的时间戳，前端拿它拼 `?v=`，浏览器就不用猜缓存有没有过期。
  const image = typeof value?.image === 'string' && Object.hasOwn(AVATAR_TYPES, value.image) ? value.image : ''
  const version = Number.isFinite(value?.version) ? Math.trunc(value.version) : 0
  return {
    text: text || fallback.text,
    tint: tint || fallback.tint,
    image,
    version: image ? version : 0,
  }
}

function writeConfig(config) {
  writeFileSync(UI_CONFIG, JSON.stringify(config, null, 2) + '\n', 'utf8')
  return config
}

function readUiRead() {
  try {
    const raw = JSON.parse(readFileSync(UI_READ, 'utf8'))
    return {
      group: typeof raw?.group === 'string' ? raw.group : '',
      dm: raw?.dm && typeof raw.dm === 'object' && !Array.isArray(raw.dm) ? raw.dm : {},
    }
  } catch {
    return { group: '', dm: {} }
  }
}

function writeUiRead(next) {
  try {
    writeFileSync(UI_READ, JSON.stringify(next, null, 2) + '\n', 'utf8')
  } catch {
    // 写不进去不影响看消息，只是红点会重复出现
  }
}

function countUnread(file, since, scope = 'all') {
  return readMessages(file).filter((message) => {
    if (message.from === 'fabian') return false
    if (String(message.ts ?? '') <= since) return false
    if (scope === 'mentions' && message.to !== 'all' && message.to !== 'fabian') return false
    return true
  }).length
}

function lastTsOf(file) {
  const messages = readMessages(file)
  return messages.length ? String(messages[messages.length - 1].ts ?? '') : ''
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

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
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
    notifyScope: payload?.notifyScope === 'mentions' ? 'mentions' : 'all',
        names: {
          lee: normalizeName(payload?.names?.lee, DEFAULT_CONFIG.names.lee),
          whale: normalizeName(payload?.names?.whale, DEFAULT_CONFIG.names.whale),
          fabian: normalizeName(payload?.names?.fabian, DEFAULT_CONFIG.names.fabian),
        },
        seats: normalizeSeats(payload?.seats),
        avatars: {
          lee: normalizeAvatar(payload?.avatars?.lee, DEFAULT_CONFIG.avatars.lee),
          whale: normalizeAvatar(payload?.avatars?.whale, DEFAULT_CONFIG.avatars.whale),
          fabian: normalizeAvatar(payload?.avatars?.fabian, DEFAULT_CONFIG.avatars.fabian),
        },
      }
      try {
        writeConfig(next)
      } catch (error) {
        sendJson(res, 500, { error: 'write-failed', detail: String(error?.message ?? error) })
        return
      }
      sendJson(res, 200, next)
    },
  }))

  /**
   * 头像照片：读一张、换一张、去掉。
   *
   * 为什么走 data URL 而不是 multipart：图就是一张头像，多一个解析器不划算。
   * `GET /group/api/avatar?member=lee&v=<版本>` 直接回二进制，`v` 变了 URL 就变了，
   * 浏览器那层缓存不用特意去清。
   */
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/group/api/avatar',
    async handler(req, res) {
      const url = new URL(req.url ?? '/', 'http://localhost')
      // member 既可以从 query 给，也可以从 body 给。只认其中一路的话，
      // 另一路会收到一个没有解释的 400 —— 这个坑现场踩过（2026-11-11）。
      let member = url.searchParams.get('member') ?? ''
      const pathOf = (ext) => join(AVATAR_DIR, `${member}.${ext}`)
      const requireMember = () => {
        if (Object.hasOwn(LABEL, member)) return true
        sendJson(res, 400, { error: 'unknown-member', member, hint: 'member 从 query 或 body 给都行' })
        return false
      }

      if (req.method === 'GET') {
        if (!requireMember()) return
        for (const [ext, type] of Object.entries(AVATAR_TYPES)) {
          const file = pathOf(ext)
          if (!existsSync(file)) continue
          try {
            const bytes = readFileSync(file)
            res.writeHead(200, {
              'content-type': type,
              // 版本号在 URL 里，所以这张图可以永久缓存；换图会换成新 URL。
              'cache-control': 'public, max-age=31536000, immutable',
              'content-length': bytes.length,
            })
            res.end(bytes)
            return
          } catch {
            // 读失败就当没有，接着试别的格式
          }
        }
        sendJson(res, 404, { error: 'no-avatar' })
        return
      }

      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method-not-allowed' })
        return
      }

      let payload
      try {
        payload = JSON.parse(await readBody(req, 4 * 1024 * 1024))
      } catch {
        sendJson(res, 400, { error: 'bad-json' })
        return
      }

      member = String(payload?.member ?? member)
      if (!requireMember()) return

      const config = readConfig()
      const clear = () => {
        for (const ext of Object.keys(AVATAR_TYPES)) {
          const file = pathOf(ext)
          if (!existsSync(file)) continue
          try { rmSync(file) } catch { /* 删不掉就留着，下次覆盖 */ }
        }
        config.avatars[member] = { ...config.avatars[member], image: '', version: 0 }
        writeConfig(config)
        sendJson(res, 200, config)
      }

      if (payload?.clear === true) {
        clear()
        return
      }

      const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(payload?.dataUrl ?? ''))
      if (!match) {
        sendJson(res, 400, { error: 'bad-image', hint: '只收 png / jpeg / webp 的 data URL' })
        return
      }
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
      let bytes
      try {
        bytes = Buffer.from(match[2], 'base64')
      } catch {
        sendJson(res, 400, { error: 'bad-base64' })
        return
      }
      if (bytes.length === 0 || bytes.length > AVATAR_MAX_BYTES) {
        sendJson(res, 413, { error: 'too-large', maxBytes: AVATAR_MAX_BYTES, got: bytes.length })
        return
      }

      try {
        mkdirSync(AVATAR_DIR, { recursive: true })
        // 换了格式就把旧文件删掉，免得同一个人留两份脸
        for (const old of Object.keys(AVATAR_TYPES)) {
          if (old === ext) continue
          const stale = pathOf(old)
          if (existsSync(stale)) rmSync(stale)
        }
        writeFileSync(pathOf(ext), bytes)
      } catch (error) {
        sendJson(res, 500, { error: 'write-failed', detail: String(error?.message ?? error) })
        return
      }

      config.avatars[member] = { ...config.avatars[member], image: ext, version: Date.now() }
      writeConfig(config)
      sendJson(res, 200, config)
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
        const pins = JSON.parse(readFileSync(PINS, 'utf8'))
        const bySession = {}
        for (const [member, ids] of Object.entries(pins ?? {})) {
          for (const id of Array.isArray(ids) ? ids : [ids]) {
            if (typeof id === 'string') bySession[id] = member
          }
        }
        // 1) 对方那个进程写的心跳文件：本进程看不见他们的 agent，只能读盘。
        //    超过 20 秒没更新就当"不知道"（进程关了、卡了），不要假装对方在打字。
        for (const member of Object.keys(pins ?? {})) {
          try {
            const beat = JSON.parse(readFileSync(join(PRESENCE_DIR, `${member}.json`), 'utf8'))
            const at = Number(beat?.at) || 0
            if (Date.now() - at <= PRESENCE_FRESH_MS) {
              // reason 是"这一轮从哪来"，不是"这句话回谁"：
              // 群唤醒会留 groupWakeAt，十分钟内算群里的；其余一律算"在别处忙"，
              // 因为宿主这里根本没有更细的信息，宁可含糊也不要编。
              const woke = Number(beat?.groupWakeAt) || 0
              members[member] = {
                status: beat?.status === 'idle' ? 'idle' : 'working',
                reason: woke > 0 && Date.now() - woke <= GROUP_WAKE_TTL_MS ? 'group' : 'self',
              }
            }
          } catch {
            // 没心跳就当不知道
          }
        }
        // 2) 本进程的 agent 状态更准（心跳最慢差 5 秒），有就以它为准。
        //    本进程这一侧不知道"为什么忙"（那要读群唤醒记录，代价不值），所以不覆盖 reason。
        for (const agent of ctx.agents.list()) {
          const sessionId = agent?.session?.header?.id
          const member = bySession[sessionId]
          if (!member) continue
          const busy = agent?.status !== 'idle'
          if (busy) {
            const prev = members[member]
            members[member] = { status: 'working', reason: prev?.reason === 'group' ? 'group' : 'self' }
          }
        }
      } catch {
        // 读不到就当没人说话：宁可安静，不要假装有人在打字
      }
      sendJson(res, 200, { members })
    },
  }))

  // 有哪些座位：把 pins.json 里每一段被钉住的会话列出来（id 前 6 位 + 属于谁）。
  // 设置页据此给每一段一个可改的显示名——不硬编码，换机器、加会话都不用改代码。
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/group/api/seats',
    handler(req, res) {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
      const seats = []
      try {
        const pins = JSON.parse(readFileSync(PINS, 'utf8'))
        for (const [member, ids] of Object.entries(pins ?? {})) {
          for (const id of Array.isArray(ids) ? ids : [ids]) {
            if (typeof id !== 'string') continue
            seats.push({ prefix: id.replace(/^session-/, '').slice(0, 6), member, sessionId: id })
          }
        }
      } catch {
        // 读不到名册就返回空表；设置页会显示"还没有登记座位"
      }
      sendJson(res, 200, { seats })
    },
  }))
  // ---------- 群图片 ----------
  // GET  ?id=<16hex>&ext=png  → 图片字节（内容哈希当 id，所以可以永久缓存）
  // POST { dataUrl }          → { id, ext, bytes, month }，前端拿到后再调 /group/api/send 带 image
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/group/api/image',
    async handler(req, res) {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method === 'GET') {
        const found = imagePathOf(url.searchParams.get('id'), url.searchParams.get('ext'))
        if (found.file === null) {
          logImageIssue(found.why, { phase: 'read', id: url.searchParams.get('id'), ext: url.searchParams.get('ext') })
          sendJson(res, 404, { error: 'no-image' })
          return
        }
        const file = found.file
        const bytes = readFileSync(file)
        res.statusCode = 200
        res.setHeader('content-type', IMAGE_EXT[url.searchParams.get('ext').toLowerCase()] ?? 'application/octet-stream')
        res.setHeader('content-length', String(bytes.length))
        res.setHeader('cache-control', 'public, max-age=31536000, immutable')
        res.end(bytes)
        return
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      let payload
      try {
        payload = JSON.parse(await readBody(req, 12 * 1024 * 1024))
      } catch {
        sendJson(res, 400, { error: 'bad-json' })
        return
      }
      try {
        const image = storeImageDataUrl(payload?.dataUrl)
        sendJson(res, 200, { ok: true, image })
      } catch (error) {
        const message = String(error?.message ?? error)
        sendJson(res, message.includes('太大') ? 413 : 400, { error: 'bad-image', detail: message })
      }
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
      // 图片（可选）：{ id, ext, bytes, month, path }，由 /group/api/image 先上传拿到。
      let image = null
      try {
        image = imageFieldOf(payload?.image)
      } catch (error) {
        sendJson(res, 400, { error: 'unknown-image', detail: String(error?.message ?? error) })
        return
      }
      if (!text && image === null) {
        sendJson(res, 400, { error: 'empty-message', detail: '至少要有文字或一张图片' })
        return
      }
      if (to !== 'all' && to !== 'lee' && to !== 'whale') {
        sendJson(res, 400, { error: 'bad-target' })
        return
      }
      const now = new Date()
      // toSeat（可选）：指名这个人的哪一段会话收（6 位十六进制）。不填 = 叫这个人，谁空谁应。
      const rawSeat = typeof payload?.toSeat === 'string' ? payload.toSeat.trim() : ''
      const toSeat = /^[0-9a-f]{6}$/.test(rawSeat) ? rawSeat : ''
      // s = 谁发的：'ui' 表示从面板发的（他没有会话 id）。跟 group_say 写的 s=<会话前6位> 是同一个字段。
      const record = {
        ts: now.toISOString(), from: 'fabian', to, text, kind: 'say', s: 'ui',
        ...(toSeat === '' ? {} : { toSeat }),
        ...(image === null ? {} : { image }),
      }
      try {
        appendFileSync(MESSAGES, JSON.stringify(record) + '\n', 'utf8')
        const who = to === 'all' ? '群里' : LABEL[to] ?? to
        const body = image === null
          ? text
          : `（图片 images/${image.month}/${image.id}.${image.ext}）${text === '' ? '' : `\n\n${text}`}`
        appendFileSync(READABLE, `**${stamp(now)} · Fabian → ${who}**\n\n${body}\n\n`, 'utf8')
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
      // 私聊一样能带图：字节和群聊共用 images\ 目录（同一张图两边只存一份）。
      let image = null
      try {
        image = imageFieldOf(payload?.image)
      } catch (error) {
        sendJson(res, 400, { error: 'unknown-image', detail: String(error?.message ?? error) })
        return
      }
      if (!text && image === null) {
        sendJson(res, 400, { error: 'empty-message', detail: '至少要有文字或一张图片' })
        return
      }
      const peer = dmPeerOf(payload?.peer)
      const now = new Date()
      const record = {
        ts: now.toISOString(), from: 'fabian', to: peer, text, kind: 'dm', channel: 'dm',
        ...(image === null ? {} : { image }),
      }
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

  // ---------- 未读红点：这里的"读没读"只记"这个窗口看到哪儿了"，不动她那边的游标 ----------
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/group/api/unread',
    async handler(req, res) {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      const state = readUiRead()
      const scope = readConfig().notifyScope
      const group = countUnread(MESSAGES, state.group, scope)
      const dm = {}
      let total = group
      for (const peer of KNOWN_PEERS) {
        const count = countUnread(dmFileOf(peer), String(state.dm[peer] ?? ''))
        dm[peer] = count
        total += count
      }
      // seen 是"这个窗口上次看到哪儿"的时间戳，面板拿它在消息列表里画一条
      // 「以上为历史消息」的分割线（2026-11-11 他的要求）。
      sendJson(res, 200, { group, dm, total, seen: { group: state.group, dm: state.dm } })
    },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/group/api/read',
    async handler(req, res) {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      let payload = null
      try {
        payload = JSON.parse(await readBody(req))
      } catch {
        sendJson(res, 400, { error: 'bad-json' })
        return
      }
      const channel = payload?.channel
      const state = readUiRead()
      if (channel === 'group') {
        state.group = lastTsOf(MESSAGES)
      } else if (channel === 'dm') {
        const peer = dmPeerOf(payload?.peer)
        state.dm[peer] = lastTsOf(dmFileOf(peer))
      } else {
        sendJson(res, 400, { error: 'bad-channel' })
        return
      }
      writeUiRead(state)
      sendJson(res, 200, { ok: true, state })
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
