// 路由配置的"读到的那一份"（fi-0022，2026-11-26）
//
// 为什么单独一个文件、为什么名字里带 cfg：
//   这条 fissue 最初的说法是"boot 行记了 provider 会过期"。核到现场时发现 boot 行
//   根本没有 provider/model 两格 —— 那是预测，不是现状。所以这次只加"读文件读到的"
//   两格，名字写清来源（cfg=），不写 provider=，免得读的人以为那是运行态。
//
//   运行态那一半（"进程真的切了吗"）现在没有读数。插件里能看见的是：patch 文件变了、
//   插件被重新 apply。这两件都不等于路由切换，所以"切换行"叫 route-cfg-changed，
//   不叫 route-switch。

/**
 * 从 profile 的 cordis.patch.yml 文本里抠出 `agent-default-model` 那一段的 provider/model。
 *
 * 为什么要"那一段"而不是全文搜 provider:：
 *   同一个文件里 `llm-pi-ai` 那一段也有 `providers:` 和一串模型名，全文搜会抓到别人家的。
 *   所以先定位顶层块（列 0 的 `- id: agent-default-model`），到下一个列 0 的 `- ` 之前，
 *   只在这个窗口里找。
 *
 * 不给默认值：读不到就返回 null 的字段，调用方负责写 unknown。
 * （fi-0031 的教训：缺省值会被读成"读到了那个值"。）
 */
export function parseDefaultModel(patchText) {
  const text = String(patchText ?? '')
  const lines = text.split(/\r?\n/)
  const isTopEntry = (line) => /^-\s/.test(line)
  let start = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (isTopEntry(lines[i]) && /^-\s*id:\s*['"]?agent-default-model['"]?\s*$/.test(lines[i])) {
      start = i
      break
    }
  }
  if (start === -1) return { provider: null, model: null }
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (isTopEntry(lines[i])) { end = i; break }
  }
  let provider = null
  let model = null
  for (let i = start + 1; i < end; i += 1) {
    const line = lines[i]
    // 只认"比块头缩进更深"的键，防止把别处同名的键算进来
    if (!/^\s+\S/.test(line)) continue
    const m = /^\s+(provider|model):\s*(.+?)\s*$/.exec(line)
    if (!m) continue
    const value = unquote(m[2].replace(/\s+#.*$/, ''))
    if (!value) continue
    if (m[1] === 'provider' && provider === null) provider = value
    if (m[1] === 'model' && model === null) model = value
  }
  return { provider, model }
}

function unquote(raw) {
  const v = String(raw ?? '').trim()
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1).trim()
  }
  return v
}

/** 有没有变。返回 null 表示没变；否则返回 { provider: bool, model: bool }。 */
export function routeCfgDiff(prev, next) {
  const p = prev ?? {}
  const n = next ?? {}
  const providerChanged = (p.provider ?? 'unknown') !== (n.provider ?? 'unknown')
  const modelChanged = (p.model ?? 'unknown') !== (n.model ?? 'unknown')
  if (!providerChanged && !modelChanged) return null
  return { provider: providerChanged, model: modelChanged }
}

/** 账本上那一行的正文（不拼时间、不拼成员——那两格由写入口加）。 */
export function routeCfgLine(prev, next, member) {
  const p = prev ?? {}
  const n = next ?? {}
  return `to=${member} from-cfg=${p.provider ?? 'unknown'}/${p.model ?? 'unknown'} to-cfg=${n.provider ?? 'unknown'}/${n.model ?? 'unknown'}`
}
