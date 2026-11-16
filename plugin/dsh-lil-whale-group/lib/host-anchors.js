// 宿主包在哪：2026-11-16 r195 起按"实际在跑的那个 dsh"一起找，不再只认 npm 全局安装。
//
// npx 跑 dsh 时包在 %LOCALAPPDATA%\npm-cache\_npx\<hash>\node_modules\@deepseek-ai\dsh，
// 老的两个锚点全落空 —— defineTool / createUserMessage 永远是 null（typeof null === "object"），
// 插件降级成裸对象注册，还每秒重试刷日志（第三方装机实测 P5/P6）。

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function isDshPackageJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))?.name === '@deepseek-ai/dsh'
  } catch {
    return false
  }
}

/** 从某个入口文件往上找 @deepseek-ai/dsh/package.json（最多 8 层）。 */
export function dshPkgFromEntry(entry) {
  if (!entry) return null
  let dir = dirname(entry)
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, 'package.json')
    if (existsSync(candidate) && isDshPackageJson(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** npx 缓存里所有 dsh 包，按 mtime 从新到旧；找不到就空数组。 */
export function npxDshPkgFiles() {
  const base = process.env.npm_config_cache
    || (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'npm-cache') : '')
  if (!base) return []
  const npxRoot = join(base, '_npx')
  if (!existsSync(npxRoot)) return []
  try {
    return readdirSync(npxRoot)
      .map((name) => join(npxRoot, name, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
      .filter((file) => existsSync(file) && isDshPackageJson(file))
      .map((file) => ({ file, mtime: statSync(file).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .map((x) => x.file)
  } catch {
    return []
  }
}

/** 返回 [{ kind, file }]；kind 进日志，file 只在进程里用（不把用户路径写进账本）。 */
export function hostAnchors() {
  const out = []
  const push = (kind, file) => {
    if (typeof file !== 'string' || !file) return
    if (out.some((a) => a.file === file)) return
    out.push({ kind, file })
  }
  push('launcher-env', process.env.DSH_LAUNCHER_MODULE)
  push('argv-entry', dshPkgFromEntry(process.argv[1]))
  push('npm-global', join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
  push('npm-global-profile', join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
  for (const file of npxDshPkgFiles()) push('npx-cache', file)
  return out
}
