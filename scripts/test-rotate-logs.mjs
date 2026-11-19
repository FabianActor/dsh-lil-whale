#!/usr/bin/env node
// 日志轮转的两条边界（fi-0005，r390）：
//   ① 已经切下来的份不能再被切（否则名字一路往后接，"只留 3 份"永远数不到它们）；
//   ② 轮转与丢弃各落一行账（巡守 detached 起它，stdout 没人看；日志也是证据）。
// 全程在临时目录里跑，不碰真池子。
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync, mkdirSync, utimesSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = dirname(HERE)
const SCRIPT = join(HERE, 'rotate-logs.mjs')

let pass = 0
let fail = 0
function ok(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ok  ${name}`)
  } else {
    fail++
    console.log(`  xx  ${name}${detail ? '：' + detail : ''}`)
  }
}
function run(dir, extra = []) {
  return spawnSync(process.execPath, [SCRIPT, '--dir', dir, '--state-dir', dir, ...extra], {
    cwd: APP,
    encoding: 'utf8',
    timeout: 30000,
  })
}
function rotatedNames(dir) {
  return readdirSync(dir).filter((n) => /\.\d{8}-\d{6}(?:-\d+)?\.log$/.test(n))
}
function bigFile(dir, name, bytes = 1100 * 1024) {
  writeFileSync(join(dir, name), 'x'.repeat(bytes), 'utf8')
}
function readLedger(dir) {
  const p = join(dir, 'rotate.log')
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

const root = mkdtempSync(join(tmpdir(), 'llw-rotate-'))
const dir = join(root, 'logs')
mkdirSync(dir, { recursive: true })

try {
  console.log('— 第一次：切一份；第二次：已经切下来的份不再切 —')
  bigFile(dir, 'fakeapp.log')
  const r1 = run(dir)
  ok('第 1 次 rotated=1', /rotated=1/.test(r1.stdout), r1.stdout.trim())
  ok('原账已改名，留下 1 份带时间戳的账', !readdirSync(dir).includes('fakeapp.log') && rotatedNames(dir).length === 1, rotatedNames(dir).join(','))
  const firstRotated = rotatedNames(dir)[0]
  const r2 = run(dir)
  ok('第 2 次 rotated=0（不再切已切下来的份）', /rotated=0/.test(r2.stdout), r2.stdout.trim())
  ok('第 2 次没有产生新名字', rotatedNames(dir).length === 1 && rotatedNames(dir)[0] === firstRotated, rotatedNames(dir).join(','))

  console.log('— 只留 3 份：历史堆下来的也会被收回到 3 份 —')
  for (let i = 0; i < 4; i++) {
    const name = `fakeapp.2026110${i + 1}-000000.log`
    writeFileSync(join(dir, name), `old-${i}`, 'utf8')
    const t = new Date(2026, 10, i + 1, 0, 0, 0)
    utimesSync(join(dir, name), t, t)
  }
  const before = rotatedNames(dir).length
  const r3 = run(dir)
  const after = rotatedNames(dir).length
  ok('第 3 次把多出来的份收掉（收到 3 份）', new RegExp(`dropped=${before - 3}`).test(r3.stdout), `before=${before} after=${after} ${r3.stdout.trim()}`)
  ok('轮转产物只剩 3 份', after === 3, rotatedNames(dir).sort().join(','))

  console.log('— 账本：轮转/丢弃/汇总都有行 —')
  const ledger = readLedger(dir)
  ok('写了 rotate.log', ledger.length > 0)
  ok('有汇总行 note=log-rotate rotated=', /note=log-rotate rotated=\d+ dropped=\d+/.test(ledger))
  ok('有轮转行 from/to/bytes', /note=log-rotate-rotated from=.*bytes=\d+ to=.*\.log/.test(ledger))
  ok('有丢弃行 file/bytes', /note=log-rotate-dropped file=.*bytes=\d+/.test(ledger))

  console.log('— dry-run：只看不写 —')
  bigFile(dir, 'fakeapp.log')
  const namesBefore = readdirSync(dir).sort().join(',')
  const ledgerBefore = readLedger(dir)
  const dry = run(dir, ['--dry-run'])
  ok('dry-run 打印 would-rotate', /would-rotate/.test(dry.stdout), dry.stdout.trim())
  ok('dry-run 不改目录、不写账', readdirSync(dir).includes('fakeapp.log') && readLedger(dir) === ledgerBefore, `before=${namesBefore}`)
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log(`test-rotate-logs：合计 ${pass + fail}，PASS ${pass}，FAIL ${fail}`)
process.exit(fail > 0 ? 1 : 0)
