#!/usr/bin/env node
/**
 * fi-0016 / r420 的行为测试：卡住要说话。
 *
 * 这一版只判「投递之后仍忙、会话文件没有新写入」这一档，措辞必须带「可能」。
 * 断言分三类：
 *   1) classifyStall 的五种判决（none/idle/working/stalled/too-old）
 *   2) 系统行必须是「系统」署名、带「可能」与 WebUI 地址、时间来自投递时刻
 *   3) 源码接线：投递后开始计时、60 秒检查一次、状态落在 pool\state\stalls、
 *      系统行只进 DM 不进群
 */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { classifyStall, hhmmOf, stallSentenceOf, STALL_AFTER_MS, STALL_MAX_MS } from '../plugin/dsh-lil-whale-group/lib/stall-core.js'

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) pass++
  else failures.push(`${name}${detail ? `：${detail}` : ''}`)
}

const T0 = Date.UTC(2026, 10, 23, 1, 0, 0) // 2026-11-23 09:00 +08:00
// 1) 判决
check('没有投递 → none', classifyStall({ now: T0, deliveredAt: null }).kind === 'none')
check('闲着 → idle', classifyStall({ now: T0 + 10 * 60_000, deliveredAt: T0, sessionMtime: T0, agentStatus: 'idle' }).kind === 'idle')
check('阈值内 → working', classifyStall({ now: T0 + STALL_AFTER_MS - 1, deliveredAt: T0, sessionMtime: T0, agentStatus: 'busy' }).kind === 'working')
check('先写了一句、随后 4 分钟没动 → stalled', classifyStall({ now: T0 + 10 * 60_000, deliveredAt: T0, sessionMtime: T0 + 60_000, agentStatus: 'busy' }).kind === 'stalled')
check('刚写过（离现在不到 4 分钟）→ working', classifyStall({ now: T0 + 5 * 60_000, deliveredAt: T0, sessionMtime: T0 + 3 * 60_000, agentStatus: 'busy' }).kind === 'working')
check('lastAt 取最后一次动静（写给系统行用的时刻）', classifyStall({ now: T0 + 10 * 60_000, deliveredAt: T0, sessionMtime: T0 + 60_000, agentStatus: 'busy' }).lastAt === T0 + 60_000)
check('忙且没新写入、过阈值 → stalled', classifyStall({ now: T0 + STALL_AFTER_MS + 1, deliveredAt: T0, sessionMtime: T0, agentStatus: 'busy' }).kind === 'stalled')
check('读不到会话文件也报 stalled（已知的盲区）', classifyStall({ now: T0 + 10 * 60_000, deliveredAt: T0, sessionMtime: null, agentStatus: 'busy' }).kind === 'stalled')
check('超过一小时 → too-old', classifyStall({ now: T0 + STALL_MAX_MS + 1, deliveredAt: T0, sessionMtime: T0, agentStatus: 'busy' }).kind === 'too-old')
check('时间倒流不出现负数 ageSec', classifyStall({ now: T0 - 5_000, deliveredAt: T0, sessionMtime: T0, agentStatus: 'busy' }).ageSec === 0)

// 2) 系统行
check('hhmm 补零', /^\d{2}:\d{2}$/.test(hhmmOf(T0)))
const sentence = stallSentenceOf({ label: '小肥鱼', port: 3082, since: T0 })
check('带【系统】前缀', sentence.startsWith('【系统】'), sentence)
check('带「可能」', sentence.includes('可能'), sentence)
check('带她的称呼', sentence.includes('小肥鱼'), sentence)
check('带 WebUI 地址', sentence.includes('http://127.0.0.1:3082/'), sentence)
check('没有自称「她卡住了」这种断言', !sentence.includes('卡住'), sentence)
check('没有端口就不给空 URL', !stallSentenceOf({ label: 'x', port: '', since: T0 }).includes('http'), sentence)

// 3) 源码接线
const here = dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(join(here, '..', 'plugin', 'dsh-lil-whale-group', 'lib', 'index.js'), 'utf8')
check('imports classifyStall', src.includes("from './stall-core.js'") && src.includes('classifyStall'))
check('投递成功后开始计时', src.includes("lastDeliveries.set(member, { at: Date.now()"))
check('每 60 秒检查一次', /const stallTimer = setInterval\(\(\) => \{[\s\S]{0,400}?\}, 60_000\)/.test(src))
check('状态目录是 pool\\state\\stalls', src.includes("join(POOL_STATE, 'stalls')"))
check('系统行写进 DM 文件', src.includes('saySystemToDm') && src.includes('dmFileOf(member, human)'))
check('system 有自己的署名', src.includes("if (who === 'system') return '系统'"))
check('系统行不写群记录', !/saySystemToDm[\s\S]{0,900}?MESSAGES/.test(src))
check('未走动时清掉状态文件', src.includes('clearStallFile(member)'))

if (failures.length > 0) {
  console.error(`test-stall-core：合计 ${pass + failures.length}，PASS ${pass}，FAIL ${failures.length}`)
  for (const f of failures) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log(`test-stall-core：合计 ${pass}，PASS ${pass}，FAIL 0`)
