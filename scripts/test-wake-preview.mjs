// 唤醒词四种分支的行为测试。
//
// 为什么要这个文件（2026-11-15 20:49）：小满说，四种唤醒词里只有两种会自然发生
// （resumed / 没过档），first 要等一条从没有过游标的鱼，lost 要把游标挪走——
// "要跑这一格，找一个有权限的人摆，我负责看唤醒词对不对"。
// 小鱼丸补：**摆之前先把"应该听到哪句话"写下来**，否则摆完看到什么就说什么，
// 唤醒词又变回"看着对就行"的东西。
//
// 所以这里先写期望句子，再跑。跑红了就是话变了，不是"看着不顺眼"。
// 这个文件不碰任何真状态：不读 cursors、不读消息文件、不动她的家。
//
// **它是现状锁定，不是独立验证**（第三条鱼 2026-11-15 21:02 退回来的半句功劳）：
// 这四句措辞的来源链是 实现 → Leea 在群里引的 #527/#529 → 小满 20:51 的预登记表 → 本文件。
// 两头同源。所以绿证明的是"代码 = 我们俩都见过的那版措辞"（一致），
// 不证明"代码 = 一个从没看过实现的人期望的措辞"（验证）。
// 真要独立预校验，得找一个没用过那句话的人先写、谁也不许改。
// 判据：**两个同源的东西对上了，叫一致，不叫验证。**

import { createHash } from 'node:crypto'
import { wakeWordingOf, previewTextOf } from '../plugin/dsh-lil-whale-group/lib/wake-preview-core.js'

let pass = 0
let fail = 0
const failures = []

function eq(name, got, want) {
  if (got === want) {
    pass += 1
    return
  }
  fail += 1
  failures.push(`  ✗ ${name}\n    期望: ${JSON.stringify(want)}\n    实际: ${JSON.stringify(got)}`)
}

// ---------- 群里：超过 backlogTier（8）条 ----------
{
  const r = wakeWordingOf({ kind: 'group', who: '小满、小鱼丸', count: 76, firstRead: true, cursorLost: false, backlog: true })
  eq('first 的正文', r.where, '群里现在有 76 条点了你名字的（小满、小鱼丸）——你还没读过这个群（还没有游标）')
  eq('first 的尾巴', r.tailHint, '先看最后三条；前面的不用补，想看再翻。')
  eq('first 的模板 id', r.tpl, 'group-first@3')
  eq('first 的尾巴 id', r.tailTpl, 'tail-no-backfill@1')
}
{
  const r = wakeWordingOf({ kind: 'group', who: '小满', count: 76, firstRead: true, cursorLost: true, backlog: true })
  eq('lost 的正文', r.where, '群里现在有 76 条点了你名字的（小满）——你的读进度不见了（游标这一格是空的），这次按从头算，已经记了一笔账')
  eq('lost 的尾巴', r.tailHint, '先看最后三条；前面的不用补，想看再翻。')
  eq('lost 的模板 id', r.tpl, 'group-lost@3')
  eq('lost 的尾巴 id', r.tailTpl, 'tail-no-backfill@1')
}
{
  const r = wakeWordingOf({ kind: 'group', who: '小鱼丸', count: 12, firstRead: false, cursorLost: false, backlog: true })
  eq('resumed 的正文', r.where, '你不在的这段时间，群里积了 12 条点了你名字的（小鱼丸）')
  eq('resumed 的尾巴', r.tailHint, '先看最后三条，再看看有没有指名你的。')
  eq('resumed 的模板 id', r.tpl, 'group-backlog@3')
  eq('resumed 的尾巴 id', r.tailTpl, 'tail-named@1')
}

