// 进程内单实例防护的行为测试 + 相关文件的静态契约（2026-11-16 第五份沉淀 P1/P2/P3/P6）
//
// 背景：DSH 在同一进程里卸载/重装插件时旧 fiber 的 dispose 不一定触发，旧实例会继续写
// 旧目录并重建已删除的目录。instance-guard 用 %TEMP% 下按 pid 的登记表让旧实例自己停表。
import { readFileSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerInstance, registryPathFor } from '../plugin/dsh-lil-whale-group/lib/instance-guard.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0
const fails = []
function ok(name) {
  pass++
  console.log(`PASS ${name}`)
}
function bad(name, detail = '') {
  fails.push(name)
  console.log(`FAIL ${name}${detail ? '：' + detail : ''}`)
}
function read(rel) {
  return readFileSync(join(root, rel), 'utf8')
}
function assert(cond, name) {
  if (cond) ok(name)
  else bad(name)
}

// ── 一、行为：同进程里第二个实例登记后，第一个应判自己为幽灵 ─────────────
const a = registerInstance({ selfHome: 'X\\a', configFile: 'X\\a\\config.json', profile: 'a' })
assert(a.isGhost() === false, '只有一个实例时不是幽灵')
await new Promise((r) => setTimeout(r, 8))
const b = registerInstance({ selfHome: 'X\\b', configFile: 'X\\b\\config.json', profile: 'b' })
assert(a.isGhost() === true, '同进程里出现更新的实例后，旧实例判自己为幽灵')
assert(b.isGhost() === false, '新实例照常工作')
let cleared = false
a.addTimer(setInterval(() => {}, 1000))
a.retire()
cleared = true
assert(cleared === true, '幽灵实例 retire() 后停表（不抛错）')
a.unregister()
b.unregister()
const reg = registryPathFor()
if (existsSync(reg)) rmSync(reg, { force: true })
ok('登记表在 %TEMP% 下，与配置路径无关（可被旧实例发现）')

// ── 二、静态契约：代码里真的接线了 ────────────────────────────────────
const indexJs = read('plugin/dsh-lil-whale-group/lib/index.js')
assert(indexJs.includes("from './instance-guard.js'"), 'index.js 引入了 instance-guard')
assert(indexJs.includes('registerInstance({'), 'apply 里登记了实例')
assert((indexJs.match(/stillPrimary\(\)/g) || []).length >= 3, '三个定时器入口都有 stillPrimary 守卫')
assert(indexJs.includes('instanceGuard.addTimer(timer)'), 'wake 定时器登记进 guard')
assert(indexJs.includes('instanceGuard.addTimer(selfTimer)'), '自己的闹钟定时器登记进 guard')
assert(indexJs.includes('instanceGuard.addTimer(watchTimer)'), '巡守定时器登记进 guard')
assert(indexJs.includes('instanceGuard.unregister()'), 'dispose 时注销实例登记')

const installPs1 = read('scripts/install.ps1')
assert(installPs1.includes('旧插件实例退出'), '安装器收尾提示"旧实例不会退出"')
assert(installPs1.includes('重启前不要删旧目录'), '安装器提醒重启前别删旧目录')

const doctorPs1 = read('scripts/doctor.ps1')
assert(doctorPs1.includes('第五份沉淀 P6'), 'doctor 的启动行匹配按 profile 过滤（P6）')
assert(doctorPs1.includes('第五份沉淀 P2'), 'doctor 首装未开窗时心跳标 INFO（P2）')
assert(doctorPs1.includes("undiciLine -match '^SKIP'"), 'doctor 的 undici SKIP 标 INFO（P3）')

const releaseCheck = read('scripts/release-check.ps1')
assert(releaseCheck.includes('4n. 进程内单实例防护'), 'release-check 纳入单实例防护测试')

// ── 汇总 ─────────────────────────────────────────────────────────────
console.log('')
if (fails.length) {
  console.log(`FAIL ${fails.length} 项：${fails.join('、')}`)
  process.exit(1)
}
console.log(`PASS ${pass}/${pass} 项（单实例防护 + 安装/体检契约）`)
