#!/usr/bin/env node
// 群面板「贴底跟随」与「回到历史未读」的静态接线检查。
//
// 为什么是静态检查：这两个 bug 都在浏览器里，没有 jsdom 可跑；
// 能验的是"东西还在不在"——ResizeObserver 是否挂在内容列上、
// 贴底时是否仍会补到底、提示是否被 atBottom 挡住。
// 真效果要人刷新面板看：贴底来一条长消息、清红点后来一条新消息。
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

// 1. 贴底时盯内容高度：新消息比视口还高，撑开发生在首帧之后
ok('用 ResizeObserver 盯内容列', src.includes('new ResizeObserver') && src.includes('observer.observe(el.firstElementChild || el)'))
ok('高度增长时补到底（内容变高 + 人没动）', src.includes('const grew = height > lastHeightRef.current') && src.includes('if (atBottomRef.current && grew && movedDown)'))
ok('stickToBottom 记下高度，供下一次比较', /lastHeightRef\.current = el\.scrollHeight/.test(src))
ok('deps 变化后仍补三次（0 / 200ms / 800ms）', src.includes('setTimeout(stickToBottom, 200)') && src.includes('setTimeout(stickToBottom, 800)'))

// 2. 「回到历史未读」不能在贴底时亮
ok('measureHistory 受 atBottom 约束', src.includes('lineAbove && !historyVisitedRef.current && !atBottomRef.current'))
ok('回到贴底时收起提示并记成「来过」', /if \(!atBottom\) return\s*\n\s*historyVisitedRef\.current = true\s*\n\s*if \(historyAboveRef\.current\) \{ historyAboveRef\.current = false; setHistoryAbove\(false\) \}/.test(src))
ok('markRead 后重量分割线', /historyVisitedRef\.current = false[\s\S]{0,240}measureHistory\(\)/.test(src))

// 3. 构建标记（人刷新后靠它确认拿到的是这一版）
// 期望跟着实现走：r328 把标记从 v51/follow-tail-long 换成 v52/line-cite（气泡行号），
// 行为没变，变的只是这个字符串——所以这里同步改，不算回归（§27 期望变）。
ok('client build v55', src.includes('client build v56 · update-source-github'))

console.log(`test-client-follow-tail：合计 ${total}，PASS ${pass}，FAIL ${total - pass}`)
process.exit(pass === total ? 0 : 1)
