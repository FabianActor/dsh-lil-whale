#!/usr/bin/env node
/**
 * 重新生成一条鱼的 `环境.md`。
 *
 * 为什么要有这个脚本：`环境.md` 是"这个环境里有什么"的说明书，装在鱼的家目录里。
 * 但家目录是**数据**，我们不该为了改一句话去动它 —— 于是这份说明书以前只能由安装脚本写一次，
 * 之后代码改了、名册加了鱼、路径搬了家，纸还是旧的。Fabian 2026-11-12 20:10 指出来：
 * "随着我们不断修bug，总有些文件的描述会过期，但有些描述放在小鱼的目录内"。
 *
 * 做法：模板（templates/环境.md.tpl）+ 现场数据（名册、配置、真实工具清单）→ 整篇重写。
 * 不局部替换：这份文件是生成的，允许整篇覆盖；但整篇覆盖必须能回答"我覆盖的是哪一版"，
 * 所以末尾写一行机器可读的指纹 `<!-- env: template=<sha8> generated=<时间> -->`，
 * doctor 拿它和当前模板比，过期就报出来。
 *
 * 用法：
 *   node scripts/render-env.mjs --workspace D:\...\lil-whale-2 --profile fishball --pool-dir D:\...\lil-whale-pool
 *   node scripts/render-env.mjs ... --dry-run        # 只打印，不写
 *
 * 退出码：0 = 写了（或 dry-run 打印了）；1 = 失败（并给 NEXT: 一行）。
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { biliSectionOf } from '../advanced notes on third-party plugins/让小鱼能看B站-bili-eyes/scripts/bili-section.mjs'
import { drawSectionOf } from './draw-section.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
// 2026-11-15：默认值和"默认值+覆盖"只在 wake-config.js 里写一份。
// 以前这里用正则读 index.js 的文字形状 —— 形态一改就静默退回硬编码（小肥鱼抓到的"纸在骗人"）。
import { resolveWake } from '../plugin/dsh-lil-whale-group/lib/wake-config.js'

const REPO_ROOT = resolve(HERE, '..')

function die(message) {
  console.error(`render-env: ${message}`)
  console.error('NEXT: 检查 --workspace / --profile / --pool-dir；配置坏了就看 pool\\members.json')
  process.exit(1)
}

function parseArgs(argv) {
  const out = { dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[i + 1]
      if (v === undefined || v.startsWith('--')) die(`${a} 后面缺一个值`)
      i++
      return v
    }
    if (a === '--workspace') out.workspace = next()
    else if (a === '--profile') out.profile = next()
    else if (a === '--pool-dir') out.poolDir = next()
    else if (a === '--her-port') out.herPort = Number(next())
    else if (a === '--config') out.config = next()
    else if (a === '--deploy-date') out.deployDate = next()
    else if (a === '--child-name') out.childName = next()
    else if (a === '--child-id') out.childId = next()
    else if (a === '--parent-id') out.parentId = next()
    else if (a === '--out') out.out = next()
    else if (a === '--newborn') out.newborn = true
    else if (a === '--dry-run') out.dryRun = true
    else if (a === '--help' || a === '-h') {
      console.log('用法：node scripts/render-env.mjs --workspace <家> --profile <profile> [--pool-dir <共享区>] [--newborn] [--dry-run]')
      process.exit(0)
    } else die(`不认识的参数：${a}`)
  }
  if (!out.workspace) die('缺 --workspace')
  if (!out.profile) die('缺 --profile')
  return out
}

const args = parseArgs(process.argv.slice(2))
const workspace = resolve(args.workspace)
const poolDir = resolve(args.poolDir || join(workspace, '..', 'lil-whale-pool'))
const outPath = resolve(args.out || join(workspace, '环境.md'))
const membersFile = join(poolDir, 'members.json')

let roster
if (existsSync(membersFile)) {
  try {
    roster = JSON.parse(readFileSync(membersFile, 'utf8'))
  } catch (e) {
    die(`名册读不了（${membersFile}）：${e.message}`)
  }
} else {
  // 干净机器上还没有名册（第一次安装）：用安装参数现场拼一份最小的。
  // 为什么允许这样：环境.md 是装完就该有的东西；不能因为"共享区还没建名册"就让她的家里缺一页。
  const childId = args.childId || args.profile
  const childName = args.childName || childId
  const parentId = args.parentId && args.parentId !== 'none' ? args.parentId : null
  const rosterMembers = {}
  if (parentId) rosterMembers[parentId] = { name: '宿主', kind: 'fish', role: 'watcher', parent: null, profile: 'web' }
  rosterMembers[childId] = { name: childName, kind: 'fish', role: 'member', parent: parentId, profile: args.profile, home: workspace, dshHome: join(workspace, 'dsh-home') }
  rosterMembers.human = { name: '人类', kind: 'human', role: 'human', parent: null }
  roster = {
    version: 1,
    updatedAt: new Date().toISOString(),
    members: rosterMembers,
  }
  console.error(`render-env: 还没有 ${membersFile}，按安装参数拼了一份临时名册（${Object.keys(roster.members).join(' / ')}）`)
}
const members = roster?.members && typeof roster.members === 'object' ? roster.members : null
if (!members) die('名册里没有 members 字段')

// 名册存在但还没有这条鱼（装第二条鱼时 members.json 先于这一步存在）：只在内存里补一条，
// 让 环境.md 能写出来；名册本身由 install.ps1 的名册步骤负责写。
if (
  !Object.keys(members).some((k) => members[k]?.profile === args.profile) &&
  !Object.keys(members).some((k) => members[k]?.home && resolve(members[k].home) === workspace)
) {
  const childId = args.childId || args.profile
  const childName = args.childName || childId
  const parentId = args.parentId && args.parentId !== 'none' ? args.parentId : null
  members[childId] = {
    name: childName, kind: 'fish', role: 'member', parent: parentId,
    profile: args.profile, home: workspace, dshHome: join(workspace, 'dsh-home'),
  }
  console.error(`render-env: 名册里还没有这条鱼，按安装参数临时补了一条（${childId}）；名册本身由 install.ps1 负责写`)
}

// 哪一条是我：按 profile 认；认不出来就用 workspace 对 home 认。
const myKey =
  Object.keys(members).find((k) => members[k]?.profile === args.profile) ||
  Object.keys(members).find((k) => members[k]?.home && resolve(members[k].home) === workspace)
if (!myKey) die(`名册里没有 profile=${args.profile} 也没有 home=${workspace} 的成员`)
const me = members[myKey]

// ---- 名册表：写清"谁是谁"，而不是写死三个 id ----
// 2026-11-12 20:10 Fabian 问"固定槽位中的变量名是否应该脱敏"：
// 不能脱敏 —— `to` 里写的就是 id，藏起来等于让她没法叫人。该修的是"名册会变"这件事没写在纸上。
function relationOf(key, m) {
  if (key === myKey) return '你'
  if (m?.kind === 'human') return '人（不跑轮，只读消息）'
  if (m?.role === 'watcher') return '宿主（巡守）'
  if (m?.parent === myKey) return '你的下一代'
  if (myKey && me?.parent && m?.parent === me.parent) return '同辈（同一个家长）'
  if (key === me?.parent) return '你的家长'
  if (m?.parent === me?.parent && m?.parent === null) return '另一个根（并列，没有家长）'
  return m?.kind === 'fish' ? '另一条鱼' : '成员'
}
const memberRows = Object.keys(members)
  .map((key) => `| \`${key}\` | ${members[key]?.name ?? key} | ${relationOf(key, members[key])} |`)
  .join('\n')
const membersTable = [
  '| id（`to` 里写这个） | 称呼 | 对你来说 |',
  '|---|---|---|',
  memberRows,
].join('\n')

// ---- 工具清单：必须是真实挂载的，不能手写 ----
// 2026-11-16 小满 #774：纸上的清单只在宿主跑 refresh 时才算得出来——
// 鱼在自己家跑 refresh 时写不了 `dsh-home`（沙箱故意不给写），`dsh --dump-config` 会去写
// `profiles\<键>\cordis.yml`，于是整段退化成"没能算出工具清单"。
// 判据："鱼自己跑 refresh，纸只会更旧不会更差" ⇒ 算不出来时沿用上一次纸上那份，并写明原因。
function carriedToolsFromPaper(file) {
  if (!existsSync(file)) return null
  try {
    const text = readFileSync(file, 'utf8')
    const m = text.match(/## 你能做什么\s*\n([\s\S]*?)\n## /)
    if (!m) return null
    const lines = m[1]
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.startsWith('- '))
      .filter((l) => !l.startsWith('- （'))
    return lines.length ? lines : null
  } catch {
    return null
  }
}
let toolsText = '- （工具清单没能自动生成，见下面那行提示）'
// 纸末指纹里的计数（2026-11-16 三条鱼）：让"这张纸被人算过"变成能 grep 的数。
// 单位是"挂载项（组）"，不是"件"——一个插件可能带好几只手，两个数不在一起加。
// source=dump 是"这次真算了"；source=carried 是"沿用上一次"——数不在＝没算过，不能和 0 混。
// 2026-11-17 第四条鱼 #1012：数不到的 bundle 也要有字段，否则读者会把它读成"没有"。
// 只列"带手、但不进 dump 默认组合段"的第三方 bundle；核心包与我们自己的两个包不算。
const CORE_BUNDLES = new Set(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
const OWN_BUNDLE = /^@fabianactor\/dsh-lil-whale-group(-ui)?$/
function externalBundlesOf(dshHome, profile) {
  try {
    const pkg = JSON.parse(readFileSync(join(dshHome, 'profiles', profile, 'package.json'), 'utf8'))
    const arr = pkg?.dsh?.profile?.bundles
    if (!Array.isArray(arr)) return null
    const ext = arr
      .filter((b) => typeof b === 'string' && b && !CORE_BUNDLES.has(b) && !OWN_BUNDLE.test(b))
      .sort()
    return ext
  } catch {
    return null
  }
}
let bundlesField = 'unknown'
let toolsMeta = `tools=unknown skipped=unknown internal=unknown unit=mounts source=no-paper bundles=${bundlesField}`
const toolsScript = join(REPO_ROOT, 'scripts', 'tools-from-profile.mjs')
if (existsSync(toolsScript)) {
  const dshHome = me?.dshHome || join(workspace, 'dsh-home')
  const extBundles = externalBundlesOf(dshHome, args.profile)
  bundlesField = extBundles === null ? 'unknown' : extBundles.length ? extBundles.join(',') : 'none'
  const r = spawnSync(process.execPath, [toolsScript, '--profile', args.profile], {
    env: { ...process.env, DSH_HOME: dshHome },
    encoding: 'utf8',
  })
  let parsed = null
  try {
    parsed = r.stdout ? JSON.parse(r.stdout) : null
  } catch {
    parsed = null
  }
  if (parsed?.ok && Array.isArray(parsed.tools) && parsed.tools.length > 0) {
    const lines = parsed.tools.map((t) => `- ${t.line}`)
    lines.push('- 在群里说话（`group_say`）')
    toolsText = lines.join('\n')
    const c = parsed.counts || {}
    // 名单也按原因分组（第二条鱼 #824）：读者要能回答"是哪两个"，做不出就等于没写。
    const idsOf = (kind) =>
      (parsed.skipped || [])
        .filter((s) => s.kind === kind)
        .map((s) => s.id)
        .sort()
        .join(',')
    toolsMeta = `tools=${c.listed ?? parsed.tools.length} skipped=${c.skipped ?? (parsed.skipped || []).length} internal=${c.internal ?? 0} unit=mounts source=dump`
    // skipped 的方向（第二条鱼 #816）：disabled/unjudged/nodoc 各几个，0 的不写。
    const dirParts = [
      ['skipped-disabled', c.skippedDisabled],
      ['skipped-unjudged', c.skippedUnjudged],
      ['skipped-nodoc', c.skippedNoDoc],
    ]
      .filter(([, n]) => Number(n) > 0)
      .map(([k, n]) => `${k}=${n}`)
    if (dirParts.length) toolsMeta += ' ' + dirParts.join(' ')
    for (const kind of ['disabled', 'unjudged', 'nodoc']) {
      const ids = idsOf(kind)
      if (ids) toolsMeta += ` skipped-${kind}-ids=${ids}`
    }
    if (c.evalRules) toolsMeta += ` eval-rules=${c.evalRules}`
    toolsMeta += ` bundles=${bundlesField}`
  } else {
    const carried = carriedToolsFromPaper(outPath)
    if (carried) {
      const note =
        '- （注：这次没能重新算工具清单——这里写不了 `dsh-home`，`--dump-config` 跑不起来。' +
        '上面这一份是**沿用上一次成功算出的**，不是新算的；要更新请宿主在鱼塘根跑 ' +
        '`fish.ps1 refresh ' + (args.profile || myKey) + '`。）'
      toolsText = carried.join('\n') + '\n' + note
      toolsMeta = `tools=unknown skipped=unknown internal=unknown unit=mounts source=carried bundles=${bundlesField}`
      console.error('render-env: 工具清单没能重算（' + (parsed?.reason ?? '跑不起来').slice(0, 120) + '），沿用上一次纸上的清单')
    } else {
      toolsText = `- （没能从 --dump-config 算出工具清单：${parsed?.reason ?? '跑不起来'}；这份纸里也没有旧的清单可沿用）`
      toolsMeta = 'tools=unknown skipped=unknown internal=unknown unit=mounts source=no-paper'
    }
  }
}

// ---- 叫醒参数：用共享定义；输入路径要写在纸上（小肥鱼 08:48） ----
function readCfgForPaper(cfgPathOverride) {
  const cfgPath = cfgPathOverride || process.env.LIL_WHALE_CONFIG || join(REPO_ROOT, 'lil-whale.config.json')
  try {
    const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {}
    return { cfg, path: cfgPath, readOk: true, error: null }
  } catch (error) {
    return { cfg: {}, path: cfgPath, readOk: false, error: error.message }
  }
}
const cfgInfo = readCfgForPaper(args.config ? resolve(args.config) : '')
const wake = resolveWake(cfgInfo.cfg)

// ---- 生效值：唯一写者是巡守进程（2026-11-15 小肥鱼/小鱼丸） ----
// 代码里的是默认值、配置能覆盖；只有跑起来的那个进程知道真正的数。
// 读不到就明说读不到 —— 别让代码默认值冒充正在生效的数。
function readWakeCaps() {
  const file = join(poolDir, 'state', 'wake-caps.json')
  if (!existsSync(file)) return { ok: false, why: '文件不存在（巡守还没写过）', file }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const atMs = Date.parse(raw?.at ?? '')
    if (!Number.isFinite(atMs)) return { ok: false, why: '文件里没有可读的 at', file }
    const ageMin = Math.round((Date.now() - atMs) / 60000)
    const fresh = ageMin <= 5
    return { ok: fresh, why: fresh ? '' : `已经 ${ageMin} 分钟没更新`, raw, atMs, ageMin, file }
  } catch (error) {
    return { ok: false, why: `文件读不出来：${error.message}`, file }
  }
}
const capsInfo = readWakeCaps()
const caps = capsInfo.ok && capsInfo.raw?.caps ? capsInfo.raw.caps : null
// 生效值以巡守写的那份为准；没写就明说，别拿渲染器自己的输入冒充
if (caps) {
  for (const key of ['cooldownSec', 'perHour', 'perDay', 'totalPerDay', 'maxWakesPerDay']) {
    const v = Number(caps[key])
    if (Number.isFinite(v) && v > 0) wake[key] = v
  }
}
const pad2 = (n) => String(n).padStart(2, '0')
const capsAtLocal = capsInfo.ok
  ? (() => {
      const d = new Date(capsInfo.atMs)
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
    })()
  : ''
// 纸不该"自述"路径，该"转抄"路径（小肥鱼 2026-11-15 08:51）：
// 转抄 wake-caps.json 里巡守自己写的 source —— 转述有出处，自述只有自信。
// 数字只有一份（CAPS_TEXT）；下面这段只说来源，不再重复数字（小肥鱼 2026-11-15 08:54）。
// 兜底那一档不写路径：兜底的定义就是"没有文件参与"（鱼丸）。
const capsOverrides = Array.isArray(capsInfo.raw?.source?.overrides) ? capsInfo.raw.source.overrides : []
const capsSourceText = capsOverrides.length ? '配置覆盖了 ' + capsOverrides.join('、') : '配置里没有 wake 键 → 用默认值'
const capsCfgPath = String(capsInfo.raw?.source?.configFile ?? '')
const capsText = '两次之间至少隔 ' + wake.cooldownSec + ' 秒、每人每小时最多 ' + wake.perHour + ' 次、每天最多 ' + wake.perDay + ' 次、全池每天最多 ' + wake.totalPerDay + ' 次、巡守推门最多 ' + wake.maxWakesPerDay + ' 次'
const capsAtText = capsAtLocal
const capsPid = capsInfo.raw?.pid ?? '?'
const fmtLocalIso = (iso) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}
// 输入自己的时间戳（小鱼丸 2026-11-15 09:26）：at 在走只证明写者活着，
// 两个都动（at + configMtime）才证明"它读的确实是现在这份配置"。
const capsCfgMtime = capsInfo.ok ? fmtLocalIso(capsInfo.raw?.source?.configMtime) : ''
const capsCfgMtimeNow = capsInfo.ok ? fmtLocalIso(capsInfo.raw?.source?.configMtimeNow) : ''
const cfgChangedAfterLoad = Boolean(capsCfgMtime && capsCfgMtimeNow && capsCfgMtime !== capsCfgMtimeNow)
let capsNote = caps
  ? (capsCfgPath
      ? '（来源：转抄 pool/state/wake-caps.json 的 source —— 巡守读的是 ' + capsCfgPath + '（' + capsSourceText + '），于 ' + capsAtText + ' 写出，pid ' + capsPid + '）'
      : '（来源：巡守没记下它读的是哪份配置（source.configFile 空），于 ' + capsAtText + ' 写出，pid ' + capsPid + '）')
  : '（读不到巡守写出的生效值：' + capsInfo.why + ' —— 上面这几个数是代码默认值，可能不是正在生效的；没有来源路径可抄，等巡守写出 wake-caps.json 再刷新这张纸）'
if (cfgChangedAfterLoad) {
  capsNote += '——**注意：配置文件在巡守加载之后被改过**（加载时 ' + capsCfgMtime + '，现在 ' + capsCfgMtimeNow + '）；生效值仍是加载时那份，要等巡守重启才变'
}

// ---- 模板与指纹 ----
const templatePath = join(REPO_ROOT, 'templates', '环境.md.tpl')
if (!existsSync(templatePath)) die(`找不到模板：${templatePath}`)
const template = readFileSync(templatePath, 'utf8')
const templateSha = createHash('sha256').update(template).digest('hex').slice(0, 8)

const now = new Date()
const pad = (n) => String(n).padStart(2, '0')
const generatedAt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`

// 安装日期：优先沿用旧文件里那一行（那是"这个家什么时候装出来的"，重生成不该改它）
function previousDeployDate() {
  if (!existsSync(outPath)) return null
  const m = readFileSync(outPath, 'utf8').match(/^- `?(\d{4}-\d{2}-\d{2})`? 安装时生成/m)
  return m ? m[1] : null
}
const deployDate = args.deployDate || previousDeployDate() || me?.bornAt || generatedAt.slice(0, 10)

const herHome = resolve(me?.home || workspace)
const herDshHome = resolve(me?.dshHome || join(herHome, 'dsh-home'))
const herPort = Number(args.herPort || me?.port || 0) || 3082
const groupDir = join(poolDir, 'group')

// 新生鱼的纸只写基本信息（宿主 2026-11-15）：
// "新生小鱼的时候，只把它的最基本信息告知，剩下的后装插件赋予的能力一概不写。"
// 为什么不在模板里简单留空：模板会长；留空只保证"现在没有"，开关保证"以后也不会写进去"。
// 判据：出生那一刻的纸里，不能出现她还没有的任何能力名（外部眼睛、画笔、生图……）。
// 注意：这只是"出生时"的写法。宿主后来真装了扩展、跑 fish.ps1 refresh，纸才会出现那一节。
const isNewborn = Boolean(args.newborn)
const biliSection = isNewborn
  ? ''
  : biliSectionOf({ dshHome: me?.dshHome || join(workspace, 'dsh-home'), profile: args.profile })
const drawSection = isNewborn ? '' : drawSectionOf({ workspace, home: me?.home || workspace })

const values = {
  HER_HOME: herHome,
  HER_DSH_HOME: herDshHome,
  HER_PORT: String(herPort),
  GROUP_DIR: groupDir,
  POOL_DIR: poolDir,
  CAPS_NOTE: capsNote,
  CAPS_TEXT: capsText,
  TOKEN_PER_TURN: '180-200',
  CHILD_NAME: me?.name ?? myKey,
  CHILD_ID: myKey,
  PARENT_ID: me?.parent ?? 'none',
  HUMAN_ID: Object.keys(members).find((k) => members[k]?.kind === 'human') ?? 'human',
  TOOLS: toolsText,
  TOOLS_META: toolsMeta,
  MEMBERS_TABLE: membersTable,
  TEMPLATE_SHA: templateSha,
  GENERATED_AT: generatedAt,
  DEPLOY_DATE: deployDate,
  BILI_SECTION: biliSection,
  DRAW_SECTION: drawSection,
}

let rendered = template
for (const [key, value] of Object.entries(values)) {
  rendered = rendered.split(`{{${key}}}`).join(String(value))
}
const leftover = rendered.match(/\{\{[A-Z_]+\}\}/g)
if (leftover) die(`模板里有没被替换的占位符：${[...new Set(leftover)].join(', ')}`)

if (args.dryRun) {
  process.stdout.write(rendered)
  console.error(`\n[dry-run] 本来会写：${outPath}（模板 ${templateSha}，生成于 ${generatedAt}）`)
  process.exit(0)
}

writeFileSync(outPath, rendered, 'utf8')
console.log(`环境.md 已重新生成：${outPath}`)
const toolLines = toolsText.split('\n').filter((l) => l.startsWith('- ') && !l.startsWith('- （')).length
console.log(`  名册 ${Object.keys(members).length} 人；工具 ${toolLines} 条；模板 ${templateSha}；生成于 ${generatedAt}`)
