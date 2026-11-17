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
const counts = rosterAuditCounts({
  rosterKeys: ['lee', 'whale', 'fabian', 'fishball', 'xiaoman', 'lee2'],
  fishEntries: [
    ['lee', { kind: 'fish', role: 'watcher' }],
    ['whale', { kind: 'fish', role: 'member' }],
    ['fishball', { kind: 'fish', role: 'member' }],
    ['xiaoman', { kind: 'fish', role: 'member' }],
    ['lee2', { kind: 'fish', role: 'member' }],
  ],
  humanKeys: ['fabian'],
  homeKeys: ['xiaoman', 'fishball', 'lee', 'lee2', 'whale'],
  pinKeys: ['lee', 'whale', 'fishball', 'xiaoman', 'lee2'],
})
const line = buildRosterAuditLine({ ts: '2026-11-18 07:10:00', counts })

ok('行首：时间 | roster-audit | fmt=3', line.startsWith('2026-11-18 07:10:00 | roster-audit | fmt=3 '))
ok('干净行以 ok 收尾', line.endsWith(' ok'))
ok('members 写明是鱼、分母 6 键、人不在数里', line.includes('members=5(fish;keys=6;not-fish=fabian)'))
ok('homes 写明是目录、名字列出来（排序）', line.includes('homes=5(dirs:fishball,lee,lee2,whale,xiaoman)'))
ok('home-check 写明只有 4 条鱼、lee 被跳过及原因', line.includes('home-check=4(fish;skip=lee:home-outside-pond)'))
ok('pins 计数单独一格', line.includes('pins=5'))
ok('旧口径字段不再出现（scope= / exclude=）', !line.includes('scope=') && !line.includes('exclude='))
ok('一行只出现一次 members=', line.split('members=').length === 2)
ok('home-check 的 4 = members 的 5 − 巡守 1', counts.homeChecked.length === counts.fishKeys.length - 1)
ok('巡守仍算在 members 里（只是不参与家比对）', counts.fishKeys.includes('lee') && !counts.homeChecked.includes('lee'))

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

// ---- 差集行：问题原样带上，且不写 ok ----
const bad = buildRosterAuditLine({
  ts: '2026-11-18 07:10:00',
  counts,
  problems: ['only-in-homes=ghost', 'only-in-members=lee2'],
})
ok('有问题时事件名是 roster-mismatch', bad.includes('| roster-mismatch | fmt=3 '))
ok('问题 token 原样保留', bad.includes('only-in-homes=ghost') && bad.includes('only-in-members=lee2'))
ok('有问题时不写 ok', !bad.endsWith(' ok') && bad.endsWith('only-in-members=lee2'))

// ---- 接线：index.js 用新函数，旧的行模板已退役 ----
ok('index.js 导入 rosterAuditCounts / buildRosterAuditLine', index.includes("from './roster-audit-core.js'") && index.includes('rosterAuditCounts, buildRosterAuditLine'))
ok('index.js 用 buildRosterAuditLine 拼行', index.includes('buildRosterAuditLine({ ts, counts, problems })'))
ok('index.js 不再自己拼 fmt=2 的自检行', !index.includes('roster-audit | fmt=2'))
ok('index.js 会读名册全部键（分母）', index.includes('function rosterAllKeys()'))

console.log(`test-roster-audit：合计 ${total}，PASS ${pass}，FAIL ${total - pass}`)
if (pass !== total) process.exit(1)
