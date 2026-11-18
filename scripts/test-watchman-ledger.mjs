// 巡守账位置（r352）：整池一本 `pool\state\watchman.log`，旧路径只在迁移里出现。
// 这条测试守的是"位置"不是"内容"：谁写、写到哪、搬过一次之后旧路径还被不被人当写点。
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(p, 'utf8')

const index = read('plugin/dsh-lil-whale-group/lib/index.js')
const doctor = read('scripts/doctor.ps1')
const verify = read('scripts/verify-pending.ps1')
const rotate = read('scripts/rotate-logs.mjs')
const logDoc = read('docs/detail/日志都记在哪.md')
const installDoc = read('docs/detail/怎么装一套鱼塘.md')

let pass = 0
const fails = []
const ok = (name, cond) => { if (cond) { pass += 1 } else { fails.push(name) } }

// --- 插件：常量与迁移 ---
ok('WATCHMAN_LOG 指向 pool\\state', /const WATCHMAN_LOG = join\(POOL_STATE, 'watchman\.log'\)/.test(index))
ok('WATCHMAN_LOG 不再用 SELF_HOME', !/const WATCHMAN_LOG = join\(SELF_HOME, 'logs', 'watchman\.log'\)/.test(index))
ok('旧路径只放在 LEGACY_WATCHMAN_LOG',
  /const LEGACY_WATCHMAN_LOG = join\(SELF_HOME, 'logs', 'watchman\.log'\)/.test(index))
ok('有 migrateWatchmanLog 函数', /function migrateWatchmanLog\(\)/.test(index))
ok('迁移在模块加载时调用一次', /^migrateWatchmanLog\(\)$/m.test(index))
ok('迁移用 renameSync', /renameSync\(LEGACY_WATCHMAN_LOG, WATCHMAN_LOG\)/.test(index))
ok('迁移后账首写 home-moved', /home-moved from=\$\{LEGACY_WATCHMAN_LOG\}/.test(index))
ok('两边都在时写 home-moved-conflict', /home-moved-conflict from=/.test(index))
ok('冲突时旧文件改名留档', /watchman\.legacy-/.test(index))
ok('写账仍然只写 WATCHMAN_LOG', /appendFileSync\(WATCHMAN_LOG/.test(index))
ok('旧路径不被当成写点', !/appendFileSync\(LEGACY_WATCHMAN_LOG/.test(index) && !/writeFileSync\(LEGACY_WATCHMAN_LOG/.test(index))

// --- doctor：9c 与「生效值」只看一个文件 ---
ok('doctor 9c 用 PoolState 拼路径', /\$wmPath9c = Join-Path \$Cfg\.PoolState 'watchman\.log'/.test(doctor))
ok('doctor 9c 的标签写明池账本', /\$label9c = 'pool\\state\\watchman\.log'/.test(doctor))
ok('doctor 9c 保留 r352 分界注释', /r352/.test(doctor))
ok('doctor 生效值也读池账本', /\$capsLog = Join-Path \$Cfg\.PoolState 'watchman\.log'/.test(doctor))
ok('doctor 不再逐鱼找 watchman.log 写点',
  !/\$wmLog = Join-Path \$homes/.test(doctor) && !/homes\\\\\*\\\\logs\\\\watchman\.log/.test(doctor))

// --- verify-pending：只读池账本 ---
ok('verify-pending 读 PoolState', /\$wm = Join-Path \$Cfg\.PoolState 'watchman\.log'/.test(verify))

// --- 轮转：目标列表含 pool\state ---
ok('rotate-logs 扫 pool\\state', /join\(POOL, 'state'\)/.test(rotate))

// --- 文档：写清楚"整池一本" ---
ok('日志页写了整池一本', /pool\\state\\watchman\.log.*整池一本/.test(logDoc))
ok('日志页写了 home-moved 断口', /home-moved from=/.test(logDoc))
ok('安装页 WATCHMAN_LOG 表更新', /`WATCHMAN_LOG` \| `<鱼塘根>\\pool\\state\\watchman\.log`/.test(installDoc))
ok('安装页不再说"一家一本"',
  !/watchman\.log.*不是一本，是一家一本/.test(installDoc))

console.log(fails.length === 0 ? `test-watchman-ledger：PASS ${pass}` : `test-watchman-ledger：PASS ${pass}，FAIL ${fails.length}\n  xx ${fails.join('\n  xx ')}`)
process.exit(fails.length === 0 ? 0 : 1)
