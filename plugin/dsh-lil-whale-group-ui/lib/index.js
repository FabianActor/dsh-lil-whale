/**
 * 群 UI 的宿主半边：给页面开三条门 —— 读消息、发一条消息、读写这个页面的外观设置。
 *
 * 为什么不走 RPC：客户端到宿主没有通用的、不用生成 schema 的调用通道，
 * 而 webServer 有现成的具名路由。群里那份 messages.jsonl 本来就是接口，
 * 这里只是给它开一扇 HTTP 的门。
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { Socket } from 'node:net'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { config } from './config.js'
import { parseMessageLines } from './messages-core.js'

export const name = '@fabianactor/dsh-lil-whale-group-ui'
export const inject = ['webServer', 'agents']

// 她的家在哪从 lil-whale.config.json 读（见本包 lib/config.js）
const GROUP_DIR = config().groupDir
const MESSAGES = join(GROUP_DIR, 'messages.jsonl')
const READABLE = join(GROUP_DIR, '群.md')
// 私聊是双向隐私窗口，不在 group\ 下面（A.24）。
const DM_DIR = config().dmDir || join(GROUP_DIR, 'dm')
// 一个人和一条鱼的那段对话：两个方向都写在同一个文件里（他 2026-11-10 定）
// 文件名 = 两个 id 按字母序拼：`fabian__whale.jsonl`
function dmReadableOf(peer) {
  const [x, y] = [HUMAN_ID, peer].sort()
  return join(DM_DIR, `私聊-${x}__${y}.md`)
}

function dmFileOf(peer) {
  return join(DM_DIR, [HUMAN_ID, peer].sort().join('__') + '.jsonl')
}
// 人类自己不开私聊页；巡守那条（主进程里跟他说话的那位）也不再列一页。
// 2026-11-16 r215：别写死那个名字 —— 那是作者家的键，新装机器上它根本不存在。
const UI_CONFIG = join(GROUP_DIR, 'ui-config.json')
// 「看到哪儿了」的游标：只在面板里看，不影响她那边读群的游标
const UI_READ = join(GROUP_DIR, 'ui-read.json')
const PINS = join(GROUP_DIR, 'pins.json')
// 跨进程心跳：dsh-lil-whale-group 插件在各自那个进程里每 5 秒写一份 `state\presence\<成员>.json`。
// 面板要显示"小肥鱼 正在回复"，只能读这个 —— 这个进程里的 ctx.agents 只有大肥鱼自己的会话。
const POOL_STATE = config().poolStateDir || join(GROUP_DIR, '..', 'state')
const PRESENCE_DIR = join(POOL_STATE, 'presence')
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
// 没有 fmt 字段的图片指针按 fmt=1 读；fmt=2 起有 path / algo。
const IMAGE_FMT = 2
const IMAGE_ALGO = 'sha256'

// 版本：设置页要显示「当前版本」并检查 npm 上的最新版。
// 当前版本从两个包自己的 package.json 读（ui 就是自己；host 走模块解析，
// 解析不到再按同 scope 的兄弟目录找）——不写死数字，免得代码和 package.json 各说各话。
const UI_PACKAGE = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
const HOST_PACKAGE_NAME = '@fabianactor/dsh-lil-whale-group'

function hostPackageVersion() {
  try {
    const req = createRequire(import.meta.url)
    const file = req.resolve(HOST_PACKAGE_NAME + '/package.json')
    return JSON.parse(readFileSync(file, 'utf8')).version ?? null
  } catch {
    try {
      return JSON.parse(readFileSync(fileURLToPath(new URL('../../dsh-lil-whale-group/package.json', import.meta.url)), 'utf8')).version ?? null
    } catch {
      return null
    }
  }
}

function versionState() {
  return {
    host: { name: HOST_PACKAGE_NAME, current: hostPackageVersion() },
    ui: { name: UI_PACKAGE.name, current: UI_PACKAGE.version ?? null },
  }
}

/** 只比 x.y.z 的数字段；预发布标签（-rc.1）忽略——给人看的是版本，不是 semver 全集。 */
function newerThan(latest, current) {
  if (!latest || !current) return null
  const a = String(latest).split('-')[0].split('.').map((n) => Number(n) || 0)
  const b = String(current).split('-')[0].split('.').map((n) => Number(n) || 0)
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false
  }
  return false
}

async function latestOnNpm(packageName) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(`https://registry.npmjs.org/${packageName.replace('/', '%2F')}/latest`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    return typeof data?.version === 'string' ? data.version : null
  } finally {
    clearTimeout(timer)
  }
}

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
function imagePathOf(id, ext, pathHint, algoHint) {
  const safeId = String(id || '')
  const safeExt = String(ext || '').toLowerCase()
  if (!/^[0-9a-f]{16}$/.test(safeId) || !IMAGE_EXT[safeExt]) return { file: null, why: 'bad-id-or-ext' }
  // 指纹算法标在纸上：换了算法，全库返回 unknown-algo，而不是静默孤儿。
  if (String(algoHint || IMAGE_ALGO) !== IMAGE_ALGO) return { file: null, why: 'unknown-algo' }

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
  return { fmt: IMAGE_FMT, id, ext, bytes: buffer.length, month, path: `images/${month}/${id}.${ext}`, algo: IMAGE_ALGO }
}
/**
 * 把前端传来的 image 指针变成要写进记录的字段（补齐 path）。
 * 没有图返回 null；指针无效抛错，错误码 unknown-image。
 * 两处（群发 / 私聊）共用，别各写一份——各写一份就会各漂各的。
 */
/** 多图（2026-11-15）：payload.images 可以是数组，也可以传单张 payload.image。 */
function imageFieldsOf(rawImages) {
  const list = Array.isArray(rawImages) ? rawImages : (rawImages ? [rawImages] : [])
  return list.map((rawImage) => imageFieldOf(rawImage)).filter(Boolean)
}

