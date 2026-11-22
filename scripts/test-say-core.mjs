// 发言地址检查的测试（2026-11-17 r243）。
//
// 两半：
//   1. 纯函数说对了没有（to/channel 的值域）
//   2. 插件真的用了它没有（静态接线检查；不改鱼塘数据）
//
// 用法：node scripts\test-say-core.mjs

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sayProblemOf, toProblemOf, channelProblemOf, CHANNELS } from '../plugin/dsh-lil-whale-group/lib/say-core.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const KEYS = ['lee', 'whale', 'fabian', 'fishball', 'xiaoman']

let pass = 0
let fail = 0
const failures = []
function check(label, actual, expected) {
  if (actual === expected) {
    pass += 1
    return
  }
  fail += 1
  failures.push({ label, actual, expected })
}

// —— 1. 正经地址：不该被拦 ——
check('群发 all', toProblemOf('all', KEYS), null)
check('群里指名成员', toProblemOf('whale', KEYS), null)
check('私聊指名成员', toProblemOf('whale', KEYS, 'dm'), null)
check('首尾空白会去掉后认', toProblemOf(' lee ', KEYS), null)
check('缺省 channel 当作 group', sayProblemOf({ to: 'lee' }, KEYS), null)
check('空 channel 当作 group', sayProblemOf({ to: 'lee', channel: '' }, KEYS), null)
// 2026-11-22 r413：群里不再有 to（叫醒谁看 mention），所以 group 不要求 to。
check('群里没有 to 也算合格（r413）', sayProblemOf({}, KEYS), null)
check('群里 to 是坏的也不再算地址错（r413 起 to 不进群消息）', sayProblemOf({ to: 'group' }, KEYS), null)
check('私聊没 to 仍要拦', typeof sayProblemOf({ channel: 'dm' }, KEYS), 'string')
check('CHANNELS 只有两个值', CHANNELS.join(','), 'group,dm')

// —— 2. 坏地址：必须拦，而且要说出为什么 ——
check('房间名当收件人（第三条鱼那条坏调用）', typeof toProblemOf('group', KEYS), 'string')
check('房间名当收件人：文案点出 channel', /channel/.test(toProblemOf('group', KEYS)), true)
check('名册里没有的键', typeof toProblemOf('nobody', KEYS), 'string')
check('to 没写', typeof toProblemOf(undefined, KEYS), 'string')
check('to 是数字', typeof toProblemOf(42, KEYS), 'string')
check('to 是空串', typeof toProblemOf('   ', KEYS), 'string')
check('私聊不能 all', typeof toProblemOf('all', KEYS, 'dm'), 'string')
check('私聊不能 all：文案说得清', /指名/.test(toProblemOf('all', KEYS, 'dm')), true)
check('未知 channel', typeof channelProblemOf('DM'), 'string')
check('未知 channel：私聊', typeof channelProblemOf('私聊'), 'string')
check('channel 是数字', typeof channelProblemOf(1), 'string')
check('sayProblemOf 先报 channel', /channel/.test(sayProblemOf({ to: 'lee', channel: 'DM' }, KEYS)), true)
check('数组形式的名册键也认', toProblemOf('lee', [...KEYS]), null)

// —— 3. 静态接线：index.js 真的用了这套检查 ——
const indexJs = readFileSync(join(ROOT, 'plugin', 'dsh-lil-whale-group', 'lib', 'index.js'), 'utf8')
check('index.js 导入 say-core', /from '\.\/say-core\.js'/.test(indexJs), true)
check('say() 调 sayProblemOf', /const problem = sayProblemOf\(\{ to, channel \}/.test(indexJs), true)
check('say() 被拒时留 say-rejected 痕', /say-rejected/.test(indexJs), true)
check('群消息记录不再写 to（r413：叫醒只看 mention）', /to: toKey/.test(indexJs), false)
check("group_say 检查 channel 值域", /channelProblemOf\(args\.channel\)/.test(indexJs), true)
check('raw-spec 的 reason 改成 host-resolve-pending', /host-resolve-pending/.test(indexJs), true)
check('旧的 defineTool-unresolved 不再出现', /defineTool-unresolved/.test(indexJs), false)
check('旧事件名 group_say-rejected 已改名', /group_say-rejected/.test(indexJs), false)
check('改名后的事件名 say-unpinned', /note: 'say-unpinned'/.test(indexJs), true)
check('host-resolve 行会 join rawRegistered', /rawRegistered: \[\.\.\.rawRegistered\]\.join/.test(indexJs), true)

// —— 4. 文案快照：拒绝时说的那几句话，是不是还是这几句 ——
// 期望值是从 say-core.js 一次抄下来的。文案一变，这里就红——这是故意的。
// 红的时候先分诊（判据 §54）：
//   CHANGELOG 里有"文案变" ⇒ 这里跟着改，红转绿，不算回归；
//   没有 ⇒ 先按字段比，别急着改期望值把红抹掉。
const MEMBER_LIST = KEYS.join(' / ')
const ALL_LIST = 'all / ' + MEMBER_LIST
check(
  '文案快照：channel 类型错',
  channelProblemOf(7),
  'channel 要写字符串：group 或 dm（现在是 number）。',
)
check(
  '文案快照：channel 不认识',
  channelProblemOf('DM'),
  'channel=DM 不认识：只有 group（在群里说）和 dm（私下说）两个值。',
)
check(
  '文案快照：to 没写',
  toProblemOf(undefined, KEYS),
  `to 没写：要给 'all'（群里所有人）或名册里的成员键（现在有：${ALL_LIST}）。`,
)
check(
  '文案快照：to 不在名册',
  toProblemOf('group', KEYS),
  [
    `to=group 不是名册里的键（现在有：${ALL_LIST}）。`,
    "to 是「说给谁」，不是「在哪间屋」—— 群里说话 to 可以写 'all' 或某个成员键，",
    '「在群里还是私下」由 channel 决定（channel=group / channel=dm）。',
  ].join(''),
)
check(
  '文案快照：私聊不能 all',
  toProblemOf('all', KEYS, 'dm'),
  `channel=dm 得指名对象：to 不能是 'all'（现在有：${MEMBER_LIST}）。`,
)

if (fail > 0) {
  const copyRed = failures.some((item) => item.label.startsWith('文案快照'))
  if (copyRed) {
    console.log('文案快照红了：先看 CHANGELOG 里有没有「文案变」那条（判据 §54）。')
    console.log('  有 ⇒ 更新这里的期望值；没有 ⇒ 先按字段比，再决定是不是真回归。')
  }
  for (const item of failures) {
    console.log(`xx ${item.label}`)
    console.log(`   期望：${JSON.stringify(item.expected)}`)
    console.log(`   实际：${JSON.stringify(item.actual)}`)
  }
}
console.log(`test-say-core：合计 ${pass + fail}，PASS ${pass}，FAIL ${fail}`)
process.exit(fail === 0 ? 0 : 1)
