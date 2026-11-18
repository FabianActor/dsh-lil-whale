// 媒体缓存清理（r333；r334 加现状快照）。
// bili-eyes 把视频下到 pool\cache\bili-eyes\media，它自己只按容量删最旧的（mediaMaxMb），
// 没有按时间清。放太久的视频不看也应该让位。
//
// **两个阈值不是同一个数，别以为有一个写错了**（第三条鱼 2026-11-18 私信）：
//   - 插件缓存规则 `cacheHours = 24`：管"新鲜度"，过期 = 下次重新下载，**删不删都算过期**；
//   - 巡守清理规则 `7 天`：管"占盘"，只有放久了没人看才删，**没到 7 天不代表还能复用**。
// 两件事各说各的，同时成立是对的。
//
// 判据三条：
//  1. 只删这个目录里的普通文件，不递归——子目录是别人的地盘，动了要有人负责。
//  2. 删不掉要留痕（failed 交给调用方写 error 行），别让"没清"和"清过"长得一样（§60）。
//  3. "没东西可删"不写事件行，但现状要挂在周期行上（mediaCacheStats）：否则
//     "机制没跑（配置错/进程没起）"和"跑了但目录本来就空"在账上同形。
import { readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

// 默认 7 天：比插件的 cacheHours=24 宽得多，因为它们量的不是一件事（见上）。
export const MEDIA_CACHE_MAX_AGE_DAYS = 7

/**
 * 删掉 dir 里 mtime 早于 maxAgeDays 的普通文件。
 * 返回 { removed, bytes, failed:[{name,code}], existed }；目录不存在不是错误（existed=false）。
 */
export function pruneMediaCache({ dir, maxAgeDays = MEDIA_CACHE_MAX_AGE_DAYS, now = Date.now() } = {}) {
  const out = { removed: 0, bytes: 0, failed: [], existed: true }
  if (!dir) return { ...out, existed: false }
  let names
  try {
    names = readdirSync(dir)
  } catch (error) {
    if (error?.code === 'ENOENT') return { ...out, existed: false }
    return { ...out, failed: [{ name: '', code: error?.code ?? 'error' }] }
  }
  const cutoff = now - maxAgeDays * 86400_000
  for (const name of names.slice().sort()) {
    const full = join(dir, name)
    try {
      const stat = statSync(full)
      if (!stat.isFile() || stat.mtimeMs >= cutoff) continue
      unlinkSync(full)
      out.removed += 1
      out.bytes += stat.size
    } catch (error) {
      out.failed.push({ name, code: error?.code ?? 'error' })
    }
  }
  return out
}

/**
 * 看一眼目录现状，不删东西。给周期行（roster-audit 的 `media=`）提供对照：
 * 有这一格，"没删"与"没清过"才分得开。
 * 返回 { existed, files, bytes, oldestMs }；oldestMs 为 null 表示目录里没有文件。
 */
export function mediaCacheStats({ dir } = {}) {
  const out = { existed: false, files: 0, bytes: 0, oldestMs: null }
  if (!dir) return out
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  out.existed = true
  for (const name of names) {
    try {
      const stat = statSync(join(dir, name))
      if (!stat.isFile()) continue
      out.files += 1
      out.bytes += stat.size
      if (out.oldestMs === null || stat.mtimeMs < out.oldestMs) out.oldestMs = stat.mtimeMs
    } catch {
      /* 读不到某一项就不算进现状；它不是"没有"，只是没看见 */
    }
  }
  return out
}
