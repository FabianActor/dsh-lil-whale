// 日志表头（log-format）的写法：只在"格式真的变了"的时候写一次。
//
// 2026-11-18 r294。起因是小满 #1741 的核对：她那本 `watchman.log` 里
// `log-format` 有 25 行，`since` 25 个各不相同，`fmt` / `changed` / `fields`
// 25 行一模一样，每行配一个不同 `pid`——这行其实是在每次启动时写的。
//
// 后果：`since` 的用途是"从这一刻起这个格式生效"，可同一个格式有 25 个 `since`，
// 读者拿任何一个去划"字段出生线"都会划错。更糟的是它长得像表头、实际是心跳：
// 表头说"我从 X 起生效"，心跳说"我现在还活着"，这两句话不该用同一行承载。
//
// 判据（小满）：「一个字段名承诺的是『某个区间』，写法却每行都重置它，那么读它的人
// 得到的是『最后一次重置的时刻』」。
//
// 2026-11-18 r296，两条补丁（第二条鱼 #1746、第四条鱼 #1745）：
//   1. 指纹改成"按 key 解析后比"，不再在整条 detail 上做字符串搜索——
//      否则任何值里出现字面量 `fields=` / `fmt=` 都会把指纹切错。
//   2. key 的顺序不再是签名的一部分：比较的是"每个 key 的值"，不是拼好的字符串。
//      （小鱼丸："签名的相等是按字符串比的，顺序不同就算变了"——重排常量会让每次启动多一行。）

// 2026-11-19 fi-0001（小满，群第 2260 行）：`changed=` 声明的是"格式变过的事件"，
// 不是"这本账里所有 kind"——于是 `error`（1129 行）从来没被任何声明覆盖，声明和检查器
// 两格都看不见它。声明写漏是常态，所以补两件事：
//   1. `kinds=` 把代码会写的 kind 列成完整清单（这张表就是声明；加一个 kind 必须改它）；
//   2. `auditKinds()` 拿账上出现过的 kind 跟它对，报"未声明的 kind 有几行"。
// 判据（小满）：「声明描述它想管的 kind，检查器该报它不管的 kind 有几行」。
export const LOG_KINDS = ['deliver', 'error', 'log-format', 'note', 'resumed', 'skip', 'started', 'stopped', 'wake', 'wake-caps', 'wake-skip', 'wake-try', 'woke']

export const LOG_FORMAT_SIG = `fmt=3 changed=skip,wake-skip,deliver fields=deny,note,reason field-since=codeFp:r255,member:r292,note:r293 kinds=${LOG_KINDS.join(',')}`

const MARK = ' | log-format | '
// 参与指纹的 key（顺序固定输出，但比较时按 key 取值——顺序不进指纹）。
const KEYS = ['fmt', 'changed', 'fields', 'field-since', 'kinds']
export const LOG_FORMAT_KEYS = KEYS

// 从 detail 里按 ` (^|空格)key=值` 取每个 key 的值。
// 值里夹着别的 key 的字面量不会影响：这里只认"空白之后"的 key。
function parseDetail(detail) {
  const map = {}
  const re = /(?:^|\s)(fmt|changed|fields|field-since|kinds)=(\S*)/g
  let m = re.exec(detail)
  while (m) {
    map[m[1]] = m[2]
    m = re.exec(detail)
  }
  return map
}

// 稳定指纹：只含"格式"那几项，按 key 取值拼成 JSON（顺序与写法无关）。
//
// 2026-11-18 r297，第三条补丁（第二条鱼 #1751）：键的顺序已经不影响了，但值里的
// **逗号列表**（`changed=` / `fields=` / `field-since=`）还在按字符串逐字比——
// 把 `fields=note,deny,reason` 重排成 `deny,note,reason` 会被判成"格式变了"。
// 列表内部的顺序对读者没有意义（它们都是集合），所以比较前先拆开、排序、拼回。
function listCanonical(value) {
  if (typeof value !== 'string' || !value.includes(',')) return value
  return value.split(',').map((part) => part.trim()).filter(Boolean).sort().join(',')
}

const LIST_KEYS = new Set(['changed', 'fields', 'field-since', 'kinds'])

