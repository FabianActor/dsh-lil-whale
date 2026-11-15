import { readFileSync } from 'node:fs'

const raw = readFileSync(new URL('../scripts/doctor.ps1', import.meta.url), 'utf8')

// 这张表是“体检覆盖”的登记册：doctor.ps1 里每个 Add-Row 的格名都要在这里有名字。
// 它不是为了好看——有了它，加新格而不登记会红；删旧格而表没改会黄。
// 静态格名与动态族分开登记：会话绑定（小肥鱼）这种是拼出来的，只能按前缀认。
const STATIC = {
  '版本一致': '启动痕迹里的 pkg 版本 vs 磁盘 package.json',
  '工具注册': 'group_say/sleep/rename 三件工具是否注册上',
  '睡眠工具': 'sleep/wake_up 的注册与形状',
  '会话绑定': '会话绑定这一族的兜底行（查不了时）',
  '名册与家': '名册 / 家目录 / pins 三个键集合是否对得上',
  '名册（全鱼）': '每条鱼在 pins 里有没有钉（存在性）',
  '名册（lee）': 'watcher 的家不在鱼塘：这一格不覆盖 lee 的声明（INFO）',
  '名册自检': '巡守的 roster-audit 最近一次结果',
  '名册': 'pins.json 不存在时的 FAIL',
  '生命周期字段': '旧 status 字段是否还在',
  '旧段': '名册外的会话近两小时是否被写过',
  '配置': '配置文件是否可读、键是否齐全',
  '默认值': '配置里是否写着等于默认值的键',
  '生效值': '运行期生效的叫醒闸数值与来源',
  '环境说明': '环境.md 是否过期',
  '她的心跳': '第二条鱼 presence 心跳',
  '她的心跳（说明）': '心跳这一格的补充说明（INFO）',
  '主 dsh 端口': '主 dsh 的端口占用',
  '他的端口': '宿主侧端口登记',
  '端口登记': '端口表与占用',
  '启动痕迹': 'plugin-boot.log 最近一次启动',
  '出生账': '出生账的 since 分界与缺行',
  '格式分界': 'watchman.log 的 log-format 分界行（含轮转旧文件）',
  '投递账本': 'wake-deliver.log 形状与末行',
  '游标': '成员游标是否超过文件行数',
  '群投影': '群.md 能否由 jsonl 重建到 0 差异',
  '私聊可读版': '私聊可读投影与 jsonl 是否一致',
  '钥匙（跨鱼）': '两条鱼是否共用同一把钥匙（继承要能指向账）',
  '通行证': '沙箱 workspace capability SID 这一族的兜底行',
  '工具数（全鱼）': '每条鱼可见工具数比上次少没少',
  '全鱼': '每条鱼一行（端口/心跳/启动痕迹）',
  'undici 文件': 'undici 依赖文件完整性',
  'writer 唯一': '同一会话是否只有一个 writer',
  '窗口留痕': '开窗/关窗的 close.log 是否写',
}
const DYNAMIC = {
  '会话绑定（': '钉的每段会话能否在该鱼自己的 dshHome 里找到',
  '家根权限（': '家根是否有当前用户完全控制（贴标签的前置）',
  '通行证（': 'workspace 子树 capability SID 是否齐全',
  '完整性标签（': '家目录树是否都带 Low 完整性标签',
  '钥匙（': '该鱼 key 指纹 vs 上次记账',
  '条件（': '该鱼 wake-on 条件表形状与条数',
}

const staticNames = new Set()
for (const m of raw.matchAll(/Add-Row '([^']+)'/g)) staticNames.add(m[1])
const dynamicNames = new Set()
for (const m of raw.matchAll(/Add-Row \('([^（']+（)'/g)) dynamicNames.add(m[1])

const fail = []
const warn = []
for (const n of staticNames) if (!STATIC[n]) fail.push('新格未登记：' + n)
for (const p of dynamicNames) if (!DYNAMIC[p]) fail.push('新动态族未登记：' + p + '…')
for (const n of Object.keys(STATIC)) if (!staticNames.has(n)) warn.push('登记了但代码里找不到：' + n)
for (const p of Object.keys(DYNAMIC)) if (!dynamicNames.has(p)) warn.push('登记了但代码里找不到动态族：' + p)

console.log('静态格 ' + staticNames.size + ' 个（登记 ' + Object.keys(STATIC).length + '）')
console.log('动态族 ' + dynamicNames.size + ' 个（登记 ' + Object.keys(DYNAMIC).length + '）')
for (const w of warn) console.log('WARN ' + w)
for (const f of fail) console.log('FAIL ' + f)
if (fail.length) { console.log('FAIL total=' + fail.length); process.exit(1) }
console.log('doctor 覆盖面 OK')
