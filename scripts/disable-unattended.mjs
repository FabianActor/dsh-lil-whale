// 把 profile patch 里旧的 agent-loop 无人值守块删掉。
// 为什么删：agent-loop 直接 resume 会话，不经过 session-controller 的 composeAgent，
// preset 的工具挂不上去（2026-11-13 事故：小鱼丸手里只剩 group_say 和 working_directory）。
// 现在由群插件在进程内调 sessionController.agents.resume(sessionId) 挂载。
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from './lib/config-path.mjs'

const args = process.argv.slice(2)
const opt = (name, fallback = '') => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}
const member = opt('--member')
if (!member) {
  console.error('用法：node scripts/disable-unattended.mjs --member <键> [--patch <文件>]')
  process.exit(1)
}

// 三态见 lib/config-path.mjs（r242）：env 给的文件不在时退出，不再当"没有配置"处理。
const cfgOut = loadConfig({ repoRoot: process.cwd(), includeExample: false })
if (cfgOut.error && cfgOut.source === 'env-given-missing') {
  console.error(`xx ${cfgOut.error}\n\nNEXT: ${cfgOut.next}`)
  process.exit(1)
}
const cfg = cfgOut.cfg || {}
const membersFile = cfg.membersFile ?? join(cfg.poolDir ?? join(cfg.herHome ?? '.', '..', 'lil-whale-pool'), 'members.json')
const members = JSON.parse(readFileSync(membersFile, 'utf8'))
const m = members.members?.[member] ?? members[member]
if (!m) { console.error(`名册里没有 ${member}`); process.exit(1) }

const patch = opt('--patch') || join(m.dshHome ?? join(cfg.herHome ?? '.', 'dsh-home'), 'profiles', m.profile ?? member, 'cordis.patch.yml')
if (!existsSync(patch)) { console.error(`找不到 ${patch}`); process.exit(1) }

const raw = readFileSync(patch, 'utf8')
const lines = raw.split(/\r?\n/)
const start = lines.findIndex((l) => l.includes('无人值守'))
if (start < 0) { console.log('没有 agent-loop 块，跳过'); process.exit(0) }
const endRel = lines.slice(start).findIndex((l) => l.includes('无人值守结束'))
const end = endRel < 0 ? lines.length : start + endRel + 1
const kept = [...lines.slice(0, start), ...lines.slice(end)]
while (kept.length && kept[kept.length - 1].trim() === '') kept.pop()
copyFileSync(patch, `${patch}.bak-disable-unattended-${Date.now()}`)
writeFileSync(patch, kept.join('\r\n') + '\r\n')
console.log(`已删掉 ${member} 的 agent-loop 块：${patch}`)