function canonicalOf(map) {
  const out = {}
  for (const key of KEYS) out[key] = LIST_KEYS.has(key) ? listCanonical(map[key] ?? null) : (map[key] ?? null)
  return JSON.stringify(out)
}

function detailOf(line) {
  const text = String(line || '')
  const at = text.indexOf(MARK)
  if (at < 0) return ''
  return text.slice(at + MARK.length)
}

// 从一整行日志里取出"格式指纹"（不含 since / pid / to 这些每次都可能不同的部分）。
// 不是 log-format 行返回 ''。
export function signatureOfLine(line) {
  const detail = detailOf(line)
  if (!detail) return ''
  return canonicalOf(parseDetail(detail))
}

// 签名常量的规范化形式（与 signatureOfLine 的返回可直接比较）。
export function signatureOfConstant(signature = LOG_FORMAT_SIG) {
  return canonicalOf(parseDetail(String(signature || '')))
}

// 最后一行 log-format（找不到返回 ''）。旧行可能中间夹着别的日志，所以从尾往前找。
export function findLastLogFormatLine(lines) {
  const list = Array.isArray(lines) ? lines : []
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (String(list[i]).includes(MARK)) return String(list[i])
  }
  return ''
}

// 该不该写一行新的表头。
// lines：这本日志现有的行（顺序与文件一致）；signature：本次打算写的格式签名。
export function shouldWriteLogFormat({ lines, signature = LOG_FORMAT_SIG } = {}) {
  const prev = findLastLogFormatLine(lines)
  if (!prev) return { write: true, reason: '还没有表头' }
  const prevSig = signatureOfLine(prev)
  if (prevSig !== signatureOfConstant(signature)) return { write: true, reason: '格式变了' }
  return { write: false, reason: '同一格式已在纸上' }
}

// 拼 log-format 行的正文（不含时间与 ` | ` 分隔符）。
export function buildLogFormatDetail({ signature = LOG_FORMAT_SIG, since, pid, to = '' } = {}) {
  const at = since || new Date().toISOString()
  const who = to ? ` to=${to}` : ''
  return `${signature} since=${at} pid=${pid}${who}`
}

// 账上一行是 `<日期> <时间> | kind | 正文`。取出 kind；不是这个形状返回 ''。
// 2026-11-19 fi-0001：对账要知道"账上到底出现过哪些 kind"，不能只信声明。
export function kindOfLine(line) {
  const m = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \| ([A-Za-z0-9_-]+) \|/.exec(String(line || ''))
  return m ? m[1] : ''
}

// 从最后一行 log-format 取声明的 kind 清单；账上还没有带 kinds= 的表头时返回 null。
// null 与空数组是两件事：老账是"这版代码之前没有这项声明"，不是"声明了空清单"。
export function declaredKindsOf(lines) {
  const last = findLastLogFormatLine(lines)
  if (!last) return null
  const map = parseDetail(detailOf(last))
  if (typeof map.kinds !== 'string' || map.kinds === '') return null
  return map.kinds.split(',').map((part) => part.trim()).filter(Boolean)
}

// 对账：账上出现过的 kind 逐类计数，跟声明比。
//   declared：声明清单（null=老账，没有 kinds= 行）
//   seen： [{ kind, count }] 按 kind 排序
//   undeclared：账上有、声明里没有（这才是 fi-0001 要报的那一类）
//   missing：声明里有、账上还没出现（用来区分"声明了但没用过"）
export function auditKinds(lines, fallbackKinds = null) {
  const list = Array.isArray(lines) ? lines : []
  const seenMap = new Map()
  for (const row of list) {
    const kind = kindOfLine(row)
    if (!kind) continue
    seenMap.set(kind, (seenMap.get(kind) ?? 0) + 1)
  }
  const seen = [...seenMap.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0))
  const declared = declaredKindsOf(list) ?? (Array.isArray(fallbackKinds) ? fallbackKinds : null)
  if (declared === null) return { declared: null, seen, undeclared: [], missing: [] }
  const declaredSet = new Set(declared)
  return {
    declared,
    seen,
    undeclared: seen.filter((item) => !declaredSet.has(item.kind)),
    missing: [...declaredSet].filter((kind) => !seenMap.has(kind)).sort(),
  }
}
