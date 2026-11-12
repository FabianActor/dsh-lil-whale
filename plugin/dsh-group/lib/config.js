/**
 * 这台机器的假设，全从这里读。
 *
 * 为什么要有这个文件：代码里写死 `D:\文档\WorkSpace\lil-whale` 之类的东西，等于"这段程序只在这台机器上
 * 成立"。打包给别人时最麻烦的不是改名，是这些路径 —— 装上以后跑不起来，报的还是一句
 * `ENOENT: no such file or directory`，看不出是谁的问题。
 *
 * 读法（优先级从高到低）：
 *   1. 环境变量 `LIL_WHALE_CONFIG` 指向的 JSON 文件
 *   2. 仓库根目录的 `lil-whale.config.json`
 *   3. 一份"按标准布局"推出来的默认值（下面的 DEFAULTS）
 *
 * "标准布局"= 仓库旁边有个同级的 `lil-whale/` 当她的家。所以别人克隆下来、把她的家放在旁边，
 * 不写配置文件也能跑；只有布局不一样时才需要那份 JSON。
 *
 * 注意仓库根是从**本文件的位置**往上数出来的，不是从进程 cwd 数出来的 —— 宿主的 cwd 是
 * "从哪儿启动的"，我们的代码可能被 link 到别的 profile 目录里，cwd 靠不住。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
// lib/ → dsh-group/ → plugin/ → 仓库根
const REPO_ROOT = resolve(HERE, '..', '..', '..')

const DEFAULTS = {
  repoRoot: REPO_ROOT,
  herHome: resolve(REPO_ROOT, '..', 'lil-whale'),
  herWaker: join(REPO_ROOT, 'scripts', 'wake-whale.ps1'),
  wakeMetrics: join(REPO_ROOT, 'logs', 'wake-metrics.log'),
  pwshExe: process.platform === 'win32' ? 'pwsh.exe' : 'pwsh',
  leeCwd: REPO_ROOT,
  leeProfile: 'web',
  whaleProfile: 'whale',
  // 她那个进程开的端口。守夜要推门时敲的就是它；改端口必须同时改这里，否则守夜会去敲一扇没人的门。
  herPort: 3082,
}

let cached = null

export function configPath() {
  return process.env.LIL_WHALE_CONFIG || join(REPO_ROOT, 'lil-whale.config.json')
}

/** 派生字段（只由上面几个推出来，不许单独写死）。 */
function derive(c) {
  const herHome = c.herHome
  // 共享区（pool）在她家之外：群、多成员账本都放这儿。
  // 为什么不在她家里：群是共享空间，不是她的私人物品；第二条鱼出现后，
  // 第二条的群文件写进第一条的家就是越界（Fabian 2026-11-12 拍板）。
  // 她家里留 Junction 指回 pool，所以她的路径一个字都不用改。
  const poolDir = c.poolDir || resolve(herHome, '..', 'lil-whale-pool')
  return {
    ...c,
    poolDir,
    poolStateDir: c.poolStateDir || join(poolDir, 'state'),
    herPort: Number(c.herPort) || 3082,
    groupDir: c.groupDir || join(poolDir, 'group'),
    herDshHome: c.herDshHome || join(herHome, 'dsh-home'),
    whaleCwd: c.whaleCwd || herHome,
    chatCwd: c.chatCwd || dirname(c.repoRoot),
    watchmanPidFile: c.watchmanPidFile || join(herHome, 'logs', 'watchman.pid'),
  }
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
  cached = { ...derive({ ...DEFAULTS, ...raw }), _path: path, _exists: existsSync(path), _error: error }
  return cached
}

/** 给启动痕迹用的短摘要：哪份配置、她的家在哪儿。 */
export function configSummary() {
  const c = config()
  return { path: c._path, exists: c._exists, error: c._error, herHome: c.herHome, groupDir: c.groupDir }
}
