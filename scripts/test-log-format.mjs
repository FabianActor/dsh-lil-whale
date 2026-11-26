#!/usr/bin/env node
// 日志表头（log-format）的写法检查。
//
// 2026-11-18 r294。起因是小满 #1741 的核对：她那本 `watchman.log` 里
// `log-format` 有 25 行、`since` 25 个各不同、`fmt`/`changed`/`fields` 完全一样，
// 每行配一个不同 pid —— 这行其实是在每次启动时写的，读者拿任何一个 `since`
// 去划"字段出生线"都会划错。修法：格式没变就不写第二行；变了才写、`since` 指这一刻。
//
// 2026-11-18 r296 补两条（第二条鱼 #1746、第四条鱼 #1745）：
//   - 指纹按 key 解析后比，不在整条 detail 上做字符串搜索（值里出现 `fields=` 也不会切错）；
//   - 签名比较不看 key 顺序（重排常量不该让每次启动都多写一行）。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LOG_FORMAT_SIG,
  LOG_KINDS,
  auditKinds,
  declaredKindsOf,
  kindOfLine,
  signatureOfLine,
  signatureOfConstant,
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
function ok(name, cond, extra = '') {
  total += 1
  if (cond) console.log(`ok   ${name}`)
  else {
    failed += 1
    console.log(`FAIL ${name}${extra ? `  — ${extra}` : ''}`)
  }
}

const line = (detail) => `2026-11-18 08:18:00 | log-format | ${detail}`
const OLD_SIG = 'fmt=3 changed=skip,wake-skip,deliver fields=deny,note,reason'
const oldDetail = `${OLD_SIG} since=2026-11-16T00:18:00.864Z pid=18408 to=xiaoman`
const newLine = (i = 0) => line(`${LOG_FORMAT_SIG} since=2026-11-18T03:00:0${i % 10}.000Z pid=${100 + i} to=fish`)
const SIG = signatureOfConstant()

// ── 1. 指纹：按 key 解析、顺序无关 ────────────────────────
ok('新写法的指纹等于当前签名', signatureOfLine(line(`${LOG_FORMAT_SIG} since=x pid=1 to=fish`)) === SIG)
ok('老行缺 field-since，指纹不等于当前签名', signatureOfLine(line(oldDetail)) !== SIG)
ok('非 log-format 行指纹为空', signatureOfLine('2026-11-18 08:18:00 | woke | trigger=channel to=fish') === '')
ok('字段顺序无关（fields 在前也能认）', signatureOfLine(line(`fields=deny,note,reason ${LOG_FORMAT_SIG.replace(' fields=deny,note,reason', '')} since=x pid=1`)) === SIG)
ok('常量重排后仍算同一签名（顺序不进指纹）', (() => {
  const reordered = `field-since=codeFp:r255,member:r292,note:r293,cfgProvider:r491,cfgModel:r491 changed=skip,wake-skip,deliver fmt=3 kinds=${LOG_KINDS.join(',')} fields=deny,note,reason`
  return signatureOfConstant(reordered) === SIG
})())
ok('值里出现字面量 fields= 不会把指纹切错', signatureOfLine(line(`${OLD_SIG} since=x pid=1 to=note=fmt=3,fields=evil`)) === signatureOfConstant(OLD_SIG))
ok('值里的逗号列表重排也算同一签名（fields，r297）', signatureOfConstant(LOG_FORMAT_SIG.replace('fields=deny,note,reason', 'fields=note,deny,reason')) === SIG)
ok('值里的逗号列表重排也算同一签名（changed，r297）', signatureOfConstant(LOG_FORMAT_SIG.replace('changed=skip,wake-skip,deliver', 'changed=deliver,skip,wake-skip')) === SIG)
ok('值里的逗号列表重排也算同一签名（field-since，r297）', signatureOfConstant(LOG_FORMAT_SIG.replace('field-since=codeFp:r255,member:r292,note:r293', 'field-since=note:r293,codeFp:r255,member:r292')) === SIG)
ok('值里的列表少一项仍算变了', signatureOfConstant(LOG_FORMAT_SIG.replace('fields=deny,note,reason', 'fields=deny,note')) !== SIG)
ok('两个不同格式的指纹不同', signatureOfConstant('fmt=4 changed=a fields=b field-since=c') !== signatureOfConstant('fmt=3 changed=a fields=b field-since=c'))
ok('签名指纹不含 since/pid/to', signatureOfLine(newLine(0)) === signatureOfLine(newLine(1)))

