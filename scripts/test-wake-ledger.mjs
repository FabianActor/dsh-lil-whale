#!/usr/bin/env node
// 账本形状检查（2026-11-17，第一条鱼 #911 指出两处）：
//  ① trigger=self 的 woke 行要和其它触发同形状（wid / lag / inserted 都有）；
//  ② 一次没投出去的计划尝试不能无限期冒充 woke（僵尸 wid、lag 越涨越大、inserted 恒 0）。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, 'plugin/dsh-lil-whale-group/lib/index.js'), 'utf8')

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
// 结构判据：所有 `watchmanLog('woke'` 行都必须带 `to=`（2026-11-17 第二条鱼按结构数出 3 处、2 处缺）
for (const [i, line] of src.split('\n').entries()) {
  if (line.includes("watchmanLog('woke'") && !line.includes('to=')) {
    console.log('FAIL 第 ' + (i + 1) + ' 行的 woke 行没有 to=')
    bad++
  }
}
for (const [name, re] of must) if (!re.test(src)) { console.log('FAIL 缺少：' + name); bad++ }
for (const [name, re] of forbidden) if (re.test(src)) { console.log('FAIL 仍存在：' + name); bad++ }
if (bad > 0) { console.log('FAIL×' + bad + ' —— 账本形状检查没过'); process.exit(1) }
console.log('OK —— self 触发的账与他人触发同形状；过期的尝试不再冒充 woke')
