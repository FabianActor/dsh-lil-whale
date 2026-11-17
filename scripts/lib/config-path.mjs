// config-path.mjs -- 找配置文件的**唯一**入口（脚本侧）。
//
// 为什么要有它：以前每个脚本自己写一遍"环境变量 → 仓库根 → 示例文件"的循环，
// 而且全都把"路径不存在"当成"没给路径" —— 于是 `LIL_WHALE_CONFIG` 打错一个字母时，
// 脚本安静地落回仓库里的真配置，测试跑了真鱼塘、还报绿（第三条鱼 2026-11-17 实测）。
//
// 三种状态必须分开，各有各的名字：
//
//   env-given-ok       环境变量给了，文件在            → 用它
//   env-given-missing  环境变量给了，文件不在          → **报错退出**，绝不落回
//   repo              环境变量没给，仓库根那份在       → 用它
//   example           环境变量没给，仓库根那份不在，
//                     只有示例文件                     → 用示例文件（装之前跑脚本用）
//   none              都没有                          → 报错，给出下一步
//
// "给了但不在"和"没给"的区别是**人的意图**：前者是"我要用这个"，没说"没有就随便挑一个"。
// 把两者混成一件事，是配置优先级实现的通病（adv 鱼原话，2026-11-17）。
//
// 用法：
//   import { loadConfigOrExit } from './lib/config-path.mjs'
//   const cfg = loadConfigOrExit({ repoRoot: REPO })
//
// 需要"没有配置也能跑"的脚本用 loadConfig()，自己决定 env-given-missing 要不要退出，
// 但**不许**在这种情况下去读仓库里的真配置。
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 本文件在 scripts/lib/ 下：往上一级是 scripts，再上一级是仓库根。 */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * 只回答"该读哪份、为什么"，不读文件内容。
 * 返回 { path, source, error?, next? }；source 见文件头五种之一。
 */
export function resolveConfigFile({ repoRoot = REPO_ROOT, includeExample = true } = {}) {
  const envPath = process.env.LIL_WHALE_CONFIG
  if (envPath) {
    const path = resolve(envPath)
    if (existsSync(path)) return { path, source: 'env-given-ok' }
    return {
      path,
      source: 'env-given-missing',
      error: `LIL_WHALE_CONFIG 指向的文件不存在：${path}`,
      next: '你给了环境变量就是要用它，脚本不会悄悄改读仓库里那份真配置。' +
        '确认路径，或者先清掉它（PowerShell: $env:LIL_WHALE_CONFIG=$null；bash: unset LIL_WHALE_CONFIG）再跑。',
    }
  }
  const repoPath = join(repoRoot, 'lil-whale.config.json')
  if (existsSync(repoPath)) return { path: repoPath, source: 'repo' }
  if (includeExample) {
    const examplePath = join(repoRoot, 'lil-whale.config.example.json')
    if (existsSync(examplePath)) return { path: examplePath, source: 'example' }
  }
  return {
    path: null,
    source: 'none',
    error: `找不到配置（仓库根 ${repoPath}）`,
    next: '先跑 install.ps1，或把 lil-whale.config.example.json 复制成 lil-whale.config.json',
  }
}

/**
 * 找并读。出错时返回 { cfg: null, error, next, source }，不退出进程；
 * env-given-missing 同样算错（调用方必须处理，不许当"没有配置"）。
 */
export function loadConfig({ repoRoot = REPO_ROOT, includeExample = true } = {}) {
  const found = resolveConfigFile({ repoRoot, includeExample })
  if (found.error) return { ...found, cfg: null }
  try {
    return { ...found, cfg: JSON.parse(readFileSync(found.path, 'utf8')) }
  } catch (e) {
    return {
      ...found,
      cfg: null,
      error: `配置读不了：${found.path}（${e.message}）`,
      next: '先修好那份 JSON，或删掉它重新生成',
    }
  }
}

/** CLI 用：出错就打印 `xx …` 与 `NEXT:` 并 exit 1。返回 cfg 本身。 */
export function loadConfigOrExit({ repoRoot = REPO_ROOT, includeExample = true } = {}) {
  const out = loadConfig({ repoRoot, includeExample })
  if (out.error) {
    console.error('xx ' + out.error)
    if (out.next) console.error('\nNEXT: ' + out.next)
    process.exit(1)
  }
  return out.cfg
}

/** 给诊断/日志用的短标签：别把"示例文件"和"真配置"写成同一种来源。 */
export const CONFIG_SOURCE_LABEL = {
  'env-given-ok': '环境变量',
  'env-given-missing': '环境变量（文件不在）',
  repo: '仓库根配置',
  example: '示例文件',
  none: '没有配置',
}

// CLI：`node scripts/lib/config-path.mjs`
// 只回答"该读哪份"，不碰鱼塘数据 —— 所以它能进发布包的干净环境里验三态
// （`test-config-path.mjs` 用它跑正/负样本；gen-family 那种要读名册的脚本在空包里跑不了）。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = loadConfig({})
  if (out.error) {
    console.error('xx ' + out.error)
    if (out.next) console.error('\nNEXT: ' + out.next)
    process.exit(1)
  }
  console.log(`source=${out.source} path=${out.path}`)
}
