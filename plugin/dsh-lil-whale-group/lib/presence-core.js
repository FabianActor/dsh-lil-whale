/**
 * presence 心跳的合并规则（2026-11-19 从 index.js 抽出来，好单独测）。
 *
 * 心跳每 5 秒写一次 `status`，但它**不是**这份文件的全部内容：
 * `wakeKind` / `wakeAt` / `groupWakeAt` 记的是"最近一次从哪条通道被叫醒"，
 * 由 markWakeMarker 写。心跳如果只重建自己那几个字段，这三个就会被抹掉 ——
 * 2026-11-19 他报的「群内显示正在回复、私聊显示正在忙」就是这条：
 * 心跳每 5 秒把 wakeKind/wakeAt 洗掉，面板只剩旧的 groupWakeAt，
 * 于是十分钟内一律当成"在群里回复"。这不是某条鱼的个性，是所有鱼共有的。
 *
 * 规则：只带 status 和 at 上前，其余字段原样放过（新增字段不用回来改这里）。
 */
export function mergeHeartbeat(prev, status, now, member) {
  const base = prev !== null && typeof prev === 'object' ? prev : {}
  return {
    ...base,
    ...(typeof member === 'string' && member !== '' ? { member } : {}),
    status: typeof status === 'string' ? status : 'idle',
    at: Number(now) || Date.now(),
  }
}
