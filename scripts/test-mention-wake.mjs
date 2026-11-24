// mention（叫醒谁）的纯判据测试 —— 2026-11-22 r413。
//
// r412 时这里还测 `defaultMentionOf`（人类默认 all、鱼默认 []）；r413 把角色默认删了：
// **人和鱼同一套**——没写 mention 就是 []，谁都不叫醒。所以那个函数连同那四条断言一起下掉，
// 换成"写端不写 to / 投影不写箭头"的源码断言。
//
// 只在内存里摆题，不碰真鱼塘（真状态在 handleChannel 那一侧；这里只验规则本身）。

import { readFileSync } from 'node:fs'
import { mentionLabelOf } from '../plugin/dsh-lil-whale-group-ui/lib/messages-core.js'
import {
  MENTION_ALL,
  normalizeMention,
  wantsWake,
  mentionTextOf,
  mentionDisplayOf,
  bumpHeld,
  heldOf,
  clearHeld,
  heldSentenceOf,
} from '../plugin/dsh-lil-whale-group/lib/mention-core.js'

let pass = 0
let fail = 0
function ok(cond, name, extra = '') {
  if (cond) { pass += 1; return }
  fail += 1
  console.log(`FAIL ${name}${extra === '' ? '' : `：${extra}`}`)
}
function eq(actual, expected, name) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  ok(a === b, name, `期望 ${b}，实际 ${a}`)
}
function throws(fn, name) {
  let threw = false
  try { fn() } catch { threw = true }
  ok(threw, name, '应当抛错但没抛')
}

const KEYS = ['lee', 'whale', 'fishball', 'xiaoman', 'lee2', 'fabian']

// ---- normalizeMention ----
eq(normalizeMention(undefined, KEYS), undefined, '没写 mention ⇒ undefined（写端再落成 []）')
eq(normalizeMention('', KEYS), [], '空串 ⇒ 显式不叫醒任何人')
eq(normalizeMention('all', KEYS), MENTION_ALL, "all ⇒ 'all'")
eq(normalizeMention('  whale ', KEYS), ['whale'], '单个 id 去空白')
eq(normalizeMention('whale,lee2', KEYS), ['whale', 'lee2'], '逗号分隔')
eq(normalizeMention('whale、lee2', KEYS), ['whale', 'lee2'], '顿号分隔')
eq(normalizeMention(['whale', 'whale'], KEYS), ['whale'], '数组去重')
eq(normalizeMention([' whale ', 'lee2'], KEYS), ['whale', 'lee2'], '数组里也去空白')
eq(normalizeMention('all', KEYS), MENTION_ALL, 'all 不拆成成员')
throws(() => normalizeMention('nobody', KEYS), '不认识的成员 ⇒ 抛错')
throws(() => normalizeMention(42, KEYS), '非字符串/数组 ⇒ 抛错')

// ---- wantsWake：新记录看 mention ----
ok(wantsWake({ mention: MENTION_ALL }, 'lee2'), 'mention=all ⇒ 谁都醒')
ok(!wantsWake({ mention: [] }, 'lee2'), 'mention=[] ⇒ 谁都不醒')
ok(wantsWake({ mention: ['lee2'] }, 'lee2'), '名单里有我 ⇒ 醒')
ok(!wantsWake({ mention: ['whale'] }, 'lee2'), '名单里没我 ⇒ 不醒')
ok(!wantsWake({ mention: 'bogus' }, 'lee2'), '认不出的 mention 形状 ⇒ 不猜、不叫醒')
ok(wantsWake({ mention: MENTION_ALL }, 'fabian'), '人类也在名单里（只是他不跑轮）')

// ---- wantsWake：老记录回退 to ----
ok(wantsWake({ to: 'all' }, 'lee2'), '老记录 to=all ⇒ 叫醒所有人（旧行为）')
ok(wantsWake({ to: 'lee2' }, 'lee2'), '老记录 to=某人 ⇒ 叫醒那个人')
ok(!wantsWake({ to: 'another' }, 'lee2'), '老记录 to=别人 ⇒ 不叫醒')
ok(!wantsWake({ to: 'lee2', mention: [] }, 'lee2'), '新记录 to=我但 mention 空 ⇒ 不叫醒（to 只说给谁）')
ok(wantsWake({ mention: 'all' }, 'whale'), '新记录没有 to 也能叫醒')

// ---- 回执文案 ----
eq(mentionTextOf(undefined, (k) => k), '（老记录，按 to 推）', '未写时的文案')
eq(mentionTextOf(MENTION_ALL, (k) => k), '所有人', 'all 的文案')
eq(mentionTextOf([], (k) => k), '不叫醒任何人', '空的文案')
eq(mentionTextOf(['whale', 'lee2'], (k) => `名-${k}`), '名-whale、名-lee2', '名单的文案用 labelOf')

