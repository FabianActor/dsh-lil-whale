#!/usr/bin/env node
'use strict'
/**
 * audit-log-kinds.mjs -- 对账：账上出现过的 kind ↔ 代码声明的 kind 清单。
 *
 * 2026-11-19 fi-0001（小满，群第 2260 行）：`log-format` 行的 `changed=` 声明的是
 * "格式变过的事件"，不是"账上所有 kind"——于是 `error` 1129 行从来没被任何声明
 * 覆盖，她的检查器（只看"声明了且有行"/"声明了但 0 行"）两格都不进。
 *
 * 现在表头带 `kinds=` 完整清单；这个脚本把账上实际出现的 kind 逐类计数，跟清单比，
 * 报出"未声明的 kind 有几行"。声明写漏是常态，检查器不能拿"声明过的"当全集。
 *
 * 用法：
 *   node scripts\audit-log-kinds.mjs                  # 读本鱼塘 pool\state\watchman.log
 *   node scripts\audit-log-kinds.mjs --file <账本>    # 指定账本（造样本/复算用）
 *   node scripts\audit-log-kinds.mjs --json
 *
 * 退出码：0=全部已声明（或老账还没有 kinds=）；1=有未声明的 kind；2=读不到账本。
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditKinds, LOG_KINDS } from '../plugin/dsh-lil-whale-group/lib/log-format-core.js'
import { loadConfigOrExit } from './lib/config-path.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  if (i < 0) return fallback
  const next = process.argv[i + 1]
  if (next === undefined || next.startsWith('--')) return true
  return next
}

const asJson = arg('json', false) === true
let file = arg('file', null)
if (typeof file !== 'string') {
  const cfg = loadConfigOrExit({ repoRoot: REPO })
  const stateDir = cfg.poolStateDir || join(cfg.poolDir, 'state')
  file = join(stateDir, 'watchman.log')
}

let text = ''
try {
  text = readFileSync(file, 'utf8')
} catch (error) {
  const why = error?.code === 'ENOENT' ? '账本不存在' : (error?.message || '读不了')
  if (asJson) console.log(JSON.stringify({ ok: false, file, reason: why }, null, 2))
  else console.log(`ff 读不到账本：${file}（${why}）`)
  process.exit(2)
}

const audit = auditKinds(text.split(/\r?\n/))
const undeclared = audit.undeclared
const okAll = undeclared.length === 0

if (asJson) {
  console.log(
    JSON.stringify(
      {
        ok: okAll,
        file,
        declared: audit.declared,
        declaredIsLegacy: audit.declared === null,
        kindsInCode: LOG_KINDS,
        seen: audit.seen,
        undeclared,
        missing: audit.missing,
      },
      null,
      2,
    ),
  )
} else if (audit.declared === null) {
  console.log(`ok 账上还没有 kinds= 声明（r374 之前的账）：${file}`)
  console.log(`   代码声明的 ${LOG_KINDS.length} 类：${LOG_KINDS.join(',')}`)
  console.log(`   账上出现过 ${audit.seen.length} 类：${audit.seen.map((item) => `${item.kind}×${item.count}`).join(', ')}`)
} else {
  console.log(`${okAll ? 'ok' : 'ff'} kind 对账：声明 ${audit.declared.length} 类，账上出现 ${audit.seen.length} 类`)
  for (const item of undeclared) console.log(`   未声明：${item.kind} ×${item.count}`)
  if (undeclared.length > 0) {
    console.log('NEXT: 把未声明的 kind 加进 plugin\\dsh-lil-whale-group\\lib\\log-format-core.js 的 LOG_KINDS（清单就是声明）')
  }
  if (audit.missing.length > 0) console.log(`   声明了、账上还没出现：${audit.missing.join(',')}`)
}

process.exit(okAll ? 0 : 1)