// ---------- 群里：没过档（<= 8 条） ----------
// 这一档只有一句话，不区分 first/lost/resumed——三个入参都给不同的值，输出必须一样。
{
  const a = wakeWordingOf({ kind: 'group', who: '小满', count: 3, firstRead: true, cursorLost: false, backlog: false })
  const b = wakeWordingOf({ kind: 'group', who: '小满', count: 3, firstRead: true, cursorLost: true, backlog: false })
  const c = wakeWordingOf({ kind: 'group', who: '小满', count: 3, firstRead: false, cursorLost: false, backlog: false })
  eq('没过档 的正文', a.where, '群里有 3 条点了你名字的（小满）')
  eq('没过档 的尾巴', a.tailHint, '去看看。')
  eq('没过档 的模板 id', a.tpl, 'group-plain@3')
  eq('没过档 的尾巴 id', a.tailTpl, 'tail-go@1')
  eq('没过档 不区分 first/lost/resumed（正文）', a.where === b.where && b.where === c.where, true)
  eq('没过档 不区分 first/lost/resumed（尾巴）', a.tailHint === b.tailHint && b.tailHint === c.tailHint, true)
}

// ---------- 渲染指纹：能事后重算出同一句话 ----------
// 2026-11-15 21:3x，小鱼丸："tpl 锁的是'选了哪一句'，锁不住'句子里那个数对不对'。"
// 所以投递行同时记 tpl@版本 + wtext8 + pkg：拿同一版代码、同样的变量（n、谁），
// 就能重算出同一个 wtext8；算不出来，那一行就只是"记下了当时用了哪个模板"。
{
  const a = wakeWordingOf({ kind: 'group', who: '小满、小鱼丸', count: 76, firstRead: false, cursorLost: false, backlog: true })
  const b = wakeWordingOf({ kind: 'group', who: '小满、小鱼丸', count: 76, firstRead: false, cursorLost: false, backlog: true })
  const c = wakeWordingOf({ kind: 'group', who: '小满、小鱼丸', count: 77, firstRead: false, cursorLost: false, backlog: true })
  eq('同一组入参的 wtext8 稳定', a.wtext8 === b.wtext8, true)
  eq('n 变了 wtext8 要变', a.wtext8 === c.wtext8, false)
  eq('wtext8 是 8 位十六进制', /^[0-9a-f]{8}$/.test(a.wtext8), true)
  const recompute = createHash('sha256').update(a.where + '\n' + a.tailHint, 'utf8').digest('hex').slice(0, 8)
  eq('用记录里的正文与尾巴能重算出同一个 wtext8', recompute, a.wtext8)
}

// ---------- 私聊 ----------
{
  const r = wakeWordingOf({ kind: 'dm', who: '小满、小鱼丸', dmWho: 'Fabian', count: 5, firstRead: true, cursorLost: false, backlog: true })
  eq('私聊积压的正文', r.where, 'Fabian 私下跟你说了 5 句')
  eq('私聊积压的尾巴（头回读）', r.tailHint, '先看最后三条；前面的不用补，想看再翻。')
  eq('私聊积压的模板 id', r.tpl, 'dm@2')
  eq('私聊积压的尾巴 id', r.tailTpl, 'tail-no-backfill@1')
}
{
  const r = wakeWordingOf({ kind: 'dm', dmWho: 'Fabian', count: 2, firstRead: false, cursorLost: false, backlog: false })
  eq('私聊没积压的正文', r.where, 'Fabian 私下跟你说了 2 句')
  eq('私聊没积压的尾巴', r.tailHint, '去看看。')
  eq('私聊没积压的模板 id', r.tpl, 'dm@2')
  eq('私聊没积压的尾巴 id', r.tailTpl, 'tail-go@1')
}

// ---------- 预览截断提示的地点（2026-11-18，宿主第 3 条） ----------
// 私聊里被截断时，提示不能再说"全文在群文件里"——那条消息不在群里。
{
  const long = '一'.repeat(121)
  eq('群文件被截断时的地点', previewTextOf(long, { channelKind: 'group', max: 120 }).endsWith('…（已截断，全文在群文件里）'), true)
  eq('私聊被截断时的地点', previewTextOf(long, { channelKind: 'dm', max: 120 }).endsWith('…（已截断，全文在私聊文件里）'), true)
  eq('正好 120 字不截断', previewTextOf('一'.repeat(120), { channelKind: 'dm', max: 120 }), '一'.repeat(120))
  eq('121 字才截断', previewTextOf('一'.repeat(121), { channelKind: 'group', max: 120 }).includes('已截断'), true)
  eq('截断保留前 120 字原文', previewTextOf('甲乙' + '一'.repeat(119), { channelKind: 'group', max: 120 }).startsWith('甲乙' + '一'.repeat(118)), true)
  eq('短消息原样返回', previewTextOf('收到。', { channelKind: 'group', max: 120 }), '收到。')
  eq('默认是群文件（调用方没传通道时）', previewTextOf('一'.repeat(121)).endsWith('全文在群文件里）'), true)
}

