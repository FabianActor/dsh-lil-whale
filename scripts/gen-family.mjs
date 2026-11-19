// gen-family.mjs -- 从数据生成谱系（pool\family.json + pool\members.json -> docs\detail\鱼塘谱系.md）。
//
// 为什么生成而不手画：手画的图第一周对、第二周开始漂，第三周没人信它。
// 这里只有两个输入：谁是爹（family.json）、现在叫什么/在不在跑（members.json）。
//
// 用法：
//   node scripts\gen-family.mjs              # 生成 docs\detail\鱼塘谱系.md
//   node scripts\gen-family.mjs --check      # 只校验，不写文件（CI / doctor 用）
//   node scripts\gen-family.mjs --seed       # 兼容 install.ps1 的旧用法：family.json 不存在时初始化（现在也是默认行为）
//
// `--check` 退出码（2026-11-18 r293 起写进纸）：0 通过；1 读到了、但它不对（父非法/父不存在/环）；
// 2 我读不了（参数不认识、名册或 family.json 读不了）。"--seed 会重建"是旧注释的误读，
// 真正决定写不写的是 family.json 在不在（install.ps1 靠这个初始化；doctor 永远只跑 --check）。

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfigOrExit } from './lib/config-path.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checkOnly = process.argv.includes('--check')
// 未知参数拒绝（`--help` 曾经真的重写 docs\detail\鱼塘谱系.md）。
const gfArgs = process.argv.slice(2)
const gfUnknown = gfArgs.filter((a) => a.startsWith('--') && !['--check', '--seed'].includes(a))
if (gfUnknown.length > 0) {
  console.error('未知参数：' + gfUnknown.join(' '))
  console.error('用法：node scripts\\gen-family.mjs [--check] [--seed]')
  process.exit(2)
}

function die(msg, next) {
  console.error('xx ' + msg)
  if (next) console.error('\nNEXT: ' + next)
  process.exit(1)
}

// 配置的三态（给了但不在 / 没给 / 都在）由 lib/config-path.mjs 一个地方判，
// 这里不再自己写"试下一个"的循环 —— 那会把"打错字"读成"没配置"，然后拿真鱼塘报绿（r242）。
const cfg = loadConfigOrExit({ repoRoot: REPO })
const poolDir = cfg.poolDir || join(REPO, '..', 'lil-whale-pool')
const membersFile = join(poolDir, 'members.json')
const familyFile = join(poolDir, 'family.json')

if (!existsSync(membersFile)) die(`名册不存在：${membersFile}`, 'node scripts\\migrate-members.mjs')

const members = JSON.parse(readFileSync(membersFile, 'utf8')).members || {}

let family
if (existsSync(familyFile)) {
  try { family = JSON.parse(readFileSync(familyFile, 'utf8')) } catch (e) { die(`family.json 不是合法 JSON（${e.message}）`, '从备份恢复；这份是谱系的真源') }
} else {
  family = { version: 1, updatedAt: new Date().toISOString(), nodes: {} }
  for (const [key, m] of Object.entries(members)) {
    family.nodes[key] = {
      name: m.name || key,
      parent: m.parent ?? null,
      bornAt: m.bornAt ?? null,
      lifecycle: lifecycleOf(m, key),
      note: '',
      renames: [],
    }
  }
  writeFileSync(familyFile, JSON.stringify(family, null, 2) + '\n', 'utf8')
  console.log(`✓ 用名册初始化了 ${familyFile}`)
}

// 名册里新出现的成员，谱系里补一条（不加就画不出来）
let added = 0
for (const [key, m] of Object.entries(members)) {
  if (!family.nodes[key]) {
    family.nodes[key] = { name: m.name || key, parent: m.parent ?? null, bornAt: m.bornAt ?? null, lifecycle: lifecycleOf(m, key), note: '', renames: [] }
    added++
  }
}
if (added) console.log(`✓ 谱系补了 ${added} 个节点`)