/** 投影正文：和宿主 readableBodyOf 逐字一致（重建器靠这个对 0 差异）。 */
function readableBodyWithImages(text, images) {
  if (!Array.isArray(images) || images.length === 0) return text
  const marks = images.map((image) => `（图片 images/${image.month}/${image.id}.${image.ext}）`).join('\n')
  return `${marks}${text === '' ? '' : `\n\n${text}`}`
}

function imageFieldOf(rawImage) {
  if (!rawImage || typeof rawImage !== 'object') return null
  const found = imagePathOf(rawImage.id, rawImage.ext, rawImage.path, rawImage.algo)
  if (found.file === null) {
    logImageIssue(found.why, { phase: 'send', id: rawImage.id, ext: rawImage.ext, hint: rawImage.path })
    throw new Error('先调 /group/api/image 上传，再带 id/ext 发消息')
  }
  const file = found.file
  const id = String(rawImage.id)
  const ext = String(rawImage.ext).toLowerCase()
  const month = String(rawImage.month || file.split(/[\\/]/).slice(-2)[0] || '')
  return { fmt: IMAGE_FMT, id, ext, bytes: statSync(file).size, month, path: `images/${month}/${id}.${ext}`, algo: IMAGE_ALGO }
}

const AVATAR_MAX_BYTES = 1.5 * 1024 * 1024
const AVATAR_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }

/**
 * 名册的真源是共享区的 `pool\members.json`（2026-11-12 起）。
 *
 * 以前这里写死三条（lee / whale / fabian），后果是：新装的鱼**不在群里、设置页里看不到、
 * @ 面板点不到她**，而且一个错都不报 —— 又是"错的东西长得很安静"。
 * 现在有几个人由数据说了算；读不到文件才退回内置三条。
 */
// 兜底名册只给"名册文件读不到"时用（最小安装会走到这里）。
// 名字必须中性：这里曾经写着 大肥鱼/小肥鱼/Fabian，等于把作者家的成员名
// 漏进别人的安装里（2026-11-16 第三份装机沉淀 P11，r206）。
const UI_MEMBERS_FALLBACK = {
  host: { name: '宿主', kind: 'fish', role: 'watcher' },
  fish: { name: '第二条鱼', kind: 'fish', role: 'member' },
  human: { name: '人类', kind: 'human', role: 'human' },
}

function loadUiMembers() {
  const file = config().membersFile || join(config().poolDir || join(GROUP_DIR, '..'), 'members.json')
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const out = {}
    for (const [key, m] of Object.entries(raw?.members ?? {})) {
      const name = typeof m?.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 16) : key
      out[key] = { name, kind: m?.kind === 'human' ? 'human' : 'fish', role: m?.role === 'watcher' ? 'watcher' : (m?.kind === 'human' ? 'human' : 'member') }
    }
    if (Object.keys(out).length) return out
  } catch {
    // 读不到 / 读坏了：退回内置三条。不写日志 —— UI 插件没有宿主那套 logLine，
    // 而 doctor 已经在查名册了（缺鱼会点名），这里再喊一遍只是噪音。
  }
  return UI_MEMBERS_FALLBACK
}

const MEMBERS = loadUiMembers()
/** 巡守的成员键：按 role 找，不按名字猜。 */
const WATCHER_ID = Object.keys(MEMBERS).find((id) => MEMBERS[id].role === 'watcher') ?? null
const DM_HIDDEN = new Set(WATCHER_ID ? [WATCHER_ID] : [])
const LABEL = Object.fromEntries(Object.entries(MEMBERS).map(([key, m]) => [key, m.name]))
/** 能私聊的对象：鱼，不含人类自己，也不含明确隐藏的。 */
const KNOWN_PEERS = Object.keys(MEMBERS).filter((id) => MEMBERS[id].kind === 'fish' && !DM_HIDDEN.has(id))
/** 人类成员的 id（名册里 kind: human 的那个）：UI 写消息、私聊文件名、未读口径都用它。 */
const HUMAN_ID = Object.keys(MEMBERS).find((id) => MEMBERS[id].kind === 'human') ?? 'fabian'

/** 新成员没有配头像时的兜底：名字首字 + 一组固定底色（按成员 id 稳定分配）。 */
const AVATAR_TINTS = ['#4a7dbd', '#c2705a', '#5c8a6a', '#8a6ab8', '#b8863c', '#3f8f8f']
function defaultAvatarOf(member) {
  const name = LABEL[member] ?? member
  let hash = 0
  for (const ch of member) hash = (hash * 31 + ch.codePointAt(0)) % 997
  return { text: [...name][0] ?? '?', tint: AVATAR_TINTS[hash % AVATAR_TINTS.length] }
}

