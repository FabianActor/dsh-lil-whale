// gen-family.mjs -- 从数据生成谱系（pool\family.json + pool\members.json -> docs\detail\谱系.md）。
//
// 为什么生成而不手画：手画的图第一周对、第二周开始漂，第三周没人信它。
// 这里只有两个输入：谁是爹（family.json）、现在叫什么/在不在跑（members.json）。
//
// 用法：
//   node scripts\gen-family.mjs              # 生成 docs\detail\谱系.md
//   node scripts\gen-family.mjs --check      # 只校验，不写文件（CI / doctor 用）
//   node scripts\gen-family.mjs --seed       # 用 members.json 初始化 family.json（没有时自动做）

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checkOnly = process.argv.includes('--check')
// 未知参数拒绝（`--help` 曾经真的重写 docs\detail\谱系.md）。
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

function readConfig() {
  const tries = [process.env.LIL_WHALE_CONFIG, join(REPO, 'lil-whale.config.json'), join(REPO, 'lil-whale.config.example.json')]
  for (const p of tries) {
    if (p && existsSync(p)) {
      try { return JSON.parse(readFileSync(p, 'utf8')) } catch (e) { die(`配置读不了：${p}（${e.message}）`) }
    }
  }
  die('找不到配置', '先跑 install.ps1')
}

const cfg = readConfig()
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
      status: m.status || 'resident',
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
    family.nodes[key] = { name: m.name || key, parent: m.parent ?? null, bornAt: m.bornAt ?? null, status: m.status || 'resident', note: '', renames: [] }
    added++
  }
}
if (added) console.log(`✓ 谱系补了 ${added} 个节点`)

// ---------- 校验 ----------
const errors = []
for (const [key, node] of Object.entries(family.nodes)) {
  if (node.parent && !family.nodes[node.parent]) errors.push(`${key} 的 parent=${node.parent} 不存在`)
  if (node.parent === key) errors.push(`${key} 自己是自己的爹`)
}
// 环检测
const state = {}
function walk(key, path) {
  if (state[key] === 'done') return
  if (state[key] === 'walking') { errors.push('谱系里有一个环：' + [...path, key].join(' -> ')); return }
  state[key] = 'walking'
  const p = family.nodes[key]?.parent
  if (p) walk(p, [...path, key])
  state[key] = 'done'
}
for (const key of Object.keys(family.nodes)) walk(key, [])
// 根：可以不止一个（人类和鱼各是一棵树；鱼必须恰好一个根）
const roots = Object.entries(family.nodes).filter(([, n]) => !n.parent).map(([k]) => k)
const fishRoots = roots.filter((k) => (members[k] || {}).kind !== 'human')
if (fishRoots.length !== 1) errors.push(`鱼应该只有一个根，现在是：${fishRoots.join(', ') || '（没有）'}`)

if (errors.length) {
  for (const e of errors) console.error('xx ' + e)
  die('谱系数据有问题，没有生成图', '修 pool\\family.json（它是谱系真源），再跑一次')
}

// ---------- 生成 ----------
const root = fishRoots[0] || roots[0]
const childrenOf = (key) => Object.entries(family.nodes).filter(([, n]) => n.parent === key).map(([k]) => k).sort()

function label(key) {
  const f = family.nodes[key]
  const m = members[key] || {}
  const bits = [f.name || key]
  if (m.kind === 'human') bits.push('人类')
  else if (m.role === 'watcher') bits.push('巡守')
  if (f.status === 'experiment') bits.push('实验')
  if (f.status === 'archived') bits.push('已归档')
  if (m.port) bits.push(String(m.port))
  return `${bits[0]}<br/>${bits.slice(1).join(' · ')}`
}

const lines = []
lines.push('# 谱系', '')
lines.push('> 这份文件是**生成的**，别手改。真源是 `pool\\family.json`（谁是谁的爹）+ `pool\\members.json`（现在叫什么、在不在跑）。')
lines.push('> 重新生成：`node scripts\\gen-family.mjs`', '')

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
  if (f.status === 'experiment') tags.push('实验')
  if (f.status === 'archived') tags.push('已归档')
  if (m.port) tags.push(`:${m.port}`)
  const tag = tags.length ? `  [${tags.join(' ')}]` : ''
  if (isRoot) lines.push(`${f.name || key} (${key})${tag}`)
  else lines.push(`${prefix}${isLast ? '└─ ' : '├─ '}${f.name || key} (${key})${tag}`)
  const kids = childrenOf(key)
  kids.forEach((kid, i) => {
    const childPrefix = isRoot ? '' : prefix + (isLast ? '   ' : '│  ')
    draw(kid, childPrefix, i === kids.length - 1, false)
  })
}
for (const r of roots) draw(r, '', true, true)
lines.push('```', '')

lines.push('## 名册', '', '| 键 | 名字 | 爹 | 出生 | 端口 | 角色 | 状态 |', '|---|---|---|---|---|---|---|')
for (const [key, node] of Object.entries(family.nodes).sort((a, b) => (a[1].bornAt || '').localeCompare(b[1].bornAt || '') || a[0].localeCompare(b[0]))) {
  const m = members[key] || {}
  lines.push(`| \`${key}\` | ${node.name || m.name || key} | ${node.parent ? '`' + node.parent + '`' : '—'} | ${node.bornAt || '—'} | ${m.port ?? '—'} | ${m.role || m.kind || '—'} | ${node.status} |`)
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

const out = join(REPO, 'docs', 'detail', '谱系.md')
if (checkOnly) {
  console.log('✓ 谱系校验通过（根：' + root + '，' + Object.keys(family.nodes).length + ' 个节点）')
  process.exit(0)
}
// 2026-11-15 小肥鱼咬的第一口：她盯的是"文件变"，她关心的是"集合变"。
// 这个文件里 updatedAt 每次都会变 —— 重生成若逐字节写，会把"没有出生"报成"家里有事"。
// 所以先比语义（除 updatedAt 之外的部分），一样就不写；谱系.md 也一样。
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
console.log(`✓ 谱系已生成：${out}（根 ${root}，${Object.keys(family.nodes).length} 个节点）`)
