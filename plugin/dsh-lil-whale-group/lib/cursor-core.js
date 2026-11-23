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
 * @returns {{start:number, src:'file'|'legacy'|'missing'|'unknown'|'capped'|'regressed', stored:number, lastDelivered:number|null, capped:boolean, regressed:boolean, unknown:boolean}}
 */
export function classifyCursorRead({ source, stored, lastDelivered = null, lines }) {
  const total = Number.isFinite(lines) && lines > 0 ? Math.trunc(lines) : 0
  const raw = Number.isFinite(stored) ? Math.trunc(stored) : 0
  const meta = Number.isFinite(lastDelivered) ? Math.trunc(lastDelivered) : null
  const base = { stored: raw, lastDelivered: meta, capped: false, regressed: false, unknown: false }

  // 1) 超过文件长度：旧行为，夹到文件尾。留 `capped` 让人能追。
  if (raw > total) return { ...base, start: total, src: 'capped', capped: true }
  // 2) 比上一次递到的位置还小：不重放，从 meta 接着走。
  //    这是 rc.5 那次的正面防线——128 < 3186，于是不会再把 1300 条重投一遍。
  if (meta !== null && raw < meta) {
    return { ...base, start: Math.min(meta, total), src: 'regressed', regressed: true }
  }
  // 3) 读不到（文件缺失 / 损坏）：只给最近一小段，且不声称知道条数。
  if (source === 'missing' || source === 'unknown') {
    return { ...base, start: Math.max(0, total - CURSOR_LOST_WINDOW), src: source, unknown: true }
  }
  // 4) 正常：legacy 是迁移来的真值、recovered 是从 meta 重建的，都照常使用，只在记账里标来源。
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
export function countsKnownOf(read) {
  return !(read && read.unknown)
}
