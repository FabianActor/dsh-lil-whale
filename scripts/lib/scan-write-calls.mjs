// 静态扫描：找出代码里"裸的写调用"（fi-0003）
//
// 目标不是把 JS 解析对，而是把"补丁脚本里所有落盘动作都走 safe-write"这件事变成一个可执行的判据。
//
// 做法两段，**顺序不能换**：
//   1. 先在原文上认出方括号形状 `fs['writeFileSync'](...)` —— 剥层会把字符串里的名字一起剥掉，
//      所以方括号那一格必须在剥层之前抓（测试里有一条"顺序敏感"用例：剥层在前就必须漏掉它）。
//   2. 再把注释、普通字符串、模板字符串、正则字面量剥成空格（保留换行），在剩下的代码里找
//      `名字 + 可选空白/换行 + (`。
//
// 报错带 `文件:行号` 与那一行原文，人不用自己数行。

export const SCANNER_HEADER = '已知不查：动态拼名、变量取属性、模板字符串 ${} 里的调用'

export const WRITE_NAMES = [
  'writeFileSync',
  'writeFile',
  'appendFileSync',
  'appendFile',
  'renameSync',
  'rename',
  'copyFileSync',
  'copyFile',
  'unlinkSync',
  'unlink',
  'mkdirSync',
  'mkdir',
  'chmodSync',
  'chmod',
  'rmSync',
  'rm',
]

const REGEX_PREFIX = new Set(['=', '(', ',', '[', '{', ':', ';', '!', '&', '|', '?', '+', '-', '*', '%', '~', '^', '<', '>'])
const REGEX_WORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'instanceof'])

function blank(ch) {
  return ch === '\n' || ch === '\r' ? ch : ' '
}

/** 把注释 / 普通字符串 / 模板字符串 / 正则字面量剥成空格；长度与换行保持，行号不漂 */
export function stripNonCode(source) {
  const out = []
  const n = source.length
  let i = 0
  let prevSignificant = ''
  let prevWord = ''

  const pushBlank = (ch) => {
    out.push(blank(ch))
  }

  while (i < n) {
    const ch = source[i]
    const next = source[i + 1]

    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') {
        pushBlank(source[i])
        i++
      }
      continue
    }
    if (ch === '/' && next === '*') {
      pushBlank('/')
      pushBlank('*')
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        pushBlank(source[i])
        i++
      }
      if (i < n) {
        pushBlank('*')
        pushBlank('/')
        i += 2
      }
      continue
    }
    if (ch === "'" || ch === '"') {
      const quote = ch
      pushBlank(ch)
      i++
      while (i < n) {
        const c = source[i]
        if (c === '\\') {
          pushBlank(c)
          if (i + 1 < n) pushBlank(source[i + 1])
          i += 2
          continue
        }
        pushBlank(c)
        i++
        if (c === quote || c === '\n') break
      }
      continue
    }
    if (ch === '`') {
      pushBlank(ch)
      i++
      while (i < n) {
        const c = source[i]
        if (c === '\\') {
          pushBlank(c)
          if (i + 1 < n) pushBlank(source[i + 1])
          i += 2
          continue
        }
        pushBlank(c)
        i++
        if (c === '`') break
      }
      continue
    }
    if (ch === '/') {
      const isRegex = REGEX_PREFIX.has(prevSignificant) || REGEX_WORDS.has(prevWord) || prevSignificant === ''
      if (isRegex) {
        pushBlank(ch)
        i++
        let inClass = false
        while (i < n) {
          const c = source[i]
          if (c === '\\') {
            pushBlank(c)
            if (i + 1 < n) pushBlank(source[i + 1])
            i += 2
            continue
          }
          if (c === '[') inClass = true
          else if (c === ']') inClass = false
          pushBlank(c)
          i++
          if (c === '/' && !inClass) break
          if (c === '\n') break
        }
        while (i < n && /[a-z]/i.test(source[i])) {
          pushBlank(source[i])
          i++
        }
        prevSignificant = '/'
        prevWord = ''
        continue
      }
    }

    out.push(ch)
    if (!/\s/.test(ch)) {
      prevSignificant = ch
      if (/[\w$]/.test(ch)) {
        let j = i
        while (j >= 0 && /[\w$]/.test(source[j])) j--
        prevWord = source.slice(j + 1, i + 1)
      } else {
        prevWord = ''
      }
    }
    i++
  }

  return out.join('')
}

function lineOf(source, index) {
  let line = 1
  for (let i = 0; i < index && i < source.length; i++) if (source[i] === '\n') line++
  return line
}

/** 扫描一份源码，返回已排序的命中列表 [{ name, line, column, where: 'bracket'|'direct', text }] */
export function scanWriteCalls(source) {
  const hits = []
  const seen = new Set()
  const record = (name, index, where) => {
    const line = lineOf(source, index)
    const column = index - source.lastIndexOf('\n', index - 1)
    const key = `${name}:${line}:${where}`
    if (seen.has(key)) return
    seen.add(key)
    const text = (source.split('\n')[line - 1] ?? '').trim()
    hits.push({ name, line, column, where, text })
  }

  // 第 1 段：方括号形状（剥层之前）
  const bracketRe = /\b([A-Za-z_$][\w$]*)\s*\[\s*(['"])([^'"\\]+)\2\s*\]\s*\(/g
  let match
  while ((match = bracketRe.exec(source)) !== null) {
    if (WRITE_NAMES.includes(match[3])) record(match[3], match.index, 'bracket')
  }

  // 第 2 段：剥层之后找直接调用
  const stripped = stripNonCode(source)
  const directRe = new RegExp(`\\b(${WRITE_NAMES.join('|')})\\s*\\(`, 'g')
  while ((match = directRe.exec(stripped)) !== null) record(match[1], match.index, 'direct')

  return hits.sort((a, b) => a.line - b.line || a.column - b.column)
}

/** 把命中格式化成人读的几行；第一行永远是"已知不查" */
export function describeHits(file, hits) {
  const rows = [SCANNER_HEADER]
  if (hits.length === 0) {
    rows.push(`${file}：没有裸的写调用（0 处）`)
    return rows
  }
  for (const hit of hits) {
    rows.push(`${file}:${hit.line}  ${hit.name}（${hit.where}）  ${hit.text}`)
  }
  return rows
}
