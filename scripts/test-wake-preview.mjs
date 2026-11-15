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

import { wakeWordingOf } from '../plugin/dsh-lil-whale-group/lib/wake-preview-core.js'

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
  eq('first 的正文', r.where, '群里现在有 76 条（小满、小鱼丸）——你还没读过这个群（还没有游标）')
  eq('first 的尾巴', r.tailHint, '先看最后三条；前面的不用补，想看再翻。')
}
{
  const r = wakeWordingOf({ kind: 'group', who: '小满', count: 76, firstRead: true, cursorLost: true, backlog: true })
  eq('lost 的正文', r.where, '群里现在有 76 条（小满）——你的读进度不见了（游标这一格是空的），这次按从头算，已经记了一笔账')
  eq('lost 的尾巴', r.tailHint, '先看最后三条；前面的不用补，想看再翻。')
}
{
  const r = wakeWordingOf({ kind: 'group', who: '小鱼丸', count: 12, firstRead: false, cursorLost: false, backlog: true })
  eq('resumed 的正文', r.where, '你不在的这段时间，群里积了 12 条（小鱼丸）')
  eq('resumed 的尾巴', r.tailHint, '先看最后三条，再看看有没有指名你的。')
}

// ---------- 群里：没过档（<= 8 条） ----------
// 这一档只有一句话，不区分 first/lost/resumed——三个入参都给不同的值，输出必须一样。
{
  const a = wakeWordingOf({ kind: 'group', who: '小满', count: 3, firstRead: true, cursorLost: false, backlog: false })
  const b = wakeWordingOf({ kind: 'group', who: '小满', count: 3, firstRead: true, cursorLost: true, backlog: false })
  const c = wakeWordingOf({ kind: 'group', who: '小满', count: 3, firstRead: false, cursorLost: false, backlog: false })
  eq('没过档 的正文', a.where, '群里有 3 条新的（小满）')
  eq('没过档 的尾巴', a.tailHint, '去看看。')
  eq('没过档 不区分 first/lost/resumed（正文）', a.where === b.where && b.where === c.where, true)
  eq('没过档 不区分 first/lost/resumed（尾巴）', a.tailHint === b.tailHint && b.tailHint === c.tailHint, true)
}

// ---------- 私聊 ----------
{
  const r = wakeWordingOf({ kind: 'dm', who: '小满、小鱼丸', dmWho: 'Fabian', count: 5, firstRead: true, cursorLost: false, backlog: true })
  eq('私聊积压的正文', r.where, 'Fabian 私下跟你说了 5 句')
  eq('私聊积压的尾巴（头回读）', r.tailHint, '先看最后三条；前面的不用补，想看再翻。')
}
{
  const r = wakeWordingOf({ kind: 'dm', dmWho: 'Fabian', count: 2, firstRead: false, cursorLost: false, backlog: false })
  eq('私聊没积压的正文', r.where, 'Fabian 私下跟你说了 2 句')
  eq('私聊没积压的尾巴', r.tailHint, '去看看。')
}

console.log(`test-wake-preview：合计 ${pass + fail}，PASS ${pass}，FAIL ${fail}`)
if (fail > 0) {
  console.log(failures.join('\n'))
  process.exit(1)
}
