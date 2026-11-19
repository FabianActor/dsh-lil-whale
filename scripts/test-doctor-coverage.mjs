import { readFileSync } from 'node:fs'

const raw = readFileSync(new URL('../scripts/doctor.ps1', import.meta.url), 'utf8')

// 这张表是"体检覆盖"的登记册：doctor.ps1 里每个 Add-Row 的格名都要能落进某"族"。
// 判据分两档（小鱼丸）：新格没登记 = FAIL（覆盖面缩水）；登记了但代码里一种形态都没有 = WARN。
//
// 形状（第三条鱼 2026-11-16 02:05 的原型 + 建议）：一个族可能有三种出现形态——
//   '名字'                 静态格名
//   ('前缀' + $x)          动态格名（每鱼/每端口一格）
//   裸家族名（catch 兜底） 静态格名，但意思是"这一族整体查不了"
// 所以登记按「族 → { 静态名?, 动态前缀? }」，不写成两张平表：
//   加新格时人只需决定它属于哪个族；族在代码里彻底消失会 WARN，不会被悄悄忘掉。
const FAMILIES = [
  { name: '版本一致', static: ['版本一致'], why: '启动痕迹里的 pkg 版本 vs 磁盘 package.json' },
  { name: '工具注册', static: ['工具注册'], why: 'group_say/sleep/rename 三件工具是否注册上' },
  { name: '睡眠工具', static: ['睡眠工具'], why: 'sleep/wake_up 的注册与形状' },
  { name: '会话绑定', static: ['会话绑定'], dynamicPrefix: ['会话绑定（'], why: '钉的每段会话能否在该鱼自己的 dshHome 里找到；静态兜底名=这一族整体查不了' },
  { name: '工作区（鱼）', static: ['工作区'], dynamicPrefix: ['工作区（'], why: '钉在名册里的会话是否登记进她 storages\\workspace.json（否则界面挂在「未分组」）' },
  { name: '第三方补丁', static: ['第三方补丁（bili-eyes）', '第三方补丁'], why: '第三方插件（bili-eyes）的本地补丁是否还在——升级或重装会把它冲掉' },
  { name: '会话分身', static: ['会话分身（全鱼）', '会话分身'], why: '同一会话 id 是否同时出现在两个家里（split-brain：两个进程各写一份，历史会分叉）' },
  { name: '名册与家', static: ['名册与家'], why: '名册 / 家目录 / pins 三个键集合是否对得上' },
  { name: '名册', static: ['名册', '名册（全鱼）', '名册（lee）'], why: 'pins 存在性、每条鱼有没有钉、watcher 不在视野的声明' },
  { name: '名册自检', static: ['名册自检'], why: '巡守的 roster-audit 最近一次结果' },
  { name: '谱系（全鱼）', static: ['谱系（全鱼）'], why: '名册里的每个人都在 family.json 里有节点（单向包含）' },
  { name: '生命周期字段', static: ['生命周期字段'], why: '旧 status 字段是否还在' },
  { name: '归档完整性', static: ['归档完整性'], why: '归档目录的清单/事件流/磁盘是否对得上（r354）' },
  { name: 'fissue 账', static: ['fissue 账'], why: '鱼群 issue 收件台的账是否自洽、正在做哪条（r372）' },
  { name: '日志 kind 声明', static: ['日志 kind 声明'], why: '账上出现未声明的 kind 时报行数（fi-0001，r374）' },
  { name: '旧段', static: ['旧段'], why: '名册外的会话近两小时是否被写过' },
  { name: '配置', static: ['配置'], why: '配置文件是否可读、键是否齐全' },
  { name: '默认值', static: ['默认值'], why: '配置里是否写着等于默认值的键' },
  { name: '生效值', static: ['生效值'], why: '运行期生效的叫醒闸数值与来源' },
  { name: '环境说明', static: ['环境说明'], why: '环境.md 是否过期' },
  { name: '心跳', static: ['她的心跳', '她的心跳（说明）'], why: '第二条鱼 presence 心跳（含说明行）' },
  { name: '端口', static: ['主 dsh 端口', '他的端口', '端口登记'], why: '端口占用与登记' },
  { name: '启动痕迹', static: ['启动痕迹'], why: 'plugin-boot.log 最近一次启动' },
  { name: '出生账', static: ['出生账'], why: '出生账的 since 分界与缺行' },
  { name: '格式分界', static: ['格式分界'], why: 'watchman.log 的 log-format 分界行（含轮转旧文件）' },
  { name: '投递账本', static: ['投递账本'], why: 'wake-deliver.log 形状与末行' },
  { name: '游标', static: ['游标'], why: '成员游标是否超过文件行数' },
  { name: '群投影', static: ['群投影'], why: '群.md 能否由 jsonl 重建到 0 差异' },
  { name: '私聊可读版', static: ['私聊可读版'], why: '私聊可读投影与 jsonl 是否一致' },
  { name: '钥匙', static: ['钥匙（跨鱼）'], dynamicPrefix: ['钥匙（'], why: '该鱼 key 指纹 vs 上次记账；跨鱼共用是否指向继承记录' },
  { name: '通行证', static: ['通行证'], dynamicPrefix: ['通行证（'], why: 'workspace 子树 capability SID 是否齐全；静态兜底名=整体查不了' },
  { name: '家根权限', dynamicPrefix: ['家根权限（'], why: '家根是否有当前用户完全控制（贴标签的前置）' },
  { name: '完整性标签', dynamicPrefix: ['完整性标签（'], why: '家目录树是否都带 Low 完整性标签' },
  { name: '身份纸', static: ['身份纸'], dynamicPrefix: ['身份纸（'], why: '名册 home / AGENTS.md 的家 / START.md 所在家 / 运行 selfHome 四路是否对齐；静态兜底名=这一族整体查不了' },
  { name: '条件', dynamicPrefix: ['条件（'], why: '该鱼 wake-on 条件表形状与条数' },
  { name: '工具数（全鱼）', static: ['工具数（全鱼）'], why: '每条鱼可见工具数比上次少没少' },
  { name: '全鱼', static: ['全鱼'], why: '每条鱼一行（端口/心跳/启动痕迹）' },
  { name: 'undici 文件', static: ['undici 文件'], why: 'undici 依赖文件完整性' },
  { name: 'writer 唯一', static: ['writer 唯一'], why: '同一会话是否只有一个 writer' },
  { name: '窗口留痕', static: ['窗口留痕'], why: '开窗/关窗的 close.log 是否写' },
]

