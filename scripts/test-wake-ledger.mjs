#!/usr/bin/env node
// 账本形状检查（2026-11-17）：
//  ① trigger=self 的 woke 行要和其它触发同形状（wid / lag / inserted 都有）；
//  ② 一次没投出去的计划尝试不能无限期冒充 woke（僵尸 wid、lag 越涨越大、inserted 恒 0）；
//  ③ 任何一处 `woke` 写点都必须带 to=（r227 起改成按「调用」扫，不再按行扫）。
//
// 按行扫的教训（三条鱼 2026-11-17 09:0x 一起指出）：`watchmanLog(` 与 `'woke'`
// 跨行写时，逐行检查一条也看不见；错误跨行，检查器就得跨行。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcArg = process.argv.indexOf('--src')
const srcPath = srcArg === -1
  ? join(root, 'plugin/dsh-lil-whale-group/lib/index.js')
  : resolve(process.argv[srcArg + 1] ?? '')
const src = readFileSync(srcPath, 'utf8')

// 按「调用」扫：从每个 `watchmanLog(` 起，到下一个 `watchmanLog(` 之前，
// 这一段里只要出现 `'woke'`，就必须同时出现 `to=`。
// 不依赖换行，所以跨行写法也在视野里。
function wokeCallsWithoutTo(text) {
  const marker = 'watchmanLog('
  const hits = []
  let i = -1
  while ((i = text.indexOf(marker, i + 1)) !== -1) {
    const rest = text.slice(i)
    const nextCall = rest.indexOf(marker, marker.length)
    const call = nextCall === -1 ? rest : rest.slice(0, nextCall)
    if (!call.includes("'woke'")) continue
    if (!call.includes('to=')) hits.push(i)
  }
  return hits
}

const lineOf = (text, idx) => text.slice(0, idx).split('\n').length

const must = [
  ['self 的 woke 行带 lag', /trigger=self lag/],
  ['self 的 woke 行带 inserted=1', /trigger=self lag[^\n]*inserted=1/],
  ['self 的 woke 行带 to= 与 plan=', /inserted=1 to=\$\{[^}]+\} plan=/],
  ['缺席的 wid 不写替身（missing=wid）', /missing=wid/],
  ['回放/外部 wake 的 woke 行带 to=', /inserted=\$\{pending \? 1 : 0\} to=\$\{member\.key\}/],
  ['计划投递的 woke 行带 to=', /trigger=plan lag[^\n]*inserted=1 to=\$\{member\.key\}/],
  ['计划时刻统一用 planDueMs()', /function planDueMs\(at\) \{/],
  ['一次尝试有有效期常量', /const WAKE_ATTEMPT_TTL_SEC = 30 \* 60/],
  ['只认有效期内的尝试', /ageSec <= WAKE_ATTEMPT_TTL_SEC/],
  ['认领过后清掉 lastTry', /st\.lastTry = null/],
  ['过期的尝试退成 note', /note=session-mounted member=\$\{member\.key\}[^\n]*try-age=\$\{ageSec\}s/],
  ['intent 的 woke 行带 to=', /trigger=intent lag[^\n]*inserted=1 to=\$\{member\.key\}/],
  ['推门成功的 woke 行带 to=', /night=\$\{night\} to=\$\{member\.key\} \$\{job\.tag\}/],
  ['推门失败的 woke 行带 to=', /reason=\$\{res\.detail\} to=\$\{member\.key\} \$\{job\.tag\}/],
]
const forbidden = [
  ['旧的 self 行（没有 wid/lag/inserted）', /trigger=self to=\$\{self\}/],
  ['旧的 dueAt 内联 IIFE', /const dueAt = \(\(\) => \{/],
  ['wid 用 none 当缺席替身', /\?\? 'none'/],
]

let bad = 0

// 断言自检：负样本要配"最难看见的那一类"（第三条鱼语）——
// 单行能抓到不算本事，跨行也抓到才算；顺便确认好样本不被误报。
const samples = [
  ['单行、缺 to=', "watchmanLog('woke', `wid=x inserted=1`)", 1],
  ['跨行、缺 to=', "watchmanLog(\n  'woke',\n  `wid=x inserted=1`,\n)", 1],
  ['单行、有 to=', "watchmanLog('woke', `wid=x inserted=1 to=whale`)", 0],
  ['跨行、有 to=', "watchmanLog(\n  'woke',\n  `wid=x inserted=1 to=whale`,\n)", 0],
]
for (const [name, sample, want] of samples) {
  const got = wokeCallsWithoutTo(sample).length
  if (got !== want) { console.log('FAIL 自检：' + name + ' 期望 ' + want + ' 处，得到 ' + got); bad++ }
}

// 真实代码：每个 woke 写点都得带 to=
for (const idx of wokeCallsWithoutTo(src)) {
  console.log('FAIL 第 ' + lineOf(src, idx) + ' 行的 woke 调用没有 to=')
  bad++
}

for (const [name, re] of must) if (!re.test(src)) { console.log('FAIL 缺少：' + name); bad++ }
for (const [name, re] of forbidden) if (re.test(src)) { console.log('FAIL 仍存在：' + name); bad++ }
if (bad > 0) { console.log('FAIL×' + bad + ' —— 账本形状检查没过'); process.exit(1) }
console.log('OK —— 所有 woke 写点都带 to=（单行与跨行都扫）；过期的尝试不再冒充 woke；断言自检通过（含跨行负样本）')