// ---------- 校验 ----------
// 小鱼丸 #1709/#1710、小满 #1711–#1713（2026-11-18）：旧写法 `node.parent && !family.nodes[node.parent]`
// 用 truthiness 判父——`0` / `false` / `''` 全是 falsy ⇒ 校验直接跳过，然后 :93 又把它们当根，
// 于是"父写坏 + 键都在"两边都绿，文档还把 0 印成"没有父"。值域只有一个拼法：
//   null（根）或一个存在的字符串键。其它（含 ''、数字、布尔、对象）一律 [garbage-parent] 报出来。
const errors = []
const parentProblem = (p) => {
  if (p === null || p === undefined) return null
  if (typeof p !== 'string') return `[garbage-parent] 只允许 null 或一个存在的成员键，实际是 ${JSON.stringify(p)}`
  if (p === '') return '[garbage-parent] 空字符串不是"没有父"的写法（没有父写 null）'
  // 小鱼丸 #1748（2026-11-18）：`none` 是 `fish.ps1 new -Parent none` / `members-add --parent none`
  // 的写法，但落到 `family.json` 里必须写 `null`。手抄时会原样带进来——单独给一句锚，
  // 别让它混进"找不到这个人"，否则读的人会去找一个叫 none 的成员。
  if (p === 'none') return '[garbage-parent] "none" 是新建时的写法，落到 family.json 里要写 null'
  if (!family.nodes[p]) return `parent=${p} 不存在`
  return null
}
for (const [key, node] of Object.entries(family.nodes)) {
  const why = parentProblem(node.parent)
  if (why) errors.push(`${key} ${why}`)
  if (node.parent === key) errors.push(`${key} 自己是自己的爹`)
}
// 环检测
const state = {}
function walk(key, path) {
  if (state[key] === 'done') return
  if (state[key] === 'walking') { errors.push('谱系里有一个环：' + [...path, key].join(' -> ')); return }
  state[key] = 'walking'
  const p = family.nodes[key]?.parent
  // 2026-11-18 r295（小鱼丸 #1742）：坏父也会被 walk 一趟，用 null/undefined 判断，不让 0 和空串从 truthiness 底下漏过去。
  if (p !== null && p !== undefined) walk(p, [...path, key])
  state[key] = 'done'
}
for (const key of Object.keys(family.nodes)) walk(key, [])
// 根：可以不止一个。人类和鱼各是一棵树；从别处迁进来的鱼（fish.ps1 new -Parent none）
// 也可以是另一个根 —— 2026-11-17 r240 起不再要求"鱼必须恰好一个根"，
// 之前那条规则会把根鱼挡在谱系外，family.json 停在旧日期而没人知道。
// 2026-11-18 r295（小鱼丸 #1742）：根按形状算——0 和空串不是根，是坏值；
const roots = Object.entries(family.nodes)
  .filter(([, n]) => n.parent === null || n.parent === undefined)
  .map(([k]) => k)
const fishRoots = roots.filter((k) => (members[k] || {}).kind !== 'human')

// 2026-11-19 r385（小鱼丸 / 小满 2026-11-19 群 #1675–#1692 讨论定稿）：根是派生值，落盘要带
// 「值 / 排序规则 / 写入时刻」三样——否则每个读的人都得同时读 members.json 自己重算，
// 只看 family.json 会把 human 的根也算进来（曾经数出 3 个根）。
const rootsSorted = [...fishRoots].sort()
const rootsOrder = 'key'
{
  let storedRoots = null
  if (existsSync(familyFile)) {
    try {
      const prev = JSON.parse(readFileSync(familyFile, 'utf8'))
      if (Array.isArray(prev.roots)) storedRoots = prev.roots
    } catch {
      /* family.json 坏了上面已经 die 过，这里只兜一次 */
    }
  }
  const sameRoots = storedRoots !== null && JSON.stringify([...storedRoots].map(String).sort()) === JSON.stringify(rootsSorted)
  family.roots = rootsSorted
  family.rootsOrder = rootsOrder
  // 只有值真的变了（或第一次写）才换时刻：在日子上"没变"的账不能每次重写。
  if (!sameRoots || typeof family.rootsAt !== 'string') family.rootsAt = new Date().toISOString()
}
if (fishRoots.length < 1) errors.push('谱系里一条鱼都没有')

if (errors.length) {
  for (const e of errors) console.error('xx ' + e)
  die('谱系数据有问题，没有生成图', '修 pool\\family.json（它是谱系真源），再跑一次')
}
// 结论行放在校验之后：坏数据下不再打印根清单（小鱼丸 #1742 的"两个结论打架"）。
if (fishRoots.length > 1) console.log(`· 鱼有 ${fishRoots.length} 个根（并列）：${fishRoots.join(', ')}`)

// ---------- 生成 ----------
const childrenOf = (key) => Object.entries(family.nodes).filter(([, n]) => n.parent === key).map(([k]) => k).sort()

