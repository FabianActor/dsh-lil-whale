// test-family-check.mjs -- 谱系校验的负样本（2026-11-18 r293）
//
// 背景：小鱼丸 #1709 用假塘证明"父全写坏、键全在 ⇒ gen-family --check 与 doctor 两边都绿"；
// 小满 #1670–#1672 抓到 boot 行镜像丢 note。这条测试把三件事钉住：
//   1. gen-family --check 对 parent=0 / '' / 不存在的键 必须 exit 1 并说清原因（[garbage-parent] 锚）；
//   2. members-add 不再让 0 从 `??` 下面走过去（旧写法 :90 的 truthiness 会跳过它）；
//   3. doctor 的「谱系（全鱼）」真的调用 gen-family --check，且不再教人跑假的 `--seed`。
//
// 全部用临时目录 + LIL_WHALE_CONFIG 指过去，不碰真鱼塘、不写任何真文件。

import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, openSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GEN = join(REPO, 'scripts', 'gen-family.mjs')
const MEMBERS_ADD = join(REPO, 'scripts', 'members-add.mjs')
const DOCTOR = join(REPO, 'scripts', 'doctor.ps1')
const INDEX_JS = join(REPO, 'plugin', 'dsh-lil-whale-group', 'lib', 'index.js')

let pass = 0
let fail = 0
function ok(name, cond, detail) {
  if (cond) {
    pass++
    console.log(`ok ${name}`)
  } else {
    fail++
    console.log(`FAIL ${name}${detail ? ' —— ' + detail : ''}`)
  }
}

const root = mkdtempSync(join(tmpdir(), 'llw-family-'))

function makeCase(name, familyParent, opts = {}) {
  const dir = join(root, name)
  mkdirSync(join(dir, 'pool'), { recursive: true })
  const members = {
    version: 2,
    updatedAt: '2026-11-18T00:00:00.000Z',
    members: {
      lee: { name: 'Leea', kind: 'fish', role: 'watcher', parent: null },
      fabian: { name: 'Fabian', kind: 'human', parent: null },
      fish: { name: 'fish', kind: 'fish', parent: opts.memberParent === undefined ? 'lee' : opts.memberParent },
    },
  }
  const family = {
    version: 1,
    updatedAt: '2026-11-18T00:00:00.000Z',
    nodes: {
      lee: { name: 'Leea', parent: null, bornAt: null, lifecycle: 'active', note: '', renames: [] },
      fabian: { name: 'Fabian', parent: null, bornAt: null, lifecycle: 'active', note: '', renames: [] },
      fish: { name: 'fish', parent: familyParent, bornAt: null, lifecycle: 'active', note: '', renames: [] },
    },
  }
  const cfg = {
    repoRoot: REPO,
    poolDir: join(dir, 'pool'),
    groupDir: join(dir, 'group'),
    selfHome: dir,
    membersFile: join(dir, 'pool', 'members.json'),
    configFile: join(dir, 'config.json'),
  }
  writeFileSync(join(dir, 'pool', 'members.json'), JSON.stringify(members, null, 2) + '\n', 'utf8')
  writeFileSync(join(dir, 'pool', 'family.json'), JSON.stringify(family, null, 2) + '\n', 'utf8')
  writeFileSync(join(dir, 'config.json'), JSON.stringify(cfg, null, 2) + '\n', 'utf8')
  return { dir, cfgFile: join(dir, 'config.json'), membersFile: join(dir, 'pool', 'members.json') }
}

// 子进程的输出写到文件、再读回来——不走管道。
// 2026-11-18 小鱼丸 #1742：鱼沙箱里 spawnSync 的管道拿不到 stdout，`status` 全是 null，
// 同一份测试宿主上 22/22、鱼上 7/22——红的原因在取数那一步，那就别走那一步。
let runSeq = 0
function run(cwd, args, cfgFile, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv }
  if (cfgFile) env.LIL_WHALE_CONFIG = cfgFile
  else delete env.LIL_WHALE_CONFIG
  const logFile = join(tmpdir(), `llw-tfc-${process.pid}-${++runSeq}.log`)
  const fd = openSync(logFile, 'w')
  let status = null
  try {
    const r = spawnSync(process.execPath, args, { cwd, env, stdio: ['ignore', fd, fd] })
    status = r.status
  } finally {
    closeSync(fd)
  }
  const out = readFileSync(logFile, 'utf8')
  rmSync(logFile, { force: true })
  return { code: status, out }
}

// 1) 干净数据：exit 0
{
  const c = makeCase('clean', 'lee')
  const r = run(REPO, [GEN, '--check'], c.cfgFile)
  ok('gen-family：干净数据 exit 0', r.code === 0, `exit=${r.code} ${r.out.slice(0, 120)}`)
  ok('gen-family：干净数据说"谱系校验通过"', /谱系校验通过/.test(r.out), r.out.slice(0, 200))
}

// 2) parent = 0（数字）：旧代码会被 truthiness 跳过并当根；新代码必须 exit 1 + [garbage-parent]
{
  const c = makeCase('num-zero', 0)
  const r = run(REPO, [GEN, '--check'], c.cfgFile)
  ok('gen-family：parent=0 exit 1', r.code === 1, `exit=${r.code}`)
  ok('gen-family：parent=0 带 [garbage-parent] 锚', /\[garbage-parent\]/.test(r.out), r.out.slice(0, 240))
  ok('gen-family：parent=0 原样印出坏值', /实际是 0/.test(r.out), r.out.slice(0, 240))
  // 小鱼丸 #1742：坏数据下不能先打一句· 鱼有 3 个根（并列）、再打 xx [garbage-parent]——两句话描述同一份数据。
  ok('gen-family：坏父时不打印根清单（两个结论不打架）', !/个根（并列）/.test(r.out), r.out.slice(0, 240))
}

