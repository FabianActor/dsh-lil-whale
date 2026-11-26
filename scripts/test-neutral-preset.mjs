// 中立 preset 自检的两条纯函数：切清单、比差集。
//
// 这一格存在的理由：neutral 是一份**快照**，它不会跟着 standard 长。快照落后时症状特别安静——
// 用 neutral 起的新会话就是少几只手，而账上没有任何一行说"少了"。所以这里要能红：
// 把 standard 里的一件塞进标准清单、neutral 里不给，差集必须正好是它。
import { presetPluginIds, missingPluginsOf } from './check-neutral-preset.mjs'

let pass = 0
const fails = []
function ok(name, cond, extra) {
  if (cond) { pass += 1; return }
  fails.push(`${name}${extra ? ' —— ' + extra : ''}`)
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const DUMP = [
  '- id: preset-standard',
  '  name: standard',
  '  plugins:',
  '    - id: tool-fs',
  '      name: "@deepseek-ai/dsh-tool-fs"',
  '    - id: tool-office',
  '      name: "@deepseek-ai/dsh-tool-office"',
  '    - id: tool-bili-eyes',
  '      name: "@deepseek-ai/dsh-bili-eyes"',
  '- id: preset-neutral',
  '  name: neutral',
  '  plugins:',
  '    - id: tool-fs',
  '      name: "@deepseek-ai/dsh-tool-fs"',
  '- id: preset-ptc',
  '  name: ptc',
  '  plugins:',
  '    - id: tool-office',
  '      name: "@deepseek-ai/dsh-tool-office"',
  '',
].join('\n')

const std = presetPluginIds(DUMP, 'standard')
const neu = presetPluginIds(DUMP, 'neutral')
ok('standard 切得对', eq(std, ['tool-fs', 'tool-office', 'tool-bili-eyes']), JSON.stringify(std))
ok('neutral 切得对', eq(neu, ['tool-fs']), JSON.stringify(neu))
ok('ptc 不会混进 neutral', !eq(neu, presetPluginIds(DUMP, 'ptc')))
ok('没有的 preset 回 null', presetPluginIds(DUMP, 'nope') === null)

// 正样本：一致
ok('一致时差集为空', eq(missingPluginsOf(std, std), []))
// 负样本：真落后（这就是 11-27 凌晨那件事的缩小版）
const behind = missingPluginsOf(std, neu)
ok('落后时正好点名那两件', eq(behind, ['tool-office', 'tool-bili-eyes']), JSON.stringify(behind))
// 反向不算落后（neutral 多出来的是它自己装的，不归这一格管）
ok('neutral 多出来的不算落后', eq(missingPluginsOf(['a'], ['a', 'b']), []))
// 输入不是数组时不许炸，也不许报"落后"
ok('null 输入回空数组', eq(missingPluginsOf(null, ['a']), []))

// 真 dump 的形状里有 CRLF 与更深的缩进
const CRLF = DUMP.replace(/\n/g, '\r\n').replace(/^ {4}- id:/gm, '        - id:')
ok('CRLF 与更深缩进也切得对', eq(presetPluginIds(CRLF, 'neutral'), ['tool-fs']), JSON.stringify(presetPluginIds(CRLF, 'neutral')))

if (fails.length > 0) {
  for (const f of fails) console.log('  ✗ ' + f)
  console.log(`PASS ${pass} / FAIL ${fails.length}`)
  process.exit(1)
}
console.log(`PASS ${pass} / FAIL 0`)