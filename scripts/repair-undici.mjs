#!/usr/bin/env node
// 修 undici 的"缺 cache 文件"问题（2026-11-15 小肥鱼报的）。
//
// 现象：dsh 装的 undici 目录在，但 lib\cache\ 与 lib\web\cache\ 里少了文件，
// `require('undici')` 在 interceptor/cache.js 就炸：
//   Error: Cannot find module '../cache/memory-cache-store'
// 影响：鱼那边的 web_fetch 走 undici 时报错；补回文件即好。
//
// 为什么要有这个脚本：手补的文件在 npm i / 升级 dsh / 换机器后会被重建覆盖，
// 覆盖之后报的还是同一个错，看起来像"没修过"。所以把它变成可重放的检查 + 修补。
//
// 用法：
//   node scripts/repair-undici.mjs --check   # 只查，缺了 exit 1
//   node scripts/repair-undici.mjs --fix     # 查，缺了就补（从官方 tarball）
//   node scripts/repair-undici.mjs           # 同 --check

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, copyFileSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(HERE)

const REQUIRED = [
  'lib/cache/memory-cache-store.js',
  'lib/cache/sqlite-cache-store.js',
  'lib/web/cache/cache.js',
  'lib/web/cache/cachestorage.js',
  'lib/web/cache/util.js',
]

function dshRoot() {
  const candidates = [
    process.env.DSH_LAUNCHER_MODULE ? dirname(process.env.DSH_LAUNCHER_MODULE) : '',
    join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh'),
    join(process.env.USERPROFILE || '', 'AppData', 'Roaming', 'npm', 'node_modules', '@deepseek-ai', 'dsh'),
  ].filter(Boolean)
  for (const c of candidates) {
    if (existsSync(join(c, 'package.json'))) return c
  }
  return null
}

function undiciDir(root) {
  return join(root, 'node_modules', 'undici')
}

function installedVersion(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version || ''
  } catch {
    return ''
  }
}

// 在，不等于能用（2026-11-15 小肥鱼补的）：
// 0 字节、被截断、从别的版本拷来的文件，existsSync 都报 true。
// 今天坏掉的形态是"文件根本没在"，所以先拦最常见的那种（空文件）；
// sha256 校验等真的出现"补错版本"再上——判据按已经发生过的错来配。
function missingFiles(dir) {
  return REQUIRED.filter((rel) => {
    const p = join(dir, rel)
    try {
      const st = statSync(p)
      return !st.isFile() || st.size === 0
    } catch {
      return true
    }
  })
}

function fix(root, dir, version, missing) {
  const work = mkdtempSync(join(tmpdir(), 'undici-fix-'))
  try {
    const pack = spawnSync('npm', ['pack', `undici@${version}`, '--silent', '--pack-destination', work], {
      cwd: REPO, encoding: 'utf8', shell: process.platform === 'win32',
    })
    if (pack.status !== 0) throw new Error(`npm pack 失败：${(pack.stderr || pack.stdout || '').trim()}`)
    const tgz = pack.stdout.trim().split(/\r?\n/).filter((l) => l.endsWith('.tgz')).pop()
    if (!tgz) throw new Error('npm pack 没给出 tarball 名')
    const untar = spawnSync('tar', ['-xzf', tgz], { cwd: work, encoding: 'utf8' })
    if (untar.status !== 0) throw new Error(`解包失败：${(untar.stderr || '').trim()}`)
    const src = join(work, 'package')
    for (const rel of missing) {
      const from = join(src, rel)
      const to = join(dir, rel)
      if (!existsSync(from)) throw new Error(`tarball 里也没有 ${rel}`)
      mkdirSync(dirname(to), { recursive: true })
      copyFileSync(from, to)
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

const mode = process.argv.includes('--fix') ? 'fix' : 'check'
const root = dshRoot()
if (!root) {
  console.log('FAIL 找不到 dsh 安装目录（试过 DSH_LAUNCHER_MODULE / %APPDATA%\\npm\\node_modules\\@deepseek-ai\\dsh）')
  process.exit(1)
}
const dir = undiciDir(root)
if (!existsSync(join(dir, 'package.json'))) {
  console.log(`SKIP 没有 undici（${dir}）——dsh 没用到它，不用修`)
  process.exit(0)
}
const version = installedVersion(dir)
let missing = missingFiles(dir)

if (missing.length === 0) {
  console.log(`OK undici@${version}：${REQUIRED.length} 个文件都在`)
  process.exit(0)
}

console.log(`WARN undici@${version} 缺（或空）${missing.length} 个文件：`)
for (const rel of missing) console.log(`  - ${rel}`)

if (mode !== 'fix') {
  console.log('NEXT: node scripts/repair-undici.mjs --fix')
  process.exit(1)
}

const toFix = missing.slice()
fix(root, dir, version, toFix)
const stillMissing = missingFiles(dir)
if (stillMissing.length !== 0) {
  console.log(`FAIL 补完还缺 ${stillMissing.length} 个：${stillMissing.join(', ')}`)
  process.exit(1)
}
console.log(`OK 已从官方 tarball 补回 ${toFix.length} 个文件；再跑一次 --check 可复核`)
