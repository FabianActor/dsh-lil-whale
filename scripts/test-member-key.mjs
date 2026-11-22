#!/usr/bin/env node
/**
 * fi-0010 / r404：名册 map 的每个值都必须带自己的 key。
 *
 * 为什么值得测：`to=${member.key}` 写在日志拼行里，key 缺失时不会抛错——它写出
 * `to=undefined`，于是"谁被跳过了"这 900 行事件全部查不到。错的输出与对的输出
 * 长得一样（都是一行 skip），只有 test 能提前拦住。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { membersWithKeys } from '../plugin/dsh-lil-whale-group/lib/members-core.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const INDEX = join(HERE, '..', 'plugin', 'dsh-lil-whale-group', 'lib', 'index.js')

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) pass++
  else failures.push(`${name}${detail ? `：${detail}` : ''}`)
}

// 1) 基本行为
const roster = { whale: { kind: 'fish', home: 'D:\\pond\\homes\\whale' }, fabian: { kind: 'human' } }
const keyed = membersWithKeys(roster)
check('每个值都带 key', keyed.whale.key === 'whale' && keyed.fabian.key === 'fabian')
check('不丢原字段', keyed.whale.home === 'D:\\pond\\homes\\whale' && keyed.whale.kind === 'fish')
check('不修改入参', roster.whale.key === undefined)
check('返回新对象', keyed !== roster && keyed.whale !== roster.whale)
check('值里原本的 key 被覆盖成 map 的键', membersWithKeys({ a: { key: 'wrong' } }).a.key === 'a')
check('空 / null 返回空对象', Object.keys(membersWithKeys(null)).length === 0 && Object.keys(membersWithKeys(undefined)).length === 0)
check('非对象值原样保留', membersWithKeys({ x: 3 }).x === 3)

// 2) 源码层：buildMembers 出来以前必须经过 membersWithKeys，且 selfPlanTick 不能再手工补 key
const src = readFileSync(INDEX, 'utf8')
check('index.js 引了 membersWithKeys', src.includes("import { membersWithKeys } from './members-core.js'"))
check('兜底分支也过 membersWithKeys', /return membersWithKeys\(out\)\s*\n\s*\}\s*\n\s*try \{/.test(src))
check('最终返回也过 membersWithKeys', /return membersWithKeys\(out\)\s*\n\s*\}\s*\n[\s\S]{0,120}const MEMBERS = buildMembers\(\)/.test(src))
check('selfPlanTick 里不再手工补 key', !src.includes('{ ...MEMBERS[self], key: self }'))
check('MEMBERS[self] 仍被使用（没被误删）', src.includes('const member = MEMBERS[self]'))

if (failures.length) {
  console.log(`✗ 不合 ${failures.length} 格`)
  for (const f of failures) console.log(`  - ${f}`)
  console.log(`\n合计 ${pass + failures.length}，PASS ${pass}，FAIL ${failures.length}`)
  process.exit(1)
}
console.log(`✓ 全部 ${pass} 格通过`)
