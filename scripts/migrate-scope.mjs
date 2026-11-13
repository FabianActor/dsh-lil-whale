// 一次性迁移：把 profile 里装的旧包名 lil-whale-group(-ui) 改成 scoped 名，
// 同时把 link 路径从旧的 plugin/dsh-group(-ui) 指到新的 plugin/dsh-lil-whale-group(-ui)。
//
// 为什么不用 `dsh plugin add link:...` 重装：那会走 pnpm，联网/锁文件都可能卡；
// 这里只改确定的东西——package.json、pnpm-lock 的 importers 段、node_modules 链接。
//
// 只处理"这个 profile 真的装了"的包：只装宿主那条鱼不会有 UI 包的链接。
//
// 用法：
//   node scripts/migrate-scope.mjs --profile-dir <profile 目录> [--dry-run]
// 例：
//   node scripts/migrate-scope.mjs --profile-dir <你的 DSH_HOME>\profiles\web
//
// 写前备份 package.json / pnpm-lock.yaml 为 *.bak-scope-<时间>。

import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

const MAP = [
  { old: 'lil-whale-group', name: '@fabianactor/dsh-lil-whale-group', dir: 'plugin/dsh-lil-whale-group' },
  { old: 'lil-whale-group-ui', name: '@fabianactor/dsh-lil-whale-group-ui', dir: 'plugin/dsh-lil-whale-group-ui' },
]

function arg(name, fallback = null) {
  const i = process.argv.indexOf('--' + name)
  if (i < 0) return fallback
  const next = process.argv[i + 1]
  return next !== undefined && !next.startsWith('--') ? next : true
}
const profileDir = arg('profile-dir')
const dry = Boolean(arg('dry-run', false))
if (!profileDir || profileDir === true) {
  console.error('NEXT: 用法 node scripts/migrate-scope.mjs --profile-dir <profile 目录> [--dry-run]')
  process.exit(1)
}
if (!existsSync(join(profileDir, 'package.json'))) {
  console.error(`NEXT: ${profileDir} 不像一个 profile（没有 package.json）`)
  process.exit(1)
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const log = (...a) => console.log(dry ? '[dry] ' + a.join(' ') : a.join(' '))
const nm = join(profileDir, 'node_modules')

const pkgPath = join(profileDir, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const deps = pkg.dependencies ?? {}
const bundles = pkg.dsh?.profile?.bundles ?? []

// 只迁"装了"的包：deps 里是旧名或新名，或 node_modules 里有旧链接。
const targets = MAP.filter((m) => {
  if (deps[m.old] !== undefined || deps[m.name] !== undefined) return true
  try { return lstatSync(join(nm, m.old)) && true } catch { return false }
})
if (!targets.length) {
  log('这个 profile 没装 lil-whale 的包，什么都不用做：' + profileDir)
  process.exit(0)
}

let pkgChanged = 0
for (const m of targets) {
  if (deps[m.old] !== undefined) {
    const target = 'link:' + join(REPO, m.dir).replace(/\\/g, '/')
    delete pkg.dependencies[m.old]
    pkg.dependencies[m.name] = target
    pkgChanged += 1
    log(`deps: ${m.old} → ${m.name}`)
  }
  const at = bundles.indexOf(m.old)
  if (at >= 0) { bundles[at] = m.name; pkgChanged += 1; log(`bundles: ${m.old} → ${m.name}`) }
}
if (pkgChanged && !dry) {
  copyFileSync(pkgPath, `${pkgPath}.bak-scope-${stamp}`)
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
}

const lockPath = join(profileDir, 'pnpm-lock.yaml')
if (existsSync(lockPath)) {
  let out = readFileSync(lockPath, 'utf8')
  let lockChanged = 0
  for (const m of targets) {
    const newPath = join(REPO, m.dir).replace(/\\/g, '/')
    const oldKey = `      ${m.old}:\n`
    const newKey = `      '${m.name}':\n`
    if (!out.includes(oldKey)) continue
    const i = out.indexOf(oldKey)
    const end = out.indexOf('\n\n', i)
    const block = out.slice(i, end < 0 ? out.length : end)
    const replaced = newKey + block.slice(oldKey.length)
      .replace(/specifier: link:[^\n]*/, `specifier: link:${newPath}`)
      .replace(/version: link:[^\n]*/, `version: link:${newPath}`)
    out = out.slice(0, i) + replaced + out.slice(end < 0 ? out.length : end)
    lockChanged += 1
    log(`lock: ${m.old} → ${m.name}`)
  }
  if (lockChanged && !dry) {
    copyFileSync(lockPath, `${lockPath}.bak-scope-${stamp}`)
    writeFileSync(lockPath, out, 'utf8')
  }
}

function removeLink(p) {
  try {
    const st = lstatSync(p)
    if (st.isSymbolicLink()) { unlinkSync(p); return true }
    if (st.isDirectory()) { rmdirSync(p); return true }
  } catch { /* 不存在 */ }
  return false
}
if (existsSync(nm)) {
  for (const m of targets) {
    const oldLink = join(nm, m.old)
    const newLink = join(nm, ...m.name.split('/'))
    const target = join(REPO, m.dir)
    if (removeLink(oldLink)) log(`link: 删 ${m.old}`)
    if (existsSync(newLink)) { log(`link: ${m.name} 已存在`); continue }
    if (!dry) {
      mkdirSync(dirname(newLink), { recursive: true })
      symlinkSync(target, newLink, 'junction')
    }
    log(`link: ${m.name} → ${target}`)
  }
}

if (!dry) {
  const after = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const problems = []
  for (const m of targets) {
    if (after.dependencies?.[m.name] === undefined) problems.push('deps 缺 ' + m.name)
    if (!(after.dsh?.profile?.bundles ?? []).includes(m.name)) problems.push('bundles 缺 ' + m.name)
    if (existsSync(nm) && !existsSync(join(nm, ...m.name.split('/')))) problems.push('链接缺 ' + m.name)
  }
  if (problems.length) {
    console.error('NEXT: 迁移后自检失败 —— ' + problems.join('；'))
    process.exit(1)
  }
}
log('完成：' + profileDir + '（' + targets.map((m) => m.name).join(', ') + '）')
