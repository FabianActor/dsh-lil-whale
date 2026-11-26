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

// ---------------------------------------------------------------------------
// fi-0033（2026-11-27）：运行态那一半的读数。
//
// 上一版只记了"文件里写着什么"（cfg*），把"进程真的用哪个"留给以后。翻案时查到两个接口：
//   - `dsh-agent-default-model/lib/index.js:38` 的 `currentSelection()` 读的是 config refs；
//   - `dsh-api-session-controller/lib/index.js:433-445` 的 `agentOptions()` 用 getter 每次现取。
// 所以"请求那一刻用哪个"是读得到的，只是要在拿到服务之后读。
//
// 名字继续分开：live= 是进程内这一刻的选择，cfg= 是磁盘上那一份。
// **两者不一致本身就是一条读数**——但只说明"内存与文件不同"，不说明"谁对"。
// ---------------------------------------------------------------------------

/**
 * 把"读一眼运行态"变成一个纯函数：reader 返回 `{ provider, model }` 或 null。
 * 读不到不是"没有路由"，而是"这一刻读不到"——两种状态分开写（fi-0031 的教训）。
 *
 * @param {() => unknown} read 调 `agentDefaultModel.currentSelection()` 的薄壳。
 * @returns {{ provider: string|null, model: string|null, reason: string|null }}
 */
export function liveRouteOf(read) {
  if (typeof read !== 'function') return { provider: null, model: null, reason: 'no-reader' }
  let selection
  try {
    selection = read()
  } catch (error) {
    return { provider: null, model: null, reason: `read-failed:${String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 60)}` }
  }
  if (selection === null || selection === undefined) return { provider: null, model: null, reason: 'service-absent' }
  const provider = typeof selection.provider === 'string' && selection.provider !== '' ? selection.provider : null
  const model = typeof selection.model === 'string' && selection.model !== '' ? selection.model : null
  if (provider === null || model === null) return { provider, model, reason: 'incomplete' }
  return { provider, model, reason: null }
}

/**
 * route-live 一行的正文。`diff=yes` 只表示两个来源写得不一样，不表示谁对。
 * 读不到时 live 写 `(unavailable)` 而不是 `unknown`——unknown 会被读成"读到了但不知名"。
 */
export function routeLiveLine(live, cfg) {
  const L = live ?? {}
  const C = cfg ?? {}
  const liveTxt = `${L.provider ?? '(unavailable)'}/${L.model ?? '(unavailable)'}`
  const cfgTxt = `${C.provider ?? 'unknown'}/${C.model ?? 'unknown'}`
  // 按"写出来的两个串"比：读不到写成 (unavailable)、文件里读不到写成 unknown，
  // 它们不是同一个值，所以 diff 要亮。用 null 比较会把这一格吞掉。
  const diff = liveTxt !== cfgTxt
  const why = typeof L.reason === 'string' && L.reason !== '' ? ` why=${L.reason}` : ''
  return { line: `live=${liveTxt} cfg=${cfgTxt} diff=${diff ? 'yes' : 'no'}${why}`, diff }
}
