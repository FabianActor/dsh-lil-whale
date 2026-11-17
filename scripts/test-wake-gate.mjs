#!/usr/bin/env node
// 叫醒闸（gate）与预览截断的静态接线检查。
//
// 为什么是静态检查：gate 和 handleChannel 都在插件主进程里，没有可注入的时钟/名册；
// 能验的是"接线还在不在"——人说话是否绕过额度、挡住时是否留痕、截断提示是否分通道。
// 真效果要等宿主重启后由鱼的实际日志验。
//
// 这些条件来自 2026-11-18 宿主报的三条：
//   1. lee2 睡着还被私信叫醒（查无此事，见 CHANGELOG r274）；
//   2. 23:43 群消息叫不醒小满（真因：当天额度 200/200，且被挡时一声不吭）；
//   3. 私聊触发执行请求时，截断提示写"全文在群文件里"（应为私聊文件）。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = join(HERE, '..', 'plugin', 'dsh-lil-whale-group', 'lib')
const index = readFileSync(join(LIB, 'index.js'), 'utf8')
const core = readFileSync(join(LIB, 'wake-preview-core.js'), 'utf8')

let total = 0
let pass = 0
function ok(name, cond) {
  total += 1
  if (cond) { pass += 1; return }
  console.log(`xx ${name}`)
}

// ---- gate：人说话绕过额度，睡眠仍然挡 ----
ok('gate 增加 bypassRate 参数', index.includes('function gate(member, wakes, bypassRate = false)'))
ok('睡眠检查在 bypass 之前（睡着谁都不叫）', index.indexOf("if (isSleeping(member)) return 'sleep'") < index.indexOf('if (bypassRate) return null'))
ok('bypass 只绕额度、不绕睡眠', index.includes('if (isSleeping(member)) return \'sleep\'') && index.includes('if (bypassRate) return null'))
ok('handleChannel 先算 humanIncoming', index.includes('const humanIncoming = incoming.some(') && index.includes("MEMBERS[record.from]?.kind === 'human'"))
ok('gate 调用带 humanIncoming', index.includes('gate(member, wakes, humanIncoming)'))

// ---- 被挡住要留痕（sleep 以外的原因不再静默） ----
ok('新增 noteWakeSkip', index.includes('function noteWakeSkip('))
ok('noteWakeSkip 写 watchman wake-skip 行', index.includes("'wake-skip',\n    `to=${member} deny=${deny}"))
ok('blocked !== null 时按 sleep / 其它分开记', index.includes("if (blocked === 'sleep') noteSleepHold(") && index.includes('else noteWakeSkip('))
ok('留痕带游标（不抄正文）', index.includes('pending=${pending} cursor=${seen}/${total}'))
ok('投递账记 human=yes|no（额度满还能递，账上有据）', index.includes("human=${humanIncoming ? 'yes' : 'no'} pkg="))

// ---- 预览截断：地点跟通道一致 ----
ok('core 导出 previewTextOf', core.includes('export function previewTextOf('))
ok('core 里按通道分两种地点', core.includes("channelKind === 'dm' ? '私聊文件' : '群文件'"))
ok('index.js 用 previewTextOf（不再写死群文件）', index.includes('return previewTextOf(body, { channelKind: channel.kind, max: PREVIEW_MAX })'))
ok('index.js 不再有写死的截断提示', !index.includes('…（已截断，全文在群文件里）'))
ok('调用处把通道传进去', index.includes('channelKind: channel.kind'))

console.log(`test-wake-gate：合计 ${total}，PASS ${pass}，FAIL ${total - pass}`)
if (pass !== total) process.exit(1)
