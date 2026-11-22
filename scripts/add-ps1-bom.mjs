#!/usr/bin/env node
/**
 * 给 scripts\ 下缺 UTF-8 BOM 的 .ps1 补 BOM（fi-0009，r405）。
 * 只补 BOM、不动内容与行尾；已经有 BOM 的跳过；已经是 ASCII 的也跳过（不需要）。
 * 用法：node scripts\add-ps1-bom.mjs [--dir <目录>] [--dry-run]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hasBom } from './lib/ps1-encoding-core.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const dir = process.argv.includes('--dir') ? process.argv[process.argv.indexOf('--dir') + 1] : join(REPO, 'scripts')
const dryRun = process.argv.includes('--dry-run')

const files = readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.ps1')).sort()
let added = 0
for (const name of files) {
  const p = join(dir, name)
  const bytes = readFileSync(p)
  if (hasBom(bytes)) continue
  const hasNonAscii = bytes.some((b) => b > 0x7f)
  if (!hasNonAscii) continue
  if (dryRun) {
    console.log(`would add BOM: ${name}`)
    continue
  }
  writeFileSync(p, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]))
  console.log(`✓ 补了 BOM：${name}`)
  added++
}
if (!dryRun) console.log(`\n共补 ${added} 个（dir=${dir}）`)