// ---------- 读不到进度：不报条数（fi-0015，2026-11-23） ----------
// 旧实现把"文件有 1354 行、游标读不到"写成"积了 1354 条"——
// 那 1300 多条早就读过。这里锁的是：缺失/损坏两档，一个数字都不出现。
for (const src of ['missing', 'unknown']) {
  const r = wakeWordingOf({ kind: 'group', who: '小满', count: 1354, firstRead: true, cursorLost: false, backlog: true, src })
  eq(`${src} 群：正文不出现条数`, /\d/.test(r.where), false)
  eq(`${src} 群：正文说"读进度找不到了"`, r.where.includes('读进度找不到了'), true)
  eq(`${src} 群：模板 id`, r.tpl, 'group-unknown@1')
  eq(`${src} 群：尾巴说"不重放"`, r.tailHint.includes('不重放'), true)
  const d = wakeWordingOf({ kind: 'dm', dmWho: 'Fabian', count: 1107, firstRead: true, cursorLost: true, backlog: true, src })
  eq(`${src} 私聊：正文不出现条数`, /\d/.test(d.where), false)
  eq(`${src} 私聊：模板 id`, d.tpl, 'dm-unknown@1')
  eq(`${src} 私聊：尾巴 id`, d.tailTpl, 'tail-unknown@1')
}
// 正常读到时，条数仍然要有——别把"读不到"的补丁用到"读得到"上。
{
  const r = wakeWordingOf({ kind: 'group', who: '小满', count: 76, firstRead: false, cursorLost: false, backlog: true, src: 'file' })
  eq('file 源仍报条数', r.where.includes('76'), true)
  eq('file 源模板不变', r.tpl, 'group-backlog@3')
}

// ---------- fi-0026：主语与计数来自同一批行 ----------
// 3 条系统行 + 1 条对方的话 ⇒ 只数 1 句，另外 3 条要能被看出来不是他说的。
const mixed = wakeWordingOf({ kind: 'dm', who: 'Fabian', dmWho: 'Fabian', count: 4, spoke: 1, systemCount: 3, firstRead: false, cursorLost: false, backlog: false })
eq('4 行里 1 行是人说的 ⇒ 叫醒词说 1 句', mixed.where.includes('说了 1 句'), true)
eq('同一句里说明另外 3 条是系统消息', mixed.where.includes('另有 3 条系统消息'), true)
eq('不再把系统行数成对方说的话', mixed.where.includes('说了 4 句'), false)
const sysOnly = wakeWordingOf({ kind: 'dm', who: 'Fabian', dmWho: 'Fabian', count: 3, spoke: 0, systemCount: 3, firstRead: false, cursorLost: false, backlog: false })
eq('全是系统消息时不说「说了 N 句」', sysOnly.where.includes('说了 3 句'), false)
eq('全是系统消息时说「没有新的话」', sysOnly.where.includes('没有新的话'), true)
const groupMixed = wakeWordingOf({ kind: 'group', who: '小肥鱼', count: 5, spoke: 2, systemCount: 3, firstRead: false, cursorLost: false, backlog: false })
eq('群也按人说的行数数（不带系统行）', groupMixed.where.includes('群里有 2 条'), true)

console.log(`test-wake-preview：合计 ${pass + fail}，PASS ${pass}，FAIL ${fail}`)
if (fail > 0) {
  
console.log(failures.join('\n'))
  process.exit(1)
}
