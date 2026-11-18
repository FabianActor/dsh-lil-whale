/**
 * 面板怎么读一条 presence 心跳（2026-11-19 抽出）。
 *
 * `reason` 回答的是「这一轮从哪条通道被叫起来」，不是「这句话回谁」——
 * 宿主那边没有更细的信息，宁可含糊也不要编。
 *
 * 2026-11-19 他报的 bug：LeeaCP 在回私聊时，群内显示「正在回复」、私聊显示「正在忙」。
 * 根因不在读取端，在写入端：心跳把 wakeKind/wakeAt 抹掉了，只剩旧 groupWakeAt；
 * 于是十分钟内一律读成 'group'，群聊页按「在回这一段」显示、私聊页按「在别处忙」显示。
 * 读取端这层规则本身是对的，抽出来是为了让"三种输入 → 三种结果"可以被断言。
 */

export const WAKE_REASON_TTL_MS = 10 * 60_000

/**
 * @param {{ wakeKind?: string, wakeAt?: number, groupWakeAt?: number } | null | undefined} beat
 * @param {number} now
 * @param {number} ttlMs
 * @returns {'group' | 'dm' | 'self'}
 */
export function presenceReasonOf(beat, now, ttlMs = WAKE_REASON_TTL_MS) {
  const at = Number(now) || 0
  const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : WAKE_REASON_TTL_MS
  const fresh = (value) => Number(value) > 0 && at - Number(value) <= ttl

  const wakeAt = beat?.wakeAt
  if (fresh(wakeAt)) return String(beat?.wakeKind ?? '') === 'dm' ? 'dm' : 'group'

  // 兼容旧心跳：只有 groupWakeAt 的那些进程。它只可能是群，不可能是私聊。
  if (fresh(beat?.groupWakeAt)) return 'group'

  return 'self'
}
