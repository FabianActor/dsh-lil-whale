#!/usr/bin/env node
// 把工作区里四个平级目录收成一个「鱼塘」：
//
//   <workdir>\dsh-lil-whale   → <pond>\app\          （仓库；旧目录留空壳给正在跑的会话）
//   <workdir>\lil-whale       → <pond>\homes\whale\  （第一条鱼的家）
//   <workdir>\lil-whale-2     → <pond>\homes\fishball\
//   <workdir>\lil-whale-pool  → <pond>\pool\         （共享区）
//   <pond> = <workdir>\lil-whale
//
// 同时：改配置里的绝对路径、重建 group/state 的 Junction、修 profile 的 link 依赖、
// 修 %USERPROFILE%\dsh-lil-whale Junction、把会话头的 cwd 改成新家并把会话目录挪到新 projectKey。
//
// 用法：
//   node scripts\migrate-pond.mjs --dry-run     # 只打印计划，不动任何东西
//   node scripts\migrate-pond.mjs               # 真跑（会先停两条鱼）
//
// 规矩：跑之前 git status 必须干净；所有移动都在同一个盘（rename 原子）；先备份配置到 pool\archive\migration-<ts>\。

import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync,
  rmdirSync, symlinkSync, rmSync, statSync, copyFileSync,
} from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'

const DRY = process.argv.includes('--dry-run')
const argOf = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const WORKDIR = resolve(argOf('--workdir', 'D:\\文档\\WorkSpace'))
const POND_NAME = argOf('--pond-name', 'lil-whale')

const OLD = {
  repo: join(WORKDIR, 'dsh-lil-whale'),
  home1: join(WORKDIR, 'lil-whale'),
  home2: join(WORKDIR, 'lil-whale-2'),
  pool: join(WORKDIR, 'lil-whale-pool'),
}
const POND = join(WORKDIR, POND_NAME)
const STAGING = join(WORKDIR, `.pond-staging-${Date.now()}`)
const NEW = {
  app: join(POND, 'app'),
  pool: join(POND, 'pool'),
  home1: join(POND, 'homes', 'whale'),
  home2: join(POND, 'homes', 'fishball'),
  acl: join(POND, 'acl'),
}
const STAGE = {
  app: join(STAGING, 'app'),
  pool: join(STAGING, 'pool'),
  home1: join(STAGING, 'homes', 'whale'),
  home2: join(STAGING, 'homes', 'fishball'),
  acl: join(STAGING, 'acl'),
}

const log = []
const say = (line) => { log.push(line); console.log((DRY ? '[dry] ' : '') + line) }
const die = (msg) => { console.error('NEXT: ' + msg); process.exit(1) }
const move = (from, to) => {
  say(`move ${from} -> ${to}`)
  if (!DRY) { mkdirSync(dirname(to), { recursive: true }); renameSync(from, to) }
}

// ---------- 0. 前置检查 ----------
for (const [name, p] of Object.entries(OLD)) if (!existsSync(p)) die(`找不到 ${name}：${p}`)
// 目标路径会复用旧家的名字：旧家先被搬走，腾出这个名字给整个鱼塘
if (existsSync(POND) && resolve(POND) !== resolve(OLD.home1)) {
  die(`目标已经存在：${POND}（先确认它是不是上一次迁移留下的）`)
}
if (existsSync(STAGING)) die(`临时目录已存在：${STAGING}`)

const cfgFiles = [join(OLD.repo, 'lil-whale.config.json'), join(OLD.repo, 'lil-whale.config.fishball.json')]
for (const f of cfgFiles) if (!existsSync(f)) die(`找不到配置：${f}`)
const membersFile = join(OLD.pool, 'members.json')
if (!existsSync(membersFile)) die(`找不到名册：${membersFile}`)

// ---------- 1. 停两条鱼 ----------
if (!DRY) {
  const fish = join(OLD.repo, 'scripts', 'fish.ps1')
  for (const key of ['fishball', 'whale']) {
    say(`stop ${key}`)
    spawnSync('pwsh', ['-NoProfile', '-File', fish, 'down', key, '-Yes'], { stdio: 'ignore', timeout: 90000 })
  }
} else {
  say('stop fishball / whale（真跑时才停）')
}

