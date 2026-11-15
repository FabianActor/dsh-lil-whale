// members-add.mjs -- 往 pool\members.json 里加一条鱼（或更新它）。
//
// 为什么要有它：名册是数据，不是代码。加一条鱼不该去改脚本、更不该手改 JSON 再祈祷字段对。
// 它只做加法：已存在的成员保留原来手改过的 name（她要改名，不能被脚本改回去），只补/改你明确给的字段。
//
// 用法：
//   node scripts\members-add.mjs --key fishball --name 小鱼丸 --parent lee \
//        --port 3083 --home <她的家> \
//        --dshHome <她的家>\dsh-home \
//        --profile fishball --configFile lil-whale.config.fishball.json \
//        --lifecycle active|archived [--dry-run]
//
// 失败时最后一行是 NEXT:，退出码 1。

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function die(msg, next) {
  console.error('xx ' + msg)
  console.error('')
  console.error('NEXT: ' + next)
  process.exit(1)
}

function readConfig() {
  const tries = [process.env.LIL_WHALE_CONFIG, join(REPO, 'lil-whale.config.json'), join(REPO, 'lil-whale.config.example.json')]
  for (const p of tries) {
    if (!p) continue
    if (!existsSync(p)) continue
    try {
      return JSON.parse(readFileSync(p, 'utf8'))
    } catch (e) {
      die(`配置读不了：${p}（${e.message}）`, '先修好那份 JSON，或删掉它重新生成')
    }
  }
  die('找不到配置（LIL_WHALE_CONFIG / 仓库根 lil-whale.config.json）', '先跑 install.ps1，或把 lil-whale.config.example.json 复制成 lil-whale.config.json')
}

const args = process.argv.slice(2)
function opt(name) {
  const i = args.indexOf('--' + name)
  if (i < 0) return undefined
  const v = args[i + 1]
  if (v === undefined || v.startsWith('--')) return ''
  return v
}
const dryRun = args.includes('--dry-run')
// 未知参数拒绝：以前写错一个参数名也会照常跑完（拿默认值把名册写坏）。
const maKnown = ['--key', '--name', '--parent', '--port', '--home', '--dshHome', '--profile', '--configFile', '--lifecycle', '--bornAt', '--dry-run']
const maUnknown = args.filter((a) => a.startsWith('--') && !maKnown.includes(a))
if (maUnknown.length > 0) {
  console.error('未知参数：' + maUnknown.join(' '))
  console.error('用法：node scripts\\members-add.mjs --key <键> --name <名字> [--parent lee] [--port 3083] [--home <家>] [--dshHome <家>\\dsh-home] [--profile <p>] [--lifecycle active|archived] [--dry-run]')
  process.exit(2)
}

const key = opt('key')
if (!key) die('缺 --key', '例如：node scripts\\members-add.mjs --key fishball --name 小鱼丸 --parent lee --port 3083 ...')
if (!/^[a-z][a-z0-9-]{1,23}$/.test(key)) die(`--key 形状不对：${key}`, '只用小写字母、数字、连字符，2–24 个字符')

const cfg = readConfig()
const membersFile = join(cfg.poolDir || join(REPO, '..', 'lil-whale-pool'), 'members.json')
if (!existsSync(membersFile)) die(`名册不存在：${membersFile}`, '先跑 node scripts\\migrate-members.mjs 生成它')

let raw
try {
  raw = JSON.parse(readFileSync(membersFile, 'utf8'))
} catch (e) {
  die(`名册不是合法 JSON：${membersFile}（${e.message}）`, '从备份恢复；不要手改坏了再存')
}
if (!raw.members || typeof raw.members !== 'object') die('名册里没有 members 对象', '跑 migrate-members.mjs 重建')

const prev = raw.members[key] || {}
const now = {
  name: opt('name') || prev.name || key,
  kind: opt('kind') || prev.kind || 'fish',
  role: opt('role') || prev.role || 'member',
  parent: opt('parent') !== undefined ? (opt('parent') || null) : (prev.parent ?? null),
  bornAt: opt('bornAt') || prev.bornAt || new Date().toISOString().slice(0, 10),
  home: opt('home') || prev.home || null,
  dshHome: opt('dshHome') || prev.dshHome || null,
  profile: opt('profile') || prev.profile || null,
  port: opt('port') ? Number(opt('port')) : (prev.port ?? null),
  cwd: opt('cwd') || prev.cwd || opt('home') || prev.home || null,
  sessionId: opt('sessionId') || prev.sessionId || null,
  configFile: opt('configFile') || prev.configFile || null,
  lifecycle: opt('lifecycle') || prev.lifecycle || 'active',
}

// 父必须存在（除了人类和根）
if (now.parent && !raw.members[now.parent] && now.parent !== 'lee') {
  die(`--parent 指向不存在的人：${now.parent}`, `先加 ${now.parent}，或改成 lee`)
}
if (now.parent === key) die('不能自己是自己的爹', '换一个 --parent')

raw.members[key] = now
raw.updatedAt = new Date().toISOString()

if (dryRun) {
  console.log('[dry-run] 将要写入：')
  console.log(JSON.stringify({ [key]: now }, null, 2))
  process.exit(0)
}

const tmp = membersFile + '.tmp-' + process.pid
writeFileSync(tmp, JSON.stringify(raw, null, 2) + '\n', 'utf8')
const { renameSync } = await import('node:fs')
renameSync(tmp, membersFile)
console.log(`✓ ${key} -> ${now.name}（${now.role} / ${now.port ?? '无端口'} / ${now.lifecycle}）写进 ${membersFile}`)
if (prev.name && prev.name !== now.name) console.log(`  注意：名字从「${prev.name}」改成了「${now.name}」—— 改名史要记进 family.json（gen-family.mjs 会读）`)
