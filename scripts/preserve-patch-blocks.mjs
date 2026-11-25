// 命令行：node scripts/preserve-patch-blocks.mjs --before <动手前的快照> --patch <现在的 patch>
//   [--dry-run] [--json]
//
// 把 before 有、现在没有的顶层段接回 patch 尾部；打印补了哪些。
// 退出码：0 = 没缺 / 补好了；2 = 缺了但没补（--dry-run 或写回失败）。
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { preserveBlocks } from './lib/patch-preserve.mjs'

const argv = process.argv.slice(2)
const arg = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const has = (name) => argv.includes(`--${name}`)

const before = arg('before')
const patch = arg('patch')
if (!before || !patch) {
  console.error('xx 缺少参数：--before <快照> --patch <现在的 patch>')
  console.error('NEXT: node scripts\\preserve-patch-blocks.mjs --before <备份> --patch <patch>')
  process.exit(1)
}

let beforeText = ''
let patchText = ''
try {
  beforeText = readFileSync(before, 'utf8')
  patchText = readFileSync(patch, 'utf8')
} catch (e) {
  console.error('xx 读不了文件：' + e.message)
  process.exit(1)
}

const { text, restored } = preserveBlocks(beforeText, patchText)
const out = { ok: true, before, patch, restored, changed: restored.length > 0 }
if (has('dry-run')) {
  out.applied = false
} else if (restored.length > 0) {
  try {
    copyFileSync(patch, `${patch}.bak-before-restore-${Date.now()}`)
    writeFileSync(patch, text, 'utf8')
    out.applied = true
  } catch (e) {
    out.ok = false
    out.error = e.message
    out.applied = false
  }
} else {
  out.applied = false
}

if (has('json')) {
  console.log(JSON.stringify(out))
} else if (!out.ok) {
  console.error(`xx 写不回去：${out.error}`)
  console.error('NEXT: 手动看 ' + patch)
  process.exit(2)
} else if (restored.length === 0) {
  console.log('ok 没有段被丢掉')
} else if (out.applied) {
  console.log('ok 补回来了：' + restored.join(', '))
} else {
  console.log('dry-run 缺这些段：' + restored.join(', '))
  process.exit(2)
}
