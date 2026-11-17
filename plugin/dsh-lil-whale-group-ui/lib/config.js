/**
 * 这台机器的假设，全从这里读。
 *
 * 为什么要有这个文件：代码里写死 `<她的家>` 之类的东西，等于"这段程序只在这台机器上
 * 成立"。打包给别人时最麻烦的不是改名，是这些路径 —— 装上以后跑不起来，报的还是一句
 * `ENOENT: no such file or directory`，看不出是谁的问题。
 *
 * 读法（优先级从高到低）：
 *   1. 环境变量 `LIL_WHALE_CONFIG` 指向的 JSON 文件
 *   2. 仓库根目录的 `lil-whale.config.json`
 *   3. 一份"按标准布局"推出来的默认值（下面的 DEFAULTS）
 *
 * "标准布局"= 鱼塘根下 `app/` 是仓库、`homes/<键>/` 是鱼的家。所以别人克隆下来、
 * 把鱼塘摆成这个形状，不写配置文件也能跑；只有布局不一样时才需要那份 JSON。
 *
 * 注意仓库根是从**本文件的位置**往上数出来的，不是从进程 cwd 数出来的 —— 宿主的 cwd 是
 * "从哪儿启动的"，我们的代码可能被 link 到别的 profile 目录里，cwd 靠不住。
 *
 * 字段命名（2026-11-14 改）：每条鱼读的都是**自己**那份配置，所以 `self*` 指"这个进程
 * 服务的那条鱼"。旧的 `her*` / `whale*` 是单鱼时代的名字（第二条鱼出现后 `whaleProfile`
 * 在 fishball 的配置里只能填 `fishball`，读起来是错的），仍然接受，只作兼容别名。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
// lib/ → dsh-lil-whale-group/ → plugin/ → 仓库根
const REPO_ROOT = resolve(HERE, '..', '..', '..')

const DEFAULTS = {
  repoRoot: REPO_ROOT,
  // 鱼塘布局（2026-11-13 起）：<pond>\app 是仓库，鱼在 <pond>\homes\<键>。
  // 配置丢了也不该指回旧布局（`<repo>\..\lil-whale` 那种），否则"默认值"会把新装的人带进老结构。
  selfHome: resolve(REPO_ROOT, '..', 'homes', 'fish'),
  selfWaker: join(REPO_ROOT, 'scripts', 'wake-fish.ps1'),
  wakeMetrics: join(REPO_ROOT, 'logs', 'wake-metrics.log'),
  pwshExe: process.platform === 'win32' ? 'pwsh.exe' : 'pwsh',
  leeCwd: REPO_ROOT,
  leeProfile: 'web',
  selfProfile: 'fish',
  // 这条鱼的进程开的端口。巡守要推门时敲的就是它；改端口必须同时改这里，否则巡守会去敲一扇没人的门。
  selfPort: 3082,
}

/** 旧名字 → 新名字。旧配置仍然能读，只是会被换成 `self*`。 */
const LEGACY_KEYS = {
  herHome: 'selfHome',
  herDshHome: 'selfDshHome',
  herWaker: 'selfWaker',
  herPort: 'selfPort',
  whaleProfile: 'selfProfile',
  whaleCwd: 'selfCwd',
}

let cached = null

export function configPath() {
  return process.env.LIL_WHALE_CONFIG || join(REPO_ROOT, 'lil-whale.config.json')
}

/**
 * 配置从哪来。三种状态别混：（r242）
 *   env / env-missing / repo / default；env-missing 是配置错误，不是"没有配置"。
 */
function configSourceOf(path) {
  const fromEnv = Boolean(process.env.LIL_WHALE_CONFIG)
  if (fromEnv) return existsSync(path) ? 'env' : 'env-missing'
  return existsSync(path) ? 'repo' : 'default'
}

/** 派生字段（只由上面几个推出来，不许单独写死）。 */
function derive(c) {
  // 先把旧名字抬成新名字（新名字优先）。
  const lifted = { ...c }
  for (const [oldKey, newKey] of Object.entries(LEGACY_KEYS)) {
    if (lifted[newKey] === undefined && lifted[oldKey] !== undefined) lifted[newKey] = lifted[oldKey]
  }
  const selfHome = lifted.selfHome
  // 共享区（pool）在她家之外：群、多成员账本都放这儿。
  // 为什么不在她家里：群是共享空间，不是她的私人物品；第二条鱼出现后，
  // 第二条的群文件写进第一条的家就是越界（Fabian 2026-11-12 拍板）。
  // 她家里留 Junction 指回 pool，所以她的路径一个字都不用改。
  // selfHome = <pond>\homes\<键> ⇒ 上两级才是 pond。
  const poolDir = lifted.poolDir || resolve(selfHome, '..', '..', 'pool')
  const out = {
    ...lifted,
    poolDir,
    poolStateDir: lifted.poolStateDir || join(poolDir, 'state'),
    // 私聊是「两个人之间的窗口」，不放进群目录：群目录是共享区里公开的那一半（Fabian 2026-11-12 拍板）。
    dmDir: lifted.dmDir || join(poolDir, 'dm'),
    // 名册：谁是谁、叫什么、哪条鱼、端口、爹是谁。多鱼之后这些不许再写死在代码里。
    membersFile: lifted.membersFile || join(poolDir, 'members.json'),
    selfPort: Number(lifted.selfPort) || 3082,
    groupDir: lifted.groupDir || join(poolDir, 'group'),
    selfDshHome: lifted.selfDshHome || join(selfHome, 'dsh-home'),
    selfCwd: lifted.selfCwd || selfHome,
    chatCwd: lifted.chatCwd || dirname(lifted.repoRoot),
    watchmanPidFile: lifted.watchmanPidFile || join(poolDir, 'state', 'watchman.pid'),
  }
  // 兼容别名：旧代码/旧脚本还在用 her* / whale*，给它们留一份只读映射。
  out.herHome = out.selfHome
  out.herDshHome = out.selfDshHome
  out.herWaker = out.selfWaker
  out.herPort = out.selfPort
  out.whaleProfile = out.selfProfile
  out.whaleCwd = out.selfCwd
  return out
}

/**
 * 读一次，缓存起来（进程生命周期内不变 —— 改配置要重启，这是有意的：
 * 热改路径会让"这个进程到底在读哪份文件"变成一个没人答得上来的问题）。
 */
export function config() {
  if (cached) return cached
  const path = configPath()
  let raw = {}
  let error = null
  if (existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'))
    } catch (e) {
      // 配置写坏了要说出来，不能安静地用默认值跑 —— 那会让人以为自己改对了
      error = `config 读取失败（${path}）：${e.message}`
    }
  }
  const source = configSourceOf(path)
  if (source === 'env-missing' && !error) {
    // 环境变量给了 = "我要用这一份"；文件不在是配置错误，不能安静地用默认值继续跑。
    error = `LIL_WHALE_CONFIG 指向的文件不存在：${path}`
  }
  cached = { ...derive({ ...DEFAULTS, ...raw }), _path: path, _exists: existsSync(path), _error: error, _source: source }
  return cached
}

/** 给启动痕迹用的短摘要：哪份配置、这条鱼的家在哪儿。 */
export function configSummary() {
  const c = config()
  return { path: c._path, source: c._source, exists: c._exists, error: c._error, selfHome: c.selfHome, groupDir: c.groupDir }
}
