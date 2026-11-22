// 消息行号与引用（2026-11-18 r328）。
//
// 两半：
//   1. 纯函数：物理行号对不对（空行/半截行也要占号），投影字段有没有丢
//   2. 接线：宿主读消息时用了它、面板把行号画出来并能复制
//
// 用法：node scripts\test-message-lines.mjs

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMessageLines, projectMessage } from '../plugin/dsh-lil-whale-group-ui/lib/messages-core.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const UI = join(ROOT, 'plugin', 'dsh-lil-whale-group-ui', 'lib')

let pass = 0
let fail = 0
const failures = []
function check(label, actual, expected) {
  if (actual === expected) {
    pass += 1
    return
  }
  fail += 1
  failures.push({ label, actual, expected })
}

const rec = (over) => JSON.stringify({ ts: over.ts ?? '2026-11-18 10:00', from: over.from ?? 'lee', to: over.to ?? 'all', text: over.text ?? 'x', ...over })

// —— 1. 行号：按物理行数，空行与坏行也占号 ——
{
  const parsed = parseMessageLines([rec({ text: 'a' }), '', rec({ text: 'b' }), '{"ts":"半截', rec({ text: 'c' })].join('\n'))
  check('三条有效记录', parsed.length, 3)
  check('第一条行号 1', parsed[0].line, 1)
  check('空行之后第二条是第 3 行', parsed[1].line, 3)
  check('坏行跳过、第三条是第 5 行', parsed[2].line, 5)
  check('坏行没有混进来', parsed.some((m) => m.text === '半截'), false)
}
{
  // CRLF 与文件末尾换行：末尾空行不该多算出一条
  const parsed = parseMessageLines([rec({ text: 'a' }), rec({ text: 'b' }), ''].join('\r\n'))
  check('CRLF 两条', parsed.length, 2)
  check('CRLF 行号', parsed.map((m) => m.line).join(','), '1,2')
}
{
  // 空文件 / 只有空行
  check('空串没有记录', parseMessageLines('').length, 0)
  check('只有空行没有记录', parseMessageLines('\n\n\n').length, 0)
}

// —— 2. 投影：字段要带全，但空值不占位 ——
{
  const full = projectMessage({
    ts: 't', from: 'whale', to: 'all', text: 'hi', kind: 'say', s: 'abc123', channel: 'group', toSeat: 'seat', image: { fmt: 2 }, images: [{ fmt: 2 }],
  })
  check('保留 s', full.s, 'abc123')
  check('保留 channel', full.channel, 'group')
  check('保留 toSeat', full.toSeat, 'seat')
  check('保留 image', full.image.fmt, 2)
  check('保留 images', full.images.length, 1)

  const bare = projectMessage({ ts: 't', from: 'lee', to: 'all', text: 'x' })
  check('缺 kind 默认 say', bare.kind, 'say')
  check('空 s 不占位', 's' in bare, false)
  check('null image 不占位', 'image' in bare, false)
  check('空 images 不占位', 'images' in bare, false)
}

// —— 3. 接线：宿主用纯函数、面板画行号并可复制 ——
{
  const index = readFileSync(join(UI, 'index.js'), 'utf8')
  check('宿主 import 了 messages-core', index.includes("from './messages-core.js'"), true)
  check('宿主用 parseMessageLines 读消息', index.includes('parseMessageLines(readFileSync(file, \'utf8\'))'), true)
  check('宿主不再自己拼 ts 投影', index.includes('out.push({'), false)

  const client = readFileSync(join(UI, 'client.js'), 'utf8')
  check('群聊传引用前缀', client.includes("citePrefix: '群'"), true)
  check('私聊传 pair 前缀', client.includes('citePrefix: `私聊 ${'), true)
  check('按物理行号显示', client.includes('#${lineNo}'), true)
  check('可点击复制', client.includes('点击复制引用'), true)
  check('有复制函数', client.includes('async function copyToClipboard'), true)
  check('有复制回执', client.includes('已复制'), true)
  check('build 标记 v55', client.includes('client build v58 · mention-split'), true)
}

if (fail === 0) {
  console.log(`test-message-lines：合计 ${pass}，PASS ${pass}，FAIL 0`)
  process.exit(0)
}
console.error(`test-message-lines：合计 ${pass + fail}，PASS ${pass}，FAIL ${fail}`)
for (const f of failures) console.error(`xx ${f.label}：期望 ${JSON.stringify(f.expected)}，实际 ${JSON.stringify(f.actual)}`)
process.exit(1)
