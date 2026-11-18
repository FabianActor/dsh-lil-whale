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

export const LOG_FORMAT_SIG = 'fmt=3 changed=skip,wake-skip,deliver fields=deny,note,reason field-since=codeFp:r255,member:r292,note:r293'

const MARK = ' | log-format | '
// 参与指纹的 key（顺序固定输出，但比较时按 key 取值——顺序不进指纹）。
const KEYS = ['fmt', 'changed', 'fields', 'field-since']
export const LOG_FORMAT_KEYS = KEYS

// 从 detail 里按 ` (^|空格)key=值` 取每个 key 的值。
// 值里夹着别的 key 的字面量不会影响：这里只认"空白之后"的 key。
function parseDetail(detail) {
  const map = {}
  const re = /(?:^|\s)(fmt|changed|fields|field-since)=(\S*)/g
  let m = re.exec(detail)
  while (m) {
    map[m[1]] = m[2]
    m = re.exec(detail)
  }
  return map
}

// 稳定指纹：只含"格式"那几项，按 key 取值拼成 JSON（顺序与写法无关）。
function canonicalOf(map) {
  const out = {}
  for (const key of KEYS) out[key] = map[key] ?? null
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