// 3) parent = ''（空串）：不是"没有父"，也要 exit 1
{
  const c = makeCase('empty-str', '')
  const r = run(REPO, [GEN, '--check'], c.cfgFile)
  ok('gen-family：parent="" exit 1', r.code === 1, `exit=${r.code}`)
  ok('gen-family：parent="" 说清空串不是"没有父"', /空字符串/.test(r.out), r.out.slice(0, 240))
}

// 4) parent 指向不存在的键：exit 1，原因写出来
{
  const c = makeCase('missing-key', 'ghost')
  const r = run(REPO, [GEN, '--check'], c.cfgFile)
  ok('gen-family：父不存在 exit 1', r.code === 1, `exit=${r.code}`)
  ok('gen-family：父不存在指出 ghost', /parent=ghost 不存在/.test(r.out), r.out.slice(0, 240))
}

// 4b) parent = 'none'（字符串）：`fish.ps1 new -Parent none` / `members-add --parent none` 的写法，
// 但落到 family.json 里要写 null。手抄进来时要给 [garbage-parent] 锚，不能混成"找不到叫 none 的人"。
// 小鱼丸 #1748（2026-11-18）。
{
  const c = makeCase('none-str', 'none')
  const r = run(REPO, [GEN, '--check'], c.cfgFile)
  ok('gen-family：parent="none" exit 1', r.code === 1, `exit=${r.code}`)
  ok('gen-family：parent="none" 带 [garbage-parent] 锚', /\[garbage-parent\]/.test(r.out), r.out.slice(0, 240))
  ok('gen-family：parent="none" 说清要写 null', /要写 null/.test(r.out), r.out.slice(0, 240))
  ok('gen-family：parent="none" 不混成"不存在"', !/parent=none 不存在/.test(r.out), r.out.slice(0, 240))
}

// 5) 未知参数：exit 2（与 r242 的配置三态同口径——2 是"我读不了/用法错"，不是"数据坏"）
{
  const c = makeCase('unknown-arg', 'lee')
  const r = run(REPO, [GEN, '--nonsense'], c.cfgFile)
  ok('gen-family：未知参数 exit 2', r.code === 2, `exit=${r.code}`)
}

// 6) members-add：名册里手改出来的 parent=0 不能再被原样保留（旧 :90 truthiness 会跳过）
{
  const c = makeCase('members-zero', 'lee', { memberParent: 0 })
  const r = run(REPO, [MEMBERS_ADD, '--key', 'fish', '--name', 'fish'], c.cfgFile)
  ok('members-add：prev.parent=0 被拒', r.code === 1, `exit=${r.code} ${r.out.slice(0, 160)}`)
  ok('members-add：拒绝理由说清只允许 null 或键', /只允许 null/.test(r.out), r.out.slice(0, 240))
  const after = JSON.parse(readFileSync(c.membersFile, 'utf8'))
  ok('members-add：被拒时没把 0 写回名册', after.members.fish.parent === 0, JSON.stringify(after.members.fish.parent))
}

// 7) members-add：--parent ghost 被拒；--parent none 写成 null
{
  const c = makeCase('members-add', 'lee')
  const bad = run(REPO, [MEMBERS_ADD, '--key', 'fish', '--name', 'fish', '--parent', 'ghost'], c.cfgFile)
  ok('members-add：--parent ghost 被拒', bad.code === 1, `exit=${bad.code}`)
  const good = run(REPO, [MEMBERS_ADD, '--key', 'fish', '--name', 'fish', '--parent', 'none'], c.cfgFile)
  ok('members-add：--parent none exit 0', good.code === 0, `exit=${good.code} ${good.out.slice(0, 160)}`)
  const after = JSON.parse(readFileSync(c.membersFile, 'utf8'))
  ok('members-add：--parent none 落成 null', after.members.fish.parent === null, JSON.stringify(after.members.fish.parent))
}

// 8) 静态接线：doctor 真的调用 gen-family --check，并且不再教人跑假的 --seed 重生成
{
  const doctor = readFileSync(DOCTOR, 'utf8')
  ok('doctor：调 gen-family --check', /gen-family\.mjs['"\s]+--check|--check['"\s]+2>&1/.test(doctor) || /genFamily --check/.test(doctor), '找不到调用')
  ok('doctor：不再出现「--seed 重生成」的 NEXT', !/--seed 重生成/.test(doctor), '旧 NEXT 还在')
  ok('doctor：谱系格有 exit 1 分支', /gen-family --check exit 1/.test(doctor), '没找到映射文案')
}

// 9) 静态接线：boot 行镜像用同一个对象（note 不再只贴给 bootLog）
{
  const src = readFileSync(INDEX_JS, 'utf8')
  ok('index.js：boot 一次拼好（bootRecordWithNote）', /const bootRecordWithNote = \{ at: new Date\(\)\.toISOString\(\), note: 'boot', \.\.\.bootRecord \}/.test(src))
  ok('index.js：bootLog 与镜像都用 bootRecordWithNote', /bootLog\(bootRecordWithNote\)/.test(src) && /\.\.\.bootRecordWithNote/.test(src))
  ok('index.js：镜像不再单独 spread bootRecord', !/\.\.\.bootRecord \}\)/.test(src), '还有旧镜像')
}

rmSync(root, { recursive: true, force: true })

console.log(`\ntest-family-check：合计 ${pass + fail}，PASS ${pass}，FAIL ${fail}`)
process.exit(fail ? 1 : 0)
