#!/usr/bin/env node
/**
 * 把"共享的东西"从她的家搬到 pool，并在她家里留下 Junction 指回去。
 *
 * 为什么：group 是共享空间，不是她的私人物品。第一条鱼的时候它住在家里没问题；
 * 第二条鱼出现后，第二条的群文件写进第一条的家，就是越界。
 *
 * 做法：先复制 → 逐文件比 sha256 → 原件改名留底 → 建 Junction → 验证
 *      （读得出、写得进、真身落在 pool）→ 全过才说成功。
 * 失败任何一步都回滚，不留半套。
 *
 * 用法：
 *   node scripts/migrate-pool.mjs --dry-run
 *   node scripts/migrate-pool.mjs --yes
 */
import { existsSync, readFileSync, renameSync, rmSync, cpSync, readdirSync, statSync, symlinkSync, readlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')

function die(msg) {
  console.error(`失败：${msg}`)
  console.error('NEXT: 什么都没改。先修上面这条，再重跑。')
  process.exit(1)
}

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const yes = argv.includes('--yes')
if (!dryRun && !yes) die('要么 --dry-run 先看，要么 --yes 真做')

const cfgPath = process.env.LIL_WHALE_CONFIG || join(REPO_ROOT, 'lil-whale.config.json')
if (!existsSync(cfgPath)) die(`找不到配置 ${cfgPath}`)
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
const herHome = cfg.herHome
const poolDir = cfg.poolDir || resolve(herHome, '..', 'lil-whale-pool')
if (!existsSync(poolDir)) die(`pool 目录不存在：${poolDir}（先建好它）`)

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const PLAN = [
  { name: 'group', src: join(herHome, 'group'), dst: join(poolDir, 'group') },
  { name: 'state', src: join(herHome, 'state'), dst: join(poolDir, 'state') },
]

function walk(root, base = root, out = []) {
  for (const ent of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, ent.name)
    if (ent.isDirectory()) walk(full, base, out)
    else out.push({ rel: full.slice(base.length + 1), size: statSync(full).size, sha: sha256(full) })
  }
  return out
}
function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

for (const p of PLAN) {
  if (!existsSync(p.src)) die(`源目录不存在：${p.src}`)
  const linkType = (() => {
    try { return statSync(p.src).isSymbolicLink() ? 'link' : 'dir' } catch { return 'dir' }
  })()
  if (linkType === 'link') die(`${p.src} 已经是链接了，不用再搬（要重搬先手工处理）`)
  if (existsSync(p.dst) && readdirSync(p.dst).length > 0) die(`目标已存在且非空：${p.dst}`)
  const files = walk(p.src)
  const bytes = files.reduce((n, f) => n + f.size, 0)
  console.log(`[计划] ${p.name}: ${files.length} 文件 / ${(bytes / 1024).toFixed(1)} KB  ${p.src} → ${p.dst}`)
  p.files = files
}

if (dryRun) {
  console.log('dry-run：没动任何东西。确认无误后加 --yes 真做。')
  process.exit(0)
}

const rollback = []
try {
  for (const p of PLAN) {
    console.log(`[复制] ${p.name} …`)
    cpSync(p.src, p.dst, { recursive: true })
    const after = walk(p.dst)
    const beforeMap = new Map(p.files.map((f) => [f.rel, f]))
    if (after.length !== p.files.length) throw new Error(`${p.name} 复制后文件数 ${after.length} ≠ ${p.files.length}`)
    for (const f of after) {
      const b = beforeMap.get(f.rel)
      if (!b) throw new Error(`${p.name} 多出文件：${f.rel}`)
      if (b.sha !== f.sha) throw new Error(`${p.name} 内容不一致：${f.rel}`)
    }
    console.log(`[校验] ${p.name}: ${after.length} 文件 sha256 全部一致`)

    const backup = `${p.src}.pre-pool-${stamp}`
    renameSync(p.src, backup)
    rollback.push(() => { rmSync(p.dst, { recursive: true, force: true }); renameSync(backup, p.src) })
    symlinkSync(p.dst, p.src, 'junction')
    console.log(`[链接] ${p.src} → ${p.dst}`)

    // 读得出
    const probe = join(p.src, p.name === 'group' ? '群.md' : 'watchman.json')
    if (existsSync(probe)) {
      const a = sha256(probe)
      const b = sha256(join(p.dst, p.name === 'group' ? '群.md' : 'watchman.json'))
      if (a !== b) throw new Error(`${p.name} 链接后读到的内容不一致`)
    }
    // 写得进，而且真身落在 pool
    const testName = `.pool-probe-${stamp}.tmp`
    writeFileSync(join(p.src, testName), 'probe', 'utf8')
    if (!existsSync(join(p.dst, testName))) throw new Error(`${p.name} 通过链接写入后 pool 里没有`)
    rmSync(join(p.src, testName), { force: true })
    console.log(`[探针] ${p.name}: 读得出、写得进、真身落在 pool ✓`)
    p.backup = backup
  }

  console.log('')
  console.log('完成。共享区已搬到 pool，她的家路径没变（Junction）。')
  console.log(`原件留底：${PLAN.map((p) => p.backup).join('  ')}`)
  console.log('NEXT: 1) 重启 3080/3082 让新代码读 poolDir；2) 重启后跑 scripts\\doctor.ps1；3) 确认没问题再删留底目录。')
} catch (e) {
  console.error(`失败：${e.message}`)
  console.error('回滚中 …')
  for (const fn of rollback.reverse()) {
    try { fn() } catch (re) { console.error(`回滚失败：${re.message}`) }
  }
  console.error('已回滚到原状。')
  process.exit(1)
}