const DEFAULT_CONFIG = {
  panelLabel: '鱼群',
  names: { ...LABEL },
  /**
   * 座位名：同一个人可能有几段会话同时在群里（`lee` 就有两段）。
   * 键是会话 id 的前 6 位（`session-e17c3c91-…` → `e17c3c`），值是这段会话在群里显示的名字。
   * 找不到座位名就回落到 `names[成员]` —— 所以不填也不影响用，只是看不出是哪一段说的。
   * 打包给别人时这里应该是空对象，由用户在自己机器上填。
   */
  seats: {},
  /** 未读口径：'all' = 所有不是自己说的话；'mentions' = 只算 @ 到我的（to 是 all 或 fabian）。 */
  notifyScope: 'all',
  avatars: Object.fromEntries(Object.keys(MEMBERS).map((key) => [key, defaultAvatarOf(key)])),
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

// 2026-11-16 r204（P6）：插件的 /group/api/* 不在 dsh web 的鉴权链里。
// 写请求只接受"面板页面"发来的：必须带自定义头 x-llw-panel: 1
// （跨站表单设不了自定义头，浏览器会先预检而我们不回 CORS 头），
// 带 Origin 时还必须与本站同源。不满足就 403，并在 plugin.log 留一行（同一路径每分钟至多一行）。
// 边界：这只防浏览器里的跨站请求；本机其它进程同一账户本来就同权限，文档里写明了，不假装防得住。
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const securityRejectAt = new Map()

function sameOriginOf(req) {
  const origin = req.headers?.origin
  if (!origin) return true
  try {
    const parsed = new URL(String(origin))
    return parsed.host === String(req.headers?.host ?? '')
  } catch {
    return false
  }
}

function logSecurityReject(reason, path) {
  try {
    const line = JSON.stringify({ at: new Date().toISOString(), note: 'security-reject', reason, path }) + '\n'
    appendFileSync(join(GROUP_DIR, 'plugin.log'), line, 'utf8')
  } catch {
    // 留痕失败不该让 403 失效。
  }
}

function guardWrite(req, res, path) {
  if (!WRITE_METHODS.has(String(req.method ?? '').toUpperCase())) return true
  const panel = String(req.headers?.['x-llw-panel'] ?? '') === '1'
  if (panel && sameOriginOf(req)) return true
  const now = Date.now()
  if (now - (securityRejectAt.get(path) ?? 0) > 60_000) {
    securityRejectAt.set(path, now)
    logSecurityReject(panel ? 'origin' : 'panel-header', path)
  }
  sendJson(res, 403, { error: 'forbidden', detail: '写请求只接受面板页面发来的（需要 x-llw-panel: 1 且同源）' })
  return false
}

/**
 * r207（宿主 2026-11-16）：最小安装（只把两个 bundle add 进 profile）不该被当成正常鱼塘。
 * 判据只看名册：没有 members.json、或者名册里一条鱼都没有 ⇒ 未完整安装。
 * 面板据此显示安装指引；写接口直接 409，不再往一个不存在的鱼塘里写消息。
 */
function installStateOf() {
  const file = config().membersFile
  if (!file || !existsSync(file)) {
    return {
      ok: false,
      missing: ['名册（pool\\members.json）'],
      hint: '只装了插件、还没跑安装脚本。先定鱼塘根，再运行：pwsh -File scripts\\install.ps1 -PondRoot <鱼塘根>',
    }
  }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const fish = Object.values(raw?.members ?? {}).filter((m) => m && m.kind === 'fish')
    if (fish.length === 0) {
      return { ok: false, missing: ['一条鱼'], hint: '名册在，但里面还没有鱼：先按安装脚本出生一条，或跑 fish.ps1 new。' }
    }
  } catch (error) {
    return { ok: false, missing: ['可读的名册'], hint: '名册读不出来：' + String(error?.message ?? error) }
  }
  return { ok: true }
}

function readConfig() {
  const names = {}
  const avatars = {}
  let raw = null
  if (existsSync(UI_CONFIG)) {
    try {
      raw = JSON.parse(readFileSync(UI_CONFIG, 'utf8'))
    } catch {
      raw = null
    }
  }
  // 成员列表跟着名册走：名册里多一条鱼，这里就多一个名字/头像的位置。
  //
  // 2026-11-13 18:5x 修：显示名的真源是 `pool\members.json` 的 `name`，不是
  // `ui-config.json` 的 `names`。以前这里是 `normalizeName(raw?.names?.[key], LABEL[key])`，
  // 于是名册改了名、面板还念旧名字（现场：名册 lee=大肥鱼，面板 lee=Leea，两个真源漂了
  // 一天多也没人报错）。现在这里只读名册；改名不在这里（A.82：名字只能由她自己改）。
  for (const key of Object.keys(MEMBERS)) {
    names[key] = LABEL[key] ?? key
    avatars[key] = normalizeAvatar(raw?.avatars?.[key], defaultAvatarOf(key))
  }
  return {
    /** 人类成员的 id（气泡左右判断、@ 面板过滤都用它；不再让客户端猜 fabian）。 */
    humanId: HUMAN_ID,
    panelLabel: typeof raw?.panelLabel === 'string' && raw.panelLabel.trim() ? raw.panelLabel.trim() : DEFAULT_CONFIG.panelLabel,
    notifyScope: raw?.notifyScope === 'mentions' ? 'mentions' : 'all',
    names,
    seats: normalizeSeats(raw?.seats),
    avatars,
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
    // 空字符串是合法值（2026-11-14：他要把输入框清空；以前 `text || fallback.text`
    // 会把刚删掉的字又填回去，看起来像"删不掉"）。空着时前端退回名字首字显示。
    text,
    tint: tint || fallback.tint,
    image,
    version: image ? version : 0,
  }
}

function writeConfig(config) {
  writeFileSync(UI_CONFIG, JSON.stringify(config, null, 2) + '\n', 'utf8')
  return config
}

/**
 * 改一条鱼的显示名：写 `pool\members.json`（真源），再同步内存里的 LABEL/MEMBERS。
 *
 * 为什么不在 ui-config.json 里存名字：那会让"她叫什么"有两个真源。名册是数据、
 * 面板是显示层——显示层可以缓存，但不能自己记一个名字。
 */

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
    if (message.from === HUMAN_ID) return false
    if (String(message.ts ?? '') <= since) return false
    if (scope === 'mentions' && message.to !== 'all' && message.to !== HUMAN_ID) return false
    return true
  }).length
}

function lastTsOf(file) {
  const messages = readMessages(file)
  return messages.length ? String(messages[messages.length - 1].ts ?? '') : ''
}

