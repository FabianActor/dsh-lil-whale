// test-host-anchors.mjs —— 宿主包定位的回归测试（2026-11-16 r195）
//
// 背景：第三方在一台只有 npx 版 dsh 的机器上装插件时，老代码只认 npm 全局安装位置，
// 三个锚点全落空 ⇒ defineTool/createUserMessage 为 null、工具降级、日志每秒一行。
//
// 这个测试不启动 DSH，只验"候选锚点是否包含 npx 缓存里的那份 dsh"。

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { hostAnchors, dshPkgFromEntry, hostExportEntryCandidates } from '../plugin/dsh-lil-whale-group/lib/host-anchors.js'

const problems = []
function check(name, ok, detail) {
  if (!ok) problems.push(detail ? `${name}：${detail}` : name)
}

const tmp = mkdtempSync(join(tmpdir(), 'llw-anchors-'))
const saved = {
  npm_config_cache: process.env.npm_config_cache,
  DSH_LAUNCHER_MODULE: process.env.DSH_LAUNCHER_MODULE,
}
try {
  const cache = join(tmp, 'npm-cache')
  const pkgDir = join(cache, '_npx', 'abc123', 'node_modules', '@deepseek-ai', 'dsh')
  mkdirSync(pkgDir, { recursive: true })
  const pkgJson = join(pkgDir, 'package.json')
  writeFileSync(pkgJson, JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.2-rc.1' }), 'utf8')

  // 1) 清掉环境变量，确保命中的只能是 npx 缓存扫描
  delete process.env.DSH_LAUNCHER_MODULE
  process.env.npm_config_cache = cache

  const anchors = hostAnchors()
  const hit = anchors.find((a) => a.kind === 'npx-cache')
  check('能扫到 npx 缓存里的 dsh', Boolean(hit), hit ? '' : `anchors=${JSON.stringify(anchors.map((a) => a.kind))}`)
  if (hit) check('npx 锚点指向那份 package.json', hit.file === pkgJson, hit.file)

  // 2) 从入口文件往上找到 package.json
  const entry = join(pkgDir, 'lib', 'index.js')
  check('从入口向上找到 dsh/package.json', dshPkgFromEntry(entry) === pkgJson, String(dshPkgFromEntry(entry)))

  // 3) 名字不对的 package.json 不算
  const fake = join(tmp, 'fake', 'lib', 'index.js')
  mkdirSync(join(tmp, 'fake'), { recursive: true })
  writeFileSync(join(tmp, 'fake', 'package.json'), JSON.stringify({ name: 'not-dsh' }), 'utf8')
  check('别的包名不会被当成 dsh', dshPkgFromEntry(fake) === null)

  // 4) 宿主包入口候选：嵌套（npm 全局）与兄弟（npx/pnpm hoisted）都要在（2026-11-16 r199）
  const cands = hostExportEntryCandidates(pkgJson, 'dsh-tools')
  const nestedOk = join(pkgDir, 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js')
  const hoistedOk = join(dirname(pkgDir), 'dsh-tools', 'lib', 'index.js')
  check('候选含嵌套布局', cands.some((c) => c.layout === 'nested' && c.file === nestedOk), JSON.stringify(cands))
  check('候选含兄弟布局', cands.some((c) => c.layout === 'hoisted' && c.file === hoistedOk), JSON.stringify(cands))
  // 兄弟布局真的存在时，候选路径也得指向一个存在的文件（不需要能 import）。
  const flatLib = join(dirname(pkgDir), 'dsh-tools', 'lib')
  mkdirSync(flatLib, { recursive: true })
  writeFileSync(join(flatLib, 'index.js'), 'export const ok = true\n', 'utf8')
  check('兄弟布局真实文件可被候选命中', cands.some((c) => c.layout === 'hoisted' && existsSync(c.file)))

  // 5) 没有 npm_config_cache 与 LOCALAPPDATA 时，npx 扫描安静地返回空
  delete process.env.npm_config_cache
  const savedLocal = process.env.LOCALAPPDATA
  delete process.env.LOCALAPPDATA
  try {
    check('没有缓存路径时不报错', hostAnchors().every((a) => a.kind !== 'npx-cache'))
  } finally {
    if (savedLocal !== undefined) process.env.LOCALAPPDATA = savedLocal
  }
} finally {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  rmSync(tmp, { recursive: true, force: true })
}

if (problems.length) {
  console.log('FAIL test-host-anchors')
  for (const p of problems) console.log('  - ' + p)
  process.exit(1)
}
console.log('PASS test-host-anchors（6 组）')
