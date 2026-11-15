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
  { name: '名册与家', static: ['名册与家'], why: '名册 / 家目录 / pins 三个键集合是否对得上' },
  { name: '名册', static: ['名册', '名册（全鱼）', '名册（lee）'], why: 'pins 存在性、每条鱼有没有钉、watcher 不在视野的声明' },
  { name: '名册自检', static: ['名册自检'], why: '巡守的 roster-audit 最近一次结果' },
  { name: '生命周期字段', static: ['生命周期字段'], why: '旧 status 字段是否还在' },
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

// 1) 代码里有、表里没有（新格/新族）——FAIL
for (const n of seenStatic) {
  if (staticOwner.has(n)) continue
  // 把动态族写死的提示：名字有形如 "前缀（具体内容）"，且前缀本身已登记为动态族
  const m = /^([^（]+（)/.exec(n)
  if (m && dynamicOwner.has(m[1])) {
    fail.push('把动态族写成了静态名：' + n + '（应走动态前缀 ' + m[1] + '…）')
  } else {
    fail.push('新格未登记：' + n)
  }
}
for (const p of seenDynamic) {
  if (!dynamicOwner.has(p)) fail.push('新动态族未登记：' + p + '…')
}

// 2) 表里有、代码里一种形态都没有——WARN（可能改名，也可能真删了）
for (const f of FAMILIES) {
  const hasStatic = (f.static || []).some((s) => seenStatic.has(s))
  const hasDynamic = (f.dynamicPrefix || []).some((p) => seenDynamic.has(p))
  if (!hasStatic && !hasDynamic) warn.push('登记的族在代码里一种形态都没有：' + f.name)
}

// 3) 表里有、但某个静态名/前缀缺失——WARN（族还在，具体那一格没了）
for (const [s, fam] of staticOwner) {
  if (!seenStatic.has(s)) warn.push('登记了但代码里抓不到静态格：' + s + '（族：' + fam + '）')
}
for (const [p, fam] of dynamicOwner) {
  if (!seenDynamic.has(p)) warn.push('登记了但代码里抓不到动态族：' + p + '…（族：' + fam + '）')
}

console.log('静态格 ' + seenStatic.size + ' 个 / 登记 ' + staticOwner.size)
console.log('动态族 ' + seenDynamic.size + ' 个 / 登记 ' + dynamicOwner.size)
console.log('族 ' + FAMILIES.length + ' 个')
for (const w of warn) console.log('WARN ' + w)
for (const f of fail) console.log('FAIL ' + f)
if (fail.length) {
  console.log('FAIL total=' + fail.length)
  process.exit(1)
}
console.log('doctor 覆盖面 OK（每族至少一种形态、没有未登记的格）')