// ---- 投影文案：群.md 表头 / 气泡共用的那一句 ----
eq(mentionDisplayOf({ mention: MENTION_ALL }, (k) => `名-${k}`), ' · 提到了：所有人', '投影：all')
eq(mentionDisplayOf({ mention: ['whale', 'lee2'] }, (k) => `名-${k}`), ' · 提到了：名-whale、名-lee2', '投影：多成员')
eq(mentionDisplayOf({ mention: [] }, (k) => `名-${k}`), '', '投影：空名单整节不写')
eq(mentionDisplayOf({ to: 'whale' }, (k) => `名-${k}`), ' · 提到了：名-whale', '投影：老记录指名时按 to 推')
eq(mentionDisplayOf({ to: 'all' }, (k) => `名-${k}`), '', '投影：老广播不补"所有人"（不改历史）')
eq(mentionDisplayOf({}, (k) => `名-${k}`), '', '投影：什么也没有就不写')

// ---- held（没叫醒的也要有账） ----
let held = { version: 1, channels: {}, updatedAt: '' }
held = bumpHeld(held, 'group', { count: 1, line: 10, ts: '2026-11-22T07:00:00.000Z', now: '2026-11-22T07:00:01.000Z' })
held = bumpHeld(held, 'group', { count: 3, line: 12, ts: '2026-11-22T07:01:00.000Z', now: '2026-11-22T07:01:01.000Z' })
eq(heldOf(held, 'group'), 4, 'held 累加')
eq(held.channels.group.from, 10, 'held 记住第一条行号')
eq(held.channels.group.to, 12, 'held 记住最后一条行号')
eq(heldOf(held, 'dm:fabian__lee2'), 0, '别的通道不受影响')
const cleared = clearHeld(held, 'group', '2026-11-22T07:02:00.000Z')
eq(heldOf(cleared, 'group'), 0, '清掉之后计数归零')
eq(heldOf(bumpHeld(null, 'group', { count: 2 }), 'group'), 2, '空状态也能累加（坏文件不炸）')
eq(heldSentenceOf(0), '', '0 条不写一句噪声')
ok(heldSentenceOf(3).includes('3 条没点你的话'), '有积压时有句子')
ok(!heldSentenceOf(3).includes('君'), '句子不编原因')

// ---- 源码层：写端不写 to、投影不看 to、正文 @ 不解析 ----
const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')
const idxSrc = read('../plugin/dsh-lil-whale-group/lib/index.js')
ok(idxSrc.includes('mention: mentions'), '群消息记录写 mention')
ok(!/to: toKey/.test(idxSrc), '群消息记录不再写 to（r413）')
ok(idxSrc.includes('mentionDisplayOf({ mention: mentions }, labelOf)'), '群.md 投影用 mentionDisplayOf')
ok(idxSrc.includes('mentionTextOf(m.split(\',\'), labelOf)'), '回执把输出里的 mention 字符串拆开再翻译')
ok(!idxSrc.includes('defaultMentionOf'), '角色默认已删（人和鱼同一套）')
ok(!idxSrc.includes('strongMention') && !idxSrc.includes('parseMentionFromText'), '正文里的 @ 没有被解析成 mention')
ok(idxSrc.includes('from: record.from'), 'group_say 的返回值带 from')
ok(idxSrc.includes("mention: record.mention === 'all' ? 'all' : (record.mention ?? []).join(',')"), 'group_say 的返回值把 mention 压成字符串')
// 2026-11-22 实机踩过：output schema 是 additionalProperties:false，return 里多一个没声明的字段，
// 宿主会直接拒掉整个工具调用（"value.from is not a declared property"）。
ok(/^\s+from: \{ type: 'string' \},$/m.test(idxSrc), 'output schema 声明了 from')
ok(/^\s+mention: \{ type: 'string' \},$/m.test(idxSrc), 'output schema 声明了 mention')
ok(!idxSrc.includes('Array.isArray(value.mention)'), '回执不再假设输出里 mention 是数组')
ok(!idxSrc.includes('return { ts: record.ts, queued: true, channel: record.channel, to: record.to, image:'), '旧的一行 return 不在了')
// 2026-11-22 实机踩过：execute 删掉 toSeat 解析后，say( 调用还传 toSeat 变量 ⇒ ReferenceError。
ok(!/,\s*toSeat,\s*image,/.test(idxSrc), 'group_say 的 say( 调用不再引用 toSeat 变量')
ok(idxSrc.includes("...(record.to === undefined ? {} : { to: record.to })"), '回执的 to 只在私聊时带')
ok(!idxSrc.includes('to: record.to,'), '回执不再无条件写 to')

const coreSrc = read('../plugin/dsh-lil-whale-group-ui/lib/messages-core.js')
ok(coreSrc.includes('mentionLabelOf'), 'messages-core 暴露了投影文案函数')
ok(coreSrc.includes('mention'), 'projectMessage 透传 mention')