// ---------- 2. 建临时目录 ----------
for (const p of [STAGE.app, STAGE.pool, dirname(STAGE.home1), dirname(STAGE.home2), STAGE.acl]) {
  say(`mkdir ${p}`)
  if (!DRY) mkdirSync(p, { recursive: true })
}

// ---------- 3. 备份 ----------
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const backupDir = join(OLD.pool, 'archive', `migration-${stamp}`)
say(`backup configs -> ${backupDir}`)
if (!DRY) {
  mkdirSync(backupDir, { recursive: true })
  for (const f of [...cfgFiles, membersFile]) copyFileSync(f, join(backupDir, f.split(/[\\/]/).pop()))
}

// ---------- 4. 搬 ----------
// 仓库：搬内容，留空壳（当前会话的 workspace 还挂在旧路径上）
for (const entry of readdirSync(OLD.repo)) {
  if (entry === '.pond-staging') continue
  move(join(OLD.repo, entry), join(STAGE.app, entry))
}
move(OLD.home1, STAGE.home1)
move(OLD.home2, STAGE.home2)
move(OLD.pool, STAGE.pool)
say(`rename ${STAGING} -> ${POND}`)
if (!DRY) renameSync(STAGING, POND)

// ---------- 5. 路径映射 ----------
const mapPath = (value) => {
  if (typeof value !== 'string') return value
  return value
    .split(OLD.pool).join(NEW.pool)
    .split(OLD.home1).join(NEW.home1)
    .split(OLD.home2).join(NEW.home2)
    .split(OLD.repo).join(NEW.app)
}

// ---------- 6. 配置与名册 ----------
const rewriteJson = (file, fn) => {
  if (!existsSync(file)) return say(`skip (missing) ${file}`)
  const raw = readFileSync(file, 'utf8')
  const next = JSON.stringify(fn(JSON.parse(raw)), null, 2) + '\n'
  say(`rewrite ${file}`)
  if (!DRY) writeFileSync(file, next, 'utf8')
}
const rewriteDeep = (value) => {
  if (Array.isArray(value)) return value.map(rewriteDeep)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewriteDeep(v)]))
  return mapPath(value)
}
for (const f of cfgFiles) rewriteJson(join(NEW.app, f.split(/[\\/]/).pop()), rewriteDeep)
rewriteJson(join(NEW.pool, 'members.json'), rewriteDeep)

// ---------- 7. Junction：group / state ----------
const fixJunction = (linkPath, target) => {
  say(`junction ${linkPath} -> ${target}`)
  if (DRY) return
  if (existsSync(linkPath)) rmdirSync(linkPath) // 只删链接本身，不碰目标
  symlinkSync(target, linkPath, 'junction')
}
for (const home of [NEW.home1, NEW.home2]) {
  fixJunction(join(home, 'group'), join(NEW.pool, 'group'))
  fixJunction(join(home, 'state'), join(NEW.pool, 'state'))
}

// ---------- 8. profile 的 link 依赖 ----------
// 目录链接一律用 junction（Windows 上不需要管理员权限，也不需要开发者模式），
// 目标写绝对路径 —— 反正搬家时这个脚本会把它们全部改一遍。
const fixProfile = (profileDir, links) => {
  const pkgFile = join(profileDir, 'package.json')
  if (!existsSync(pkgFile)) return say(`skip (missing) ${pkgFile}`)
  rewriteJson(pkgFile, (pkg) => {
    for (const [name, target] of Object.entries(links)) {
      if (pkg.dependencies?.[name]) pkg.dependencies[name] = 'link:' + target.replace(/\\/g, '/')
    }
    return pkg
  })
  for (const [name, target] of Object.entries(links)) {
    const nm = join(profileDir, 'node_modules')
    const linkPath = join(nm, name)
    if (!existsSync(nm)) continue
    say(`junction ${linkPath} -> ${target}`)
    if (DRY) continue
    if (existsSync(linkPath)) {
      try { rmdirSync(linkPath) } catch { try { rmSync(linkPath, { force: true }) } catch {} }
    }
    symlinkSync(target, linkPath, 'junction')
  }
}
fixProfile(join(NEW.home1, 'dsh-home', 'profiles', 'whale'), { 'lil-whale-group': join(NEW.app, 'plugin', 'dsh-lil-whale-group') })
fixProfile(join(NEW.home2, 'dsh-home', 'profiles', 'fishball'), { 'lil-whale-group': join(NEW.app, 'plugin', 'dsh-lil-whale-group') })
fixProfile(join(homedir(), '.dsh', 'profiles', 'web'), {
  'lil-whale-group': join(NEW.app, 'plugin', 'dsh-lil-whale-group'),
  'lil-whale-group-ui': join(NEW.app, 'plugin', 'dsh-lil-whale-group-ui'),
})

