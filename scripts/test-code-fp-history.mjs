// 代码指纹历史账的测试（r364，2026-11-19）。
// 背景：小肥鱼私聊第 53 行指出 —— `进程 fp == boot 时刻的磁盘 fp` 是恒真式，
// 因为 boot 行里的 codeFp 本来就是那一刻进程自己算的。要回答“改过没有”，
// 得像 log-format 那样在值变化时留一行；本测试盯的就是这份账的形状与接线。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  CODE_FP_LEDGER,
  codeFpChangeOf,
  codeFpHistoryLine,
  codeFpLedgerOf,
} from '../plugin/dsh-lil-whale-group/lib/code-fp-history-core.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const INDEX = join(REPO, 'plugin', 'dsh-lil-whale-group', 'lib', 'index.js')

let pass = 0
let fail = 0
const ok = (name, condition, detail = '') => {
  if (condition) {
    pass += 1
    console.log(`  ok  ${name}`)
  } else {
    fail += 1
    console.log(`  xx  ${name}${detail ? `  —— ${detail}` : ''}`)
  }
}

console.log('一、codeFpChangeOf')
const cur = { fp: 'aaaaaaaaaaaa', files: 18 }
let change = codeFpChangeOf(null, cur)
ok('没有历史 → baseline', change.kind === 'baseline' && change.newFp === 'aaaaaaaaaaaa')
change = codeFpChangeOf({}, cur)
ok('历史是空对象 → baseline', change.kind === 'baseline')
change = codeFpChangeOf({ fp: 'aaaaaaaaaaaa', files: 18 }, cur)
ok('同值 → same', change.kind === 'same')
change = codeFpChangeOf({ fp: 'bbbbbbbbbbbb', files: 17 }, cur)
ok('异值 → changed', change.kind === 'changed')
ok('changed 带旧值', change.oldFp === 'bbbbbbbbbbbb' && change.oldFiles === 17)
ok('changed 带新值', change.newFp === 'aaaaaaaaaaaa' && change.newFiles === 18)
change = codeFpChangeOf({ fp: 'bbbbbbbbbbbb' }, cur)
ok('历史缺 files 按 0', change.kind === 'changed' && change.oldFiles === 0)
change = codeFpChangeOf(null, undefined)
ok('当前值缺失 → unknown/files=0', change.kind === 'baseline' && change.newFp === 'unknown' && change.newFiles === 0)

console.log('二、codeFpHistoryLine')
const baselineLine = codeFpHistoryLine({ kind: 'baseline', newFp: 'aaaaaaaaaaaa', newFiles: 18 })
ok('baseline 行带 fp 与 files', baselineLine === 'note=code-fp-baseline fp=aaaaaaaaaaaa files=18')
const changedLine = codeFpHistoryLine({
  kind: 'changed',
  oldFp: 'bbbbbbbbbbbb',
  oldFiles: 17,
  newFp: 'aaaaaaaaaaaa',
  newFiles: 18,
})
ok(
  'changed 行带旧/新 fp 与文件数',
  changedLine ===
    'note=code-fp-changed old=bbbbbbbbbbbb new=aaaaaaaaaaaa files-old=17 files-new=18',
)
ok('same 不写行', codeFpHistoryLine({ kind: 'same', newFp: 'aaaaaaaaaaaa', newFiles: 18 }) === null)
ok('未知 kind 不写行', codeFpHistoryLine({ kind: 'other' }) === null)

console.log('三、codeFpLedgerOf')
const ledger = codeFpLedgerOf(cur, '2026-11-19T00:00:00.000Z')
ok('账本留 fp/files/at', ledger.fp === 'aaaaaaaaaaaa' && ledger.files === 18 && ledger.at === '2026-11-19T00:00:00.000Z')
ok('账本常量名', CODE_FP_LEDGER === 'code-fp.json')

console.log('四、接线（index.js）')
const source = readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n')
ok('import 了核心模块', source.includes("from './code-fp-history-core.js'"))
ok('账本文件挂在 POOL_STATE 下', source.includes('const CODE_FP_LEDGER_FILE = join(POOL_STATE, CODE_FP_LEDGER)'))
ok('recordCodeFpHistory 存在', source.includes('function recordCodeFpHistory()'))
const bootIdx = source.indexOf('bootLog(bootRecordWithNote)')
const callIdx = source.indexOf('\n  recordCodeFpHistory()')
ok('启动痕迹写完再记账', bootIdx > 0 && callIdx > bootIdx)
ok('读上一次的值', source.includes('readJson(CODE_FP_LEDGER_FILE, null)'))
ok('变化时才写 watchmanLog 行', source.includes("watchmanLog('note', line)"))
ok('把这一次的值写回账本', source.includes('writeJson(CODE_FP_LEDGER_FILE, codeFpLedgerOf(CODE_FP'))
ok('同一文件里没有旧式“拿 boot 跟 boot 比”的断言', !source.includes('bootFp === CODE_FP.fp'))
ok(
  '账本写失败不拦启动',
  source.includes('历史账写不进去不该拦住启动') || source.includes('}) catch {'),
)

console.log('')
console.log(`test-code-fp-history：合计 ${pass + fail}，PASS ${pass}，FAIL ${fail}`)
if (fail > 0) process.exit(1)