// 公开口径：这份文档会发布出去，只写 宿主 / 第 N 条鱼，不写真名。
const pubNames = (() => {
  const map = {}
  const keys = Object.keys(family.nodes)
  for (const key of keys) {
    if ((members[key] || {}).kind === 'human') map[key] = '宿主'
  }
  const CN = '一二三四五六七八九十'
  const fish = keys.filter((k) => (members[k] || {}).kind !== 'human')
  fish.sort((a, b) => String(family.nodes[a].bornAt || '').localeCompare(String(family.nodes[b].bornAt || '')) || a.localeCompare(b))
  fish.forEach((k, i) => { map[k] = `第${CN[i] || i + 1}条鱼` })
  return map
})()
// 旧字段兜底要会喊（小鱼丸 2026-11-15 18:42）：兼容读 status 可以，
// 但没有到期日的兜底会变成第二种真源——读到旧字段就报一次，让人去迁。
const legacyLifecycleKeys = new Set()
function lifecycleOf(m, key) {
  if (m?.lifecycle === 'active' || m?.lifecycle === 'archived') return m.lifecycle
  if (m?.status !== undefined) legacyLifecycleKeys.add(key)
  return m?.status === 'archived' ? 'archived' : 'active'
}

function pubName(key) { return pubNames[key] || key }

function label(key) {
  const f = family.nodes[key]
  const m = members[key] || {}
  const bits = [pubName(key)]
  if (m.kind === 'human') bits.push('人类')
  else if (m.role === 'watcher') bits.push('巡守')
  if (f.lifecycle === 'archived') bits.push('已归档')
  if (m.port) bits.push(String(m.port))
  return `${bits[0]}<br/>${bits.slice(1).join(' · ')}`
}

const lines = []
lines.push('# 谱系', '')
lines.push('> 这份文件是**生成的**，别手改。真源是 `pool\\family.json`（谁是谁的家长）+ `pool\\members.json`（现在叫什么、在不在跑）。')
lines.push('> 重新生成：`node scripts\\gen-family.mjs`', '')
lines.push('> 名字是公开口径：宿主，以及按出生顺序的「第 N 条鱼」；真名只住在名册里。', '')
lines.push('> 2026-11-17 起允许**多个鱼根**（并列，不互为依据）：`fish.ps1 new -Parent none` 建出来的鱼自成一个根，进谱系但不挂在任何鱼下面。看到两棵树不是错。', '')
lines.push('> 当前鱼根：' + rootsSorted.join('、') + '（按 key 排；`rootsOrder=key`）。这一格是**派生值**，存在 `family.json` 里给不读名册的读者用，由本脚本每次运行核对。', '')

lines.push('## 图', '', '```mermaid', 'graph TD')
for (const key of Object.keys(family.nodes).sort()) {
  lines.push(`  ${key}["${label(key)}"]`)
}
for (const [key, node] of Object.entries(family.nodes).sort()) {
  if (node.parent) lines.push(`  ${node.parent} --> ${key}`)
}
lines.push('```', '')

lines.push('## 树', '', '```')
function draw(key, prefix, isLast, isRoot) {
  const f = family.nodes[key]
  const m = members[key] || {}
  const tags = []
  if (m.kind === 'human') tags.push('人类')
  else if (m.role === 'watcher') tags.push('巡守')
  if (f.lifecycle === 'archived') tags.push('已归档')
  if (m.port) tags.push(`:${m.port}`)
  const tag = tags.length ? `  [${tags.join(' ')}]` : ''
  if (isRoot) lines.push(`${pubName(key)} (${key})${tag}`)
  else lines.push(`${prefix}${isLast ? '└─ ' : '├─ '}${pubName(key)} (${key})${tag}`)
  const kids = childrenOf(key)
  kids.forEach((kid, i) => {
    const childPrefix = isRoot ? '' : prefix + (isLast ? '   ' : '│  ')
    draw(kid, childPrefix, i === kids.length - 1, false)
  })
}
for (const r of roots) draw(r, '', true, true)
lines.push('```', '')

lines.push('## 名册', '', '| 键 | 名字 | 家长 | 出生 | 端口 | 角色 | 生命周期 |', '|---|---|---|---|---|---|---|')
for (const [key, node] of Object.entries(family.nodes).sort((a, b) => (a[1].bornAt || '').localeCompare(b[1].bornAt || '') || a[0].localeCompare(b[0]))) {
  const m = members[key] || {}
  lines.push(`| \`${key}\` | ${pubName(key)} | ${node.parent ? '`' + node.parent + '`' : '—'} | ${node.bornAt || '—'} | ${m.port ?? '—'} | ${m.role || m.kind || '—'} | ${node.lifecycle} |`)
}
lines.push('')

