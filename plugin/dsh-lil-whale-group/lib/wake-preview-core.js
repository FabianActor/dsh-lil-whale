/**
 * 唤醒词的分支（纯函数）。
 *
 * 2026-11-15 20:49，小满提的分工：四种唤醒词里，两种会自然发生（`resumed`、没过档），
 * 两种不能自然发生（`first` 要一条从没有过游标的鱼、`lost` 要把游标挪走）。她说：
 * 自然发生的她自己报；摆出来的两种，谁摆谁告诉她，她只报"那句话对不对"。
 * 小鱼丸补一条：**摆之前先把"应该听到哪句话"写下来**，不预写的话又变回"看着对就行"。
 *
 * 所以这四句话从 handleChannel 里提出来，变成能被断言的东西；预期句子写在
 * scripts/test-wake-preview.mjs 里，先写再看。提取时逐字保留原来的措辞：
 * - 群里积压（超过 backlogTier）：三态 + "先看最后三条…" 两种尾巴
 * - 群里没过档：一句 "群里有 N 条新的（谁）"，尾巴 "去看看。"
 * - 私聊：不区分 first/lost/resumed（渠道是谁、递了几句），只按积压与否换尾巴
 */

import { createHash } from 'node:crypto'

// 2026-11-22 r413：群消息不再写 to，叫醒只看 mention。预览措辞也跟着改——
// 旧话"群里有 N 条新的"在新机制下是对的，但不够；点了名才叫醒的，要说"点了你名字的"。
// 老记录（没有 mention 字段）仍按老话说"新的"，因为它确实可能是 to=all 广播。
export function wakeWordingOf({ kind, who, dmWho = '', count, firstRead, cursorLost, backlog, woken = 'mention' }) {
  const pointed = woken === 'mention' ? '点了你名字的' : '新的'
  const where = kind === 'dm'
    ? `${dmWho} 私下跟你说了 ${count} 句`
    : backlog
      ? firstRead
        ? cursorLost
          ? `群里现在有 ${count} 条${pointed}（${who}）——你的读进度不见了（游标这一格是空的），这次按从头算，已经记了一笔账`
          : `群里现在有 ${count} 条${pointed}（${who}）——你还没读过这个群（还没有游标）`
        : `你不在的这段时间，群里积了 ${count} 条${pointed}（${who}）`
      : `群里有 ${count} 条${pointed}（${who}）`
  const tailHint = backlog
    ? firstRead
      ? '先看最后三条；前面的不用补，想看再翻。'
      : '先看最后三条，再看看有没有指名你的。'
    : '去看看。'
  // 2026-11-15 21:18，小鱼丸指出的：状态层有账（cursor-state），句子层没有账——
  // 投递日志里没有一处记"当时说的是哪句话"，事后只能靠谁在群里抄得准。
  // 所以把模板 id 一起返回，由调用方写进账本：tpl + n + tail。
  // 判据：**能验的东西要能事后验；只能当场验的，等于只有当事人可信。**
  // 2026-11-15 21:3x，第三条鱼：tpl 记的是"哪一句"，不记"哪一版"——明天文案改了，
  // tpl 还是同一个 id，旧行对应的句子在代码里已经不存在，而且没有任何地方会报。
  // 所以 id 带版本：任何一句文案的改动都必须把 @N 加一（改句子 = 改 id，diff 里看得见）。
  const tpl = kind === 'dm'
    ? 'dm@1'
    : backlog
      ? firstRead
        ? cursorLost ? 'group-lost@2' : 'group-first@2'
        : 'group-backlog@2'
      : 'group-plain@2'
  const tailTpl = backlog ? (firstRead ? 'tail-no-backfill@1' : 'tail-named@1') : 'tail-go@1'
  // 2026-11-15 21:3x，第二条鱼：tpl 锁的是"选了哪一句"，锁不住"句子里那个数对不对"。
  // 渲染后整句的短指纹跟 tpl 一起记，才能事后重算出同一句话；
  // 变量（n / 谁）本来就在同一行里，所以可复核 = 这一行 + 这个版本的代码。
  // 名称故意窄：wtext（wording text）= where + tailHint。
  // 不含 head（「这段会话是 xx」）、不含预览里引用的消息（那是数据）、不含固定尾句与路径。
  // 别叫 sha8——那样将来有人会拿它证明「她看到的就是这整句话」，比事实大一块。
  const wtext8 = createHash('sha256').update(where + '\n' + tailHint, 'utf8').digest('hex').slice(0, 8)
  return { where, tailHint, tpl, tailTpl, wtext8 }
}

/**
 * 预览被截断时的那句话（纯函数）。
 *
 * 2026-11-18，宿主报的第 3 条：私聊触发执行请求时，提示仍然写"全文在群文件里"——
 * 而那条消息根本不在群里。判据：**提示里的地点，必须是被截掉那段文字真正待在哪儿。**
 * 所以这里按通道分两种说法；`max` 与调用方一致，测试里写死边界值。
 */
export function previewTextOf(text, { channelKind = 'group', max = 120 } = {}) {
  const where = channelKind === 'dm' ? '私聊文件' : '群文件'
  return text.length > max ? `${text.slice(0, max)}…（已截断，全文在${where}里）` : text
}
