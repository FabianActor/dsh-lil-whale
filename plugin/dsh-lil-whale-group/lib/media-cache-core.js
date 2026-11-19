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
import { dirname, join } from 'node:path'

// 默认 7 天：比插件的 cacheHours=24 宽得多，因为它们量的不是一件事（见上）。
export const MEDIA_CACHE_MAX_AGE_DAYS = 7

/**
 * 删掉 dir 里 mtime 早于 maxAgeDays 的普通文件。
 *
 * 返回 { removed, bytes, existed, error, failed }，语义与 mediaCacheStats 对齐
 * （小鱼丸 2026-11-19 群第 2197 行：两个函数同名同义，读者不用记两套）：
 *   - existed: true —— 目录读到了；error: null；
 *   - existed: false, error: null —— 目录还没建（没下过视频），不是失败；
 *   - existed: false, error: '<CODE>' —— 试过、没读成（ENOTDIR / EACCES …），码进 error；
 *   - failed: [{ scope:'dir'|'file', name?, code }] —— 只装“具体某一层”的失败；
 *     目录层失败进 error，文件层失败进 failed（带 name，下一个人才知道该动哪个）。
 */
export function pruneMediaCache({ dir, maxAgeDays = MEDIA_CACHE_MAX_AGE_DAYS, now = Date.now() } = {}) {
  const out = { removed: 0, bytes: 0, existed: false, error: null, failed: [] }
  if (!dir) return { ...out, error: 'NO-ARG' }
  let names
  try {
    names = readdirSync(dir)
  } catch (error) {
    const code = error?.code ?? 'error'
    // ENOENT：目录没建 = 没东西可删，不是失败（与 mediaCacheStats 对“父目录还在”的区分不同：
    // 清理路径不关心“是谁改错了路”，只关心“这一轮没东西可清”——路径算错会由 stats 那格报出来）。
    if (code === 'ENOENT') return out
    return { ...out, error: code }
  }
  out.existed = true
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
      out.failed.push({ scope: 'file', name, code: error?.code ?? 'error' })
    }
  }
  return out
}

/**
 * 看一眼目录现状，不删东西。给周期行（roster-audit 的 `media=`）提供对照：
 * 有这一格，"没删"与"没清过"才分得开。
 *
 * 返回 { existed, error, files, bytes, oldestMs }：
 *   - `existed: true`：读到了，files/bytes/oldestMs 有效（oldestMs=null 表示空目录）；
 *   - `existed: false, error: null`：目录还没建（父目录在，正常：还没下过视频）；
 *   - `existed: false, error: '<CODE>'`：试过、失败了，码留在 error 里（`unknown` 必须带原因——
 *     第三条鱼 2026-11-18 私信：`hash=unreadable:EBUSY` 说的是"试过、失败了"，空 hash 说的是"没记"，
 *     而"权限"与"路径算错"的修法完全相反）。
 */
export function mediaCacheStats({ dir } = {}) {
  const out = { existed: false, error: null, files: 0, bytes: 0, oldestMs: null }
  if (!dir) {
    out.error = 'NO-ARG'
    return out
  }
  let names
  try {
    names = readdirSync(dir)
  } catch (error) {
    const code = error?.code ?? 'error'
    if (code === 'ENOENT') {
      // 父目录还在 ⇒ 只是缓存目录还没建（没下过）；父目录也不在 ⇒ 多半路径算错，要能分开
      try {
        statSync(dirname(dir))
      } catch {
        out.error = 'ENOENT'
      }
      return out
    }
    out.error = code
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
