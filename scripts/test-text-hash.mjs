// 文本指纹的换行归一化（r453）。
//
// 症状：`.gitattributes` 加了 `* text=auto` 之后，同一份 `templates\环境.md.tpl`
// 在 Windows 检出是 CRLF、在包里是 LF——内容没变，raw sha256 从 2b40a6da 变 eeff217b，
// doctor 把四条鱼刚生成好的 环境.md 全判成"旧模板"。
//
// 判据：指纹答"是不是同一份内容"，不答"是不是同一套换行"。

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeNewlines, sha8OfTextFile, sha256OfTextFile } from './lib/text-hash.mjs'

let pass = 0
let fail = 0
const failures = []

function ok(cond, name, extra = '') {
  if (cond) {
    pass += 1
    return
  }
  fail += 1
  failures.push(`  ✗ ${name}${extra ? `\n    ${extra}` : ''}`)
}

function eq(name, actual, expected) {
  ok(JSON.stringify(actual) === JSON.stringify(expected), name, `期望: ${JSON.stringify(expected)}\n    实际: ${JSON.stringify(actual)}`)
}

const dir = mkdtempSync(join(tmpdir(), 'llw-text-hash-'))
try {
  const body = '# 标题\n\n一行中文。\n'
  const lf = join(dir, 'lf.md')
  const crlf = join(dir, 'crlf.md')
  writeFileSync(lf, body, 'utf8')
  writeFileSync(crlf, body.replace(/\n/g, '\r\n'), 'utf8')

  eq('LF 与 CRLF 的 sha256 相同', sha256OfTextFile(lf), sha256OfTextFile(crlf))
  eq('全 CRLF 归一成 LF', normalizeNewlines(Buffer.from('a\r\nb\r\n')).toString(), 'a\nb\n')
  eq('单个 CR 不动（老 Mac 换行不冒充成对）', normalizeNewlines(Buffer.from('a\rb')).toString(), 'a\rb')
  eq('sha8 是 8 位十六进制', /^[0-9a-f]{8}$/.test(sha8OfTextFile(lf)), true)
  eq('不同内容指纹不同', sha8OfTextFile(lf) === sha8OfTextFile(crlf), true)
  let threw = false
  try {
    sha8OfTextFile(join(dir, 'missing.md'))
  } catch {
    threw = true
  }
  ok(threw, '文件读不到时抛错，不返回一个看起来正常的空指纹')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(`test-text-hash：合计 ${pass + fail}，PASS ${pass}，FAIL ${fail}`)
for (const line of failures) console.log(line)
process.exit(fail === 0 ? 0 : 1)