function readMessages(file = MESSAGES) {
  if (!existsSync(file)) return []
  // 投影与行号在 lib/messages-core.js：行号是物理行号（空行/半截行也算），
  // 它是面板上 #1763 这个引用地址的来源（r328）。
  return parseMessageLines(readFileSync(file, 'utf8'))
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

// ---------- 鱼塘：从网页里开关鱼（2026-11-12 晚） ----------
//
// 为什么要它：鱼一多，`fish.ps1 up/down` 就得记名字、记端口、记谁先谁后。
// 这里把"谁醒着、谁没开、怎么开"放进面板，端口状态每 4 秒自己刷一次。
//
// 三条边界（都是有理由的，不是省事）：
//   1. 巡守那条（`role: watcher`，就是你现在看的这个 3080）**不能从这里开关**：
//      关掉它等于把正在看的这扇窗自己拔了，页面会先白屏、再没人应答。
//   2. 动作全部走 `scripts\fish.ps1`，不在这里重写一遍起停逻辑 ——
//      两处实现迟早会分叉（今天刚因为"投影有两个写者"踩过一次）。
//   3. 端口状态用 TCP 连一下判断，不看 `Get-NetTCPConnection` ——
//      本机沙箱里它会安静地返回空，看着像"全都没开"。
const POND_SCRIPTS = join(config().repoRoot, 'scripts')
const FISH_PS1 = join(POND_SCRIPTS, 'fish.ps1')
const DOCTOR_PS1 = join(POND_SCRIPTS, 'doctor.ps1')
const RUNS_DIR = join(POOL_STATE, 'runs')
const MODE_DIR = join(POOL_STATE, 'mode')
const POND_TCP_TIMEOUT_MS = 700
const POND_ACTION_TIMEOUT_MS = 150_000

function pondMembers() {
  const file = config().membersFile
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    if (raw?.members && typeof raw.members === 'object' && Object.keys(raw.members).length) return raw.members
  } catch {
    // 读不到就走内置三条（没有端口字段，页面会显示"没有端口"，不会假装能开）
  }
  return Object.fromEntries(
    Object.entries(MEMBERS).map(([key, m]) => [key, { name: m.name, kind: m.kind, role: m.kind === 'human' ? 'human' : 'member' }]),
  )
}

/**
 * 这条鱼是怎么起的（fish.ps1 写的模式账，PRD A.47）：
 *   unattended = 无窗起、会话由 host 自己挂上；window = 开着浏览器窗；null = 不知道（旧进程或别人起的）。
 */
function modeOf(key) {
  const file = join(MODE_DIR, `${key}.json`)
  if (!existsSync(file)) return null
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const mode = typeof raw?.mode === 'string' ? raw.mode : null
    return { mode, at: typeof raw?.at === 'string' ? raw.at : null, port: Number(raw?.port) || null }
  } catch {
    return null
  }
}

/**
 * 这条鱼此刻在不在睡（PRD A.73）。数据只有一份：巡守每 60 秒写 `pool\state\sleep-status.json`。
 * 面板不自己算窗口（跨午夜、一次性睡眠、家长叫醒的优先级只有 sleep-core.js 一份实现）。
 */
function sleepOf(key) {
  const file = join(POOL_STATE, 'sleep-status.json')
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const entry = raw?.members?.[key]
    if (!entry) return null
    const updatedAt = typeof raw?.updatedAt === 'string' ? raw.updatedAt : null
    const ageMs = updatedAt ? Date.now() - Date.parse(updatedAt) : null
    return {
      sleeping: entry.sleeping === true,
      source: typeof entry.source === 'string' ? entry.source : 'unknown',
      untilAt: typeof entry.untilAt === 'string' ? entry.untilAt : null,
      label: typeof entry.label === 'string' ? entry.label : '',
      lastForced: entry.lastForced && typeof entry.lastForced === 'object' && typeof entry.lastForced.at === 'string'
        ? {
          at: entry.lastForced.at,
          by: typeof entry.lastForced.by === 'string' ? entry.lastForced.by : '',
          reason: typeof entry.lastForced.reason === 'string' ? entry.lastForced.reason : '',
        }
        : null,
      ageMs,
    }
  } catch {
    return null
  }
}

/** 端口开没开：连得上就是开着。连不上不代表"进程死了"，只代表这扇门没开。 */
function tcpOpen(port, timeoutMs = POND_TCP_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const portNumber = Number(port)
    if (!Number.isInteger(portNumber) || portNumber <= 0) {
      resolve(false)
      return
    }
    const socket = new Socket()
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    try {
      socket.connect(portNumber, '127.0.0.1')
    } catch {
      finish(false)
    }
  })
}

function pidAlive(pid) {
  const number = Number(pid)
  if (!Number.isInteger(number) || number <= 0) return false
  try {
    process.kill(number, 0)
    return true
  } catch (error) {
    // EPERM = 进程在，只是不归我们管；ESRCH = 真没了。
    return error?.code === 'EPERM'
  }
}

/** 每个进程自己的起停账：`pool\state\runs\<鱼>.log` 的最后一行。 */
function lastRunOf(key) {
  const file = join(RUNS_DIR, `${key}.log`)
  if (!existsSync(file)) return null
  try {
    const lines = readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean)
    const line = lines[lines.length - 1]
    if (!line) return null
    const parts = line.split('|').map((part) => part.trim())
    const pidMatch = /pid=(\d+)/.exec(line)
    return { ts: parts[0] ?? '', event: parts[1] ?? '', pid: pidMatch ? Number(pidMatch[1]) : null, raw: line }
  } catch {
    return null
  }
}

function presenceOf(key) {
  const file = join(PRESENCE_DIR, `${key}.json`)
  if (!existsSync(file)) return null
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const at = Number(raw?.at)
    return {
      status: typeof raw?.status === 'string' ? raw.status : 'unknown',
      at: Number.isFinite(at) ? at : null,
      ageMs: Number.isFinite(at) ? Date.now() - at : null,
    }
  } catch {
    return null
  }
}

