// 查「中立 preset」有没有落后于 standard。
//
// 为什么要这一格：`gen-neutral-preset.mjs` 的注释自己写着「preset 的 plugins 列表是完整快照，
// 覆盖后不会自动合并上游更新」。快照一旦落后，用 neutral 起的新会话就少几只手——2026-11-27
// 凌晨就是这样：换段把一条鱼从 standard（69 件）换到 neutral（67 件），少了 office 三件，
// 而她当时什么错都没犯。
//
// 判据：同一份 `--dump-config` 里，standard 与 neutral 的插件 id 差集必须是空的。
// 用 dump 而不是读 patch：patch 里只有我们写的那段，dump 才是真挂载的东西。
//
// 用法：
//   node scripts\check-neutral-preset.mjs                # 查名册里所有鱼
//   node scripts\check-neutral-preset.mjs --member lee2  # 只查一条
//   node scripts\check-neutral-preset.mjs --json
//
// 退出码：0 全部对得上；3 有鱼落后（WARN 级：能跑，但用 neutral 起的新会话会少手）；
//         2 没有可查的鱼或没装 neutral；1 跑不起来（要让体检报"这次没查成"，不是"查过没事"）。
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadConfigOrExit } from './lib/config-path.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 从 dump-config 的文本里切出某个 preset 块的插件 id。按缩进走，不猜 YAML。 */
export function presetPluginIds(text, presetId) {
  const lines = String(text ?? '').split(/\r?\n/)
  const head = lines.findIndex((l) => new RegExp(`^\\s*- id: preset-${presetId}\\s*$`).test(l))
  if (head < 0) return null
  let end = lines.length
  for (let i = head + 1; i < lines.length; i += 1) {
    if (/^- id: \S/.test(lines[i])) { end = i; break }
    if (/^- name: /.test(lines[i])) { end = i; break }
  }
  const ids = []
  for (let i = head + 1; i < end; i += 1) {
    const m = /^\s+- id: (\S+)\s*$/.exec(lines[i])
    if (m) ids.push(m[1])
  }
  return ids
}

/** 两份清单的差集：neutral 少了哪些 standard 有的。纯函数，给测试用。 */
export function missingPluginsOf(standardIds, neutralIds) {
  if (!Array.isArray(standardIds) || !Array.isArray(neutralIds)) return []
  const have = new Set(neutralIds)
  return standardIds.filter((id) => !have.has(id))
}

function main() {
  const argv = process.argv.slice(2)
  const flag = (n) => argv.includes(`--${n}`)
  const opt = (n, d) => {
    const i = argv.indexOf(`--${n}`)
    return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : d
  }

  const cfg = loadConfigOrExit({ repoRoot })
  const pondRoot = cfg.pondRoot || path.resolve(repoRoot, '..')
  const json = flag('json')

  function fishOf() {
    const one = opt('member', '')
    if (one) {
      return [{ key: one, dshHome: path.join(pondRoot, 'homes', one, 'dsh-home'), profile: one }]
    }
    const out = []
    try {
      const members = JSON.parse(fs.readFileSync(path.join(pondRoot, 'pool', 'members.json'), 'utf8'))
      for (const [key, m] of Object.entries(members?.members ?? {})) {
        if (!m || m.lifecycle === 'archived') continue
        if (m.kind && m.kind !== 'fish') continue
        const dshHome = m.dshHome || path.join(pondRoot, 'homes', key, 'dsh-home')
        if (!fs.existsSync(path.join(dshHome, 'profiles', key, 'cordis.patch.yml'))) continue
        out.push({ key, dshHome, profile: key })
      }
    } catch { /* 名册读不到就只查点名的 */ }
    if (out.length === 0 && cfg.herDshHome) {
      out.push({ key: cfg.herProfile || 'whale', dshHome: cfg.herDshHome, profile: cfg.herProfile || 'whale' })
    }
    return out
  }

  const fish = fishOf()
  if (fish.length === 0) {
    if (json) console.log(JSON.stringify({ ok: false, reason: 'no-fish', fish: [] }))
    else console.log('没有可查的鱼（名册里没有 fish，配置里也没点名）。')
    process.exit(2)
  }

  const rows = []
  let failed = false
  let drift = false
  for (const f of fish) {
    const r = spawnSync('dsh', ['--profile', f.profile, '--dump-config'], {
      cwd: path.join(f.dshHome, 'profiles', f.profile),
      env: { ...process.env, DSH_HOME: f.dshHome },
      encoding: 'utf8',
      shell: process.platform === 'win32',
      maxBuffer: 32 * 1024 * 1024,
    })
    if (r.status !== 0) {
      rows.push({ member: f.key, state: 'dump-failed', detail: (r.stderr || '').slice(0, 200) })
      failed = true
      continue
    }
    const standard = presetPluginIds(r.stdout, 'standard')
    const neutral = presetPluginIds(r.stdout, 'neutral')
    if (standard === null) { rows.push({ member: f.key, state: 'no-standard' }); failed = true; continue }
    if (neutral === null) { rows.push({ member: f.key, state: 'no-neutral' }); continue }
    const missing = missingPluginsOf(standard, neutral)
    if (missing.length > 0) drift = true
    rows.push({ member: f.key, state: missing.length ? 'behind' : 'ok', missing })
  }

  if (json) {
    console.log(JSON.stringify({ ok: !failed && !drift, fish: rows }, null, 2))
  } else {
    for (const r of rows) {
      if (r.state === 'ok') console.log(`ok   ${r.member}：neutral 与 standard 的插件清单一致`)
      else if (r.state === 'behind') console.log(`落后 ${r.member}：neutral 少 ${r.missing.length} 件 —— ${r.missing.join(', ')}`)
      else if (r.state === 'no-neutral') console.log(`没有 ${r.member}：她的 patch 里没装 preset-neutral（不换段就没事）`)
      else console.log(`查不了 ${r.member}：${r.state}${r.detail ? ' —— ' + r.detail : ''}`)
    }
    if (drift) console.log('NEXT: node scripts\\gen-neutral-preset.mjs --profile <键> 重新生成，再用 scripts\\apply-neutral-preset.mjs --home <她的 DSH_HOME> 装进去；装完要重启一次')
  }

  process.exit(failed ? 1 : drift ? 3 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()