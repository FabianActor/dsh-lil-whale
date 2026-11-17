// 代码指纹（2026-11-17 r255）。
//
// 用途：回答"这个进程里跑的，是不是磁盘上现在这份代码"。
//
// 为什么不用 mtime（第二条鱼的探针脚本原先用 mtime 判"本进程是不是新代码"，这是我补的一刀）：
//   ① mtime 只比一个文件会漏 —— 只改 say-core.js 时，index.js 的 mtime 没变，闸照样放行；
//   ② mtime 会被"不是修改"的事情改 —— git checkout、恢复备份、复制目录都会把 mtime 改回去；
//   ③ 时间戳回答"谁更新"，指纹回答"是不是同一份"，要问的是后者。
//
// 纯函数，不读配置、不碰鱼塘：只读本目录下的运行时代码（含子目录，跳过 node_modules 与点文件）。

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_DIR = dirname(fileURLToPath(import.meta.url))
const CODE_EXT = /\.(cjs|mjs|js|json)$/

/**
 * 返回 { fp, files }：fp 是 12 位十六进制；读不了时 fp='unknown' 并带 error。
 * 同目录同内容 => 同 fp；任何文件内容变了 => fp 变。
 */
export function codeFingerprint(dir = DEFAULT_DIR) {
  const files = []
  try {
    const walk = (current, prefix) => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
        const rel = `${prefix}${entry.name}`
        if (entry.isDirectory()) {
          walk(join(current, entry.name), `${rel}/`)
          continue
        }
        if (entry.isFile() && CODE_EXT.test(entry.name)) files.push(rel)
      }
    }
    walk(dir, '')
    files.sort()
    const hash = createHash('sha256')
    for (const rel of files) {
      hash.update(rel)
      hash.update('\0')
      hash.update(readFileSync(join(dir, rel)))
      hash.update('\0')
    }
    return { fp: hash.digest('hex').slice(0, 12), files: files.length }
  } catch (error) {
    return { fp: 'unknown', files: files.length, error: String(error?.message ?? error) }
  }
}

// CLI：node plugin\dsh-lil-whale-group\lib\code-fp.js
if (process.argv[1] && process.argv[1].endsWith('code-fp.js')) {
  const { fp, files, error } = codeFingerprint()
  console.log(error ? `codeFp=unknown files=${files} error=${error}` : `codeFp=${fp} files=${files}`)
}
