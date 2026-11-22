#!/usr/bin/env node
/**
 * watchman.log 的"裸行"判据（fi-0012，r417）。
 *
 * 共享账（pool\state\watchman.log）里的行是机器可读的：`时刻 | 事件 | 字段=值 …`。
 * 读端（小鱼丸的 check-log-shape、小肥鱼的 check-ps1 一类）按字段抓；如果某行是纯散文、
 * 一个 `=` 都没有，它就只能掉进 blind（"数不进去的行"）。
 *
 * 判据：
 *   - 分界：最后一条 `log-format` 行里的 `fmt=3`（含）之后，是"新格式"的行
 *   - 新格式的行里，不允许整行没有 `=`；有就点名行号
 *   - `fmt=3` 之前的裸行算"已知老缺口"，只数不判红（历史 append-only，不改）
 *   - 没有 `fmt=3` 分界 ⇒ 判不了（exit 2），不拿"看不见"当"没问题"
 *
 * 用法：
 *   node scripts/check-watchman-notes.mjs                 读配置里的 pool\state\watchman.log
 *   node scripts/check-watchman-notes.mjs --file <path>   读指定文件（测试用）
 *   node scripts/check-watchman-notes.mjs --selftest      只跑内置样本
 *
 * 退出码：0 没有违规 / 1 有违规（点名行号）/ 2 前提错（文件不在、没有 fmt=3 分界）。
 * 只读，不改任何东西。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfigOrExit } from './lib/config-path.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

/** 找最后一条 log-format 行里的 fmt=数字。返回 { lineNo, fmt } 或 null。 */
export function boundaryOf(lines) {
  let found = null
  lines.forEach((line, index) => {
    if (!/\|\s*log-format\s*\|/.test(line)) return
    const m = /\bfmt=(\d+)/.exec(line)
    if (!m) return
    const fmt = Number(m[1])
    if (fmt >= 3) found = { lineNo: index + 1, fmt }
  })
  return found
}

/**
 * 返回 { knownGap: [{no, line}], violations: [{no, line}], boundary }。
 * boundary 为 null 时两条都返回空数组，由调用方判"判不了"。
 */
export function scanLines(lines) {
  const boundary = boundaryOf(lines)
  const knownGap = []
  const violations = []
  if (!boundary) return { knownGap, violations, boundary }
  lines.forEach((line, index) => {
    if (/^\s*$/.test(line)) return
    if (line.includes('=')) return
    const item = { no: index + 1, line }
    if (index + 1 < boundary.lineNo) knownGap.push(item)
    else violations.push(item)
  })
  return { knownGap, violations, boundary }
}

function readLines(file) {
  return readFileSync(file, 'utf8').split(/\r?\n/)
}

const SELFTEST = [
  '2026-11-11 21:21:58 | note | 21:19:00 那条 dryrun started 是配置层自检',
  '2026-11-15 10:00:00 | log-format | fmt=3 since=2026-11-15T02:00:00.000Z changed=skip',
  '2026-11-15 10:00:01 | started | fmt=2 pid=1 prev-run=closed gap=1s',
  '2026-11-15 10:00:02 | skip | to=whale by=whale code=plan-bad-shape see=intent.log',
  '2026-11-15 10:00:03 | note | note=log-rotate rotated=1 dropped=0',
]

function runSelftest() {
  const { knownGap, violations, boundary } = scanLines(SELFTEST)
  const ok = boundary && boundary.fmt === 3 && knownGap.length === 1 && violations.length === 0
  console.log(ok ? '✓ 自测通过（老缺口 1、fmt=3 之后 0 违规）' : '✗ 自测不通过')
  if (!ok) {
    console.log('  boundary=' + JSON.stringify(boundary) + ' knownGap=' + knownGap.length + ' violations=' + violations.length)
  }
  return ok ? 0 : 1
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--selftest')) process.exit(runSelftest())
  let file = ''
  const at = args.indexOf('--file')
  if (at >= 0) file = args[at + 1] || ''
  if (!file) {
    const cfg = loadConfigOrExit({ repoRoot: REPO })
    const stateDir = cfg.poolStateDir || join(cfg.poolDir, 'state')
    file = join(stateDir, 'watchman.log')
  }
  if (!existsSync(file)) {
    console.log('xx 找不到 watchman.log：' + file)
    console.log('NEXT: 先跑一次鱼塘（巡守起来会写这本账），或用 --file 指定')
    process.exit(2)
  }
  const lines = readLines(file)
  const { knownGap, violations, boundary } = scanLines(lines)
  if (!boundary) {
    console.log('xx 账本里没有 log-format fmt=3 之后的分界，判不了哪些行算新格式')
    console.log('NEXT: 等下一次巡守启动写出 log-format（fmt>=3），或先人工确认这本账的格式')
    process.exit(2)
  }
  const first = violations[0]
  if (violations.length === 0) {
    console.log('✓ fmt=3 之后没有裸行（老缺口 ' + knownGap.length + ' 条，fmt=3 之前）')
    console.log('计数：fmt=3 后 lines=' + (lines.length - boundary.lineNo) + ' bare=0 known-gap=' + knownGap.length + ' boundary=' + boundary.lineNo)
    process.exit(0)
  }
  for (const v of violations) {
    console.log('✗ 第 ' + v.no + ' 行没有 =（fmt=3 之后）：' + v.line.trim().slice(0, 120))
  }
  console.log('计数：bare=' + violations.length + ' found=' + (first ? first.no : '') + ' known-gap=' + knownGap.length + ' boundary=' + boundary.lineNo)
  console.log('NEXT: 写端把自由文本写进 key=（如 note=xxx detail=…）；老行 append-only，不改')
  process.exit(1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