/**
 * 鱼的页面地址。token 只印在启动日志里（不是配置），所以每次现读日志尾巴 ——
 * 这也是 `fish.ps1` 的做法，两边保持同一条路。
 */
function pondUrlOf(member) {
  const port = Number(member?.port)
  if (!Number.isInteger(port) || port <= 0) return null
  let token = ''
  const logFile = member?.dshHome ? join(member.dshHome, 'logs', 'web-latest.log') : ''
  if (logFile && existsSync(logFile)) {
    try {
      const text = readFileSync(logFile, 'utf8')
      const matches = [...text.matchAll(/[?&]token=([A-Za-z0-9._~-]+)/g)]
      if (matches.length) token = matches[matches.length - 1][1]
    } catch {
      // 没有 token 就只给地址：页面会要求重新登录，这比编一个假 token 好
    }
  }
  return `http://127.0.0.1:${port}/${token ? `?token=${token}` : ''}`
}

/** 世代：顺着 parent 往上数（根 = 0）。parent 断了就按 0 算 —— 一条坏数据不该把整张表卡住。 */
function generationOf(key, members, seen = new Set()) {
  if (seen.has(key)) return 0
  seen.add(key)
  const parent = members?.[key]?.parent
  if (!parent || !members[parent]) return 0
  return 1 + generationOf(parent, members, seen)
}

/** 出生顺序：bornAt 是日期字符串；没有 bornAt 的排同代最后，再按键。 */
function bornOrder(a, b) {
  const ta = Date.parse(a ?? '')
  const tb = Date.parse(b ?? '')
  const hasA = Number.isFinite(ta)
  const hasB = Number.isFinite(tb)
  if (hasA && hasB) return ta === tb ? 0 : ta - tb
  if (hasA) return -1
  if (hasB) return 1
  return 0
}

// 自启动开关（2026-11-12 23:55 他要的）：存 pool\state\settings.json。
// 宿主插件启动时读它；这里只负责读写，不负责启动。
const POND_SETTINGS_FILE = join(POOL_STATE, 'settings.json')

function readPondSettings() {
  try {
    const json = JSON.parse(readFileSync(POND_SETTINGS_FILE, 'utf8'))
    return { autoStartFish: json?.autoStartFish === true }
  } catch {
    return { autoStartFish: false }
  }
}

