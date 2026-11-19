#!/usr/bin/env node
// 巡守自检行（roster-audit / roster-mismatch）的口径检查。
//
// 起因：2026-11-18 07:0x 小肥鱼读账时发现，fmt=2 那行
//   `members=5 homes=5 pins=5 scope=fish exclude=fabian(human),lee(home-outside-pond) ok`
// 没说清 `members=5` 含不含被 exclude 的 lee——她拿名册自己算了一遍才定。
// 她的判据：「一行里放两个字段，就要写清它们的关系；否则读的人得自己算一遍。」
//
// fmt=3 的形状：每个计数自带口径（分母 + 排除项贴到它影响的那一格）。
// 这里验两件事：①纯函数拼出来的行是那个形状；②index.js 真的接上了（不再写 fmt=2）。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rosterAuditCounts, buildRosterAuditLine } from '../plugin/dsh-lil-whale-group/lib/roster-audit-core.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = join(HERE, '..', 'plugin', 'dsh-lil-whale-group', 'lib')
// 换行归一：git archive 包里可能被 eol 规则转成 CRLF（2026-11-18 发版检查踩过这个坑）。
const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const index = read(join(LIB, 'index.js'))

let total = 0
let pass = 0
function ok(name, cond) {
  total += 1
  if (cond) { pass += 1; return }
  console.log(`xx ${name}`)
}

// ---- 真实名册那天的形状：6 键、5 条鱼、人 fabian、巡守 lee 的家不在 homes\ 下 ----
// 2026-11-18 15:3x 两点修正后：`homes\` 下只有含 `dsh-home\` 的才算鱼家（lee 放自己东西的
// `homes\lee` 不算），所以 `homes=4`；巡守的 skip 说明带它**真正的家**，不再写 home-outside-pond。
const counts = rosterAuditCounts({
  rosterKeys: ['lee', 'whale', 'fabian', 'fishball', 'xiaoman', 'lee2'],
  fishEntries: [
    ['lee', { kind: 'fish', role: 'watcher', home: 'C:\\Users\\Fabian\\.dsh' }],
    ['whale', { kind: 'fish', role: 'member' }],
    ['fishball', { kind: 'fish', role: 'member' }],
    ['xiaoman', { kind: 'fish', role: 'member' }],
    ['lee2', { kind: 'fish', role: 'member' }],
  ],
  humanKeys: ['fabian'],
  homeKeys: ['xiaoman', 'fishball', 'lee2', 'whale'],
  otherHomeKeys: ['lee'],
  watcherHomes: { lee: 'C:\\Users\\Fabian\\.dsh' },
  pinKeys: ['lee', 'whale', 'fishball', 'xiaoman', 'lee2'],
})
const line = buildRosterAuditLine({
  ts: '2026-11-18 07:10:00',
  counts,
  media: { existed: true, files: 3, bytes: 18117679, oldestMs: new Date('2026-11-15T10:00:00').getTime() },
})

ok('行首：时间 | roster-audit | fmt=6', line.startsWith('2026-11-18 07:10:00 | roster-audit | fmt=6 '))
ok('干净行以 ok 收尾', line.endsWith(' ok'))
ok('members 写明是鱼、分母 6 键、人不在数里', line.includes('members=5(fish;keys=6;not-fish=fabian)'))
ok('homes 只数鱼家（含 dsh-home），名字排序列出来', line.includes('homes=4(fish-home:fishball,lee2,whale,xiaoman;other:lee(no-dsh-home))'))
ok('home-check 写明只有 4 条鱼、lee 被跳过（身份）且家从名册读', line.includes('home-check=4(fish;skip=lee:watcher;watcher-home-from=members)'))
ok('不再出现有歧义的 home-outside-pond', !line.includes('home-outside-pond'))
ok('pins 写明数的是键、名字列出来（不是鱼数）', line.includes('pins=5(keys:fishball,lee,lee2,whale,xiaoman)'))
// 2026-11-18 19:5x（第三条鱼）：媒体缓存现状挂在同一行上，"没删"与"没清过"才分得开。
ok('media 格写文件数、字节数、最久没被用到那份的月-日', line.includes('media=files:3 bytes:18117679 oldest-used:11-15'))
ok('这行的 media 不是 unknown（插件拿到了 stats）', !line.includes('media=unknown'))
ok('旧口径字段不再出现（scope= / exclude=）', !line.includes('scope=') && !line.includes('exclude='))
ok('一行只出现一次 members=', line.split('members=').length === 2)
ok('这行不再把家路径塞进括号（按任何分隔符切都不丢字段）', !line.includes('home:C:'))
const homeCheckPart = (line.match(/home-check=[^ ]+/) || [''])[0]
ok('整行括号左右相等', (line.match(/\(/g) || []).length === (line.match(/\)/g) || []).length)
ok('home-check 这一格没有嵌套括号（按 ( 切也不会丢字段）', (homeCheckPart.match(/\(/g) || []).length === 1 && (homeCheckPart.match(/\)/g) || []).length === 1)
ok('home-check 的 4 = members 的 5 − 巡守 1', counts.homeChecked.length === counts.fishKeys.length - 1)
ok('巡守仍算在 members 里（只是不参与家比对）', counts.fishKeys.includes('lee') && !counts.homeChecked.includes('lee'))
ok('巡守的家仍被认出来（counts 里有，但不进这行）', counts.watcherHomes.lee === 'C:\\Users\\Fabian\\.dsh')

