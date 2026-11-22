#!/usr/bin/env node
/**
 * PS1 编码体检（fi-0009，r405）。规矩与理由见 `scripts/lib/ps1-encoding-core.mjs` 头注释：
 * 含中文的 .ps1 要么带 UTF-8 BOM，要么带 `#requires -Version 7.x`；两样都没有就报。
 *
 * 用法：
 *   node scripts/audit-ps1-encoding.mjs            扫 scripts\
 *   node scripts/audit-ps1-encoding.mjs --dir <dir>
 *   node scripts/audit-ps1-encoding.mjs --json
 *
 * 退出码：0 全部合格 / 1 有不合格 / 2 前提错（目录不在/参数不认识）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditEntries, hasBom } from './lib/ps1-encoding-core.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

function argOf(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : ''
}

const json = process.argv.includes('--json')
const unknown = process.argv.slice(2).find((a) => a.startsWith('-') && !['--dir', '--json'].includes(a))
if (unknown) {
  console.log(`不认识的参数：${unknown}\n用法：node scripts/audit-ps1-encoding.mjs [--dir <目录>] [--json]`)
  process.exit(2)
}
const dir = argOf('dir') || join(REPO, 'scripts')
let files = []
try {
  if (!statSync(dir).isDirectory()) throw new Error('不是目录')
  files = readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.ps1')).sort()
} catch (error) {
  console.log(`xx 目录读不到：${dir}（${error.message}）`)
  process.exit(2)
}
if (files.length === 0) {
  console.log(`xx 目录里一个 .ps1 都没有：${dir}（空目录不能当"全部合格"）`)
  process.exit(2)
}
const entries = files.map((name) => {
  const bytes = readFileSync(join(dir, name))
  // 去掉 BOM 再按 UTF-8 解；文件若是 GBK，这里会读成替换符，但"含中文"的判断用的是字节，
  // 所以再补一次按 latin1 的粗判（只要出现非 ASCII 就当作"可能含中文"）。
  const text = bytes.slice(hasBom(bytes) ? 3 : 0).toString('utf8')
  return { file: name, bytes, text, hasNonAscii: bytes.some((b) => b > 0x7f) }
})
const problems = auditEntries(entries)
if (json) {
  console.log(JSON.stringify({ dir, files: files.length, problems: problems.map((p) => ({ file: p.file, code: p.code, why: p.why })) }, null, 2))
} else {
  for (const e of entries) {
    const p = problems.find((x) => x.file === e.file)
    console.log(p ? `✗ ${e.file}：${p.why}` : `✓ ${e.file}`)
  }
  console.log(`\n[ps1 编码 · dir=${dir} · 脚本 ${files.length} / 不合格 ${problems.length} · exit=${problems.length ? 1 : 0}]`)
}
process.exit(problems.length ? 1 : 0)
