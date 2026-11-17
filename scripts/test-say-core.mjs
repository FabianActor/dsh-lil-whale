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
check('say() 用 toKey 落盘', /to: toKey/.test(indexJs), true)
check("group_say 检查 channel 值域", /channelProblemOf\(args\.channel\)/.test(indexJs), true)
check('raw-spec 的 reason 改成 host-resolve-pending', /host-resolve-pending/.test(indexJs), true)
check('旧的 defineTool-unresolved 不再出现', /defineTool-unresolved/.test(indexJs), false)
check('host-resolve 行会 join rawRegistered', /rawRegistered: \[\.\.\.rawRegistered\]\.join/.test(indexJs), true)

if (fail > 0) {
  for (const item of failures) {
    console.log(`xx ${item.label}`)
    console.log(`   期望：${JSON.stringify(item.expected)}`)
    console.log(`   实际：${JSON.stringify(item.actual)}`)
  }
}
console.log(`test-say-core：合计 ${pass + fail}，PASS ${pass}，FAIL ${fail}`)
process.exit(fail === 0 ? 0 : 1)
