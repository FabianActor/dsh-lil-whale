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
    current = idMatch[1].startsWith('tool-') ? { id: idMatch[1], disabled: false } : null
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
for (const tool of tools) {
  if (tool.disabled === true) {
    skipped.push({ id: tool.id, why: 'disabled: true' })
    continue
  }
  if (tool.disabled === null) {
    skipped.push({ id: tool.id, why: '停用条件是没法安全求值的表达式' })
    continue
  }
  const entry = catalog[tool.id]
  // internal：上下文机制，不是"手"，不写进环境.md
  if (entry && entry.kind === 'internal') continue
  if (!entry || !entry.line) {
    skipped.push({ id: tool.id, why: '工具目录里没有它（补一行就行）' })
    continue
  }
  enabled.push({ id: tool.id, line: entry.line, kind: entry.kind === 'group' ? 'group' : 'tool' })
}

console.log(JSON.stringify({ ok: true, preset: wanted, platform: process.platform, tools: enabled, skipped }, null, 0))
