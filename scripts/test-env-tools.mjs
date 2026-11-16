#!/usr/bin/env node
/**
 * 回归测试：`render-env.mjs` 在"算不出工具清单"时必须沿用上一次纸上的清单（r180，第三条鱼 #774）。
 *
 * 为什么要有这个测试：鱼在自己家跑 refresh 时写不了 `dsh-home`，`dsh --dump-config` 会失败；
 * 旧行为是把工具段退化成一个错误提示——等于把一份能读的纸改成不能读的。
 * 判据是"纸只会更旧，不会更差"，所以这里断言：旧清单行还在、且有一行"沿用"的注。
 *
 * 用法：node scripts/test-env-tools.mjs   （exit 0 = PASS）
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(HERE)
const renderEnv = join(REPO, 'scripts', 'render-env.mjs')

const root = mkdtempSync(join(tmpdir(), 'llw-env-tools-'))
const home = join(root, 'home')
const pool = join(root, 'pool')
mkdirSync(home, { recursive: true })
mkdirSync(pool, { recursive: true })

const failures = []
function ok(cond, message) {
  if (!cond) failures.push(message)
}

try {
  // 假纸：上一次成功算出来的清单（三行 + group_say 那行）
  const fakePaper = [
    '## 你能做什么',
    '',
    '这些是工具（旧版说明）。',
    '',
    '- 旧清单第一条（读写文件）',
    '- 旧清单第二条（跑命令）',
    '- 在群里说话（`group_say`）',
    '',
    '（群发言不是工具包给的。）',
    '',
    '没列在这里的，就是你现在没有那只手。',
    '',
    '## 群怎么用',
    '',
    '随便写点。',
    '',
  ].join('\n')
  writeFileSync(join(home, '环境.md'), fakePaper, 'utf8')

  // 名册：dshHome 指向一个不存在的目录 ⇒ dump-config 必然失败（模拟沙箱写不了 dsh-home）
  const members = {
    version: 1,
    updatedAt: new Date().toISOString(),
    members: {
      xiaoman: {
        name: '小满', kind: 'fish', role: 'member', parent: 'fishball', profile: 'xiaoman',
        home, dshHome: join(root, 'no-such-dsh-home'), port: 3084,
      },
      lee: { name: '大肥鱼', kind: 'fish', role: 'watcher', parent: null, profile: 'web' },
      fabian: { name: 'Fabian', kind: 'human', role: 'human', parent: null },
    },
  }
  writeFileSync(join(pool, 'members.json'), JSON.stringify(members), 'utf8')

  const r = spawnSync(
    process.execPath,
    [renderEnv, '--workspace', home, '--profile', 'xiaoman', '--pool-dir', pool, '--dry-run'],
    { encoding: 'utf8' },
  )
  const out = `${r.stdout || ''}\n${r.stderr || ''}`
  ok(r.status === 0, `render-env 退出码 ${r.status}（应为 0）`)
  ok(out.includes('沿用上一次成功算出的'), '缺少"沿用上一次成功算出的"注记')
  ok(out.includes('旧清单第一条（读写文件）'), '旧清单第一行丢了')
  ok(out.includes('旧清单第二条（跑命令）'), '旧清单第二行丢了')
  ok(out.includes('在这之前没能重新算工具清单') === false, '不该出现旧版退化提示')

  // 负样本：没有旧纸时，应明确说"没有旧的清单可沿用"，而不是假装算出来了
  const home2 = join(root, 'home2')
  mkdirSync(home2, { recursive: true })
  const r2 = spawnSync(
    process.execPath,
    [renderEnv, '--workspace', home2, '--profile', 'xiaoman', '--pool-dir', pool, '--dry-run'],
    { encoding: 'utf8' },
  )
  const out2 = `${r2.stdout || ''}\n${r2.stderr || ''}`
  ok(out2.includes('也没有旧的清单可沿用'), '没有旧纸时缺少"没有旧的清单可沿用"的说明')
} finally {
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    /* 临时目录清不掉不算测试失败 */
  }
}

if (failures.length) {
  console.log('FAIL test-env-tools：')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('PASS test-env-tools（2 条断言：沿用旧清单 + 无旧纸时明说）')
