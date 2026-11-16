#!/usr/bin/env node
/**
 * 从 `dsh --profile <name> --dump-config` 里算出"这个组合实际挂载了哪些工具"。
 *
 * 为什么要算，而不是写死：2026-11-12 发现手写的那张「你能做什么」已经过期 ——
 * 纸上写着 `schedule_create`，而她那个组合里根本没有 tool-schedule。
 * 手写的目录一定会过期，而且过期时长得跟没过期一样。
 *
 * 用法：
 *   node tools-from-profile.mjs --profile whale [--home <DSH_HOME>] [--catalog <json>]
 * 输出（stdout，一行 JSON）：
 *   { ok: true, preset: 'standard', tools: [{id, line}], skipped: [{id, why}] }
 *   { ok: false, reason: '...' }
 */
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

process.noDeprecation = true // spawnSync(shell:true) 的 DEP0190 会污染 install 的输出
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(HERE)

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const profile = arg('profile')
const catalogPath = arg('catalog', join(REPO, 'templates', '工具目录.json'))
if (!profile) {
  console.log(JSON.stringify({ ok: false, reason: '缺少 --profile' }))
  process.exit(0)
}

let catalog = {}
try {
  catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
} catch (error) {
  console.log(JSON.stringify({ ok: false, reason: `读不到工具目录 ${catalogPath}: ${error.message}` }))
  process.exit(0)
}

// Windows 上 `dsh` 是 .cmd/.ps1 外壳，spawnSync 不带 shell 找不到它（exit null、stderr 空）。
const shellShim = process.platform === 'win32' ? 'dsh.cmd' : 'dsh'
const dump = spawnSync(shellShim, ['--profile', profile, '--dump-config'], {
  encoding: 'utf8',
  env: process.env,
  shell: process.platform === 'win32',
  windowsHide: true,
})
if (dump.status !== 0) {
  console.log(JSON.stringify({ ok: false, reason: `dump-config 失败（exit ${dump.status}）: ${(dump.stderr || '').slice(0, 400)}` }))
  process.exit(0)
}

const lines = (dump.stdout || '').replace(/\r\n/g, '\n').split('\n')

/** 找到注册表里 `default:` 指的那个 preset 定义段。 */
function findPresetSection(text) {
  const defaultMatch = lines.find((line) => /^\s*default:\s*\S+/.test(line))
  const wanted = defaultMatch ? defaultMatch.split(':')[1].trim() : 'standard'
  const start = lines.findIndex((line) => new RegExp(`^- id: preset-${wanted}$`).test(line))
  if (start < 0) return { wanted, section: null }
  const section = []
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^- id: /.test(lines[i])) break
    section.push(lines[i])
  }
  return { wanted, section }
}

const { wanted, section } = findPresetSection(lines)
if (!section) {
  console.log(JSON.stringify({ ok: false, reason: `dump 里找不到 preset-${wanted} 的定义段` }))
  process.exit(0)
}

/** 只认两条平台规则，其他 !!js 一律当"不知道"（不执行 dump 里的任意表达式）。 */
function platformDisabled(expr) {
  const text = String(expr || '')
  if (/process\.platform\s*===\s*'win32'/.test(text)) return process.platform === 'win32'
  if (/process\.platform\s*!==\s*'win32'/.test(text)) return process.platform !== 'win32'
  return null
}

const tools = []
const skipped = []
let current = null
for (const line of section) {
  const idMatch = /^\s*- id: ([\w-]+)\s*$/.exec(line)
  if (idMatch) {
    // 默认是"挂着"；只有真的读到 disabled: 才改。没读到不等于停用。
    // 2026-11-16 小满 #774：不是所有"手"的 id 都叫 `tool-*`——DSH 核心挂的 `present`
    // 就是直接一个 `present`。判据改成"目录里登记过就算手"（目录是这张纸的翻译表，不是白名单的尽头）。
    const id = idMatch[1]
    current = id.startsWith('tool-') || catalog[id] ? { id, disabled: false } : null
    if (current) tools.push(current)
    continue
  }
  const disabledMatch = /^\s{8,}disabled:\s*(.+)$/.exec(line)
  if (disabledMatch && current) {
    if (/^true\s*$/.test(disabledMatch[1])) current.disabled = true
    else if (/^false\s*$/.test(disabledMatch[1])) current.disabled = false
    else current.disabled = platformDisabled(disabledMatch[1])
    current = null
  }
}

const enabled = []
const internal = []
for (const tool of tools) {
  if (tool.disabled === true) {
    skipped.push({ id: tool.id, why: 'disabled: true', kind: 'disabled' })
    continue
  }
  if (tool.disabled === null) {
    skipped.push({ id: tool.id, why: '停用条件是没法安全求值的表达式', kind: 'unjudged' })
    continue
  }
  const entry = catalog[tool.id]
  // internal：上下文机制，不是"手"，不写进环境.md —— 但它也是"挂载项"，
  // 必须进计数（2026-11-16 第三条鱼：等式里少了 internal 这一桶，差额会被下一个人当 bug 查）。
  if (entry && entry.kind === 'internal') {
    internal.push(tool.id)
    continue
  }
  if (!entry || !entry.line) {
    skipped.push({ id: tool.id, why: '工具目录里没有它（补一行就行）', kind: 'nodoc' })
    continue
  }
  enabled.push({ id: tool.id, line: entry.line, kind: entry.kind === 'group' ? 'group' : 'tool' })
}

// 计数单位是"挂载项（组）"，不是"件"（一个插件可能带好几只手）。
// 2026-11-16 三条鱼的结论：dump-config 只报组、不报每组几件，硬折成件只能靠猜，
// 所以这里只给同单位能算的数；件数由 wake-agent-tools 那本账单独看变化，不参与这条等式。
const skippedSorted = [...skipped].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
const skippedOf = (kind) => skipped.filter((s) => s.kind === kind).length
const counts = {
  // 这张纸会算哪些停用规则：能力本身也要能读出来，否则 unjudged 的含义会随时间漂（第三条鱼 #829）。
  evalRules: 'win32-only',
  mounts: enabled.length + skipped.length + internal.length,
  listed: enabled.length,
  skipped: skipped.length,
  internal: internal.length,
  // 2026-11-16 第二条鱼 #816：skipped 的"方向"要写清——它数的是"挂载项在、但这份纸没写进去"，
  // 原因是 被停用 / 停用条件判不了 / 目录没登记；反方向（目录有、组合里没有）不在这一行。
  skippedDisabled: skippedOf('disabled'),
  skippedUnjudged: skippedOf('unjudged'),
  skippedNoDoc: skippedOf('nodoc'),
}
console.log(
  JSON.stringify(
    { ok: true, preset: wanted, platform: process.platform, counts, tools: enabled, skipped: skippedSorted },
    null,
    0,
  ),
)
