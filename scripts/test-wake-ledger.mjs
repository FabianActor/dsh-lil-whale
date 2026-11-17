#!/usr/bin/env node
// 账本形状检查（2026-11-17，第一条鱼 #911 指出两处，第三条鱼 r225 后追问"断言配负样本了吗"）：
//  ① trigger=self 的 woke 行要和其它触发同形状（wid / lag / inserted 都有）；
//  ② 一次没投出去的计划尝试不能无限期冒充 woke（僵尸 wid、lag 越涨越大、inserted 恒 0）；
//  ③ 任何一处 `watchmanLog('woke'` 行都必须带 to=（r225；结构断言自身也在这里做负样本自检）。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcArg = process.argv.indexOf('--src')
const srcPath = srcArg === -1
  ? join(root, 'plugin/dsh-lil-whale-group/lib/index.js')
  : resolve(process.argv[srcArg + 1] ?? '')
const src = readFileSync(srcPath, 'utf8')

// 结构性判据：逐行找 `watchmanLog('woke'` 且不带 `to=` 的行。
// 注：多行写法（`watchmanLog(` 与 `'woke'` 不在同一行）由下面的 must 断言单独盯。
function wokeLinesWithoutTo(text) {
  const hits = []
  for (const [i, line] of text.split('\n').entries()) {
    if (line.includes("watchmanLog('woke'") && !line.includes('to=')) hits.push(i + 1)
  }
  return hits
}

const must = [
  ['self 的 woke 行带 lag', /trigger=self lag/],
  ['self 的 woke 行带 inserted=1', /trigger=self lag[^\n]*inserted=1/],
  ['self 的 woke 行带 to= 与 plan=', /inserted=1 to=\$\{self\} plan=\$\{item\.id\}/],
  ['计划时刻统一用 planDueMs()', /function planDueMs\(at\) \{/],
  ['一次尝试有有效期常量', /const WAKE_ATTEMPT_TTL_SEC = 30 \* 60/],
  ['只认有效期内的尝试', /ageSec <= WAKE_ATTEMPT_TTL_SEC/],
  ['认领过后清掉 lastTry', /st\.lastTry = null/],
  ['过期的尝试退成 note', /note=session-mounted member=\$\{member\.key\} wid=/],
  ['intent 的 woke 行带 to=', /trigger=intent lag[^\n]*inserted=1 to=\$\{member\.key\}/],
  ['推门成功的 woke 行带 to=', /night=\$\{night\} to=\$\{member\.key\} \$\{job\.tag\}/],
  ['推门失败的 woke 行带 to=', /reason=\$\{res\.detail\} to=\$\{member\.key\} \$\{job\.tag\}/],
]
const forbidden = [
  ['旧的 self 行（没有 wid/lag/inserted）', /trigger=self to=\$\{self\}/],
  ['旧的 dueAt 内联 IIFE', /const dueAt = \(\(\) => \{/],
]

let bad = 0

// 断言自身的负样本：先证明"抓到坏样本"和"放行好样本"这两件事都成立，
// 否则检查器只是在打印一句漂亮的 OK。
const selftestBad = "watchmanLog('woke', `wid=x trigger=self lag=0s inserted=1`)"
const selftestGood = "watchmanLog('woke', `wid=x trigger=self lag=0s inserted=1 to=whale`)"
if (wokeLinesWithoutTo(selftestBad).length !== 1) { console.log('FAIL 断言自身失效：坏样本没被抓到'); bad++ }
if (wokeLinesWithoutTo(selftestGood).length !== 0) { console.log('FAIL 断言自身失效：好样本被误报'); bad++ }

// 真实代码的结构判据
for (const line of wokeLinesWithoutTo(src)) {
  console.log('FAIL 第 ' + line + ' 行的 woke 行没有 to=')
  bad++
}

for (const [name, re] of must) if (!re.test(src)) { console.log('FAIL 缺少：' + name); bad++ }
for (const [name, re] of forbidden) if (re.test(src)) { console.log('FAIL 仍存在：' + name); bad++ }
if (bad > 0) { console.log('FAIL×' + bad + ' —— 账本形状检查没过'); process.exit(1) }
console.log('OK —— self 触发的账与他人触发同形状；过期的尝试不再冒充 woke；结构断言自检通过')
