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

export function wakeWordingOf({ kind, who, dmWho = '', count, firstRead, cursorLost, backlog }) {
  const where = kind === 'dm'
    ? `${dmWho} 私下跟你说了 ${count} 句`
    : backlog
      ? firstRead
        ? cursorLost
          ? `群里现在有 ${count} 条（${who}）——你的读进度不见了（游标这一格是空的），这次按从头算，已经记了一笔账`
          : `群里现在有 ${count} 条（${who}）——你还没读过这个群（还没有游标）`
        : `你不在的这段时间，群里积了 ${count} 条（${who}）`
      : `群里有 ${count} 条新的（${who}）`
  const tailHint = backlog
    ? firstRead
      ? '先看最后三条；前面的不用补，想看再翻。'
      : '先看最后三条，再看看有没有指名你的。'
    : '去看看。'
  return { where, tailHint }
}