const clientSrc = read('../plugin/dsh-lil-whale-group-ui/lib/client.js')
ok(clientSrc.includes('client build v68 · bind-cwd'), '面板 build 标记 v60')
ok(!clientSrc.includes('const target = message.to && message.to !== \'all\''), '气泡不再用 to 拼收件人箭头')
ok(!clientSrc.includes('toSeat: seat'), '面板不再写 toSeat')

// 2026-11-22 验收时抓到的形状差：面板写的人消息没有 channel 字段，和宿主 say() 写的群记录不一样。
const uiSrc = read('../plugin/dsh-lil-whale-group-ui/lib/index.js')
ok(uiSrc.includes("kind: 'say', channel: 'group'"), '面板写的群记录也带 channel=group')
ok(!/toSeat\s*[:,]/.test(uiSrc), '面板不再把 toSeat 写进记录')

// 老记录按 to 推出来的那节必须自标门牌（r414，小肥鱼 2026-11-22 20:14 提议）。
eq(mentionLabelOf({ to: 'whale' }, (k) => `名-${k}`), '名-whale（按当年 to 推）', '投影/气泡：老记录给出推算标记')
eq(mentionLabelOf({ mention: ['whale'] }, (k) => `名-${k}`), '名-whale', '新记录不加推算标记')
eq(mentionLabelOf({ to: 'all' }, (k) => `名-${k}`), '', '老广播不补提到了')
// 2026-11-22 宿主报：私聊气泡全部显示「提到了 lee2（按当年 to 推）」——
// dm 里的 to 是"这间屋开给谁"（收件人），不是叫醒名单，回退前必须先分屋。
eq(mentionLabelOf({ kind: 'dm', channel: 'dm', to: 'lee2' }, (k) => `名-${k}`), '', '私聊不显示「提到了」')
eq(mentionLabelOf({ kind: 'say', to: 'whale' }, (k) => `名-${k}`), '名-whale（按当年 to 推）', '老群记录（无 channel）仍按 to 推并标记')
eq(mentionLabelOf({ kind: 'say', channel: 'dm', to: 'whale' }, (k) => `名-${k}`), '名-whale（按当年 to 推）', '老群消息里的 @ 定向（channel=dm、kind=say）仍按 to 推')
// 2026-11-23 宿主报：系统提示行（kind=system、channel=dm）被当成老群记录，气泡冒出「提到了 小满（按当年 to 推）」。
eq(mentionLabelOf({ kind: 'system', channel: 'dm', to: 'xiaoman' }, (k) => `名-${k}`), '', '系统提示行不显示「提到了」')
ok(coreSrc.includes("const isGroup = !record?.kind || record.kind === 'say'"), '投影：只有群记录（kind 缺失或 say）才回退 to，dm/system 都不回退')
ok(clientSrc.includes("const isGroup = !message?.kind || message.kind === 'say'"), '气泡：只有群记录（kind 缺失或 say）才回退 to')
ok(clientSrc.includes("if (id === 'system') return '系统'"), '气泡：system 显示成「系统」')
// 2026-11-22 宿主报：群里发出去之后 @ 还留在输入框上，下一条会带着上次的叫醒名单。
ok(clientSrc.includes('setMention([])') && clientSrc.includes("if (tab === 'group') {"), '群聊发送成功后清空 mention 选择（私聊不动）')
// 2026-11-22 鱼群复核（LeeaCP 第 3166 行、小满第 3167 行）：纸里教 mention，别的段落还留着 to，
// 还给过一个不存在的关键字 "none"（根鱼的 PARENT_ID 就是 none，渲染出来会被 normalizeMention 拒）。
const tplSrc = readFileSync(new URL('../templates/环境.md.tpl', import.meta.url), 'utf8')
ok(tplSrc.includes('group_say(text, mention)'), '模板教的是 group_say(text, mention)')
ok(!tplSrc.includes('group_say(to'), '模板不再教 group_say(to, text)')
ok(!tplSrc.includes('group_say("…", "{{PARENT_ID}}")'), '模板的「只叫醒某人」示例不再用 PARENT_ID')
ok(tplSrc.includes('有消息点名了你'), '「什么时候会被叫醒」用 mention 口径')
ok(!tplSrc.includes('只写 `to` 不写 `channel`'), '模板不再教「只写 to 不写 channel」')
ok(tplSrc.includes('旧记录（2026-11-22 之前）用一个叫 `to` 的字段'), '模板说明了老记录的 to 只当“当年点了谁”')
const renderSrc = readFileSync(new URL('./render-env.mjs', import.meta.url), 'utf8')
ok(!renderSrc.includes('`to` 里写这个'), '名册表头不再写「to 里写这个」')
console.log(`test-mention-wake：合计 ${pass + fail}，PASS ${pass}，FAIL ${fail}`)
if (fail > 0) process.exit(1)
