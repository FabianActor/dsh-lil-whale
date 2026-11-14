// 改名的判断逻辑 —— 行为测试（不碰文件、不碰网络）。
// 跑：node scripts/test-rename.mjs
import {
  NAME_MAX,
  RENAME_COOLDOWN_HOURS,
  cleanName,
  nameTaken,
  historyAfterRename,
  canRename,
  renameAnnouncement,
} from '../plugin/dsh-lil-whale-group/lib/rename-core.js'

let pass = 0
let fail = 0
const failures = []

function check(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
  } else {
    fail++
    failures.push(`${label}\n  期望 ${e}\n  实际 ${a}`)
  }
}

const T = '2026-11-14T15:00:00.000Z'

// ---------- cleanName ----------
check('cleanName 空串 → null', cleanName(''), null)
check('cleanName 全空白 → null', cleanName('   '), null)
check('cleanName null → null', cleanName(null), null)
check('cleanName 数字 → null', cleanName(5), null)
check('cleanName 去首尾空白', cleanName('  小肥  '), '小肥')
check('cleanName 连续空白压一个', cleanName('小  肥\t鱼'), '小 肥 鱼')
check('cleanName 16 个 emoji 可以', cleanName('😀'.repeat(NAME_MAX)), '😀'.repeat(NAME_MAX))
check('cleanName 17 个 emoji 不行', cleanName('😀'.repeat(NAME_MAX + 1)), null)
check('cleanName 17 个汉字不行', cleanName('鱼'.repeat(NAME_MAX + 1)), null)
check('cleanName 中英混排可以', cleanName('小鱼丸 Beta'), '小鱼丸 Beta')

// ---------- nameTaken ----------
check('nameTaken 撞名（大小写不敏感）', nameTaken('Leea', ['leea']), true)
check('nameTaken 带空白也算撞', nameTaken('小肥鱼', [' 小肥鱼 ']), true)
check('nameTaken 不撞', nameTaken('Leea', ['小肥鱼', '小鱼丸']), false)
check('nameTaken 别人没名字不算撞', nameTaken('Leea', ['', '  ']), false)
check('nameTaken 空 others', nameTaken('Leea', []), false)

// ---------- historyAfterRename ----------
check(
  'history 从空开始',
  historyAfterRename([], '大肥鱼', 'Leea', T),
  [{ name: '大肥鱼', until: T }, { name: 'Leea' }],
)
check(
  'history 末条没有 until：补上它',
  historyAfterRename([{ name: '大肥鱼' }], '大肥鱼', 'Leea', T),
  [{ name: '大肥鱼', until: T }, { name: 'Leea' }],
)
check(
  'history 末条已有 until：把旧名再记一条',
  historyAfterRename([{ name: '小鱼', until: '2026-01-01T00:00:00.000Z' }], '小鱼', 'Leea', T),
  [
    { name: '小鱼', until: '2026-01-01T00:00:00.000Z' },
    { name: '小鱼', until: T },
    { name: 'Leea' },
  ],
)
check(
  'history 坏形状被丢掉',
  historyAfterRename([null, 'x', { name: '大肥鱼' }], '大肥鱼', 'Leea', T),
  [{ name: '大肥鱼', until: T }, { name: 'Leea' }],
)

// ---------- canRename ----------
check('canRename 从没改过 → 可以', canRename(null, T), { ok: true })
check('canRename 坏时间 → 可以', canRename('not-a-date', T), { ok: true })
{
  const oneHourAgo = new Date(Date.parse(T) - 3600_000).toISOString()
  const gate = canRename(oneHourAgo, T)
  check('canRename 1 小时前改过 → 不行', gate.ok, false)
  check('canRename retryAt = 上次 + 24h', gate.retryAt, new Date(Date.parse(oneHourAgo) + RENAME_COOLDOWN_HOURS * 3600_000).toISOString())
}
{
  const longAgo = new Date(Date.parse(T) - 25 * 3600_000).toISOString()
  check('canRename 25 小时前改过 → 可以', canRename(longAgo, T), { ok: true })
}

// ---------- renameAnnouncement ----------
{
  const text = renameAnnouncement('大肥鱼', 'Leea')
  check('播报里有新名字', text.includes('「Leea」'), true)
  check('播报里有旧名字', text.includes('「大肥鱼」'), true)
  check('播报说"那个名字也是我"', text.includes('那个名字也是我'), true)
}

// ---------- 结果 ----------
const total = pass + fail
if (fail === 0) {
  console.log(`合计：${total} 项，PASS ${pass}，FAIL 0`)
  process.exit(0)
}
console.log(`合计：${total} 项，PASS ${pass}，FAIL ${fail}`)
for (const item of failures) console.log('  ✗ ' + item)
process.exit(1)
