// mention —— 这条消息叫醒谁（2026-11-22，Fabian 拍板；r413 定稿）
//
// 起因：`to` 原来同时回答两个问题——"这话是给谁的"和"该叫醒谁"。
// 于是每一条 to=all 的群消息，都会把每一头醒着的鱼都拽起来。lee2 一天被叫醒二十几次，
// 其中没有一句是冲她说的；Fabian 定的分工是：
//
//   mention = 这句话叫醒谁（'all' | 成员 id 数组；空数组 = 谁都不叫醒）
//   @       = 面板上的多选入口，点谁就把谁写进 mention；正文里的 @ 名字不解析
//   to      = 只活在两处：私聊（这间屋只开给谁）与 2026-11-22 之前的老记录
//
// 默认值人和鱼同一套（Fabian 2026-11-22 修正）：
//   没写 mention 就是 [] —— 谁都不叫醒。要叫醒谁，就把谁写进 mention。
//
// 老记录没有 `mention` 字段，必须按老规则读（to=all 叫醒所有人、to=某人叫醒那个人）——
// 否则回扫历史时，会把当年真实发生过的叫醒判成"本来不该叫"，账就不认了。
// 判据：读旧记录要能复现当时的行为，不是复现今天的规则。

export const MENTION_ALL = 'all'

function keyListOf(input, memberKeys) {
  const list = Array.isArray(input) ? input : String(input).split(/[,，、\s]+/)
  const out = []
  for (const item of list) {
    const key = typeof item === 'string' ? item.trim() : ''
    if (key === '') continue
    if (!memberKeys.includes(key)) {
      throw new Error(`mention 里有不认识的成员：${key}（名册里是 ${memberKeys.join(' / ')}）`)
    }
    if (!out.includes(key)) out.push(key)
  }
  return out
}

/**
 * 把工具参数/面板传进来的 mention 归一成三种形状：
 *   undefined  没有写（群消息按 [] 处理；旧记录也是这个形状）
 *   'all'      叫醒所有人
 *   string[]   只叫醒名单里的人；[] = 谁都不叫醒
 */
export function normalizeMention(input, memberKeys) {
  if (input === undefined || input === null) return undefined
  if (Array.isArray(input)) return keyListOf(input, memberKeys)
  if (typeof input !== 'string') {
    throw new Error('mention 要是 all、成员 id 或成员 id 的列表')
  }
  const text = input.trim()
  if (text === '') return []
  if (text === MENTION_ALL) return MENTION_ALL
  return keyListOf(text, memberKeys)
}

/**
 * 这条记录会不会叫醒这个成员。
 * 认不出的 mention 形状不猜：不叫醒（宁可少叫一次，也不替它编个意思）。
 */
export function wantsWake(record, member) {
  const mention = record?.mention
  if (mention === MENTION_ALL) return true
  if (Array.isArray(mention)) return mention.includes(member)
  if (mention !== undefined && mention !== null) return false
  // 没有 mention 字段 = 2026-11-22 之前写的老记录，按老规则读
  return record?.to === MENTION_ALL || record?.to === member
}

/**
 * 回执/日志里用的一句话：这条叫醒谁。
 * `labelOf` 由调用方给（宿主那边是 labelOf，测试里可以给 key 本身）。
 */
export function mentionTextOf(mention, labelOf = (key) => key) {
  if (mention === undefined) return '（老记录，按 to 推）'
  if (mention === MENTION_ALL) return '所有人'
  if (Array.isArray(mention)) {
    if (mention.length === 0) return '不叫醒任何人'
    return mention.map((key) => labelOf(key)).join('、')
  }
  return '（认不出）'
}

/**
 * 投影/气泡上的那半句：「 · 提到了：A、B」/「 · 提到了：所有人」/ 空串。
 * 新记录看 mention；老记录没有 mention，就按当时的 to 推
 * （to=all ⇒ 所有人、to=某人 ⇒ 他）—— 读旧记录复现当时的行为，不是今天的规则。
 */
export function mentionDisplayOf({ mention, to }, labelOf = (key) => key) {
  let value = mention
  if (value === undefined && typeof to === 'string' && to !== '' && to !== MENTION_ALL) {
    // 老记录只在"当年点了名"时回退显示（to=成员）；to=all 的广播保持空——
    // 那一条当年没有点名，补一句"提到了：所有人"等于改历史。
    value = [to]
  }
  if (value === undefined || value === null) return ''
  if (value === MENTION_ALL) return ' · 提到了：所有人'
  if (!Array.isArray(value) || value.length === 0) return ''
  const names = value.map((key) => labelOf(key)).filter((name) => typeof name === 'string' && name !== '')
  return names.length === 0 ? '' : ` · 提到了：${names.join('、')}`
}

/**
 * 没叫醒别人的消息也要有账：游标会往前走（免得每轮重扫），
 * 但"你不在的时候还积着几条没点你的话"要能回答。
 * 这份状态按 (成员, 通道) 记，结构：
 *   { version: 1, channels: { group: { count, from, to, lastAt } }, updatedAt }
 */
export function bumpHeld(state, channelKey, { count = 1, line = null, ts = null, now = new Date().toISOString() } = {}) {
  const base = state !== null && typeof state === 'object' && !Array.isArray(state) ? state : {}
  const channels = base.channels !== null && typeof base.channels === 'object' ? { ...base.channels } : {}
  const prev = channels[channelKey]
  const entry = prev !== null && typeof prev === 'object' && !Array.isArray(prev) ? prev : {}
  const from = line === null ? (entry.from ?? null) : Math.min(Number(entry.from ?? line), Number(line))
  const to = line === null ? (entry.to ?? null) : Math.max(Number(entry.to ?? line), Number(line))
  channels[channelKey] = {
    count: Number(entry.count ?? 0) + count,
    from: Number.isFinite(from) ? from : null,
    to: Number.isFinite(to) ? to : null,
    lastAt: ts ?? entry.lastAt ?? now,
  }
  return { version: 1, channels, updatedAt: now }
}

export function heldOf(state, channelKey) {
  const entry = state?.channels?.[channelKey]
  return entry !== null && typeof entry === 'object' ? Number(entry.count ?? 0) : 0
}

export function clearHeld(state, channelKey, now = new Date().toISOString()) {
  const base = state !== null && typeof state === 'object' && !Array.isArray(state) ? state : {}
  const channels = base.channels !== null && typeof base.channels === 'object' ? { ...base.channels } : {}
  if (channels[channelKey] === undefined) return base
  channels[channelKey] = { count: 0, from: null, to: null, lastAt: null }
  return { version: 1, channels, updatedAt: now }
}

/** 唤醒预览里的那句：有没被叫醒的话才算数，0 就返回空串（不留一行"0 条"的噪声）。 */
export function heldSentenceOf(count) {
  if (!Number.isFinite(count) || count <= 0) return ''
  return `（自上轮醒来以后，群里还有 ${count} 条没点你的话；它们没叫醒你，但都在群文件里。）`
}
