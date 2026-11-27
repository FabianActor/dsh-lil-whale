// 工具数变化的两头：missing（少了什么）与 added（多了什么）。
//
// 这一格存在的理由：2026-11-27 23:59 那条账写着 from=69 to=67、missing=[office 三件]，
// 差 2 却少了 3 件。只记一头时，"净差"与"进出"对不上只能靠猜。
// 所以这里要能红：少 3 件、多 1 件时，两个名单都要正好是那几件，总数也不许被截断影响。
import { toolCountDiff, TOOL_COUNT_LIST_MAX } from '../plugin/dsh-lil-whale-group/lib/tool-count-core.js'

let pass = 0
const fails = []
function ok(name, cond, extra) {
  if (cond) { pass += 1; return }
  fails.push(`${name}${extra ? ' —— ' + extra : ''}`)
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// 23:59 那个现场：69 → 67，少了 office 三件（另外多了一件，名字当初没记下来）。
{
  const prev = ['a', 'b', 'office_render', 'office_convert', 'office_recalculate']
  const next = ['a', 'b', 'newcomer']
  const d = toolCountDiff(prev, next)
  ok('少了三件', eq(d.missing, ['office_render', 'office_convert', 'office_recalculate']), JSON.stringify(d.missing))
  ok('多了一件', eq(d.added, ['newcomer']), JSON.stringify(d.added))
  ok('两头总数', d.missingTotal === 3 && d.addedTotal === 1, `${d.missingTotal}/${d.addedTotal}`)
  ok('净差 = 两头之差', prev.length - next.length === d.missingTotal - d.addedTotal)
}

// 一件没变：两个名单都是空数组（读到零个 ≠ 没读到）。
{
  const d = toolCountDiff(['a', 'b'], ['b', 'a'])
  ok('没变时 missing=[]', eq(d.missing, []), JSON.stringify(d.missing))
  ok('没变时 added=[]', eq(d.added, []), JSON.stringify(d.added))
  ok('没变时总数 0', d.missingTotal === 0 && d.addedTotal === 0)
}

// 只增不减（不算缩小，但字段形状要一样）。
{
  const d = toolCountDiff(['a'], ['a', 'b'])
  ok('只增时 missing 空', eq(d.missing, []))
  ok('只增时 added 点名', eq(d.added, ['b']))
}

// 读不到旧名单：四个字段全是 null，不是空数组。
{
  const d = toolCountDiff(null, ['a'])
  ok('无旧名单 missing=null', d.missing === null && d.missingTotal === null)
  ok('无旧名单 added=null', d.added === null && d.addedTotal === null)
  const d2 = toolCountDiff(['a'], undefined)
  ok('无新名单也 null', d2.missing === null && d2.added === null)
  const d3 = toolCountDiff('a,b', ['a'])
  ok('非数组当没读到', d3.missing === null)
}

// 列表截断，但总数保留。
{
  const prev = Array.from({ length: TOOL_COUNT_LIST_MAX + 5 }, (_, i) => `old_${i}`)
  const d = toolCountDiff(prev, [])
  ok('名单截断到上限', d.missing.length === TOOL_COUNT_LIST_MAX, String(d.missing.length))
  ok('总数不被截断', d.missingTotal === prev.length, String(d.missingTotal))
}

// 重复名字：集合语义，不能因为重复多算。
{
  const d = toolCountDiff(['a', 'a', 'b'], ['a', 'b', 'b'])
  ok('重复名不算少', d.missingTotal === 0 && d.addedTotal === 0)
}

// 空数组是合法的"零个工具"。
{
  const d = toolCountDiff([], [])
  ok('空对空', d.missingTotal === 0 && d.addedTotal === 0)
}

if (fails.length) {
  console.log(`FAIL ${fails.length} 条：`)
  for (const f of fails) console.log('  - ' + f)
  process.exit(1)
}
console.log(`工具数变化两头：${pass} 条全过`)
