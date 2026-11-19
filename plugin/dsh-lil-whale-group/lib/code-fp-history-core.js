// 代码指纹的历史账（2026-11-19，小鱼丸私聊第 53 行）。
//
// boot 行里的 `codeFp` 只回答"启动那一刻磁盘是什么样"；拿它跟"启动那一刻的磁盘"比，
// 是拿一个量跟它的自述比 —— 恒真。要回答"这段代码改过没有"，得像 log-format 那样
// 在值变化时留一行：账上有历史值，读的人就不用靠谁记性好。
//
// 这里只做纯计算；文件读写留在 index.js，方便测试。

export const CODE_FP_LEDGER = 'code-fp.json'

/**
 * 比较上一次记下的指纹与这一次算出来的。
 * @returns {{kind:'baseline',newFp:string,newFiles:number}
 *   | {kind:'same',newFp:string,newFiles:number}
 *   | {kind:'changed',oldFp:string,oldFiles:number,newFp:string,newFiles:number}}
 */
export function codeFpChangeOf(prev, current) {
  const newFp = typeof current?.fp === 'string' && current.fp !== '' ? current.fp : 'unknown'
  const newFiles = Number.isFinite(current?.files) ? current.files : 0
  if (!prev || typeof prev.fp !== 'string' || prev.fp === '') {
    return { kind: 'baseline', newFp, newFiles }
  }
  if (prev.fp === newFp) return { kind: 'same', newFp, newFiles }
  return {
    kind: 'changed',
    oldFp: prev.fp,
    oldFiles: Number.isFinite(prev.files) ? prev.files : 0,
    newFp,
    newFiles,
  }
}

/** 变化时写一行；没变返回 null（"没变不记事件"）。 */
export function codeFpHistoryLine(change) {
  if (change?.kind === 'baseline') {
    return `note=code-fp-baseline fp=${change.newFp} files=${change.newFiles}`
  }
  if (change?.kind === 'changed') {
    return (
      `note=code-fp-changed old=${change.oldFp} new=${change.newFp}` +
      ` files-old=${change.oldFiles} files-new=${change.newFiles}`
    )
  }
  return null
}

/** 账本里留的最新一份（下一次启动拿它当"上一次"）。 */
export function codeFpLedgerOf(current, at) {
  const fp = typeof current?.fp === 'string' && current.fp !== '' ? current.fp : 'unknown'
  const files = Number.isFinite(current?.files) ? current.files : 0
  return { fp, files, at }
}
