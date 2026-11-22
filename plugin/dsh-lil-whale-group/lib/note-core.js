/**
 * watchman 共享账与 intent.log 的拼行（fi-0008，r403）。
 *
 * 2026-11-20 09:06 的分工：共享账（pool\state\watchman.log）只记"谁、什么码"，
 * 正文只写进她自己的 <家>\logs\intent.log；两本之间不复制同一句，靠时刻 + 成员对齐。
 *
 * 为什么拆：同一句说明在两本账各一份，改一处就漏一处；而且共享账是巡守与所有进程
 * 一起写的，正文多了以后"读一行看懂发生了什么"反而更难。
 */

/** 把一条 note 正文变成机器码：取第一个词；`note=foo`/`deny=bar` 取等号右边；遇到中文括注就截断。 */
export function noteCodeOf(msg) {
  const s = String(msg ?? '').replace(/\s+/g, ' ').trim()
  if (!s) return 'empty'
  let head = s.split(' ')[0]
  const kv = /^([a-z][a-z0-9-]+)=(.*)$/.exec(head)
  if (kv) head = kv[2] || kv[1]
  const cut = head.search(/[（(:：]/)
  if (cut > 0) head = head.slice(0, cut)
  return head || 'unknown'
}

/** intent.log 的正文：完整一句（只压空白，不截断）；被去重压制时前面加计数，仍保留整句。 */
export function intentNoteTextOf(msg, { suppressed = 0 } = {}) {
  const s = String(msg ?? '').replace(/\s+/g, ' ').trim()
  return suppressed > 0 ? `note-suppressed count=${suppressed} msg=${s}` : s
}

/** watchman 的 skip 行：只有 to=、code=（被压制时是 note-suppressed + count）与指路，不含正文。 */
export function watchmanSkipLineOf(memberKey, { code = '', suppressed = 0 } = {}) {
  const tail = suppressed > 0 ? `code=note-suppressed count=${suppressed}` : `code=${code || 'unknown'}`
  return `to=${memberKey} ${tail} see=intent.log`
}
