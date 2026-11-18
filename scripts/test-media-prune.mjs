// 媒体缓存清理的测试（r333）：
//  1. 纯函数：只删旧的普通文件、不递归、缺目录不算错、失败进 failed。
//  2. 接线：巡守里真的每小时跑一次，成功/失败都留账（别人按行名筛）。
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pruneMediaCache, mediaCacheStats, MEDIA_CACHE_MAX_AGE_DAYS } from '../plugin/dsh-lil-whale-group/lib/media-cache-core.js'

let total = 0
let pass = 0
function ok(cond, label) {
  total += 1
  if (cond) {
    pass += 1
  } else {
    console.log(`xx ${label}`)
  }
}

const root = mkdtempSync(join(tmpdir(), 'llw-media-prune-'))
const DAY = 86400_000
const now = Date.now()

function put(name, bytes, ageDays) {
  const full = join(root, name)
  writeFileSync(full, Buffer.alloc(bytes, 0x61))
  const t = new Date(now - ageDays * DAY)
  utimesSync(full, t, t)
  return full
}

try {
  const oldFile = put('old.mp4', 100, 8)
  const olderFile = put('older.m4a', 30, 10)
  const newFile = put('new.mp4', 50, 0)
  mkdirSync(join(root, 'nested'))
  writeFileSync(join(root, 'nested', 'keep.bin'), Buffer.alloc(7))

  const result = pruneMediaCache({ dir: root, now })
  ok(result.existed === true, '目录存在时 existed=true')
  ok(result.removed === 2, `删掉 2 个过期文件（实际 ${result.removed}）`)
  ok(result.bytes === 130, `字节数按实际大小累计（实际 ${result.bytes}）`)
  ok(result.failed.length === 0, '没有文件删失败')
  ok(!existsSync(oldFile), '过期视频被删')
  ok(!existsSync(olderFile), '过期音频被删')
  ok(existsSync(newFile), '新文件保留')
  ok(existsSync(join(root, 'nested', 'keep.bin')), '子目录里的文件不动（不递归）')

  const empty = mkdtempSync(join(tmpdir(), 'llw-media-empty-'))
  const emptyResult = pruneMediaCache({ dir: empty, now })
  ok(emptyResult.existed === true && emptyResult.removed === 0, '空目录：存在、删 0 个')
  rmSync(empty, { recursive: true, force: true })

  const missing = pruneMediaCache({ dir: join(root, 'no-such-dir'), now })
  ok(missing.existed === false && missing.removed === 0 && missing.failed.length === 0, '缺目录不算错（从没下过视频）')

  const noArg = pruneMediaCache({})
  ok(noArg.existed === false, '没给 dir 时当作不存在')
  ok(MEDIA_CACHE_MAX_AGE_DAYS === 7, '默认保留 7 天')

  // ---- 现状快照：不删东西，只数；给周期行提供"有没有东西"的对照 ----
  const stats = mediaCacheStats({ dir: root })
  ok(stats.existed === true, 'stats：目录存在')
  ok(stats.files === 1 && stats.bytes === 50, `stats：只剩 1 个文件 50 B（实际 ${stats.files} 个 ${stats.bytes} B）`)
  ok(stats.oldestMs !== null && Math.abs(stats.oldestMs - now) < 5000, 'stats：最老一份就是刚留下的那个（mtime 对得上）')
  ok(mediaCacheStats({ dir: join(root, 'no-such-dir') }).existed === false, 'stats：缺目录 existed=false')
  ok(mediaCacheStats({ dir: join(root, 'nested') }).files === 1, 'stats：子目录里的文件不算进这一层（只数本层普通文件）')
  ok(mediaCacheStats({}).existed === false && mediaCacheStats({}).files === 0, 'stats：没给 dir 时空表')
} finally {
  rmSync(root, { recursive: true, force: true })
}

const indexText = readFileSync(new URL('../plugin/dsh-lil-whale-group/lib/index.js', import.meta.url), 'utf8')
ok(indexText.includes("from './media-cache-core.js'"), 'index.js 引入了 media-cache-core')
ok(indexText.includes("'cache', 'bili-eyes', 'media'"), 'index.js 指向鱼塘共享的媒体缓存目录')
ok(indexText.includes('maybePruneMediaCache()'), 'index.js 有 maybePruneMediaCache()')
ok(indexText.includes('note=media-prune removed='), '成功也留一行账（note=media-prune）')
ok(indexText.includes('note=media-prune-failed'), '删不掉写 error 行（note=media-prune-failed）')
const tickStart = indexText.indexOf('async function watchmanTick()')
const tickEnd = indexText.indexOf('export { name, inject, apply }')
ok(tickStart > 0 && tickEnd > tickStart, '能在源码里定位 watchmanTick 与导出段')
const tickBody = tickStart > 0 && tickEnd > tickStart ? indexText.slice(tickStart, tickEnd) : ''
ok(tickBody.includes('maybePruneMediaCache()'), '巡守每轮都会走到清理（watchmanTick 里调用）')

console.log(`test-media-prune：合计 ${total}，PASS ${pass}，FAIL ${total - pass}`)
if (pass !== total) process.exit(1)
