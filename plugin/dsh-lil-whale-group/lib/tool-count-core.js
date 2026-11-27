// 工具数变化的两头：少了什么（missing）与多了什么（added）。
//
// 2026-11-27 小肥鱼（第 3695 行）：23:59 那条 `wake-agent-tools-shrank` 写着
// `from=69 to=67 missing=[office_render,office_convert,office_recalculate]`——
// 少了两件，名单里却有三件。差值对不上名单，读的人只有两个猜法，而且都是错的：
// 要么以为数错了，要么以为少的不止这三件。
//
// 病根是只记了一头：`missing = 旧 − 新`，没记 `added = 新 − 旧`。
// 「净差」与「进出各多少」是两件事，只写一头就只能看见另一半。
// 所以这里两头都算，并保留总数（列表会截断，总数不能跟着被截）。

const MAX_LIST = 20

function listOf(value) {
  if (!Array.isArray(value)) return null
  return value.filter((x) => typeof x === 'string' && x)
}

/**
 * @param {string[]|null} prevTools 上一次记下的工具名
 * @param {string[]|null} nextTools 这一次的
 * @returns {{missing: string[]|null, added: string[]|null, missingTotal: number|null, addedTotal: number|null}}
 *          拿不到两边的名单时四个字段都是 null（不是空数组——没读到和读到零个不一样）
 */
export function toolCountDiff(prevTools, nextTools) {
  const prev = listOf(prevTools)
  const next = listOf(nextTools)
  if (!prev || !next) return { missing: null, added: null, missingTotal: null, addedTotal: null }
  const prevSet = new Set(prev)
  const nextSet = new Set(next)
  const missing = prev.filter((x) => !nextSet.has(x))
  const added = next.filter((x) => !prevSet.has(x))
  return {
    missing: missing.slice(0, MAX_LIST),
    added: added.slice(0, MAX_LIST),
    missingTotal: missing.length,
    addedTotal: added.length,
  }
}

export { MAX_LIST as TOOL_COUNT_LIST_MAX }
