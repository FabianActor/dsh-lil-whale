#!/usr/bin/env node
/**
 * fi-0008 / r403 的行为测试：共享账只留码，正文留给 intent.log。
 *
 * 四类断言：
 *   1) watchman skip 行不含正文（长句、带空格、带数字都不出现）
 *   2) watchman 行有 to= / code= / see=intent.log
 *   3) 被去重压制时是 code=note-suppressed count=N，且仍不带正文
 *   4) intent.log 的正文是完整一句（只压空白，不 slice 到 120）
 */
import { noteCodeOf, intentNoteTextOf, watchmanSkipLineOf } from '../plugin/dsh-lil-whale-group/lib/note-core.js'

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) pass++
  else failures.push(`${name}${detail ? `：${detail}` : ''}`)
}

const LONG = 'plan-expired id=morning-read until=2026-11-20 这一句后面还有很长的一段解释，长到超过一百二十个字符，用来证明共享账里不会出现它，也不会出现被切掉一半的残句，否则两本账各留一份残句，读的人还是得去别处找全文。'
const long = LONG.replace(/\s+/g, ' ')

// 1) 机器码
check('plan-expired → plan-expired', noteCodeOf('plan-expired id=morning-read until=2026-11-20') === 'plan-expired')
check('note=intent-path-rejected → intent-path-rejected', noteCodeOf('note=intent-path-rejected id=p7') === 'intent-path-rejected')
check('deny=sleep → sleep', noteCodeOf('deny=sleep intent=p1（条件成立了）') === 'sleep')
check('中文括注截断', noteCodeOf('plan-bad-shape（要一个数组，或 {items:[...]}）') === 'plan-bad-shape')
check('空正文 → empty', noteCodeOf('   ') === 'empty')

// 2) watchman 行不含正文
const normal = watchmanSkipLineOf('whale', { code: noteCodeOf(long) })
check('正常行有 to=', normal.startsWith('to=whale '), normal)
check('正常行有 code=', normal.includes('code=plan-expired'), normal)
check('正常行有 see=intent.log', normal.includes('see=intent.log'), normal)
check('正常行不含正文关键字', !normal.includes('这一句后面还有很长'), normal)
check('正常行不含 id= 正文', !normal.includes('id=morning-read'), normal)

// 3) 压制行
const suppressed = watchmanSkipLineOf('whale', { suppressed: 3 })
check('压制行有 count', suppressed.includes('code=note-suppressed count=3'), suppressed)
check('压制行不含正文', !suppressed.includes('这一句后面还有很长'), suppressed)

// 4) intent.log 完整一句
const intent = intentNoteTextOf(long)
check('intent 是完整一句（长度 > 120）', intent.length > 120, `len=${intent.length}`)
check('intent 不含被 slice 的痕迹（以尾部句号结束）', intent.endsWith('找全文。'), intent.slice(-20))
check('intent 压掉换行', !/[\r\n]/.test(intentNoteTextOf('a\nb')))
const intentSuppressed = intentNoteTextOf(long, { suppressed: 2 })
check('压制时 intent 仍带完整正文', intentSuppressed.includes('count=2') && intentSuppressed.length > 140, `len=${intentSuppressed.length}`)

if (failures.length) {
  console.log(`✗ 不合 ${failures.length} 格`)
  for (const f of failures) console.log(`  - ${f}`)
  console.log(`\n合计 ${pass + failures.length}，PASS ${pass}，FAIL ${failures.length}`)
  process.exit(1)
}
console.log(`✓ 全部 ${pass} 格通过`)
