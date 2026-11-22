#!/usr/bin/env node
/**
 * runs 账的判据（fi-0007，小鱼丸 2026-11-19 提，2026-11-22 收进基座）。
 *
 * 每一轮启动都要有"上一轮怎么结束的"交代：
 *   - 账本第一条可以是 started（历史从这里开始）
 *   - 之后每条 started，前面紧挨着必须是 stopped 或 resumed
 *   - resumed 只是解释（"上一轮没写 stopped"），它自己不开启新一轮、也不关闭旧的一轮
 *   - stopped 只能出现在开着的轮次之后
 *
 * 为什么值得当判据：插件里 resumed 就是"上一轮崩了没留账"的补记；若某次启动既没 stopped
 * 也没 resumed，"上一轮怎么没的"就永远查不到——这是"删了/没记，在账上一个样"的同族。
 *
 * 用法：
 *   node scripts/check-run-ledger.mjs            读配置里的 pool\state\runs
 *   node scripts/check-run-ledger.mjs --dir <dir>  读指定目录（测试用）
 *   node scripts/check-run-ledger.mjs --selftest  只跑内置样本
 *
 * 退出码：0 全部成立 / 1 有违规 / 2 前提错（目录/账本/参数）。空目录算前提错，不算"全部成立"。
 * 不改任何东西，只读。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfigOrExit } from './lib/config-path.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

/** 一行属于哪一类：'started'|'stopped'|'resumed'|null。按第二格取，避免正文里出现同词误判。 */
function eventOf(line) {
  if (!line || /^\s*$/.test(line)) return null
  const parts = line.split('|')
  if (parts.length < 2) return null
  const tag = parts[1].trim()
  return tag === 'started' || tag === 'stopped' || tag === 'resumed' ? tag : null
}

/**
 * 返回 { errs, state, lines }：errs 是违规说明；state 是末态 none/open/closed。
 * 行号按"去掉空行后的行号"，与账本里肉眼数的行不一定一致时，输出会带原文行号。
 */
export function checkLines(rows) {
  const errs = []
  const lines = rows.map((line, index) => ({ line, no: index + 1 })).filter(({ line }) => !/^\s*$/.test(line))
  let state = 'none'
  for (let i = 0; i < lines.length; i++) {
    const { line, no } = lines[i]
    const ev = eventOf(line)
    if (ev === null) continue
    if (ev === 'resumed') continue // 只是解释：不开一轮，也不关一轮
    if (ev === 'stopped') {
      if (state !== 'open') errs.push(`行${no} stopped 但上一轮不是开着（state=${state}）`)
      state = 'closed'
      continue
    }
    // started
    if (state === 'open') {
      const prev = lines[i - 1]
      const explained = prev !== undefined && eventOf(prev.line) === 'resumed'
      if (!explained) errs.push(`行${no} started 时上一轮还开着、且前面没有 resumed 解释（行${prev?.no ?? '-'}）`)
    } else if (state === 'none' && i > 0) {
      errs.push(`行${no} started 之前既没 stopped 也没 resumed 交代`)
    }
    state = 'open'
  }
  return { errs, state, lines: lines.length }
}

const GOOD = [
  '2026-11-12 19:57:23 | started | fmt=2 pid=1',
  '2026-11-12 20:22:37 | stopped | fmt=2 reason=stop-script by=fish.ps1 pid=1',
  '2026-11-12 21:00:00 | started | fmt=2 pid=2',
  '2026-11-12 22:00:00 | resumed | fmt=2 reason=no-stop-record previous-start=2026-11-12 21:00:00 pid=3',
  '2026-11-12 22:00:01 | started | fmt=2 pid=3',
]
const BAD_NO_RESUME = [
  '2026-11-12 19:57:23 | started | fmt=2 pid=1',
  '2026-11-12 20:22:37 | started | fmt=2 pid=2',
]
const BAD_STOP_WHILE_CLOSED = [
  '2026-11-12 19:57:23 | started | fmt=2 pid=1',
  '2026-11-12 20:00:00 | stopped | pid=1',
  '2026-11-12 20:10:00 | stopped | pid=1',
]
const BAD_ORPHAN_STOP = [
  '2026-11-12 20:00:00 | resumed | reason=no-stop-record pid=1',
  '2026-11-12 20:00:01 | stopped | pid=1',
]
const GOOD_RESUME_EXPLAINS = [
  '2026-11-12 19:57:23 | started | fmt=2 pid=1',
  '2026-11-12 20:00:00 | resumed | fmt=2 reason=unclean previous-start=2026-11-12 19:57:23 pid=2',
  '2026-11-12 20:00:01 | started | fmt=2 pid=2',
]