function writePondSettings(payload) {
  // 读-改-写：这个文件不只存自启动开关（宿主读 crashNotify，见 PRD A.52）。
  // 2026-11-13 18:5x 修：以前整份重建 {version,autoStartFish,updatedAt}，
  // 点一下开关就把 crashNotify 抹掉，报警复发而且不报错。
  let prev = {}
  try {
    prev = JSON.parse(readFileSync(POND_SETTINGS_FILE, 'utf8')) ?? {}
  } catch {
    prev = {}
  }
  const settings = {
    ...prev,
    version: 1,
    autoStartFish: payload?.autoStartFish === true,
    updatedAt: new Date().toISOString(),
  }
  mkdirSync(POOL_STATE, { recursive: true })
  const tmp = `${POND_SETTINGS_FILE}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf8')
  renameSync(tmp, POND_SETTINGS_FILE)
  return { autoStartFish: settings.autoStartFish }
}

async function pondStatus() {
  const members = pondMembers()
  const fish = []
  for (const [key, member] of Object.entries(members)) {
    if (member?.kind !== 'fish') continue
    const port = Number(member?.port)
    const [portOpen] = await Promise.all([tcpOpen(port)])
    const run = lastRunOf(key)
    const presence = presenceOf(key)
    fish.push({
      key,
      name: typeof member?.name === 'string' ? member.name : key,
      role: member?.role === 'watcher' ? 'watcher' : 'member',
      lifecycle: member?.lifecycle ?? (member?.status === 'archived' ? 'archived' : 'active'),
      parent: member?.parent ?? null,
      generation: generationOf(key, members),
      bornAt: typeof member?.bornAt === 'string' ? member.bornAt : null,
      port: Number.isInteger(port) && port > 0 ? port : null,
      portOpen,
      pid: run?.pid ?? null,
      pidAlive: run?.pid ? pidAlive(run.pid) : false,
      lastRun: run,
      heartbeat: presence,
      heartbeatAgeMs: presence?.ageMs ?? null,
      mode: modeOf(key),
      sleep: sleepOf(key),
      canManage: member?.role !== 'watcher',
      url: portOpen ? pondUrlOf(member) : null,
    })
  }
  // 排序 = 家谱顺序（2026-11-12 他要的）：世代浅的在前；同代按出生日期，早的在前；
  // 没有出生日期的排同代最后；最后才按键（保证同一份数据两次排序结果一样）。
  fish.sort((a, b) => {
    if (a.generation !== b.generation) return a.generation - b.generation
    const byBirth = bornOrder(a.bornAt, b.bornAt)
    if (byBirth !== 0) return byBirth
    return String(a.key).localeCompare(String(b.key))
  })
  return { fish, summary: { total: fish.length, running: fish.filter((item) => item.portOpen).length } }
}

/** 跑一个 PowerShell 脚本，把输出原样带回去（页面显示最近一次动作的结果）。 */
function runPwshScript(scriptFile, args, timeoutMs = POND_ACTION_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const exe = config().pwshExe || 'pwsh'
    const startedAt = Date.now()
    let out = ''
    let err = ''
    let settled = false
    const finish = (code, timedOut) => {
      if (settled) return
      settled = true
      resolve({
        code,
        timedOut,
        seconds: Math.round((Date.now() - startedAt) / 100) / 10,
        output: `${out}${err ? `\n${err}` : ''}`.trim().slice(-6000),
      })
    }
    let child
    try {
      // PowerShell 7 在 stdout 被重定向时会按控制台代码页（本机 936）写字节，
      // 页面拿到的是 GBK 乱码（他 2026-11-12 22:53 报的）。
      // 先把输出编码钉成 UTF-8 再跑脚本 —— 这样脚本里每一句 Write-Host 都是对的。
      // 开关（-Yes / -NoBrowser）必须原样传：包成 '-Yes' 就成了字符串位置参数，
      // PowerShell 会报"找不到接受自变量 '-Yes' 的位置参数"（他 2026-11-13 11:52 报的）。
      const quoted = (value) => (/^-[A-Za-z]/.test(String(value)) ? String(value) : "'" + String(value).replace(/'/g, "''") + "'")
      const command = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; & " + quoted(scriptFile) + " " + args.map(quoted).join(' ')
      child = spawn(exe, ['-NoLogo', '-NoProfile', '-Command', command], {
        cwd: config().repoRoot,
        windowsHide: true,
      })
    } catch (error) {
      finish(-1, false)
      return
    }
    child.stdout?.on('data', (chunk) => {
      out += chunk.toString()
    })
    child.stderr?.on('data', (chunk) => {
      err += chunk.toString()
    })
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // 杀不掉也照样返回：页面会显示 timedOut，别卡住整条路由
      }
      finish(-1, true)
    }, timeoutMs)
    child.once('error', () => {
      clearTimeout(timer)
      finish(-1, false)
    })
    // 父进程（pwsh）退出了就先返回：它启动的 dsh 会继承 stdout 管道，
    // 'close' 可能要等到那条鱼也退出才来（他 2026-11-13 12:09 报的"按钮一直 …"）。
    let exitTimer = null
    child.once('exit', (code) => {
      exitTimer = setTimeout(() => {
        clearTimeout(timer)
        finish(code ?? -1, false)
      }, 400)
    })
    child.once('close', (code) => {
      if (exitTimer) clearTimeout(exitTimer)
      clearTimeout(timer)
      finish(code ?? -1, false)
    })
  })
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
      if (!guardWrite(req, res, '/group/api/config')) return
      if (req.method === 'GET') {
        sendJson(res, 200, { ...readConfig(), installState: installStateOf() })
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
        names: {},
        seats: normalizeSeats(payload?.seats),
        avatars: {},
      }
      // 同样跟着名册走：只认名册里有的成员，多传的键丢掉（免得 ui-config 里
      // 攒出一堆已经不在群里的名字）。
      for (const key of Object.keys(MEMBERS)) {
        next.names[key] = normalizeName(payload?.names?.[key], LABEL[key] ?? key)
        next.avatars[key] = normalizeAvatar(payload?.avatars?.[key], defaultAvatarOf(key))
        // 名字不是设置页能改的（2026-11-14 他定的规矩，A.82）：名字是称呼，属于她；
        // 只有她自己在会话里调 rename 才能改，设置页只改头像。这里拒绝，不留后门。
        if (next.names[key] !== (LABEL[key] ?? key)) {
          sendJson(res, 403, {
            error: 'rename-by-fish-only',
            member: key,
            hint: '名字只能由她自己改：在会话里让她调 rename。设置页只改头像。',
          })
          return
        }
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

  // 版本：当前版本随时能看；「检查更新」才去问 npm。
  // 网络不通要说清楚，不能装成"已是最新"——那和真的检查过长得一样（§60）。
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/group/api/version',
    handler(req, res) {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      sendJson(res, 200, versionState())
    },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/group/api/check-update',
    async handler(req, res) {
      if (!guardWrite(req, res, '/group/api/check-update')) return
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      const base = versionState()
      const result = { checkedAt: new Date().toISOString(), host: { ...base.host }, ui: { ...base.ui } }
      for (const side of ['host', 'ui']) {
        try {
          const latest = await latestOnNpm(result[side].name)
          result[side].latest = latest
          result[side].updateAvailable = newerThan(latest, result[side].current)
        } catch (error) {
          result[side].error = String(error?.message ?? error)
        }
      }
      sendJson(res, 200, result)
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
      if (!guardWrite(req, res, '/group/api/avatar')) return
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
              // 2026-11-13：分三档。原来只有 groupWakeAt，私聊唤醒没留痕，
              // 于是"在回私聊"被一律显示成「正在忙」（他报的 bug）。
              const wakeAt = Number(beat?.wakeAt) || 0
              const kind = String(beat?.wakeKind ?? '')
              const fresh = wakeAt > 0 && Date.now() - wakeAt <= GROUP_WAKE_TTL_MS
              // 兼容旧心跳：只有 groupWakeAt 的那些进程。
              const legacyAt = Number(beat?.groupWakeAt) || 0
              const legacyFresh = legacyAt > 0 && Date.now() - legacyAt <= GROUP_WAKE_TTL_MS
              members[member] = {
                status: beat?.status === 'idle' ? 'idle' : 'working',
                reason: fresh ? (kind === 'dm' ? 'dm' : 'group') : (legacyFresh ? 'group' : 'self'),
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
      if (!guardWrite(req, res, '/group/api/image')) return
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method === 'GET') {
        // path / algo 由记录带过来（面板的 img 请求会把它们拼在 URL 上）：读取端优先认记录自己的说法，
        // 认不出才回落到按 month 扫目录。认不出时必须留痕——静默读不到等于"什么都没发生"。
        const found = imagePathOf(
          url.searchParams.get('id'),
          url.searchParams.get('ext'),
          url.searchParams.get('path'),
          url.searchParams.get('algo'),
        )
        // 兜底救回来的也要留痕：记录里的 path 坏了、靠扫目录找着，说明这条记录写错了。
        // 图我照给（可用性优先），但"救过"这件事必须能查到——否则坏记录的坏法就是"什么都没发生"。
        if (found.why !== null) {
          logImageIssue(found.why, {
            phase: 'read',
            served: found.file !== null,
            id: url.searchParams.get('id'),
            ext: url.searchParams.get('ext'),
            path: url.searchParams.get('path'),
            algo: url.searchParams.get('algo'),
          })
        }
        if (found.file === null) {
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
      if (!guardWrite(req, res, '/group/api/send')) return
      const installState = installStateOf()
      if (!installState.ok) {
        sendJson(res, 409, { error: 'need-install', missing: installState.missing, hint: installState.hint })
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
      const to = payload?.to
      // 图片（可选，最多 4 张）：[{ id, ext, bytes, month, path }]，由 /group/api/image 先上传拿到。
      // 2026-11-15：面板支持多图；记录里 1 张仍写 image、多张写 images（老读者不受影响）。
      let images = []
      try {
        images = imageFieldsOf(payload?.images ?? payload?.image)
      } catch (error) {
        sendJson(res, 400, { error: 'unknown-image', detail: String(error?.message ?? error) })
        return
      }
      if (!text && images.length === 0) {
        sendJson(res, 400, { error: 'empty-message', detail: '至少要有文字或一张图片' })
        return
      }
      // 收信人从名册校验，不再写死三条 —— 2026-11-12 19:59 现场：fishball 被这里挡住，
      // 面板回 bad-target，看着像"她不在群里"，其实是名单又抄了一份（A.32 同一个病）。
      if (to !== 'all' && !Object.prototype.hasOwnProperty.call(MEMBERS, to)) {
        sendJson(res, 400, { error: 'bad-target' })
        return
      }
      const now = new Date()
      // toSeat（可选）：指名这个人的哪一段会话收（6 位十六进制）。不填 = 叫这个人，谁空谁应。
      const rawSeat = typeof payload?.toSeat === 'string' ? payload.toSeat.trim() : ''
      const toSeat = /^[0-9a-f]{6}$/.test(rawSeat) ? rawSeat : ''
      // s = 谁发的：'ui' 表示从面板发的（他没有会话 id）。跟 group_say 写的 s=<会话前6位> 是同一个字段。
      const record = {
        // 2026-11-16：s 只放会话号前 6 位；面板发的话没有"那段会话"，所以不写这个字段
    // （旧记录里的 s=ui/watch 是历史遗留，纸上已写分界）。
    ts: now.toISOString(), from: HUMAN_ID, to, text, kind: 'say',
        ...(toSeat === '' ? {} : { toSeat }),
        ...(images.length === 0 ? {} : (images.length === 1 ? { image: images[0] } : { images })),
      }
      try {
        // 宿主 say() 会先 ensureDir；面板这条路以前没建目录，group 被清掉后第一条消息 500。
        mkdirSync(GROUP_DIR, { recursive: true })
        appendFileSync(MESSAGES, JSON.stringify(record) + '\n', 'utf8')
        // 投影格式必须和宿主 say() 逐字一致（2026-11-12 19:46 起：指名时写「时间 · 谁 → 收信人」）。
        // 收信人写在投影里，是为了让"读记录"的人知道这条是在对谁说话——不写，指名和公开在纸上一样。
        const body = readableBodyWithImages(text, images)
        const toLabel = to !== '' && to !== 'all' ? ` → ${LABEL[to] ?? to}` : ''
        appendFileSync(READABLE, `**${stamp(now)} · ${LABEL[HUMAN_ID] ?? HUMAN_ID}${toLabel}**\n\n${body}\n\n`, 'utf8')
      } catch (error) {
        sendJson(res, 500, { error: 'write-failed', detail: String(error?.message ?? error) })
        return
      }
      sendJson(res, 200, { ok: true, record })
    },
  }))

  // ---------- 私聊：一个人和一条鱼的那段对话 ----------
  // 这个窗口里说话的人固定是 Fabian，收信的人是 peer；两个方向都写进同一个文件。
  // 不认识就返回 null，由调用方回 400。
  // 2026-11-13 18:5x 修：以前静默回退 KNOWN_PEERS[0]，peer 拼错就把话写进第一条鱼的私聊，
  // 未读也标错人，全程 200。这是"错的东西长得很安静"那一族。
  const dmPeerOf = (value) => {
    const peer = typeof value === 'string' ? value.trim() : ''
    return peer && KNOWN_PEERS.includes(peer) ? peer : null
  }

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/group/api/dm',
    async handler(req, res) {
      if (!guardWrite(req, res, '/group/api/dm')) return
      const installState = installStateOf()
      if (!installState.ok) {
        sendJson(res, 409, { error: 'need-install', missing: installState.missing, hint: installState.hint })
        return
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (req.method === 'GET') {
        const peer = dmPeerOf(url.searchParams.get('peer'))
        if (peer === null) {
          sendJson(res, 400, { error: 'bad-peer' })
          return
        }
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
      // 私聊一样能带图（最多 4 张）：字节和群聊共用 images\ 目录（同一张图两边只存一份）。
      let images = []
      try {
        images = imageFieldsOf(payload?.images ?? payload?.image)
      } catch (error) {
        sendJson(res, 400, { error: 'unknown-image', detail: String(error?.message ?? error) })
        return
      }
      if (!text && images.length === 0) {
        sendJson(res, 400, { error: 'empty-message', detail: '至少要有文字或一张图片' })
        return
      }
      const peer = dmPeerOf(payload?.peer)
      if (peer === null) {
        sendJson(res, 400, { error: 'bad-peer' })
        return
      }
      const now = new Date()
      const record = {
        ts: now.toISOString(), from: HUMAN_ID, to: peer, text, kind: 'dm', channel: 'dm',
        ...(images.length === 0 ? {} : (images.length === 1 ? { image: images[0] } : { images })),
      }
      try {
        mkdirSync(DM_DIR, { recursive: true })
        appendFileSync(dmFileOf(peer), JSON.stringify(record) + '\n', 'utf8')
        // 私聊也要有一份人眼能读的投影（宿主 sayPrivate 一直写，面板这条路漏了）。
        // 判据：rebuild-group-md.mjs 对每个 dm\*.jsonl 都应 0 差异。
        const readable = dmReadableOf(peer)
        if (!existsSync(readable)) {
          const [x, y] = [HUMAN_ID, peer].sort()
          appendFileSync(readable, `# 私聊 · ${LABEL[x] ?? x} / ${LABEL[y] ?? y}\n\n`, 'utf8')
        }
        const dmBody = readableBodyWithImages(text, images)
        appendFileSync(readable, `**${stamp(now)} · ${LABEL[HUMAN_ID] ?? HUMAN_ID}**\n\n${dmBody}\n\n`, 'utf8')
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
      if (!guardWrite(req, res, '/group/api/read')) return
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
        if (peer === null) {
          sendJson(res, 400, { error: 'bad-peer' })
          return
        }
        state.dm[peer] = lastTsOf(dmFileOf(peer))
      } else {
        sendJson(res, 400, { error: 'bad-channel' })
        return
      }
      writeUiRead(state)
      sendJson(res, 200, { ok: true, state })
    },
  }))

  // ---------- 鱼塘路由：状态 / 打开 / 开关 ----------
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/pond/api/status',
    async handler(req, res) {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      try {
        const status = await pondStatus()
        sendJson(res, 200, { ok: true, ...status, polledAt: new Date().toISOString() })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: 'status-failed', detail: String(error?.message ?? error) })
      }
    },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/pond/api/settings',
    async handler(req, res) {
      if (!guardWrite(req, res, '/pond/api/settings')) return
      if (req.method === 'GET') {
        sendJson(res, 200, { ok: true, settings: readPondSettings() })
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
      try {
        sendJson(res, 200, { ok: true, settings: writePondSettings(payload) })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: 'settings-failed', detail: String(error?.message ?? error) })
      }
    },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/pond/api/url',
    async handler(req, res) {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const key = url.searchParams.get('key') ?? ''
      const member = pondMembers()[key]
      if (!member || member.kind !== 'fish') {
        sendJson(res, 400, { error: 'unknown-fish', key })
        return
      }
      const target = pondUrlOf(member)
      if (!target) {
        sendJson(res, 400, { error: 'no-port', key })
        return
      }
      sendJson(res, 200, { ok: true, url: target })
    },
  }))

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/pond/api/action',
    async handler(req, res) {
      if (!guardWrite(req, res, '/pond/api/action')) return
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
      const action = String(payload?.action ?? '')
      const key = String(payload?.key ?? '')
      const members = pondMembers()
      const fishKeys = Object.keys(members).filter(
        (id) => members[id]?.kind === 'fish' && members[id]?.role !== 'watcher',
      )

      const runOne = async (target, act) => {
        if (act === 'up') return runPwshScript(FISH_PS1, ['up', target, '-NoBrowser'])
        if (act === 'down') return runPwshScript(FISH_PS1, ['down', target, '-Yes'])
        if (act === 'maintain') {
          // 检修（2026-11-13 他定的语义）：先休眠，再开一扇窗让人看。
          // 为什么必须"先休眠"：一段会话只能一个 writer，无人值守挂着 agent 时再起第二个会被拒（A.47）。
          // 开窗动作在 fish.ps1 里（浏览器由它打开），这里只把输出贴回页面。
          return runPwshScript(FISH_PS1, ['maintain', target])
        }
        if (act === 'restore') {
          // 回无人值守：关掉窗那份，无窗起，会话由 host 自己挂上（A.45）。
          return runPwshScript(FISH_PS1, ['restore', target])
        }
        if (act === 'wake') {
          // 家长强行叫醒（A.73）：她可以自己睡，但上级有权利把她叫醒。
          // 窗口/跨午夜判断在 sleep-core.js 一份实现里，这里只转给 fish.ps1。
          // -By/-Why：面板上按的，账本要能回答"谁按的、为什么"（小肥鱼 2026-11-15 提的第三处）。
          return runPwshScript(FISH_PS1, ['wake', target, '-By', 'fabian', '-Why', '面板「叫醒」'])
        }
        return { code: -1, timedOut: false, seconds: 0, output: `unknown-action ${act}` }
      }

      if (action === 'up-all' || action === 'down-all') {
        const act = action === 'up-all' ? 'up' : 'down'
        const parts = []
        let code = 0
        let seconds = 0
        for (const target of fishKeys) {
          const result = await runOne(target, act)
          seconds += result.seconds
          if (result.code !== 0) code = result.code
          parts.push(`[${members[target]?.name ?? target}]\n${result.output}`)
        }
        sendJson(res, 200, {
          ok: code === 0,
          action,
          code,
          seconds: Math.round(seconds * 10) / 10,
          output: parts.join('\n\n').slice(-6000),
        })
        return
      }

      if (!['up', 'down', 'maintain', 'restore', 'wake'].includes(action)) {
        sendJson(res, 400, { error: 'unknown-action', action })
        return
      }
      if (!key || !members[key] || members[key].kind !== 'fish') {
        sendJson(res, 400, { error: 'unknown-fish', key })
        return
      }
      if (members[key].role === 'watcher') {
        sendJson(res, 400, { error: 'self', hint: '巡守那条就是你现在看的这个窗口，不能从这里关' })
        return
      }
      const result = await runOne(key, action)
      sendJson(res, 200, { ok: result.code === 0, action, key, ...result })
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
