/**
 * 「有没有新版本」的纯计算：读 GitHub Releases 的 tag、比版本号。
 *
 * 为什么数据源从 npm 换成 GitHub（2026-11-20，Fabian 定的口径）：
 * npm 上只有两块 bundle，缺 pool\homes\模板\启动脚本——只从 npm 装出来的鱼塘跑不起来
 * （面板会显示「没装完整」，写接口回 409）。所以 npm 从"安装/更新渠道"降级成镜像；
 * 唯一可信的更新来源是 GitHub 仓库与它的 Releases。设置页的「检查更新」跟着改查 Releases，
 * 不然以后不再拿 npm 当渠道时，那个按钮会永远显示"已是最新"。
 *
 * 这里只做纯计算（不联网）：tag 解析、版本比较。网络与超时在 index.js 里。
 */

/** 仓库：唯一安装与更新来源。 */
export const REPO = 'FabianActor/dsh-lil-whale'

/** Releases API：最新一条正式 Release。预发布（prerelease）不算。 */
export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`

/** `v1.12.2` → `1.12.2`；认不出的 tag 返回 null（不猜）。 */
export function versionFromTag(tag) {
  const text = String(tag ?? '').trim().replace(/^v/i, '')
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(text) ? text : null
}

/** 只比 x.y.z 的数字段；预发布标签（-rc.1）忽略——给人看的是版本，不是 semver 全集。 */
export function newerThan(latest, current) {
  if (!latest || !current) return null
  const a = String(latest).split('-')[0].split('.').map((n) => Number(n) || 0)
  const b = String(current).split('-')[0].split('.').map((n) => Number(n) || 0)
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false
  }
  return false
}

/**
 * Releases API 的 JSON → 最新版本号。
 * 读不出 tag 就抛错：宁可让面板写"查不到原因"，也不要装成"已是最新"（§60）。
 */
export function latestReleaseOf(json) {
  const version = versionFromTag(json?.tag_name)
  if (!version) throw new Error(`Release 里没有能读的 tag_name：${JSON.stringify(json?.tag_name ?? null)}`)
  return { version, tag: String(json.tag_name), url: typeof json?.html_url === 'string' ? json.html_url : null }
}
