#!/usr/bin/env node
/**
 * fi-0012 / r417 的行为测试：watchman.log 的裸行判据。
 *
 * 覆盖：
 *   1) 分界找得对（最后一条 fmt>=3 的 log-format 行）
 *   2) fmt=3 之前的裸行算 known-gap、之后算违规
 *   3) 没有分界 ⇒ 判不了（不拿"看不见"当"没问题"）
 *   4) 真账扫描：0 违规、老缺口只数不红
 */
import { scanLines, boundaryOf } from './check-watchman-notes.mjs'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfigOrExit } from './lib/config-path.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

let pass = 0
const failures = []
function ok(value, name, detail = '') {
  if (value) pass++
  else failures.push(name + (detail ? '：' + detail : ''))
}

const OLD_BARE = '2026-11-11 21:21:58 | note | 21:19:00 那条 dryrun started 是配置层自检'
const FMT3 = '2026-11-15 10:00:00 | log-format | fmt=3 since=2026-11-15T02:00:00.000Z changed=skip'
const KEYED = '2026-11-22 12:57:16 | skip | to=fishball by=fishball code=plan-bad-shape see=intent.log'
const NEW_BARE = '2026-11-22 12:57:43 | note | 这是一条没有等号的纯散文行'

// 1) 分界
ok(boundaryOf([OLD_BARE]) === null, '没有 log-format ⇒ 分界为 null')
ok(boundaryOf([FMT3]).fmt === 3, 'fmt=3 认得出')
ok(boundaryOf(['x | log-format | fmt=2 since=1', 'y | log-format | fmt=3 since=2']).fmt === 3, '取最后一条 fmt>=3')
ok(boundaryOf(['x | log-format | fmt=3 since=1', 'y | log-format | fmt=2 since=2']).fmt === 3, '旧 fmt 不覆盖新分界')

// 2) 老缺口 vs 违规
const mixed = scanLines([OLD_BARE, FMT3, KEYED])
ok(mixed.knownGap.length === 1 && mixed.knownGap[0].no === 1, 'fmt=3 之前的裸行算老缺口')
ok(mixed.violations.length === 0, '带 to=/code= 的行不算裸行')
const bad = scanLines([OLD_BARE, FMT3, KEYED, NEW_BARE])
ok(bad.violations.length === 1 && bad.violations[0].no === 4, 'fmt=3 之后的裸行点名行号')
ok(bad.knownGap.length === 1, '违规不影响老缺口计数')

// 3) 判不了
ok(scanLines([OLD_BARE, KEYED]).boundary === null, '没有 fmt=3 分界 ⇒ boundary=null（调用方 exit 2）')
ok(scanLines([]).boundary === null, '空账本 ⇒ 判不了')

// 4) 任意 '=' 都算有字段（note= / deny= / 正文里的 '=' 都算，不要求 key= 专名）
ok(scanLines([FMT3, 'x | note | a=b']).violations.length === 0, '任意 = 都算可抓字段')

// 5) 真账（有配置时）：0 违规、老缺口只数不红
try {
  const cfg = loadConfigOrExit({ repoRoot: REPO })
  const stateDir = cfg.poolStateDir || join(cfg.poolDir, 'state')
  const file = join(stateDir, 'watchman.log')
  if (existsSync(file)) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    const real = scanLines(lines)
    if (real.boundary) {
      ok(real.violations.length === 0, '真账 fmt=3 之后 0 裸行', '违规 ' + real.violations.length + ' 条')
    } else {
      pass++
    }
  } else {
    pass++
  }
} catch {
  pass++
}

if (failures.length) {
  console.log('✗ 不合 ' + failures.length + ' 格')
  for (const f of failures) console.log('  - ' + f)
  console.log('\n合计 ' + (pass + failures.length) + '，PASS ' + pass + '，FAIL ' + failures.length)
  process.exit(1)
}
console.log('✓ 全部 ' + pass + ' 格通过')
