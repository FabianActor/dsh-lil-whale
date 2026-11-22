#!/usr/bin/env node
/**
 * scripts\check-run-ledger.mjs 的行为测试（fi-0007，r402）。
 *
 * 判据本身写在 checker 的 --selftest 里；这里测的是**命令行这一层**：
 * 目录读不到、空目录、有坏账、两种坏法各自点名、参数不认识、被 import 时不该跑 CLI。
 * 每格都有"期望的退出码 + 必须出现/不出现的字样"，避免"绿了但说的是别的"。
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CHECKER = join(HERE, 'check-run-ledger.mjs')

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) pass++
  else failures.push(`${name}${detail ? `：${detail}` : ''}`)
}

function run(args) {
  const r = spawnSync(process.execPath, [CHECKER, ...args], { encoding: 'utf8' })
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

const GOOD = [
  '2026-11-12 19:57:23 | started | fmt=2 pid=1',
  '2026-11-12 20:22:37 | stopped | fmt=2 reason=stop-script by=fish.ps1 pid=1',
  '2026-11-12 21:00:00 | started | fmt=2 pid=2',
]
const BAD_NO_RESUME = [
  '2026-11-12 19:57:23 | started | fmt=2 pid=1',
  '2026-11-12 20:22:37 | started | fmt=2 pid=2',
]
const BAD_TWICE_STOPPED = [
  '2026-11-12 19:57:23 | started | fmt=2 pid=1',
  '2026-11-12 20:00:00 | stopped | pid=1',
  '2026-11-12 20:10:00 | stopped | pid=1',
]
const BAD_ORPHAN_STOP = [
  '2026-11-12 20:00:00 | resumed | reason=no-stop-record pid=1',
  '2026-11-12 20:00:01 | stopped | pid=1',
]

const root = mkdtempSync(join(tmpdir(), 'llw-runs-'))
try {
  // 1. 内置自测
  {
    const r = run(['--selftest'])
    check('自测退出码 0', r.code === 0, `exit=${r.code}`)
    check('自测打出 5 格', /自测 5 格，不合 0/.test(r.out), r.out.split('\n').pop())
  }

  // 2. 好账本：exit 0，点名文件与末态
  const dirGood = join(root, 'good')
  mkdirSync(dirGood)
  writeFileSync(join(dirGood, 'fish.log'), GOOD.join('\n') + '\n', 'utf8')
  {
    const r = run(['--dir', dirGood])
    check('好账本 exit 0', r.code === 0, `exit=${r.code}`)
    check('好账本点名文件与末态', /✓ fish\.log（末态=open/.test(r.out), r.out)
    check('好账本汇总 0 违规', /账本 1 \/ 违规 0/.test(r.out), r.out)
  }

  // 3. 上一个 started 没交代：exit 1 点名行号
  const dirNoResume = join(root, 'no-resume')
  mkdirSync(dirNoResume)
  writeFileSync(join(dirNoResume, 'fish.log'), BAD_NO_RESUME.join('\n') + '\n', 'utf8')
  {
    const r = run(['--dir', dirNoResume])
    check('没交代 exit 1', r.code === 1, `exit=${r.code}`)
    check('没交代点名行2', /行2 started 时上一轮还开着/.test(r.out), r.out)
    check('没交代不误报 stopped', !/stopped 但上一轮/.test(r.out), r.out)
  }

  // 4. 连关两次：exit 1
  const dirTwice = join(root, 'twice')
  mkdirSync(dirTwice)
  writeFileSync(join(dirTwice, 'fish.log'), BAD_TWICE_STOPPED.join('\n') + '\n', 'utf8')
  {
    const r = run(['--dir', dirTwice])
    check('连关两次 exit 1', r.code === 1, `exit=${r.code}`)
    check('连关两次点名行3', /行3 stopped 但上一轮不是开着/.test(r.out), r.out)
  }

  // 5. 没有开着就 stopped：exit 1
  const dirOrphan = join(root, 'orphan')
  mkdirSync(dirOrphan)
  writeFileSync(join(dirOrphan, 'fish.log'), BAD_ORPHAN_STOP.join('\n') + '\n', 'utf8')
  {
    const r = run(['--dir', dirOrphan])
    check('孤儿 stopped exit 1', r.code === 1, `exit=${r.code}`)
    check('孤儿 stopped 点名行2', /行2 stopped 但上一轮不是开着/.test(r.out), r.out)
  }

  // 6. 一好一坏：只报坏的那本
  const dirMixed = join(root, 'mixed')
  mkdirSync(dirMixed)
  writeFileSync(join(dirMixed, 'aaa.log'), GOOD.join('\n') + '\n', 'utf8')
  writeFileSync(join(dirMixed, 'bbb.log'), BAD_NO_RESUME.join('\n') + '\n', 'utf8')
  {
    const r = run(['--dir', dirMixed])
    check('一好一坏 exit 1', r.code === 1, `exit=${r.code}`)
    check('一好一坏里好账本仍 ✓', /✓ aaa\.log/.test(r.out), r.out)
    check('一好一坏里坏账本 ✗', /✗ bbb\.log/.test(r.out), r.out)
  }

  // 7. 空目录：exit 2（空的不能当全部成立）
  const dirEmpty = join(root, 'empty')
  mkdirSync(dirEmpty)
  {
    const r = run(['--dir', dirEmpty])
    check('空目录 exit 2', r.code === 2, `exit=${r.code}`)
    check('空目录说明白', /空目录不能当"全部成立"/.test(r.out), r.out)
  }

  // 8. 目录不存在：exit 2
  {
    const r = run(['--dir', join(root, 'nope')])
    check('目录不存在 exit 2', r.code === 2, `exit=${r.code}`)
    check('目录不存在给人话', /runs 目录读不到/.test(r.out), r.out)
  }

  // 9. 不认识的参数：exit 2
  {
    const r = run(['--wat'])
    check('坏参数 exit 2', r.code === 2, `exit=${r.code}`)
    check('坏参数给用法', /不认识的参数/.test(r.out), r.out)
  }

  // 10. 空行不参与判断：好账本加空行仍是 0
  const dirBlank = join(root, 'blank')
  mkdirSync(dirBlank)
  writeFileSync(join(dirBlank, 'fish.log'), `${GOOD[0]}\n\n${GOOD[1]}\n\n\n${GOOD[2]}\n`, 'utf8')
  {
    const r = run(['--dir', dirBlank])
    check('空行不影响 exit 0', r.code === 0, `exit=${r.code}`)
  }

  // 11. resumed 不关闭旧轮、只解释：started/resumed/stopped 仍成立
  const dirResumeThenStop = join(root, 'resume-stop')
  mkdirSync(dirResumeThenStop)
  writeFileSync(
    join(dirResumeThenStop, 'fish.log'),
    ['2026-11-12 19:57:23 | started | pid=1', '2026-11-12 20:00:00 | resumed | reason=unclean', '2026-11-12 20:30:00 | stopped | pid=1'].join('\n') + '\n',
    'utf8',
  )
  {
    const r = run(['--dir', dirResumeThenStop])
    check('resumed 不关闭旧轮 exit 0', r.code === 0, `exit=${r.code}｜${r.out}`)
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}

if (failures.length) {
  console.log(`✗ 不合 ${failures.length} 格`)
  for (const f of failures) console.log(`  - ${f}`)
  console.log(`\n合计 ${pass + failures.length}，PASS ${pass}，FAIL ${failures.length}`)
  process.exit(1)
}
console.log(`✓ 全部 ${pass} 格通过`)
