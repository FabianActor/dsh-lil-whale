// 私聊可读投影的标题顺序与重建差异归类（2026-11-24，r460）
//
// 起因：`sayPrivate` 写标题时按 key 排序，`saySystemToDm` 不排序，
// 于是同一对人会被两处写成两种顺序；重建脚本按文件名（也是排序）比，
// 每次差一行，`--write` 就永远卡在「说不清的差异」上，投影停在旧的一版。
//
// 判据：同一份文件里，写标题的地方只能有一种顺序；重建脚本遇到「同一对人人换了顺序」
// 要认出来，而不是把它算成说不清的差异。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const SELF = fileURLToPath(import.meta.url)
const REPO = resolve(dirname(SELF), '..')
const read = (rel) => readFileSync(resolve(REPO, rel), 'utf8')

const plugin = read('plugin/dsh-lil-whale-group/lib/index.js')
const rebuild = read('scripts/rebuild-group-md.mjs')

let pass = 0
let fail = 0
function ok(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`PASS ${name}`) }
  else { fail += 1; console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

// 1. 两处写私聊标题都先排序
ok('sayPrivate 先排序再写标题', /const \[x, y\] = \[from, to\]\.sort\(\)/.test(plugin))
ok('saySystemToDm 先排序再写标题', /const \[hx, hy\] = \[member, human\]\.sort\(\)/.test(plugin))
ok('saySystemToDm 用排序后的两个键写标题',
  /# 私聊 · \$\{labelOf\(hx\)\} \/ \$\{labelOf\(hy\)\}/.test(plugin))
ok('没有残留「按传入顺序」的私聊标题写法',
  !/# 私聊 · \$\{labelOf\(member\)\} \/ \$\{labelOf\(human\)\}/.test(plugin))

// 2. 重建脚本认得「只是换了顺序」
ok('重建脚本有标题换序的归类', /只是标题里两个人的顺序不同/.test(rebuild))
ok('换序归类在同一个 continue 分支里', /m\[1\] === n\[2\] && m\[2\] === n\[1\][\s\S]{0,200}continue/.test(rebuild))

console.log(`test-dm-projection：合计 ${pass + fail}，PASS ${pass}，FAIL ${fail}`)
if (fail > 0) process.exitCode = 1