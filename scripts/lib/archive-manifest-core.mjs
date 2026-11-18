import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

// 归档清单的事件流（2026-11-19 r354）。
//
// 一句话：*一份状态文档表达不了"做到哪一步"，一串事件可以，而且它天然只增不改。*
//
// 背景：归档是一条鱼离开鱼塘时唯一的实物证据。原来 `archive-fish.mjs` 只写一份静态
// `manifest.json`（来源/时间/会话/字节数），它回答"是什么"，回答不了"有没有做完"：
// 拷到一半被打断时，纸和成品长得一样。所以补一条 `manifest.jsonl` 事件流：
//
//   archive-start  开始（成员、搬运清单 files:[{name,src}]）
//   moved          每搬完一件（name、sha256、bytes、skipped）
//   archive-done   收尾（之后才可以改 family.json 的生命周期）
//
// 重跑以**清单**为准，不重扫目录（重扫会把半成品合法化）；记录只增不改——
// 清单和磁盘对不上时，要报警的是"对不上"这个事实，不是把清单改成磁盘的样子。
//
// 判据（重放）：
//   - 有 start 没有 done ⇒ 半成品；
//   - start 里的文件没有对应的 ok moved ⇒ 要补搬；
//   - moved 说搬了、盘上文件却不在或哈希不对 ⇒ 有人动过归档（警报，不是修复）。
//
// 这里只放纯函数；读写盘、算哈希在 archive-fish.mjs 里做。

export const MANIFEST_FMT = 2
export const EVENTS_FILE = 'manifest.jsonl'
export const MANIFEST_FILE = 'manifest.json'

/** 一行事件（调用方自己加换行、自己 append）。 */
export function archiveEventLine(event) {
  return JSON.stringify(event)
}

export function startEvent({ at, member, name, archiveDir, files }) {
  return {
    fmt: MANIFEST_FMT,
    at,
    event: 'archive-start',
    member,
    name,
    archiveDir,
    files: files.map((file) => ({ name: file.name, src: file.src })),
  }
}

export function movedEvent({ at, name, bytes = 0, sha256 = null, skipped = false, error = null }) {
  const event = { fmt: MANIFEST_FMT, at, event: 'moved', name, bytes, skipped, ok: !error }
  if (sha256) event.sha256 = sha256
  if (error) event.error = String(error)
  return event
}

export function doneEvent({ at, member }) {
  return { fmt: MANIFEST_FMT, at, event: 'archive-done', member }
}

/**
 * 解析事件行（忽略空行；坏行计数，不抛——坏行本身就是"记录被改过"的线索）。
 * 返回 { start, moves, done, doneAt, badLines, unknownEvents }。
 */
export function parseArchiveEvents(lines) {
  const state = { start: null, moves: new Map(), done: false, doneAt: null, badLines: 0, unknownEvents: 0 }
  for (const line of lines) {
    if (!line || !line.trim()) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      state.badLines += 1
      continue
    }
    if (event?.event === 'archive-start') {
      if (!state.start) state.start = event
      continue
    }
    if (event?.event === 'moved') {
      // 同一件搬过多次时保留最后一条（ok 优先于早先的失败），这是事件流的"重放"语义
      state.moves.set(event.name, event)
      continue
    }
    if (event?.event === 'archive-done') {
      state.done = true
      state.doneAt = event.at ?? null
      continue
    }
    state.unknownEvents += 1
  }
  return state
}

/**
 * 重放判定：只读状态 + 一个 hashOf(name) 回调（返回盘上 sha256 或 null）。
 * 返回 { started, done, missing, mismatched, problems }：
 *   - missing：start 里有、但没有成功的 moved 的文件条目（要补搬）
 *   - mismatched：moved 说搬了、盘上哈希不对或文件不在（警报）
 *   - problems：给人看的短句
 */
export function replayPlanOf(state, hashOf) {
  const problems = []
  if (!state.start) {
    problems.push('没有 archive-start：这份归档不是这个脚本写完的，或事件流被删了')
    return { started: false, done: state.done, missing: [], mismatched: [], problems }
  }
  const files = Array.isArray(state.start.files) ? state.start.files : []
  const missing = []
  const mismatched = []
  for (const file of files) {
    if (!file || !file.name) {
      problems.push('清单里有一条没有名字的条目')
      continue
    }
    const moved = state.moves.get(file.name)
    if (!moved) {
      missing.push(file)
      continue
    }
    if (moved.ok === false) {
      missing.push(file)
      continue
    }
    const actual = hashOf(file.name)
    if (!actual) {
      mismatched.push({ name: file.name, why: '文件不在' })
      continue
    }
    if (moved.sha256 && actual !== moved.sha256) {
      mismatched.push({ name: file.name, why: 'sha256 与 moved 记录不一致' })
    }
  }
  for (const moved of state.moves.values()) {
    if (!files.some((file) => file?.name === moved.name)) {
      problems.push(`moved 里有清单外的条目：${moved.name}`)
    }
  }
  if (mismatched.length) problems.push(`${mismatched.length} 件与记录不一致（有人动过归档）`)
  return { started: true, done: state.done, missing, mismatched, problems }
}

/** 给人看的一句话总结（archive-fish 与 doctor 共用同一套词）。 */
export function summarizeReplay(plan) {
  if (!plan.started) return '清单里没有开头'
  if (plan.mismatched.length) return `记录与磁盘不一致：${plan.mismatched.map((x) => x.name).join('、')}`
  if (plan.missing.length) return `还没搬完：${plan.missing.map((x) => x.name).join('、')}`
  return plan.done ? '完整' : '搬完了但没写收尾'
}


// ── 盘上事实：字节数与哈希（archive-fish 与 doctor 的检查器共用同一份算法）────────
// 判据：能比内容的时候不要比时间（§55）。目录哈希按名字排序，路径 + 长度 + 内容
// 进同一个 sha256；读不到的文件记 u:，让"读不到"也改变哈希，而不是悄悄跳过。
export function sha256OfFile(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

export function treeSha256(dir) {
  const hash = createHash('sha256')
  const walk = (cur, rel) => {
    const entries = readdirSync(cur, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))
    for (const entry of entries) {
      const full = join(cur, entry.name)
      const relName = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        hash.update(`d:${relName}\0`)
        walk(full, relName)
      } else if (entry.isFile()) {
        let bytes
        try { bytes = readFileSync(full) } catch { hash.update(`u:${relName}\0`); continue }
        hash.update(`f:${relName}\0${bytes.length}\0`)
        hash.update(bytes)
      }
    }
  }
  walk(dir, '')
  return hash.digest('hex')
}

export function hashOfPath(target) {
  const info = statSync(target)
  if (info.isFile()) return sha256OfFile(target)
  return treeSha256(target)
}

/** 目录或文件的字节数；读不到的部分算 0（只用于给人看规模，不作判据）。 */
export function dirBytes(target) {
  const info = statSync(target)
  if (info.isFile()) return info.size
  let total = 0
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const full = join(target, entry.name)
    try {
      if (entry.isDirectory()) total += dirBytes(full)
      else if (entry.isFile()) total += statSync(full).size
    } catch { /* 读不到的算 0 */ }
  }
  return total
}
