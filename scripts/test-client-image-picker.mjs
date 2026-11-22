#!/usr/bin/env node
// 群面板「发图按钮」的静态回归检查。
//
// 2026-11-20 他报：点「发图」能选文件、但图不进输入框；拖入正常。
// 根因是 FileList 是活的引用——先 `event.target.value = ''` 再读 `files`，
// 读到的是空列表。这里钉死两件事：两处 file input 都先复制成数组再清 value；
// 且复制发生在清空之前。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FILE = join(HERE, '..', 'plugin', 'dsh-lil-whale-group-ui', 'lib', 'client.js')
const src = readFileSync(FILE, 'utf8')

let total = 0
let pass = 0
function ok(name, cond) {
  total += 1
  if (cond) { pass += 1; return }
  console.log(`xx ${name}`)
}

// 1. 不许再有"直接拿活 FileList"的写法（`const files = event.target.files` 不带 Array.from）
ok('没有直接引用活 FileList 的写法', !/const files = event\.target\.files\s*$/m.test(src))

// 2. 两处 input（群聊、私聊）都先快照再清空
const snaps = [...src.matchAll(/Array\.from\(event\.target\.files \?\? \[\]\)/g)]
ok('两处 file input 都先摘成数组', snaps.length === 2)

// 3. 每处都在清 value 之前复制，清空之后才交给 attachImages
let ordered = snaps.length === 2
for (const m of snaps) {
  const after = src.slice(m.index, m.index + 320)
  const iCopy = after.indexOf('Array.from(event.target.files')
  const iClear = after.indexOf("event.target.value = ''")
  const iAttach = after.indexOf('void attachImages(files)')
  if (!(iCopy >= 0 && iClear > iCopy && iAttach > iClear)) ordered = false
}
ok('先复制 → 再清空 → 再交给 attachImages', ordered)

// 4. 评论区留了原因（防止以后有人把顺序改回去，还看不出为什么）
ok('注释写明 FileList 是活的', src.includes('FileList 是活的'))

// 5. 构建标记：人刷新后靠它确认拿到的是这一版
ok('client build v60 · legacy-derived', src.includes('client build v60 · legacy-derived'))

console.log(`test-client-image-picker：合计 ${total}，PASS ${pass}，FAIL ${total - pass}`)
process.exit(pass === total ? 0 : 1)
