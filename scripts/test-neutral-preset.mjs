// 中立 preset 自检的两条纯函数：切清单、比差集。
//
// 这一格存在的理由：neutral 是一份**快照**，它不会跟着 standard 长。快照落后时症状特别安静——
// 用 neutral 起的新会话就是少几只手，而账上没有任何一行说"少了"。所以这里要能红：
// 把 standard 里的一件塞进标准清单、neutral 里不给，差集必须正好是它。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { presetPluginIds, missingPluginsOf, rotationEnabledOf } from './check-neutral-preset.mjs'

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

// ── 开着换段却没把默认 preset 设成 neutral（issue #10 后半）──
// 这一格的理由：换段只作用于"已经在跑的那段会话"；新起的会话读的是 default。
// 默认还停在 standard 时，界面上没有任何地方会说"你新开的会话没 neutral"。
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'np-rot-'))
  const dir = path.join(root, 'pool', 'state', 'rotation')
  fs.mkdirSync(dir, { recursive: true })
  const write = (name, obj) => fs.writeFileSync(path.join(dir, name), JSON.stringify(obj))
  // 什么都没写：默认关
  ok('没有 rotation 目录时算关', rotationEnabledOf(root, 'whale') === false)
  // 全机默认开
  write('_default.json', { version: 1, enabled: true, rounds: 80 })
  ok('全机默认开时算开', rotationEnabledOf(root, 'whale') === true)
  // 单鱼覆盖成关
  write('whale.json', { version: 1, enabled: false, rounds: 80 })
  ok('单鱼关覆盖全机开', rotationEnabledOf(root, 'whale') === false)
  ok('别的鱼仍跟全机默认', rotationEnabledOf(root, 'fishball') === true)
  // 只写 rounds 也算显式开（与 apply-neutral-preset 里的 pickBool 同口径）
  write('fishball.json', { version: 1, rounds: 10 })
  ok('只写 rounds 算开', rotationEnabledOf(root, 'fishball') === true)
  write('fishball.json', { version: 1, enabled: false, rounds: 10 })
  ok('enabled=false 压过 rounds', rotationEnabledOf(root, 'fishball') === false)
  // 坏 JSON 当作没写，不许炸
  fs.writeFileSync(path.join(dir, 'xiaoman.json'), '{')
  ok('坏文件不炸、按全机默认算', rotationEnabledOf(root, 'xiaoman') === true)
  fs.rmSync(root, { recursive: true, force: true })
}

if (fails.length > 0) {
  for (const f of fails) console.log('  ✗ ' + f)
  console.log(`PASS ${pass} / FAIL ${fails.length}`)
  process.exit(1)
}
console.log(`PASS ${pass} / FAIL 0`)