// 一次性迁移：把两个 profile 的 package.json 里的包名从 dsh-group* 改成 lil-whale-group*
// 用 node 做，是因为刚才用 PowerShell 的字符串索引把数组展开成了字符串、把文件写坏过一次。
import { readFileSync, writeFileSync } from 'node:fs'

const MAP = { 'dsh-group-ui': 'lil-whale-group-ui', 'dsh-group': 'lil-whale-group' }

for (const file of process.argv.slice(2)) {
  const raw = readFileSync(file, 'utf8')
  const pkg = JSON.parse(raw)
  const before = JSON.stringify(pkg)

  if (pkg.dependencies) {
    const next = {}
    for (const [key, value] of Object.entries(pkg.dependencies)) next[MAP[key] ?? key] = value
    pkg.dependencies = next
  }
  const bundles = pkg?.dsh?.profile?.bundles
  if (Array.isArray(bundles)) {
    pkg.dsh.profile.bundles = bundles.map((name) => MAP[name] ?? name)
  }

  const after = JSON.stringify(pkg)
  if (before === after) {
    console.log(`unchanged  ${file}`)
    continue
  }
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
  console.log(`rewritten  ${file}`)
  const hitDeps = Object.keys(pkg.dependencies ?? {}).filter((k) => k.startsWith('lil-whale'))
  const hitBundles = (pkg?.dsh?.profile?.bundles ?? []).filter((k) => k.startsWith('lil-whale'))
  console.log(`   deps: ${hitDeps.join(', ') || '(none)'}`)
  console.log(`   bundles: ${hitBundles.join(', ') || '(none)'}`)
}
