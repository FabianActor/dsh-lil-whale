/**
 * PS1 编码体检（fi-0009，r405）。
 *
 * 要查的问题：Windows PowerShell 5.1 读无 BOM 的 UTF-8 文件时按 ANSI 解码，中文行会乱，
 * 报出来的却是"缺少 }"或"字符串没结束"——**一个字不提编码**。实测：
 *   无 BOM + 中文 + `#requires -Version 7.0` → 5.1 会先说"这脚本要 7.0"（清楚）
 *   无 BOM + 中文 + 没有 #requires       → `The string is missing the terminator: '.`（误导）
 *
 * 所以要守的规矩只有一条：**含中文的 .ps1，要么带 UTF-8 BOM，要么带 `#requires -Version 7.x`**。
 * 两者都有最好；两样都没有就必须报出来。
 */

export const PS1_BOM = [0xef, 0xbb, 0xbf]

/** 读到的前三个字节是不是 UTF-8 BOM。 */
export function hasBom(bytes) {
  if (!bytes || bytes.length < 3) return false
  return bytes[0] === PS1_BOM[0] && bytes[1] === PS1_BOM[1] && bytes[2] === PS1_BOM[2]
}

/** 是否有中文字符（含全角标点不算，只要汉字）。 */
export function hasCjk(text) {
  return /[\u4e00-\u9fff]/.test(String(text ?? ''))
}

/** 是否声明了 `#requires -Version 7`（大小写与空格宽容，只看行首指令）。 */
export function hasRequires7(text) {
  return /^\s*#requires\s+-Version\s+7(\b|\.)/im.test(String(text ?? ''))
}

/**
 * 一张表里的一行文件；`bytes` 是原始字节，`text` 是 BOM 之外的解码文本。
 * 返回 null（合格）或 `{ code, why }`（不合格）。
 */
export function encodingProblem({ bytes, text, file, hasNonAscii = false }) {
  const bom = hasBom(bytes)
  // GBK 文件按 UTF-8 解会变成替换符 ⇒ hasCjk 为假，所以"出现过非 ASCII 字节"也算可能含中文。
  const cjk = hasCjk(text) || Boolean(hasNonAscii)
  const req = hasRequires7(text)
  if (!cjk) return null // 纯 ASCII 不受 ANSI/UTF-8 差异影响
  if (bom) return null
  if (req) return null // 没有 BOM 但有 #requires 7：5.1 会给出清楚的"要 7.0"
  return { code: 'no-bom-no-requires', why: `${file ?? '这个脚本'} 含中文，但既没有 UTF-8 BOM，也没有 #requires -Version 7` }
}

/** 对一个目录下所有 .ps1 跑一遍（只回答谁不合格，不负责读盘）。 */
export function auditEntries(entries) {
  const problems = []
  for (const e of entries) {
    const p = encodingProblem(e)
    if (p) problems.push({ ...e, ...p })
  }
  return problems
}