// ---------- 9. %USERPROFILE%\dsh-lil-whale ----------
const asciiLink = join(homedir(), 'dsh-lil-whale')
say(`junction ${asciiLink} -> ${NEW.app}`)
if (!DRY) {
  if (existsSync(asciiLink)) rmdirSync(asciiLink)
  symlinkSync(NEW.app, asciiLink, 'junction')
}

// ---------- 10. 会话：改 cwd + 挪 projectKey ----------
function projectKey(cwd) {
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i += 1) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}
function patchSessionFile(file, oldCwd, newCwd) {
  const raw = readFileSync(file)
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const offsets = []
  let i = 0
  while (true) {
    const at = raw.indexOf(magic, i)
    if (at < 0) break
    offsets.push(at)
    i = at + 4
  }
  const frames = []
  for (let k = 0; k < offsets.length; k += 1) {
    const start = offsets[k]
    const end = k + 1 < offsets.length ? offsets[k + 1] : raw.length
    frames.push(zstdDecompressSync(raw.subarray(start, end)).toString('utf8'))
  }
  let changed = 0
  const first = frames[0]
  if (first.includes(JSON.stringify(oldCwd))) {
    frames[0] = first.replace(JSON.stringify(oldCwd), JSON.stringify(newCwd))
    changed += 1
  }
  const out = Buffer.concat(frames.map((text) => zstdCompressSync(Buffer.from(text, 'utf8'))))
  return { out, changed, frames: frames.length }
}
const fixSessions = (homeDir, oldCwd, newCwd) => {
  const root = join(homeDir, 'dsh-home', 'sessions')
  if (!existsSync(root)) return say(`skip sessions (missing) ${root}`)
  const oldKey = projectKey(oldCwd)
  const newKey = projectKey(newCwd)
  const oldDir = join(root, oldKey)
  if (!existsSync(oldDir)) return say(`skip sessions (no old key) ${oldDir}`)
  for (const id of readdirSync(oldDir)) {
    const from = join(oldDir, id)
    const file = join(from, 'session.v4.jsonl.zstd')
    if (!existsSync(file)) { say(`skip session (no file) ${from}`); continue }
    const { out, changed, frames } = patchSessionFile(file, oldCwd, newCwd)
    say(`session ${id}: frames=${frames} cwd-changed=${changed}`)
    if (DRY) continue
    const to = join(root, newKey, id)
    mkdirSync(dirname(to), { recursive: true })
    if (existsSync(to)) rmSync(to, { recursive: true, force: true })
    renameSync(from, to)
    writeFileSync(join(to, 'session.v4.jsonl.zstd'), out)
  }
  if (!DRY) {
    try { if (readdirSync(oldDir).length === 0) rmdirSync(oldDir) } catch {}
  }
}
fixSessions(NEW.home1, OLD.home1, NEW.home1)
fixSessions(NEW.home2, OLD.home2, NEW.home2)

// ---------- 11. 报告 ----------
const reportFile = join(NEW.pool, 'archive', `migration-${stamp}`, 'migration.log')
say(`report -> ${reportFile}`)
if (!DRY) {
  mkdirSync(dirname(reportFile), { recursive: true })
  writeFileSync(reportFile, log.join('\n') + '\n', 'utf8')
}
console.log(DRY ? '\n[dry] 没有动任何东西。去掉 --dry-run 真跑。' : '\n迁移完成。下一步：改安装默认值/README，重启 3080，`fish.ps1 up all` 起鱼，再跑 doctor。')
