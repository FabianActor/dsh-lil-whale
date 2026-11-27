/**
 * 面板 build 标记（client.js 里那行 console.info）的唯一真相。
 * 以前每个测试各写一个 vNN，改一次面板要挨家改六处，还总漏一处；
 * 现在只有这里要动：改了 client.js 就把 MIN_CLIENT_BUILD 加一，顺带把标签也改了。
 */
export const MIN_CLIENT_BUILD = 70

export function clientBuildOf(text) {
  const match = /client build v(\d+) \u00b7 ([\w-]+)/.exec(String(text ?? ''))
  if (!match) return null
  return { version: Number(match[1]), name: match[2] }
}

/** 旧不满要求的测试用它报同一句话。 */
export function describeClientBuildFailure(text) {
  const found = clientBuildOf(text)
  if (!found) return `没有 build 标记（至少要 v${MIN_CLIENT_BUILD}）`
  return found.version >= MIN_CLIENT_BUILD ? '' : `build 标记是 v${found.version}，至少要 v${MIN_CLIENT_BUILD}`
}
