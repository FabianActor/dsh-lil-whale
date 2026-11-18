#!/usr/bin/env node
/**
 * 归档事件流（2026-11-19 r354）。
 *
 * 原来看不见的三件事：拷贝被中途打断（半成品和成品长得一样）、重跑会重扫目录
 * （把半成品合法化）、清单和磁盘对不上时没人知道。
 * 这里测纯函数的事件解析与重放判定，外加 archive-fish.mjs 的接线顺序。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  MANIFEST_FMT,
  startEvent,
  movedEvent,
  doneEvent,
  parseArchiveEvents,
  replayPlanOf,
  summarizeReplay,
} from '../scripts/lib/archive-manifest-core.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const SRC = readFileSync(join(ROOT, 'scripts/archive-fish.mjs'), 'utf8')

let total = 0
let failed = 0
function ok(name, cond, detail = '') {
  total += 1
  if (cond) return
  failed += 1
  console.error(`xx ${name}${detail ? `：${detail}` : ''}`)
}
function eq(name, actual, expected) {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  ok(name, same, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}

const at = '2026-11-19T01:00:00.000Z'
const start = startEvent({ at, member: 'fishball', name: '小鱼丸', archiveDir: 'X', files: [
  { name: 'home', src: 'H' },
  { name: 'group-slice.jsonl', src: 'G' },
] })
const lines = [
  JSON.stringify(start),
  JSON.stringify(movedEvent({ at, name: 'home', bytes: 10, sha256: 'aaa' })),
  JSON.stringify(movedEvent({ at, name: 'group-slice.jsonl', bytes: 2, sha256: 'bbb' })),
  JSON.stringify(doneEvent({ at, member: 'fishball' })),
]

// ── 1. 解析 ─────────────────────────────────────────────────────────────
eq('fmt 是 2', MANIFEST_FMT, 2)
const state = parseArchiveEvents(lines)
eq('解析出 start', state.start?.member, 'fishball')
eq('解析出 done', state.done, true)
eq('解析出两件 moved', state.moves.size, 2)
eq('坏行只在计数里', parseArchiveEvents(['', '{bad json', '']).badLines, 1)
eq('未知事件只在计数里', parseArchiveEvents([JSON.stringify({ event: 'whatever' })]).unknownEvents, 1)
const dup = parseArchiveEvents([
  JSON.stringify({ event: 'moved', name: 'home', ok: false, at }),
  JSON.stringify({ event: 'moved', name: 'home', ok: true, sha256: 'aaa', at }),
])
eq('同一件搬多次保留最后一次', dup.moves.get('home').ok, true)

// ── 2. 重放判定 ─────────────────────────────────────────────────────────
const good = replayPlanOf(state, (name) => (name === 'home' ? 'aaa' : 'bbb'))
eq('完整归档：没有缺件', good.missing.length, 0)
eq('完整归档：没有不一致', good.mismatched.length, 0)
eq('完整归档：done', good.done, true)
eq('一句话说完整', summarizeReplay(good), '完整')

const missing = replayPlanOf(parseArchiveEvents([JSON.stringify(start)]), () => null)
eq('没搬完会被点出来', missing.missing.map((x) => x.name), ['home', 'group-slice.jsonl'])
ok('没搬完的总结', summarizeReplay(missing).includes('group-slice.jsonl'), summarizeReplay(missing))

const goneFile = replayPlanOf(state, () => null)
eq('moved 说搬了、盘上没有 ⇒ 不一致', goneFile.mismatched.length, 2)

const wrongHash = replayPlanOf(state, () => 'zzz')
eq('哈希不同 ⇒ 不一致', wrongHash.mismatched.length, 2)
ok('不一致的总结带名字', summarizeReplay(wrongHash).includes('home'), summarizeReplay(wrongHash))

const failedMove = replayPlanOf(parseArchiveEvents([
  JSON.stringify(start),
  JSON.stringify(movedEvent({ at, name: 'home', error: 'EPERM' })),
]), () => null)
eq('moved.ok=false 算没搬完', failedMove.missing.map((x) => x.name), ['home', 'group-slice.jsonl'])

const noStart = replayPlanOf(parseArchiveEvents([JSON.stringify(doneEvent({ at, member: 'x' }))]), () => null)
eq('没有 start ⇒ 判不了', noStart.started, false)
ok('没有 start 的总结', summarizeReplay(noStart).includes('没有开头'), summarizeReplay(noStart))

const extraMove = replayPlanOf(parseArchiveEvents([
  JSON.stringify(start),
  JSON.stringify(movedEvent({ at, name: 'home', sha256: 'aaa' })),
  JSON.stringify(movedEvent({ at, name: 'group-slice.jsonl', sha256: 'bbb' })),
  JSON.stringify(movedEvent({ at, name: '不在清单里的东西', sha256: 'ccc' })),
  JSON.stringify(doneEvent({ at, member: 'x' })),
]), (name) => (name === 'home' ? 'aaa' : name === 'group-slice.jsonl' ? 'bbb' : 'ccc'))
ok('清单外的 moved 会进 problems', extraMove.problems.some((x) => x.includes('不在清单里的东西')), JSON.stringify(extraMove.problems))

// ── 3. archive-fish 的接线（顺序是判据）────────────────────────────────
ok('先写 start 再搬', SRC.indexOf('appendEvent(startEvent(') >= 0 && SRC.indexOf('appendEvent(startEvent(') < SRC.indexOf('for (const item of items)'), 'start 必须在搬运循环之前')
ok('每件搬完写 moved', SRC.includes('appendEvent(movedEvent('), '没有 moved 事件')
ok('最后写 done', SRC.includes('appendEvent(doneEvent('), '没有 done 事件')
ok('清单写在搬家之后', SRC.indexOf("writeManifest(writtenFiles, 'complete')") > SRC.indexOf('for (const item of items)'), 'complete 清单必须在搬运循环之后')
ok('重跑走重放、不重扫', SRC.includes('replayPlanOf('), '没有重放判定')
ok('不一致时报错不改记录', SRC.includes('归档记录与磁盘对不上'), '缺少"对不上"分支')
{
  const doneAt = SRC.indexOf("writeManifest(writtenFiles, 'complete')")
  const callAt = SRC.indexOf('markArchived()', doneAt + 1)
  ok('先清单再改生命周期', doneAt >= 0 && callAt > doneAt, 'markArchived 必须在 complete 清单之后调用')
}
ok('事件文件名是 manifest.jsonl', SRC.includes('EVENTS_FILE'), '没引用事件文件名')
ok('静态清单文件名是 manifest.json', SRC.includes('MANIFEST_FILE'), '没引用清单文件名')

console.log(`test-archive-manifest：合计 ${total}，PASS ${total - failed}，FAIL ${failed}`)
process.exit(failed === 0 ? 0 : 1)
