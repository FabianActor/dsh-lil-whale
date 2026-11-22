#!/usr/bin/env node
/**
 * PS1 编码体检的行为测试（fi-0009，r405）。
 * 两层：①核心判定（合成字节，不依赖仓库现状）②仓库不变式（真文件）——
 * 含中文的 scripts\*.ps1 要么带 BOM，要么带 `#requires -Version 7`；fish.ps1 必须带 BOM。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditEntries, encodingProblem, hasBom, hasCjk, hasRequires7 } from './lib/ps1-encoding-core.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const SCRIPTS = join(ROOT, 'scripts')
const BOM = Buffer.from([0xef, 0xbb, 0xbf])
const BODY_CN = Buffer.from('# 中文注释\nWrite-Output 1\n', 'utf8')
const BODY_ASCII = Buffer.from('# ascii only\nWrite-Output 1\n', 'utf8')
const REQ = Buffer.from('#requires -Version 7.0\n', 'utf8')

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) pass++
  else failures.push(`${name}${detail ? `：${detail}` : ''}`)
}

function probe(bytes) {
  const bom = hasBom(bytes)
  const text = bytes.slice(bom ? 3 : 0).toString('utf8')
  const nonAscii = bytes.some((b) => b > 0x7f)
  return { bytes, text, hasNonAscii: nonAscii, file: 'x.ps1' }
}

// 1) 核心判定
check('BOM 识别', hasBom(Buffer.concat([BOM, BODY_CN])) && !hasBom(BODY_CN))
check('中文识别', hasCjk('# 中文') && !hasCjk('# ascii'))
check('#requires 识别（大小写宽容）', hasRequires7('#requires -Version 7.0\n') && hasRequires7('#Requires -Version 7.2\n'))
check('无 BOM + 中文 + 无 #requires ⇒ 报', encodingProblem(probe(BODY_CN))?.code === 'no-bom-no-requires')
check('无 BOM + 中文 + 有 #requires ⇒ 放行', encodingProblem(probe(Buffer.concat([REQ, BODY_CN]))) === null)
check('有 BOM + 中文 ⇒ 放行', encodingProblem(probe(Buffer.concat([BOM, BODY_CN]))) === null)
check('纯 ASCII ⇒ 放行', encodingProblem(probe(BODY_ASCII)) === null)
check('非 ASCII 字节（GBK 解不成汉字）也算可能中文', encodingProblem(probe(Buffer.from([0x23, 0x20, 0xc4, 0xe3, 0x0a])))?.code === 'no-bom-no-requires')

// 2) 批量审计
const probs = auditEntries([probe(BODY_CN), probe(Buffer.concat([BOM, BODY_CN])), probe(Buffer.concat([REQ, BODY_CN]))])
check('批量审计只报一份', probs.length === 1 && probs[0].code === 'no-bom-no-requires', JSON.stringify(probs))

// 3) 仓库不变式：scripts 下含中文/非 ASCII 的 .ps1，要么 BOM，要么 #requires 7
const names = readdirSync(SCRIPTS).filter((n) => n.toLowerCase().endsWith('.ps1'))
let offenders = []
for (const name of names) {
  const bytes = readFileSync(join(SCRIPTS, name))
  const bom = hasBom(bytes)
  const text = bytes.slice(bom ? 3 : 0).toString('utf8')
  const nonAscii = bytes.some((b) => b > 0x7f)
  if (!nonAscii && !hasCjk(text)) continue
  if (bom || hasRequires7(text)) continue
  offenders.push(name)
}
check('scripts\\*.ps1 都有交代（BOM 或 #requires）', offenders.length === 0, offenders.join(', '))
check('fish.ps1 带 BOM', hasBom(readFileSync(join(SCRIPTS, 'fish.ps1'))))
const fishText = readFileSync(join(SCRIPTS, 'fish.ps1')).slice(3).toString('utf8')
check('fish.ps1 第 2 行关于 BOM 的注释不再说谎', /UTF-8 BOM/.test(fishText.split(/\r?\n/).slice(0, 4).join('\n')) && hasBom(readFileSync(join(SCRIPTS, 'fish.ps1'))))

if (failures.length) {
  console.log(`✗ 不合 ${failures.length} 格`)
  for (const f of failures) console.log(`  - ${f}`)
  console.log(`\n合计 ${pass + failures.length}，PASS ${pass}，FAIL ${failures.length}`)
  process.exit(1)
}
console.log(`✓ 全部 ${pass} 格通过（扫描 ${names.length} 个 .ps1）`)
