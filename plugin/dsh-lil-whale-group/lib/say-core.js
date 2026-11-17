// 说一句话之前的"地址检查"（2026-11-17 r243，第三条鱼 #1074 的坏调用抓出来的）。
//
// 起因：`group_say(to="group", …)` 被宿主接受、写进了群记录 —— 因为裸 spec 路径下
// `parameters.enum` 只是文档（宿主只校验 required/type，实测 0 处 enum 检查）。
// `to` 是"说给谁"，`channel` 才是"在哪间屋"；把房间名塞进 to，消息就进了一个没人读的地址，
// 而且**不报错**：文件里多一行，没人被叫醒，发的人以为送出去了。
//
// 判据（第二条鱼）：错的时候要响。所以这里不依赖 schema，执行时自己检查 ——
// 降级成裸对象之后，裸对象自己也得会检查。
//
// 纯函数：成员键由调用方传进来（index.js 传 Object.keys(MEMBERS)），这里不读任何文件。

export const CHANNELS = ['group', 'dm']

/** channel 只认两个值。别的值以前会被悄悄当成 group —— 那是"写错地址不报错"的另一种形状。 */
export function channelProblemOf(channel) {
  if (channel === undefined || channel === null || channel === '') return null // 缺省 = group，见 say()
  if (typeof channel !== 'string') return `channel 要写字符串：group 或 dm（现在是 ${typeof channel}）。`
  if (!CHANNELS.includes(channel)) {
    return `channel=${channel} 不认识：只有 group（在群里说）和 dm（私下说）两个值。`
  }
  return null
}

/**
 * `to` 的检查。memberKeys 是名册的键（不含 'all'，这里会自己加）。
 * 返回 null = 没问题；返回字符串 = 给模型看的原因（会原样抛出去）。
 */
export function toProblemOf(to, memberKeys, channel = 'group') {
  const keys = (Array.isArray(memberKeys) ? memberKeys : Object.keys(memberKeys ?? {}))
    .map((key) => String(key))
    .filter((key) => key !== 'all')
  const known = ['all', ...keys]
  if (to === undefined || to === null) {
    return `to 没写：要给 'all'（群里所有人）或名册里的成员键（现在有：${known.join(' / ')}）。`
  }
  if (typeof to !== 'string') {
    return `to 要写字符串：'all' 或名册里的成员键（现在有：${known.join(' / ')}）。`
  }
  const key = to.trim()
  if (key === '') {
    return `to 是空的：要给 'all'（群里所有人）或名册里的成员键（现在有：${known.join(' / ')}）。`
  }
  if (!known.includes(key)) {
    return [
      `to=${key} 不是名册里的键（现在有：${known.join(' / ')}）。`,
      "to 是「说给谁」，不是「在哪间屋」—— 群里说话 to 可以写 'all' 或某个成员键，",
      '「在群里还是私下」由 channel 决定（channel=group / channel=dm）。',
    ].join('')
  }
  if (channel === 'dm' && key === 'all') {
    return `channel=dm 得指名对象：to 不能是 'all'（现在有：${keys.join(' / ')}）。`
  }
  return null
}

/** 两个检查合起来：返回第一条原因，没问题返回 null。 */
export function sayProblemOf({ to, channel }, memberKeys) {
  return channelProblemOf(channel) ?? toProblemOf(to, memberKeys, channel || 'group')
}