// ── 2. 取最后一处表头 ─────────────────────────────────────
const mixed = [
  line(`${OLD_SIG} pid=1 to=fish`),
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
const oldTail = [...twentyFive.slice(0, 24), line(`${OLD_SIG} pid=999 to=fish`)]
ok('旧格式的行不算"当前格式已写"（会补一行）', shouldWriteLogFormat({ lines: oldTail }).write === true)
const changedFields = [...mixed, line(LOG_FORMAT_SIG.replace('deny,note,reason', 'deny,unknown,reason') + ' since=x pid=3')]
ok('fields 变了要写', shouldWriteLogFormat({ lines: changedFields }).write === true)
ok('fields 变了的理由是"格式变了"', shouldWriteLogFormat({ lines: changedFields }).reason === '格式变了')
const changedSince = [...mixed, line(LOG_FORMAT_SIG.replace('field-since=codeFp:r255', 'field-since=codeFp:r255,note:r293') + ' since=x pid=3')]
ok('field-since 变了要写', shouldWriteLogFormat({ lines: changedSince }).write === true)
const changedFmt = [...mixed, line(LOG_FORMAT_SIG.replace('fmt=3', 'fmt=4') + ' since=x pid=3')]
ok('fmt 变了要写', shouldWriteLogFormat({ lines: changedFmt }).write === true)
const reorderedTail = [...mixed, line(`fields=deny,note,reason fmt=3 changed=skip,wake-skip,deliver field-since=codeFp:r255,member:r292,note:r293,cfgProvider:r491,cfgModel:r491 kinds=${LOG_KINDS.join(',')} since=x pid=3`)]
ok('只是 key 顺序不同，不写（r296）', shouldWriteLogFormat({ lines: reorderedTail }).write === false)

// ── 4. 拼出来的行 ────────────────────────────────────────
const detail = buildLogFormatDetail({ since: '2026-11-18T03:00:00.000Z', pid: 4242, to: 'fishball' })
ok('新行带 fmt=3', detail.includes('fmt=3'))
ok('新行 since 用传进来的时刻', detail.includes('since=2026-11-18T03:00:00.000Z'))
ok('新行带 pid', detail.includes('pid=4242'))
ok('新行带 to', detail.includes('to=fishball'))
ok('没给 to 时不写空的 to=', !buildLogFormatDetail({ since: 'x', pid: 1 }).includes('to='))
ok('默认签名含 field-since（各字段起算点）', LOG_FORMAT_SIG.includes('field-since=codeFp:r255,member:r292,note:r293'))
ok('拼出来的行用当前代码解析等于签名', (() => {
  const built = buildLogFormatDetail({ since: 'x', pid: 9, to: 'fish' })
  return signatureOfLine(line(built)) === SIG
})())

// ── 4b. kind 声明与对账（2026-11-19 fi-0001，小满 #2260）──
// `changed=` 只声明"格式变过的事件"，`error` 1129 行从声明与检查器两格里都漏过。
ok('kinds 清单无重复且有序（清单就是声明）', (() => {
  const sorted = [...LOG_KINDS].sort()
  return JSON.stringify(sorted) === JSON.stringify(LOG_KINDS) && new Set(LOG_KINDS).size === LOG_KINDS.length
})())
ok('签名里带 kinds= 完整清单', LOG_FORMAT_SIG.includes(`kinds=${LOG_KINDS.join(',')}`))
ok('kinds 重排不算格式变了（按集合比）', signatureOfConstant(LOG_FORMAT_SIG.replace(`kinds=${LOG_KINDS.join(',')}`, `kinds=${[...LOG_KINDS].reverse().join(',')}`)) === SIG)
ok('kindOfLine 认出账行', kindOfLine('2026-11-19 10:23:24 | started | fmt=2 pid=1') === 'started')
ok('kindOfLine 不认普通文本', kindOfLine('随便一句话') === '')
ok('declaredKindsOf 取最后一行清单', (() => {
  const declared = declaredKindsOf([newLine(0)])
  return Array.isArray(declared) && declared.length === LOG_KINDS.length
})())
ok('老表头没有 kinds= → null（不是空清单）', declaredKindsOf([line(`${OLD_SIG} since=x pid=1`)]) === null)
const kindAuditLines = [
  newLine(0),
  '2026-11-19 10:23:24 | started | fmt=2 pid=1',
  '2026-11-19 10:23:25 | woke | wid=1 to=fish',
  '2026-11-19 10:23:26 | bogus-kind | x=1',
  '2026-11-19 10:23:27 | bogus-kind | x=2',
]
const kindAudit = auditKinds(kindAuditLines)
ok('对账：已声明的 kind 不进 undeclared', kindAudit.undeclared.length === 1 && kindAudit.undeclared[0].kind === 'bogus-kind')
ok('对账：未声明 kind 带行数', kindAudit.undeclared[0].count === 2)
ok('对账：声明了但账上没出现单列 missing', kindAudit.missing.includes('deliver') && !kindAudit.missing.includes('started'))
const legacyAudit = auditKinds(['2026-11-19 10:23:24 | started | fmt=2 pid=1'])
ok('不给对照清单时 declared=none，只数不判', legacyAudit.declared === null && legacyAudit.declaredSource === 'none' && legacyAudit.undeclared.length === 0)
const legacyCode = auditKinds(['2026-11-19 12:00:00 | bogus-kind | x=1'], LOG_KINDS)
ok('老账 + 代码清单：未知 kind 也能红（小满 #2269 ①）', legacyCode.declaredSource === 'code' && legacyCode.undeclared.length === 1 && legacyCode.undeclared[0].kind === 'bogus-kind')
ok('表头行自己的 kind 不参与对账（小满 #2269 ③）', auditKinds([newLine(0)]).seen.length === 0)
ok('kinds= 清单里没有 log-format（正文清单不含表头）', !LOG_KINDS.includes('log-format'))

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
