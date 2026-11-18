// 媒体缓存清理（r333）：bili-eyes 把视频下到 pool\cache\bili-eyes\media，
// 它自己只按容量删最旧的（mediaMaxMb），没有按时间清。放太久的视频不看也应该让位。
//
// 判据两条：
//  1. 只删这个目录里的普通文件，不递归——子目录是别人的地盘，动了要有人负责。
//  2. 删不掉要留痕（failed 交给调用方写 error 行），别让"没清"和"清过"长得一样（§60）。
import { readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

// 默认 7 天：比 bili-eyes 自己的 cacheHours=24 宽，因为这里管的是磁盘，
// 不是"下次还下不下"——缓存键把登录状态算进去了，删了顶多下次重新下。
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
