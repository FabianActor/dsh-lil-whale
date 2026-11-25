/**
 * 游标的"读到了什么"（纯函数）。
 *
 * 2026-11-23 早上 rc.5 崩溃后重启，五条鱼一起重放：lee 的群通道 pending=1354、
 * prior-cursor=128；whale 同样 128；另外三条是 0。同一刻磁盘上的游标已经是 3186。
 * 前一晚的 fi-0013/0014/0015 把问题拆成三件：
 *
 * 1. **来源不明**：0、"文件里没有这一格"、"文件损坏"在旧代码里全被当成 0，
 *    于是"第一次读"与"进度丢了"长得一模一样，唤醒词还会替你数"积了 N 条"。
 * 2. **回退重放**：游标比"上一次真的递到哪儿"小，就从头再投一次——
 *    可那 1300 多条早就读过，钱是白的。
 * 3. **编数字**：读不到进度时，文案把 `lines - 0` 当成真实积压写出来。
 *
 * 这里只做判断，不碰磁盘：给 handleChannel 一个 start + 来源，让它能记账、能让文案闭嘴。
 */

/** 读不到进度时，最多往回看这么多行：有新的没漏，历史不重放。 */
export const CURSOR_LOST_WINDOW = 20

/**
 * @param {object} input
 * @param {'file'|'legacy'|'missing'|'unknown'} input.source 这一次是从哪读到的
 * @param {number} input.stored 文件里那格的值（没有就是 0）
 * @param {number|null} input.lastDelivered 上一次真的递到第几行（有 meta 才有）
 * @param {number} input.lines 通道文件现在有多少行
 * @returns {{start:number, src:'file'|'legacy'|'recovered'|'missing'|'unknown'|'capped'|'regressed'|'absent', stored:number, lastDelivered:number|null, capped:boolean, regressed:boolean, unknown:boolean}}
 */
export function classifyCursorRead({ source, stored, lastDelivered = null, lines, present = true }) {
  const total = Number.isFinite(lines) && lines > 0 ? Math.trunc(lines) : 0
  const raw = Number.isFinite(stored) ? Math.trunc(stored) : 0
  const meta = Number.isFinite(lastDelivered) ? Math.trunc(lastDelivered) : null
  const base = { stored: raw, lastDelivered: meta, capped: false, regressed: false, unknown: false }

  // 1) 超过文件长度：旧行为，夹到文件尾。留 `capped` 让人能追。
  if (raw > total) return { ...base, start: total, src: 'capped', capped: true }
  // 2) 文件在、但这一格没有（不是 0，是缺席）：来源叫 absent，别写成 file。
  //    LeeaCP 2026-11-23 验收：`src=file start=0` 与 `cursor-state=lost` 放一起会读成“本来就该从 0 起”。
  //    放在 regressed 之前：key 缺席时 raw=0 必然小于 meta，否则永远走 regressed、absent 不可达。
  //    有 meta 就从 meta 接着走（不重放）；没 meta 才退到最近一小段，并且不声称知道条数。
  if (source !== 'missing' && source !== 'unknown' && present === false) {
    if (meta !== null) return { ...base, start: Math.min(meta, total), src: 'absent' }
    return { ...base, start: Math.max(0, total - CURSOR_LOST_WINDOW), src: 'absent', unknown: true }
  }
  // 3) 比上一次递到的位置还小：不重放，从 meta 接着走。
  //    这是 rc.5 那次的正面防线——128 < 3186，于是不会再把 1300 条重投一遍。
  if (meta !== null && raw < meta) {
    return { ...base, start: Math.min(meta, total), src: 'regressed', regressed: true }
  }
  // 4) 读不到（文件缺失 / 损坏）：只给最近一小段，且不声称知道条数。
  if (source === 'missing' || source === 'unknown') {
    return { ...base, start: Math.max(0, total - CURSOR_LOST_WINDOW), src: source, unknown: true }
  }
  // 5) 正常：legacy 是迁移来的真值、recovered 是从 meta 重建的，都照常使用，只在记账里标来源。
  const tag = source === 'legacy' || source === 'recovered' ? source : 'file'
  return { ...base, start: Math.max(0, Math.min(raw, total)), src: tag }
}

/** 一句话说清这次读游标发生了什么（写进 watchman.log 的 cursor-source 行）。 */
export function cursorSourceLine({ member, channel, read, lines }) {
  const fields = [
    `member=${member}`,
    `channel=${channel}`,
    `src=${read.src}`,
    `stored=${read.stored}`,
    `start=${read.start}`,
  ]
  if (read.lastDelivered !== null) fields.push(`last-delivered=${read.lastDelivered}`)
  if (read.capped) fields.push('capped=yes')
  if (read.regressed) fields.push('regressed=yes')
  if (read.unknown) fields.push('counts=unknown')
  fields.push(`lines=${Number.isFinite(lines) ? Math.trunc(lines) : 0}`)
  return fields.join(' ')
}

/** 唤醒词里要不要报具体条数：只有读得到进度时才报。 */
// 2026-11-24（fi-0019）：held 只在"起点可信"时数。
// 起点丢了/回退/被夹/补建时，扫描段里混着早已读过的消息；数它会把旧账翻出来重算
// （LeeaCP 看到的那 1782 就是一次 rc.5 重放之后攒下的）。
export function heldTrustedOf(read) {
  return read?.src === 'file' || read?.src === 'legacy'
}

export function countsKnownOf(read) {
  return !(read && read.unknown)
}
/**
 * 累积量要跟它的上界比一次（LeeaCP，2026-11-24 群第 3255 行）。
 * held 数的是群账本里的消息，永远不可能多过账本行数；
 * 真出现比上界还大的数，说明数它的那一段起点错了——当年 24860 > 3251 就是这么来的。
 * 这里只回答「荒谬不荒谬」，怎么处理由写端定。
 */
export function heldOverflows(count, lines) {
  if (count === null || count === undefined || lines === null || lines === undefined) return false
  const c = Number(count)
  const n = Number(lines)
  if (!Number.isFinite(c) || !Number.isFinite(n)) return false
  return c > n
}

/**
 * 这一次写回的游标值，是从哪儿来的（fi-0031，2026-11-25）。
 *
 * 为什么要这一格：游标坏掉有两条恢复路——从 cursor-meta 重建（会写 cursor-repaired），
 * 以及进程活着、拿手里那份整份写回（旧代码什么都不记）。后者更常见，于是一个好的游标文件
 * 说不清"它怎么好的"。这里把来源定成四个字，写在每一条写回上：
 *
 *   file     从游标文件那一格读到（正常路）
 *   meta     从 cursor-meta 补回来的（recovered / regressed）
 *   legacy   迁移来的遗留值
 *   computed 没读到，按文件尾现算（missing / absent / unknown / capped）
 *
 * 不给默认值：缺省值会被读成"从文件读的"，那就又回到"错的和对的长得一样"。
 * @param {{src?: string}} read classifyCursorRead 的返回值
 * @returns {'file'|'meta'|'legacy'|'computed'}
 */
export function cursorWriteSourceOf(read) {
  const src = read?.src
  if (src === 'file') return 'file'
  if (src === 'legacy') return 'legacy'
  if (src === 'recovered' || src === 'regressed') return 'meta'
  return 'computed'
}
