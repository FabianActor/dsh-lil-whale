// 配置三态测试（r242，第三条鱼 2026-11-17 实测暴露的那条）：
//   LIL_WHALE_CONFIG 指向不存在的文件时，必须报错退出，**不许**安静落回仓库里的真配置。
//
// 为什么值得单独立一个测试：这个错"对的时候和错的时候长得一样"——
// 测试跑在真鱼塘上、报的也是绿。只有负样本能把它和正常情况分开。
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { loadConfig, loadConfigOrExit, resolveConfigFile } from './lib/config-path.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tmp = mkdtempSync(join(tmpdir(), 'llw-config-test-'))
let pass = 0
let fail = 0
const failures = []

function check(name, fn) {
  try {
    fn()
    pass++
    console.log('PASS ' + name)
  } catch (e) {
    fail++
    failures.push(`${name}：${e.message}`)
    console.log('FAIL ' + name + '：' + e.message)
  }
}
function eq(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what} 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}
function ok(value, what) {
  if (!value) throw new Error(what)
}
function withEnv(value, fn) {
  const saved = process.env.LIL_WHALE_CONFIG
  if (value === undefined) delete process.env.LIL_WHALE_CONFIG
  else process.env.LIL_WHALE_CONFIG = value
  try { return fn() } finally {
    if (saved === undefined) delete process.env.LIL_WHALE_CONFIG
    else process.env.LIL_WHALE_CONFIG = saved
  }
}

// 三条假鱼塘：只有真配置 / 只有示例 / 都没有。
const repoDir = join(tmp, 'repo')
const exampleDir = join(tmp, 'example')
const emptyDir = join(tmp, 'empty')
for (const d of [repoDir, exampleDir, emptyDir]) mkdirSync(d, { recursive: true })
writeFileSync(join(repoDir, 'lil-whale.config.json'), JSON.stringify({ marker: 'repo-config' }), 'utf8')
writeFileSync(join(exampleDir, 'lil-whale.config.example.json'), JSON.stringify({ marker: 'example' }), 'utf8')
const goodFile = join(tmp, 'good.json')
writeFileSync(goodFile, JSON.stringify({ marker: 'env-config' }), 'utf8')
const badFile = join(tmp, 'bad.json')
writeFileSync(badFile, '{ 这不是 JSON', 'utf8')

// ① 没给环境变量 + 仓库根有真配置 → 用它
check('没给环境变量时读仓库根配置', () => {
  withEnv(undefined, () => {
    const out = resolveConfigFile({ repoRoot: repoDir })
    eq(out.source, 'repo', 'source')
    eq(out.path, join(repoDir, 'lil-whale.config.json'), 'path')
    eq(loadConfig({ repoRoot: repoDir }).cfg.marker, 'repo-config', 'cfg.marker')
  })
})

// ② 给了环境变量 + 文件在 → 用它，不读仓库根
check('给了环境变量且文件在时读它', () => {
  withEnv(goodFile, () => {
    const out = resolveConfigFile({ repoRoot: repoDir })
    eq(out.source, 'env-given-ok', 'source')
    eq(loadConfig({ repoRoot: repoDir }).cfg.marker, 'env-config', 'cfg.marker')
  })
})

// ③ 给了环境变量 + 文件不在 → env-given-missing，cfg 为 null，**不能**退回 repo
check('环境变量指向的文件不在时报错（不落回仓库）', () => {
  const missing = join(tmp, 'typo', 'cfg.json')
  withEnv(missing, () => {
    const out = resolveConfigFile({ repoRoot: repoDir })
    eq(out.source, 'env-given-missing', 'source')
    ok(out.error && out.error.includes('不存在'), 'error 应该说明文件不存在')
    ok(out.error.includes(missing), 'error 应该带上是哪个路径')
    ok(out.next && out.next.includes('LIL_WHALE_CONFIG'), 'next 应该给出怎么处理')
    const loaded = loadConfig({ repoRoot: repoDir })
    eq(loaded.cfg, null, 'cfg 应该是 null（没有被 repo 配置兜底）')
    eq(loaded.source, 'env-given-missing', 'loadConfig.source')
  })
})

// ④ 只给环境变量、没有例子目录 → 报错而不是 default
check('环境变量指向的文件不在、仓库也没有配置时仍是 env-given-missing', () => {
  const missing = join(tmp, 'nope.json')
  withEnv(missing, () => {
    eq(resolveConfigFile({ repoRoot: emptyDir }).source, 'env-given-missing', 'source')
  })
})

// ⑤ 环境变量指向坏 JSON → 报"读不了"，带路径
check('环境变量指向坏 JSON 时报读不了', () => {
  withEnv(badFile, () => {
    const out = loadConfig({ repoRoot: repoDir })
    ok(out.error && out.error.includes('配置读不了'), 'error 应该是配置读不了')
    ok(out.error.includes(badFile), 'error 应该带上路径')
    eq(out.cfg, null, 'cfg')
  })
})

// ⑥ 没给环境变量 + 只有示例文件 → example（安装前跑脚本用）
check('没有真配置时退到示例文件', () => {
  withEnv(undefined, () => {
    const out = resolveConfigFile({ repoRoot: exampleDir })
    eq(out.source, 'example', 'source')
    eq(loadConfig({ repoRoot: exampleDir }).cfg.marker, 'example', 'cfg.marker')
  })
})

// ⑦ 都没有 → none + 下一步
check('哪里都没有配置时给出 next', () => {
  withEnv(undefined, () => {
    const out = resolveConfigFile({ repoRoot: emptyDir, includeExample: false })
    eq(out.source, 'none', 'source')
    ok(out.next && out.next.includes('install.ps1'), 'next 应该指向 install.ps1')
  })
})

// ⑧ CLI 集成：gen-family --check 在环境变量打错字时必须 exit 1（真鱼塘不许报绿）
check('gen-family --check 在 LIL_WHALE_CONFIG 打错字时退出 1', () => {
  const r = spawnSync(process.execPath, [join(REPO, 'scripts', 'gen-family.mjs'), '--check'], {
    cwd: REPO,
    env: { ...process.env, LIL_WHALE_CONFIG: join(tmp, 'never-there.json') },
    encoding: 'utf8',
  })
  eq(r.status, 1, 'exit code')
  ok((r.stderr || '').includes('指向的文件不存在'), 'stderr 应该说明文件不存在；实际：' + (r.stderr || '').slice(0, 200))
})

// ⑨ CLI 集成：不带环境变量时仍能正常跑（别把正常路径改坏）
check('gen-family --check 不带环境变量时仍能跑', () => {
  const env = { ...process.env }
  delete env.LIL_WHALE_CONFIG
  const r = spawnSync(process.execPath, [join(REPO, 'scripts', 'gen-family.mjs'), '--check'], { cwd: REPO, env, encoding: 'utf8' })
  eq(r.status, 0, 'exit code；stdout：' + (r.stdout || '').slice(0, 200) + ' stderr：' + (r.stderr || '').slice(0, 200))
})

rmSync(tmp, { recursive: true, force: true })
console.log(`\ntest-config-path：合计 ${pass + fail}，PASS ${pass}，FAIL ${fail}`)
if (fail > 0) {
  console.log('失败项：')
  for (const f of failures) console.log('  - ' + f)
  process.exit(1)
}
