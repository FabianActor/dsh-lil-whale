/**
 * 名册 map：每一个值都带上它自己的 key（fi-0010，r404）。
 *
 * 为什么要单独一层：`MEMBERS[self]` 一路被传进 `planDue()` 等函数，里面拼 `to=${member.key}`
 * 写日志；值对象若没有 key，日志里就是 `to=undefined`——"谁被跳过了"永远查不到。
 * 2026-11-22 实测：watchman.log 900 行 `to=undefined` 都是这样来的。
 *
 * 顺手统一：fallback（内置名册）与真名册走同一道加工，不再"某一条路碰巧带 key"。
 */

/** 返回新的 map；每个值是原对象的浅拷贝 + `key`。不修改入参。 */
export function membersWithKeys(map) {
  const out = {}
  if (!map || typeof map !== 'object') return out
  for (const [key, m] of Object.entries(map)) {
    if (m && typeof m === 'object') out[key] = { ...m, key }
    else out[key] = m
  }
  return out
}
