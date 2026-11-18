#!/usr/bin/env node
// 日志表头（log-format）的写法检查。
//
// 2026-11-18 r294。起因是小满 #1741 的核对：她那本 `watchman.log` 里
// `log-format` 有 25 行、`since` 25 个各不同、`fmt`/`changed`/`fields` 完全一样，
// 每行配一个不同 pid —— 这行其实是在每次启动时写的，读者拿任何一个 `since`
// 去划"字段出生线"都会划错。修法：格式没变就不写第二行；变了才写、`since` 指这一刻。
//
// 这里验两件事：
//   1. 纯函数的行为（同一格式不重复写、格式变了才写、找不到表头时写）；
//   2. 接线（index.js 只有一处 `watchmanLog('log-format'`，且在 writeLogFormatOnce 里）。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LOG_FORMAT_SIG,
  signatureOfLine,
  findLastLogFormatLine,
  shouldWriteLogFormat,
  buildLogFormatDetail,
} from '../plugin/dsh-lil-whale-group/lib/log-format-core.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = join(HERE, '..', 'plugin', 'dsh-lil-whale-group', 'lib')
// 换行归一：包里可能被 eol 规则转成 CRLF（2026-11-18 发版检查踩过）。
const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const index = read(join(LIB, 'index.js'))

let total = 0
let failed = 0
function ok(name, cond) {
  total += 1
  if (cond) console.log(`ok   ${name}`)
  else {
    failed += 1
    console.log(`FAIL ${name}`)
  }
}

const line = (detail) => `2026-11-18 08:18:00 | log-format | ${detail}`
const oldDetail = 'fmt=3 since=2026-11-16T00:18:00.864Z changed=skip,wake-skip,deliver fields=deny,note,reason pid=18408 to=xiaoman'
const newDetail = `${LOG_FORMAT_SIG} since=2026-11-18T03:00:00.000Z pid=1234 to=fish`
const newLine = (i) => line(`${LOG_FORMAT_SIG} since=2026-11-18T03:00:0${i % 10}.000Z pid=${100 + i} to=fish`)

// ── 1. 指纹只取"格式"那几项 ────────────────────────────────
ok('指纹忽略 since/pid/to', signatureOfLine(line(oldDetail)) === 'fmt=3 changed=skip,wake-skip,deliver fields=deny,note,reason')
ok('老行没有 field-since，所以指纹与新格式不同（r293 才加）', signatureOfLine(line(oldDetail)) !== LOG_FORMAT_SIG)
ok('新写法指纹等于当前签名', signatureOfLine(line(newDetail)) === LOG_FORMAT_SIG)
ok('非 log-format 行指纹为空', signatureOfLine('2026-11-18 08:18:00 | woke | trigger=channel to=fish') === '')
ok('字段顺序无关（fields 在前也能认）', signatureOfLine(line('fields=deny,note,reason fmt=3 changed=skip,wake-skip,deliver')) === 'fmt=3 changed=skip,wake-skip,deliver fields=deny,note,reason')

// ── 2. 取最后一处表头 ─────────────────────────────────────
const mixed = [
  line('fmt=3 since=2026-11-16T00:18:00.864Z changed=skip,wake-skip,deliver fields=deny,note,reason pid=1 to=fish'),
  '2026-11-17 21:00:00 | woke | trigger=plan to=fish',
  newLine(2),
  '2026-11-18 08:00:00 | sleep-hold | to=fish pending=3',
]
ok('取最后一条 log-format（跳过别的行）', findLastLogFormatLine(mixed).includes('pid=102'))
ok('没有表头时返回空串', findLastLogFormatLine(['2026-11-18 08:00:00 | woke | x']) === '')

// ── 3. 该不该写 ──────────────────────────────────────────
ok('空日志要写', shouldWriteLogFormat({ lines: [] }).write === true)
ok('空日志的理由是"还没有表头"', shouldWriteLogFormat({ lines: [] }).reason === '还没有表头')
ok('同一格式不重复写', shouldWriteLogFormat({ lines: mixed }).write === false)
ok('同一格式的理由是"同一格式已在纸上"', shouldWriteLogFormat({ lines: mixed }).reason === '同一格式已在纸上')
const twentyFive = Array.from({ length: 25 }, (_, i) => newLine(i))
ok('25 行同格式也不再写第 26 行', shouldWriteLogFormat({ lines: twentyFive }).write === false)
const oldTail = [...twentyFive.slice(0, 24), line('fmt=3 since=x changed=skip,wake-skip,deliver fields=deny,note,reason pid=999 to=fish')]
ok('旧格式的行不算"当前格式已写"（会补一行）', shouldWriteLogFormat({ lines: oldTail }).write === true)
const changedFields = [...mixed, line(`${LOG_FORMAT_SIG.replace('deny,note,reason', 'deny,unknown,reason')} since=x pid=3`)]
ok('fields 变了要写', shouldWriteLogFormat({ lines: changedFields }).write === true)
ok('fields 变了的理由是"格式变了"', shouldWriteLogFormat({ lines: changedFields }).reason === '格式变了')
const changedSince = [...mixed, line(`${LOG_FORMAT_SIG.replace('field-since=codeFp:r255', 'field-since=codeFp:r255,note:r293')} since=x pid=3`)]
ok('field-since 变了要写', shouldWriteLogFormat({ lines: changedSince }).write === true)
const changedFmt = [...mixed, line(`${LOG_FORMAT_SIG.replace('fmt=3', 'fmt=4')} since=x pid=3`)]
ok('fmt 变了要写', shouldWriteLogFormat({ lines: changedFmt }).write === true)

// ── 4. 拼出来的行 ────────────────────────────────────────
const detail = buildLogFormatDetail({ since: '2026-11-18T03:00:00.000Z', pid: 4242, to: 'fishball' })
ok('新行带 fmt=3', detail.includes('fmt=3'))
ok('新行 since 用传进来的时刻', detail.includes('since=2026-11-18T03:00:00.000Z'))
ok('新行带 pid', detail.includes('pid=4242'))
ok('新行带 to', detail.includes('to=fishball'))
ok('没给 to 时不写空的 to=', !buildLogFormatDetail({ since: 'x', pid: 1 }).includes('to='))
ok('默认签名含 field-since（各字段起算点）', LOG_FORMAT_SIG.includes('field-since=codeFp:r255,member:r292,note:r293'))

// ── 5. 接线：表头只能有一个写口，且先问再写 ─────────────────
ok('index.js 从 log-format-core 取判断函数', index.includes("from './log-format-core.js'"))
ok('index.js 定义了 writeLogFormatOnce', index.includes('function writeLogFormatOnce()'))
ok('写之前先问 shouldWriteLogFormat', /function writeLogFormatOnce\(\)[\s\S]{0,400}shouldWriteLogFormat\(/.test(index))
ok('没变就不写（提前 return false）', /if \(!decision\.write\) return false/.test(index))
ok('整个 index.js 只有一处 watchmanLog(\'log-format\'', (index.match(/watchmanLog\('log-format'/g) || []).length === 1)
ok('那一处是拼好的行（buildLogFormatDetail）', index.includes('buildLogFormatDetail({ since: new Date().toISOString()'))
ok('启动处调用 writeLogFormatOnce()', index.includes('writeLogFormatOnce()'))
ok('index.js 不再自己拼 field-since（签名只在 core 里）', !index.includes('field-since=codeFp:r255'))

if (failed > 0) {
  console.error(`test-log-format：合计 ${total}，FAIL ${failed}`)
  process.exit(1)
}
console.log(`test-log-format：合计 ${total}，PASS ${total}，FAIL 0`)
