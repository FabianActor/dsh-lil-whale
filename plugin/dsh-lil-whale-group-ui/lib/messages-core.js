// 消息文件的投影：把 JSONL 变成面板能画的对象，同时带上**物理行号**。
//
// 为什么行号要在这里定：面板上的 `#1763` 是引用地址，指的是 messages.jsonl /
// pool\dm\<a>__<b>.jsonl 的第 1763 行（两个文件都是 append-only，行号不会变）。
// 行号必须按"读到的第几行"算，包含空行与半截行 —— 否则引用会随文件里的空行错位。
//
// 抽出成纯函数（2026-11-18，r328）是为了能直接测：以前这段埋在 web 路由的文件里，
// 只靠静态断言证明"代码里写了这件事"，测不到"空行/坏行时行号对不对"。

export function projectMessage(record) {
  // 投影要带全：面板靠这些字段画图、画「提到了谁」、判断私聊/群。早先只留了
  // ts/from/to/text/kind，结果她发的图在面板里根本不显示 —— 记录里有、列表里没有。
  const out = {
    ts: record.ts,
    from: record.from,
    to: record.to,
    text: record.text,
    kind: record.kind ?? 'say',
  }
  if (record.s) out.s = record.s
  if (record.channel) out.channel = record.channel
  if (record.toSeat) out.toSeat = record.toSeat
  // 2026-11-22 r413：叫醒名单。新记录一定有；老记录没有（面板按 to 回退显示）。
  if (record.mention !== undefined) out.mention = record.mention
  if (record.image) out.image = record.image
  if (Array.isArray(record.images) && record.images.length > 0) out.images = record.images
  return out
}

/**
 * 「提到了谁」的显示文案（纯函数，面板与投影共用）。
 * mention = 'all' → 所有人；数组 → 名字；空数组 → ''（这一节不写）。
 * 老记录没有 mention：只有当年指了名（to=某人）才推；to=all 的广播不补（不改历史）。
 * 拆出来是为了两处用同一句话：记录投影（群.md）与面板气泡。
 */
export function mentionLabelOf(record, labelOf) {
  const say = (key) => (typeof labelOf === 'function' ? labelOf(key) : key)
  const mention = record?.mention
  if (mention === 'all') return '所有人'
  if (Array.isArray(mention)) return mention.map(say).join('、')
  const to = record?.to
  // 私聊没有"提到了谁"这回事：dm 记录里的 to 是"这间屋开给谁"（收件人），不是叫醒名单。
  // 2026-11-22 修：私聊气泡全部冒出「（按当年 to 推）」就是这个回退没分屋造成的。
  // 2026-11-23 修（r419）：老群消息里 channel='dm' 是"当年 @ 定向"，它仍在群账本里、
  // 也该显示；分屋只认 kind='dm'（私聊），不认 channel='dm'。
  // 2026-11-23 修（r423）：系统提示行是 kind='system'、channel='dm'，也在私聊那一侧。
  // 判"这是群消息吗"比列举"哪些是私聊"更稳：只有 kind 缺失或 kind='say' 才按群记录回退。
  const isGroup = !record?.kind || record.kind === 'say'
  // 老记录：只有当年指了名（to 是某个成员）才显示；to=all 的广播保持原样，
  // 补一句"提到了：所有人"等于替它改历史（2026-11-22 r413 的取舍）。
  // r414：当年 to 的含义是"这话给谁"，不是"谁被叫醒"——推出来的必须自标门牌，
  // 否则下一个人会拿它当读数（小肥鱼 2026-11-22 20:14 的提议）。
  if (isGroup && typeof to === 'string' && to !== '' && to !== 'all') return `${say(to)}（按当年 to 推）`
  return ''
}

export function parseMessageLines(text) {
  const out = []
  let lineNo = 0
  for (const line of String(text).split(/\r?\n/)) {
    lineNo += 1
    const raw = line.trim()
    if (!raw) continue
    try {
      const record = JSON.parse(raw)
      out.push({ line: lineNo, ...projectMessage(record) })
    } catch {
      // 半截行（另一个进程正在写）——跳过，下一次轮询就整了；行号照旧往前数。
    }
  }
  return out
}