// ---- 人也被钉了会话：pins 会变成 6，但名单里写着是谁，不会被读成多了一条鱼 ----
const humanPinned = buildRosterAuditLine({
  ts: '2026-11-18 07:10:00',
  counts: rosterAuditCounts({
    rosterKeys: ['a', 'b', 'fabian'],
    fishEntries: [['a', { kind: 'fish', role: 'member' }], ['b', { kind: 'fish', role: 'member' }]],
    humanKeys: ['fabian'],
    homeKeys: ['a', 'b'],
    pinKeys: ['b', 'a', 'fabian'],
  }),
})
ok('pins 键数独立于鱼数（6 不会被误读成鱼）', humanPinned.includes('pins=3(keys:a,b,fabian)') && humanPinned.includes('members=2(fish'))

// ---- 没有人的名册 ----
const noHuman = buildRosterAuditLine({
  ts: '2026-11-18 07:10:00',
  counts: rosterAuditCounts({
    rosterKeys: ['a', 'b'],
    fishEntries: [['a', { kind: 'fish', role: 'member' }], ['b', { kind: 'fish', role: 'member' }]],
    humanKeys: [],
    homeKeys: ['a', 'b'],
    pinKeys: ['a', 'b'],
  }),
})
ok('没人时 not-fish=none（不说谎成 0）', noHuman.includes(';not-fish=none)'))
ok('没有非鱼家目录时 other=none（不省略这一格）', noHuman.includes(';other:none)'))

// ---- 没有巡守（每家的家都在 homes\ 下） ----
const noWatcher = buildRosterAuditLine({
  ts: '2026-11-18 07:10:00',
  counts: rosterAuditCounts({
    rosterKeys: ['a', 'b'],
    fishEntries: [['a', { kind: 'fish', role: 'member' }], ['b', { kind: 'fish', role: 'member' }]],
    humanKeys: [],
    homeKeys: ['a', 'b'],
    pinKeys: ['a', 'b'],
  }),
})
ok('没巡守时 skip=none', noWatcher.includes('home-check=2(fish;skip=none)'))

// ---- 媒体缓存三态：unknown（没算/失败）/ no-dir（没下过）/ 空目录（oldest-used:none），不共用缺省 ----
// "unknown 不带原因"等于把"没记"与"试过、失败了"混成一句（第三条鱼 2026-11-18 私信）。
ok('没给 media 时写 media=unknown:not-collected', noHuman.includes('media=unknown:not-collected'))
const noDir = buildRosterAuditLine({ ts: '2026-11-18 07:10:00', counts, media: { existed: false, error: null } })
ok('目录不存在写 media=no-dir（不是 files:0）', noDir.includes('media=no-dir') && !noDir.includes('media=files:0'))
const eacces = buildRosterAuditLine({ ts: '2026-11-18 07:10:00', counts, media: { existed: false, error: 'EACCES' } })
ok('读不到写 media=unknown:EACCES（权限，试过了）', eacces.includes('media=unknown:EACCES'))
const enoent = buildRosterAuditLine({ ts: '2026-11-18 07:10:00', counts, media: { existed: false, error: 'ENOENT' } })
ok('父目录不在写 media=unknown:ENOENT（路径算错）', enoent.includes('media=unknown:ENOENT'))
ok('失败原因优先于 existed（有 error 就不写 files:0）', !enoent.includes('media=files:0'))
const emptyDir = buildRosterAuditLine({
  ts: '2026-11-18 07:10:00',
  counts,
  media: { existed: true, files: 0, bytes: 0, oldestMs: null },
})
ok('空目录写 files:0 bytes:0 oldest-used:none', emptyDir.includes('media=files:0 bytes:0 oldest-used:none'))

// ---- 差集行：问题原样带上，且不写 ok ----
const bad = buildRosterAuditLine({
  ts: '2026-11-18 07:10:00',
  counts,
  problems: ['only-in-homes=ghost', 'only-in-members=lee2'],
})
ok('有问题时事件名是 roster-mismatch', bad.includes('| roster-mismatch | fmt=6 '))
ok('问题 token 原样保留', bad.includes('only-in-homes=ghost') && bad.includes('only-in-members=lee2'))
ok('有问题时不写 ok', !bad.endsWith(' ok') && bad.endsWith('only-in-members=lee2'))

// ---- 接线：index.js 用新函数，旧的行模板已退役 ----
ok('index.js 导入 rosterAuditCounts / buildRosterAuditLine', index.includes("from './roster-audit-core.js'") && index.includes('rosterAuditCounts, buildRosterAuditLine'))
ok('index.js 用 buildRosterAuditLine 拼行', index.includes('buildRosterAuditLine({ ts, counts, problems, media })'))
ok('index.js 把媒体缓存现状读出来传下去', index.includes('mediaCacheStats({ dir: MEDIA_CACHE_DIR })'))
ok('index.js 不再自己拼 fmt=2 的自检行', !index.includes('roster-audit | fmt=2'))
ok('fmt=6 起 media 那格叫 oldest-used（不再叫 oldest）', line.includes('oldest-used:') && !line.includes(' oldest:'))
ok('index.js 会读名册全部键（分母）', index.includes('function rosterAllKeys()'))
// 2026-11-18 15:3x：`homes\` 下的目录不都是鱼家——只把含 `dsh-home\` 的算家，其余进 other。
ok('index.js 按 dsh-home 分辨鱼家', index.includes("existsSync(join(POND_ROOT, 'homes', name, 'dsh-home'))"))
ok('index.js 把非鱼家目录与巡守 home 一起传下去', index.includes('otherHomeKeys,') && index.includes('watcherHomes,') && index.includes('m.home ??'))
ok('index.js 的差集也用鱼家集合（不再用全部目录）', index.includes('const homes = new Set(homeKeys)'))

console.log(`test-roster-audit：合计 ${total}，PASS ${pass}，FAIL ${total - pass}`)
if (pass !== total) process.exit(1)