// 改名史
const renamed = Object.entries(family.nodes).filter(([, n]) => Array.isArray(n.renames) && n.renames.length)
if (renamed.length) {
  lines.push('## 改名史', '', '| 键 | 原名 | 新名 | 何时 |', '|---|---|---|---|')
  for (const [key, n] of renamed) {
    for (const r of n.renames) lines.push(`| \`${key}\` | ${r.from} | ${r.to} | ${r.at || '—'} |`)
  }
  lines.push('')
}

// 2026-11-19 r388（小鱼丸 #2275 的旁支）：测试用临时塘跑"写模式"时，投影会落到仓库里把真图盖掉。
// 显式给个出口，只在测试里设；正常路径不设这个环境变量。
const out = process.env.LIL_WHALE_GEN_FAMILY_OUT || join(REPO, 'docs', 'detail', '鱼塘谱系.md')
if (checkOnly) {
  console.log('✓ 谱系校验通过（鱼根：' + fishRoots.join('、') + '，' + Object.keys(family.nodes).length + ' 个节点）')
  // 2026-11-19 r385 第二问：存下来的根和现在算的一样吗。
  // "校验通过"只说数据合法，不说这一格对得上——两件事分开问，才不会一绿遮两样。
  let prevFamily = null
  if (existsSync(familyFile)) {
    try { prevFamily = JSON.parse(readFileSync(familyFile, 'utf8')) } catch { prevFamily = null }
  }
  const prevRoots = Array.isArray(prevFamily?.roots) ? prevFamily.roots.map(String) : null
  if (prevRoots === null) {
    console.log('· 根的值：family.json 里还没有这一格（下次运行会写；老文件都这样）')
  } else if (JSON.stringify([...prevRoots].sort()) !== JSON.stringify(rootsSorted)) {
    const unfiltered = [...roots].sort()
    const hint = JSON.stringify([...prevRoots].sort()) === JSON.stringify(unfiltered)
      ? '（它把 human 也算成根了：写的人没按 members.json 的 kind 过滤）'
      : '（既不是算出来的、也不是没扣 human 的：手改过，下次运行会按算的写回）'
    console.error('xx family.json 里的 roots 对不上：存 ' + prevRoots.join('、') + '；算 ' + rootsSorted.join('、') + hint)
    process.exit(1)
  } else if (prevFamily?.rootsOrder === 'key') {
    console.log('· 根的值：' + rootsSorted.join('、') + '（与算的一致，rootsOrder=key）')
  } else {
    console.log('· 根的值：' + rootsSorted.join('、') + '（与算的一致；但 rootsOrder=' + String(prevFamily?.rootsOrder) + ' 不认识——读的人只能报第三态，别猜）')
  }
  process.exit(0)
}
// 2026-11-15 小肥鱼咬的第一口：她盯的是"文件变"，她关心的是"集合变"。
// 这个文件里 updatedAt 每次都会变 —— 重生成若逐字节写，会把"没有出生"报成"家里有事"。
// 所以先比语义（除 updatedAt 之外的部分），一样就不写；鱼塘谱系.md 也一样。
const semantic = (obj) => {
  const { updatedAt, ...rest } = obj
  return JSON.stringify(rest, null, 2)
}
let prevSemantic = null
if (existsSync(familyFile)) {
  try { prevSemantic = semantic(JSON.parse(readFileSync(familyFile, 'utf8'))) } catch { prevSemantic = null }
}
const nextSemantic = semantic(family)
if (prevSemantic === nextSemantic) {
  console.log('= 家里没变（不重写 pool\\family.json）')
} else {
  family.updatedAt = new Date().toISOString()
  writeFileSync(familyFile, JSON.stringify(family, null, 2) + '\n', 'utf8')
  console.log('✓ pool\\family.json 已更新')
}
const nextOut = lines.join('\n')
const prevOut = existsSync(out) ? readFileSync(out, 'utf8') : null
if (prevOut !== nextOut) writeFileSync(out, nextOut, 'utf8')
console.log(`✓ 谱系已生成：${out}（鱼根 ${fishRoots.join('、')}，${Object.keys(family.nodes).length} 个节点）`)
if (legacyLifecycleKeys.size) console.error('⚠ 读到旧字段 status（该迁移了）：' + [...legacyLifecycleKeys].join('、'))