function selftest() {
  const cases = [
    ['正常：stopped / resumed 都能交代', GOOD, 0],
    ['正常：resumed 解释上一轮没记账', GOOD_RESUME_EXPLAINS, 0],
    ['坏：上一个 started 没交代', BAD_NO_RESUME, 1],
    ['坏：连关两次', BAD_STOP_WHILE_CLOSED, 1],
    ['坏：没有开着就 stopped', BAD_ORPHAN_STOP, 1],
  ]
  let bad = 0
  for (const [name, rows, want] of cases) {
    const { errs } = checkLines(rows)
    const got = errs.length > 0 ? 1 : 0
    if (got !== want) {
      bad++
      console.log(`✗ ${name}：期望 ${want}，实得 ${got}（${errs.join('；')}）`)
    } else {
      console.log(`✓ ${name}`)
    }
  }
  console.log(`\n${bad === 0 ? '✓' : '✗'} 自测 ${cases.length} 格，不合 ${bad}`)
  return bad === 0
}

function argOf(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : ''
}

function main() {
  if (process.argv.includes('--selftest')) return selftest() ? 0 : 1
  const unknown = process.argv.slice(2).find((a) => a.startsWith('-') && a !== '--dir' && a !== '--selftest')
  if (unknown) {
    console.log(`不认识的参数：${unknown}\n用法：node scripts/check-run-ledger.mjs [--dir <runs目录>] [--selftest]`)
    return 2
  }
  let dir = argOf('dir')
  if (!dir) {
    const cfg = loadConfigOrExit({ repoRoot: REPO })
    const stateDir = cfg.poolStateDir || (cfg.poolDir ? join(cfg.poolDir, 'state') : '')
    if (!stateDir) {
      console.log('xx 配置里既没有 poolStateDir 也没有 poolDir，不知道 runs 账在哪\nNEXT: 检查 lil-whale.config.json')
      return 2
    }
    dir = join(stateDir, 'runs')
  }
  let files = []
  try {
    if (!statSync(dir).isDirectory()) throw new Error('不是目录')
    files = readdirSync(dir).filter((n) => n.endsWith('.log')).sort()
  } catch (error) {
    console.log(`xx runs 目录读不到：${dir}（${error.message}）\nNEXT: 先确认鱼塘根/配置；没启动过鱼的塘本来就没有 runs 账`)
    return 2
  }
  if (files.length === 0) {
    console.log(`xx 目录里一条 runs 账本都没有：${dir}（空目录不能当"全部成立"）\nNEXT: 先启动一条鱼，让它写下第一行 started`)
    return 2
  }
  let bad = 0
  for (const name of files) {
    const rows = readFileSync(join(dir, name), 'utf8').split(/\r?\n/)
    const { errs, state, lines } = checkLines(rows)
    if (errs.length) {
      bad += errs.length
      console.log(`✗ ${name}（末态=${state}，${lines} 行）`)
      for (const e of errs.slice(0, 5)) console.log(`    ${e}`)
      if (errs.length > 5) console.log(`    …还有 ${errs.length - 5} 条`)
    } else {
      console.log(`✓ ${name}（末态=${state}，${lines} 行）`)
    }
  }
  console.log(`\n[判据 runs-交代 · dir=${dir} · 账本 ${files.length} / 违规 ${bad} · exit=${bad ? 1 : 0}]`)
  return bad ? 1 : 0
}

// 只在被直接执行时跑 CLI；被测试 import 时只导出 checkLines。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main())
}
