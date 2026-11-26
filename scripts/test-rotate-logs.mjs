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
function run(dir, extra = [], env = {}) {
  return spawnSync(process.execPath, [SCRIPT, '--dir', dir, '--state-dir', dir, ...extra], {
    cwd: APP,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, ...env },
  })
}
function rotatedNames(dir) {
  // 新旧两种形状都算（r469 之后以 `<base>.log.<stamp>` 为准，旧文件仍留在盘上）
  return readdirSync(dir).filter((n) => /\.log\.\d{8}-\d{6}(?:-\d+)?$/.test(n) || /\.\d{8}-\d{6}(?:-\d+)?\.log$/.test(n))
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

  console.log('— 排序看名字里的时间戳，不看 mtime —')
  const dir2 = join(root, 'logs2')
  mkdirSync(dir2, { recursive: true })
  const names2 = ['fake2.20261101-000000.log', 'fake2.20261102-000000.log', 'fake2.20261103-000000.log', 'fake2.20261104-000000.log']
  for (const n of names2) writeFileSync(join(dir2, n), 'same', 'utf8')
  // 故意把名字最老的那份 mtime 设成最新：按 mtime 排会留错人
  utimesSync(join(dir2, names2[0]), new Date(2026, 10, 19, 12, 0, 0), new Date(2026, 10, 19, 12, 0, 0))
  for (let i = 1; i < 4; i++) {
    const t = new Date(2026, 10, i, 0, 0, 0)
    utimesSync(join(dir2, names2[i]), t, t)
  }
  const r4 = run(dir2)
  const left2 = readdirSync(dir2).filter((n) => /\.\d{8}-\d{6}(?:-\d+)?\.log$/.test(n)).sort()
  ok('按名字排：丢掉名字最老那份（mtime 最新也不留）', /dropped=1/.test(r4.stdout) && !left2.includes(names2[0]), left2.join(','))
  ok('留在盘上的是名字最新的三份', left2.join(',') === names2.slice(1).join(','), left2.join(','))

  console.log('— 账本：轮转/丢弃/汇总都有行 —')
  const ledger = readLedger(dir)
  ok('写了 rotate.log', ledger.length > 0)
  ok('有汇总行 note=log-rotate rotated=', /note=log-rotate rotated=\d+ dropped=\d+/.test(ledger))
  ok('有轮转行 from/to/bytes/hash', /note=log-rotate-rotated from=.*bytes=\d+ to=\S+\.log\.\d{8}-\d{6}(-\d+)? hash=[0-9a-f]{12}$/m.test(ledger))
  ok('有丢弃行 file/bytes/hash', /note=log-rotate-dropped file=.*bytes=\d+ hash=([0-9a-f]{12}|unknown)/.test(ledger))

  ok('轮转行带 12 位内容指纹', /note=log-rotate-rotated .* hash=[0-9a-f]{12}/.test(ledger))
  ok('丢弃行带内容指纹（12 位或 unknown）', /note=log-rotate-dropped .* hash=([0-9a-f]{12}|unknown)/.test(ledger))

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

  console.log('— 配置与账本失败：不静默 —')
  const badCfg = run(dir, ['--dry-run'], { LIL_WHALE_CONFIG: join(root, 'nope.json') })
  const badText = badCfg.stdout + badCfg.stderr
  ok('给了坏配置：退出码非 0', badCfg.status !== 0, 'status=' + badCfg.status)
  ok('给了坏配置：点名 LIL_WHALE_CONFIG、不出现 roots=code', /LIL_WHALE_CONFIG/.test(badText) && !/roots=code/.test(badCfg.stdout), badText.trim().split(/\r?\n/)[0])
  const dir3 = join(root, 'logs3')
  mkdirSync(dir3, { recursive: true })
  bigFile(dir3, 'fake3.log')
  mkdirSync(join(dir3, 'rotate.log'), { recursive: true })
  const r5 = run(dir3)
  ok('账本写不进：输出 ledger-failed', /ledger-failed/.test(r5.stdout), r5.stdout.trim().split(/\r?\n/)[0])
  ok('账本写不进：退出码非 0', r5.status !== 0, 'status=' + r5.status)
console.log(`test-rotate-logs：合计 ${pass + fail}，PASS ${pass}，FAIL ${fail}`)
process.exit(fail > 0 ? 1 : 0)
