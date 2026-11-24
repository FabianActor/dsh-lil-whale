#!/usr/bin/env node
// 群面板「未读红点」的三条保证（2026-11-19 Fabian 报：群聊读完、切到别的页再切回来，红点又出现）。
//
// 为什么是静态检查：红点真假要浏览器 + 服务端账本一起看，这里没有 jsdom；
// 能验的是"该有的接线在不在"——计数有没有被藏、离开前有没有补记、读失败有没有重试。
// 真效果要人刷新面板看：读完停一秒、切到鱼塘页再切回来，计数不该再冒出来。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const UI = join(HERE, '..', 'plugin', 'dsh-lil-whale-group-ui', 'lib')
const CLIENT = readFileSync(join(UI, 'client.js'), 'utf8')
const HOST = readFileSync(join(UI, 'index.js'), 'utf8')

let total = 0
let pass = 0
function ok(name, cond, detail) {
  total += 1
  if (cond) { pass += 1; return }
  console.log(`xx ${name}${detail ? `：${detail}` : ''}`)
}

// 1. 「清了」必须等于服务端真记上了，不能靠"当前正好在群聊页"把数藏起来。
ok(
  'tab 计数不再因「在群聊且贴底」隐藏',
  !CLIENT.includes("!(tab === 'group' && atBottom)") &&
    CLIENT.includes("unread.group > 0 ? item.label + ' (' + unread.group + ')' : item.label"),
  '还留着假清的写法',
)

// 2. markRead 要认 response.ok：403/500 不能当"读过了"。
ok('markRead 返回 response.ok', CLIENT.includes('return response.ok'))
ok('markRead 失败返回 false', /catch \{\s*\n\s*\/\/ 清不掉就继续亮着，比假装看过好\s*\n\s*return false/.test(CLIENT))

// 3. 切走/卸载时要把待发的读先记上（以前被 clearTimeout 吞掉，1.5 秒内切走就永远不记）。
ok(
  '离开前补记一次 markRead',
  /return \(\) => \{[\s\S]{0,400}?groupReadTimerRef\.current = null\s*\n\s*void markRead\('group'\)/.test(CLIENT),
  'effect 清理里没有 flush',
)
ok('读失败五秒后重试', CLIENT.includes('setTimeout(finishGroupRead, 5000)'))
ok('读完仍广播 dsh-group-read', CLIENT.includes("dispatchEvent(new Event('dsh-group-read'))"))

// 4. 服务端口径没被改坏：读点=最后一条 ts，未读=ts 比它新的消息。
ok('服务端读点写最后一条 ts', HOST.includes('state.group = lastTsOf(MESSAGES)'))
ok("服务端按 ts 之后计数", HOST.includes("String(message.ts ?? '') <= since"))

// 5. 构建标记（人刷新后靠它确认拿到的是这一版；期望跟着实现走，§27）。
ok('client build v67 · history-always', CLIENT.includes('client build v67 · history-always'))

console.log(`test-client-unread：合计 ${total}，PASS ${pass}，FAIL ${total - pass}`)
process.exit(pass === total ? 0 : 1)
