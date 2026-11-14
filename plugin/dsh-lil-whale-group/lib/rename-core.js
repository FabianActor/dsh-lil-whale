/**
 * 改名的判断逻辑（2026-11-14 他定的规矩）。
 *
 * 名字是"称呼"，属于她；id 是"键"，属于系统、出生即定。
 * 所以改名只发生在一条路上：她自己在会话里调 `rename`。
 * 设置页、接口、脚本都不许替她改 —— 这条只做判断，不碰文件、不写日志，好被测试跑。
 */

/** 名字最长几个字（码位算，emoji 算一个）。 */
export const NAME_MAX = 16

/** 两次改名之间至少隔多久。 */
export const RENAME_COOLDOWN_HOURS = 24

/**
 * 把用户给的原始值收拾成一个名字；不合格返回 null（不返回空串 —— 空串是"没填"）。
 * 规则：去掉首尾空白、连续空白压成一个空格、非空、不超过 NAME_MAX 个码位。
 */
export function cleanName(raw) {
  if (typeof raw !== 'string') return null
  const name = raw.trim().replace(/\s+/g, ' ')
  if (name === '') return null
  if (Array.from(name).length > NAME_MAX) return null
  return name
}

/**
 * 这个名字是不是已经被别人用了。`others` 是"其他成员当前的名字"。
 * 大小写不敏感（Windows 上 `Leea` 和 `leea` 看起来就是同一个称呼）。
 */
export function nameTaken(name, others) {
  const needle = String(name).toLowerCase()
  return (others ?? []).some((other) => typeof other === 'string' && other.trim() !== '' && other.trim().toLowerCase() === needle)
}

/**
 * 改名后的 nameHistory：旧名字带上 until（此刻），新名字不带 until（当前）。
 * 这条和 `rebuild-group-md.mjs` 的 `labelAt` 是一对：写端记历史，读端按历史还原。
 */
export function historyAfterRename(history, oldName, newName, nowIso) {
  const list = Array.isArray(history) ? history.filter((item) => item !== null && typeof item === 'object') : []
  const last = list.length > 0 ? list[list.length - 1] : null
  if (last && !last.until) {
    last.until = nowIso
    if (!last.name) last.name = oldName
  } else if (oldName) {
    list.push({ name: oldName, until: nowIso })
  }
  list.push({ name: newName })
  return list
}

/**
 * 距离上次改名够不够久。
 * 返回 `{ ok: true }` 或 `{ ok: false, retryAt }`（retryAt 是能再改的时刻，ISO）。
 */
export function canRename(lastRenameAtIso, nowIso, cooldownHours = RENAME_COOLDOWN_HOURS) {
  const last = Date.parse(String(lastRenameAtIso ?? ''))
  const now = Date.parse(String(nowIso ?? ''))
  if (Number.isNaN(last) || Number.isNaN(now)) return { ok: true }
  const waitMs = cooldownHours * 3600_000
  if (now - last < waitMs) return { ok: false, retryAt: new Date(last + waitMs).toISOString() }
  return { ok: true }
}

/** 群里那句自动播报。 */
export function renameAnnouncement(from, to) {
  return `我改名字了：以后叫我「${to}」。以前叫「${from}」，那个名字也是我。`
}