// ---- 抓代码里的形态 ----
const seenStatic = new Set()
const seenDynamic = new Set()
for (const m of raw.matchAll(/Add-Row '([^']+)'/g)) seenStatic.add(m[1])
for (const m of raw.matchAll(/Add-Row \('([^（']+（)'/g)) seenDynamic.add(m[1])

// ---- 登记表展开 ----
const staticOwner = new Map()
const dynamicOwner = new Map()
for (const f of FAMILIES) {
  for (const s of f.static || []) {
    if (staticOwner.has(s)) throw new Error('登记冲突：静态格名重复 ' + s)
    staticOwner.set(s, f.name)
  }
  for (const p of f.dynamicPrefix || []) {
    if (dynamicOwner.has(p)) throw new Error('登记冲突：动态前缀重复 ' + p)
    dynamicOwner.set(p, f.name)
  }
}

const fail = []
const warn = []

// 改名的识别（第三条鱼 2026-11-16 02:07）：一次改名不该读成两个问题。
// 登记里有 '版本一致'、代码里变成 '版本一致X' —— 若两行分开报，读的人会去查两个假问题。
// 所以先把「登记了但抓不到」和「抓到了但没登记」按相似度配对，配上的合成一行。
function editDistance(a, b) {
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}
function looksLikeRename(a, b) {
  if (Math.abs(a.length - b.length) > 4) return false
  return editDistance(a, b) <= 2
}

// 1a) 把动态族写成静态名（例如 '钥匙（小肥鱼）'）——单独点名，不要和新格混在一起
const fishNameStatics = []
const freshStatics = []
for (const n of seenStatic) {
  if (staticOwner.has(n)) continue
  const m = /^([^（]+（)/.exec(n)
  if (m && dynamicOwner.has(m[1])) fishNameStatics.push(n)
  else freshStatics.push(n)
}
for (const n of fishNameStatics) {
  const m = /^([^（]+（)/.exec(n)
  fail.push('把动态族写成了静态名：' + n + '（应走动态前缀 ' + m[1] + '…）')
}

// 1b) 登记了但代码里抓不到 —— 先不报，等和「新格」配对
const missingStatics = [...staticOwner.keys()].filter((s) => !seenStatic.has(s))

// 2) 改名配对：一条同时报「改了名、登记表没跟上」，而不是一条 WARN + 一条 FAIL
//    （第二条鱼 02:13：一个目标只许配一个来源；有多个候选就把候选列出来，选谁要能被人复核）
const pairedMissing = new Set()
const pairedFresh = new Set()
const renamedFamilies = new Set()
for (const s of missingStatics) {
  const cands = freshStatics.filter((c) => !pairedFresh.has(c) && looksLikeRename(s, c))
  if (!cands.length) continue
  const match = cands[0]
  pairedMissing.add(s)
  pairedFresh.add(match)
  renamedFamilies.add(staticOwner.get(s))
  const alt = cands.length > 1 ? `（也可能是 ${cands.slice(1).map((c) => '「' + c + '」').join('、')}）` : ''
  fail.push('像是改名：登记里的「' + s + '」在代码里找不到，代码里多了「' + match + '」' + alt + '——把登记表里的名字一起改（只算一个问题）')
}
for (const s of missingStatics) {
  if (!pairedMissing.has(s)) warn.push('登记了但代码里抓不到静态格：' + s + '（族：' + staticOwner.get(s) + '）')
}
for (const c of freshStatics) {
  if (!pairedFresh.has(c)) fail.push('新格未登记：' + c)
}

// 3) 动态族：代码里有、表里没有 → FAIL；表里有、代码里没有 → WARN
for (const p of seenDynamic) if (!dynamicOwner.has(p)) fail.push('新动态族未登记：' + p + '…')
for (const p of dynamicOwner.keys()) if (!seenDynamic.has(p)) warn.push('登记了但代码里抓不到动态族：' + p + '…（族：' + dynamicOwner.get(p) + '）')

// 4) 整族消失不是改名，是少了一个检查 —— FAIL（第三条鱼 02:14 实测：删掉一整格后旧版还印 OK）。
//    但若这一族刚被上面的"改名配对"认领，就不要再报一次——一次改名只算一个问题。
const goneFamilies = new Set()
// 删除和改名的分水岭：有没有"陌生人"出现（第二条鱼 #726）——有新名字 = 可能是改名（WARN，需人判）；
// 没有新名字 = 少了检查（FAIL）。机器现在有这个名字，就不许再用 WARN 把两种兜在一起。
const strangers = [
  ...freshStatics.filter((x) => !pairedFresh.has(x)),
  ...[...seenDynamic].filter((p) => !dynamicOwner.has(p)).map((p) => p + '…'),
]
for (const f of FAMILIES) {
  if (renamedFamilies.has(f.name)) continue
  const hasStatic = (f.static || []).some((s) => seenStatic.has(s))
  const hasDynamic = (f.dynamicPrefix || []).some((p) => seenDynamic.has(p))
  if (!hasStatic && !hasDynamic) {
    goneFamilies.add(f.name)
    if (strangers.length === 0) {
      fail.push('整族消失：' + f.name + '（没有新名字出现——这是少了检查，不是改名）')
    } else {
      warn.push('整族消失：' + f.name + '（同时出现了 ' + strangers.length + ' 个新名字：' + strangers.join('、') + '——可能是改名，需人判配的是谁）')
    }
  }
}
// 整族消失时，那一族每个静态名缺失的 WARN 不再重复报——一次删除只算一行。
for (let i = warn.length - 1; i >= 0; i--) {
  const m = /（族：([^）]+)）$/.exec(warn[i])
  if (m && goneFamilies.has(m[1])) warn.splice(i, 1)
}

const detailWarn = warn.map((w) => 'WARN ' + w)
const detailFail = fail.map((f) => 'FAIL ' + f)
console.log('静态格 ' + seenStatic.size + ' 个 / 登记 ' + staticOwner.size)
console.log('动态族 ' + seenDynamic.size + ' 个 / 登记 ' + dynamicOwner.size)
console.log('族 ' + FAMILIES.length + ' 个')
for (const l of detailWarn) console.log(l)
for (const l of detailFail) console.log(l)

// 结论必须由明细聚合（第二条鱼 #723/#725）：末行不许是写死的 OK；并且断言"末行的数 = 明细行数"，
// 这样它下一次自打脸会先打自己。
const nWarn = detailWarn.length
const nFail = detailFail.length
const countedWarn = detailWarn.filter((l) => l.startsWith('WARN ')).length
const countedFail = detailFail.filter((l) => l.startsWith('FAIL ')).length
if (countedWarn !== nWarn || countedFail !== nFail) {
  console.log(`FAIL 汇总与明细不符：明细 WARN×${countedWarn} FAIL×${countedFail}，摘要 WARN×${nWarn} FAIL×${nFail}`)
  process.exit(1)
}
if (nFail > 0) {
  console.log(`doctor 覆盖面：FAIL×${nFail}、WARN×${nWarn}——覆盖表与代码不一致，不能发`)
  process.exit(1)
}
if (nWarn > 0) {
  console.log(`doctor 覆盖面：WARN×${nWarn}——不是 OK，有格子可能被删/改名，需人看`)
  process.exit(0)
}
console.log('doctor 覆盖面 OK（FAIL×0 / WARN×0；每族至少一种形态、没有未登记的格）')
