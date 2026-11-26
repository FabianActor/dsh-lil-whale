// 保住孩子 patch 里"不属于任何 bundle"的顶层段（issue #5，2026-11-25）。
//
// 背景：`dsh plugin add` 会按 bundle 清单重写 profiles\<p>\cordis.patch.yml——
// 它只保留自己能解释的段，设置页写进去的 ui-settings-general / agent-default-model
// 没有对应 bundle，就被静默丢掉；install.ps1 -Upgrade 里正好有这一步，于是
// "升级代码"顺手改掉了鱼在设置页里做的选择（模型、reasoningEffort 全没了）。
//
// 这里只做一件事：拿"动手之前"的文本和"动手之后"的文本比，把后者少掉的顶层段
// 原样接到尾部，并报告补了哪些。不解释、不排序、不重写任何已有段。
//
// 顶层段 = 一行以 `- ` 开头（列 0）；段尾 = 下一个列 0 的 `- ` 或文件末尾。

/** 按顶层 `- ` 切段；返回 [{ id, start, end, text }]（text 不含尾随空行）。 */
export function splitTopBlocks(text) {
  const lines = String(text).split(/\r?\n/)
  const blocks = []
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('- ')) continue
    let end = lines.length
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].startsWith('- ')) {
        end = j
        break
      }
    }
    let last = end
    while (last > i && lines[last - 1].trim() === '') last--
    const m = /^-\s+id:\s*(\S+)/.exec(lines[i])
    blocks.push({ id: m ? m[1] : '', start: i, end: last, text: lines.slice(i, last).join('\n') })
    i = end - 1
  }
  return blocks
}

/** 顶层段 id 列表（顺序即文件顺序）。 */
export function topBlockIds(text) {
  return splitTopBlocks(text).map((b) => b.id).filter(Boolean)
}

/**
 * before 里有、after 里没有的顶层段。
 * 只认 id；同一 id 在 after 里出现过就算"还在"（哪怕内容被改写——那是另一件事）。
 */
export function missingBlocks(beforeText, afterText) {
  const afterIds = new Set(topBlockIds(afterText))
  const seen = new Set()
  const out = []
  for (const b of splitTopBlocks(beforeText)) {
    if (!b.id || afterIds.has(b.id) || seen.has(b.id)) continue
    seen.add(b.id)
    out.push({ id: b.id, text: b.text })
  }
  return out
}

/** 把缺的段接到末尾；空清单 `[]` 文档先被替换掉（不然会变成两个 YAML 文档）。 */
export function appendMissingBlocks(afterText, blocks) {
  if (!blocks.length) return { text: afterText, restored: [] }
  const eol = String(afterText).includes('\r\n') ? '\r\n' : '\n'
  const already = new Set(topBlockIds(afterText))
  const want = blocks.filter((b) => !already.has(b.id))
  if (!want.length) return { text: afterText, restored: [] }
  // 段与段之间留一个空行：接上去的段和原来的段看起来得是同一种排法。
  const body = want.map((b) => b.text.replace(/\r?\n/g, eol)).join(eol + eol)
  let text = String(afterText)
  const emptyList = /^\[\][ \t]*$/m
  if (emptyList.test(text)) {
    text = text.replace(emptyList, () => body)
  } else {
    if (!text.endsWith('\n')) text += eol
    text += eol + body + eol
  }
  return { text, restored: want.map((b) => b.id) }
}

/** 一步到位：before → after，补回缺的段，返回 { text, restored }。 */
export function preserveBlocks(beforeText, afterText) {
  return appendMissingBlocks(afterText, missingBlocks(beforeText, afterText))
}
