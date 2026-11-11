// 从 messages.jsonl 重建 群.md（可读投影），并**说明每一处差异是怎么来的**。
//
// 小肥鱼 2026-11-11 给的判据（比"逐字一致"准）：
//   判据不是"一致吗"，而是"能不能指着每一处差异说出它是怎么来的"。
//   能，就是派生；有一处说不出来，那就是源头，机器不许整本写。
// 所以这个脚本的重点不是打印"一致/不一致"，是打印**差异清单 + 归类**。
//
// 跑法：node scripts\rebuild-group-md.mjs            只看对照（有未归类差异 → exit 1）
//       node scripts\rebuild-group-md.mjs --write    覆盖 群.md
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const HOME = 'D:\\文档\\WorkSpace\\lil-whale'
const MESSAGES = `${HOME}\\group\\messages.jsonl`
const READABLE = `${HOME}\\group\\群.md`
const LABEL = { lee: '大肥鱼', whale: '小肥鱼', fabian: 'Fabian' }

const pad = (n) => String(n).padStart(2, '0')

/** ISO → 本地时间 `YYYY-MM-DD HH:mm`，跟群里一直用的写法一致。 */
function stampOf(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const raw = readFileSync(MESSAGES, 'utf8')
const records = []
let badLines = 0
for (const line of raw.split('\n')) {
  const trimmed = line.trim()
  if (trimmed === '') continue
  try { records.push(JSON.parse(trimmed)) } catch { badLines += 1 }
}

// 没有正文的记录不参与重建：写进正文就等于编一句话，那比缺一段更糟。
const emptyText = records.filter((r) => (typeof r?.text === 'string' ? r.text.trim() : '') === '')

function blockOf(record) {
  const text = typeof record?.text === 'string' ? record.text.trim() : ''
  if (text === '') return ''
  const who = LABEL[String(record?.from ?? '')] ?? String(record?.from ?? '?')
  return `**${stampOf(String(record?.ts ?? ''))} · ${who}**\n\n${text}\n`
}

const blocks = records.map(blockOf).filter(Boolean)
// 第一行是标题。它是这份文件的一部分，不是某个人说的，所以由脚本负责。
const rebuilt = '# 群\n' + blocks.join('\n')

/** 行级 LCS，用来把"插入/删除"对齐成块，而不是从头开始错位比。 */
function lineDiff(a, b) {
  const n = a.length
  const m = b.length
  const dp = new Int32Array((n + 1) * (m + 1))
  const at = (i, j) => i * (m + 1) + j
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[at(i, j)] = a[i] === b[j]
        ? dp[at(i + 1, j + 1)] + 1
        : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)])
    }
  }
  const ops = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ type: 'same', a: i++, b: j++ }); continue }
    if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) ops.push({ type: 'del', a: i++ })
    else ops.push({ type: 'ins', b: j++ })
  }
  while (i < n) ops.push({ type: 'del', a: i++ })
  while (j < m) ops.push({ type: 'ins', b: j++ })
  return ops
}

/** 把相邻的非 same 操作并成一处差异。 */
function hunksOf(ops) {
  const hunks = []
  let current = null
  for (const op of ops) {
    if (op.type === 'same') { current = null; continue }
    if (!current) { current = { del: [], ins: [], aStart: op.a ?? null, bStart: op.b ?? null }; hunks.push(current) }
    if (op.type === 'del') { current.del.push(op.a); if (current.aStart === null) current.aStart = op.a }
    else { current.ins.push(op.b); if (current.bStart === null) current.bStart = op.b }
  }
  return hunks
}

/**
 * 归类一处差异。规则只有一条目标：**每一处都能说出它是怎么来的**。
 * 现在已知的只有一类化石——旧渲染器把"没有正文的记录"渲染成了 `undefined`。
 */
function classify(hunk, a) {
  const removed = hunk.del.map((i) => a[i])
  // 旧渲染器把"没有正文的记录"整块渲染成表头 + 空行 + `undefined`；重建会跳过整块，
  // 所以这一处会同时少掉 `undefined` 和它上面那行表头。
  const hasFossilBody = removed.includes('undefined')
  const onlyHeaderAndFossil = removed.every((line) => line === 'undefined' || /^\*\*.*·.*\*\*$/.test(line))
  if (hasFossilBody && onlyHeaderAndFossil && emptyText.length > 0) {
    return {
      known: true,
      why: `旧渲染器的化石：有 ${emptyText.length} 条记录没有正文（ts=${emptyText.map((r) => r.ts).join(', ')}），` +
        '当时被渲染成 `undefined`；重建跳过整块，所以这里少了它和它那行表头。',
    }
  }
  return { known: false, why: '未归类：这不一定是错，但还没人能说出它怎么来的。' }
}

// 只比内容行：空行是排版，属于脚本的事，不算「说不清来源的差异」。
const normalize = (s) => s
  .replace(/\r\n/g, '\n')
  .split('\n')
  .map((line) => line.replace(/[ \t]+$/, ''))
  .filter((line) => line !== '')
  .join('\n')

console.log(`记录 ${records.length} 条（坏行 ${badLines} 条，无正文 ${emptyText.length} 条），可重建出 ${blocks.length} 段`)

if (!existsSync(READABLE)) {
  console.log('群.md 不存在：按 --write 决定是否生成')
} else {
  const a = normalize(readFileSync(READABLE, 'utf8')).split('\n')
  const b = normalize(rebuilt).split('\n')
  const hunks = hunksOf(lineDiff(a, b))
  console.log(`现有 ${a.length} 行 / 重建 ${b.length} 行 / 差异 ${hunks.length} 处`)

  let unexplained = 0
  hunks.forEach((hunk, index) => {
    const verdict = classify(hunk, a)
    const where = hunk.aStart === null ? `重建第 ${(hunk.bStart ?? 0) + 1} 行` : `现有第 ${hunk.aStart + 1} 行`
    console.log(`\n[差异 ${index + 1}] ${where}（-${hunk.del.length} +${hunk.ins.length}）`)
    for (const i of hunk.del.slice(0, 3)) console.log(`  现有: ${String(a[i]).slice(0, 90)}`)
    for (const j of hunk.ins.slice(0, 3)) console.log(`  重建: ${String(b[j]).slice(0, 90)}`)
    console.log(`  归类: ${verdict.known ? '已知' : '未归类'} —— ${verdict.why}`)
    if (!verdict.known) unexplained += 1
  })

  if (hunks.length === 0) console.log('没有差异。')
  else if (unexplained === 0) console.log('\n全部差异都能解释：这份文件是派生，机器可以整本重写。')
  else console.log(`\n有 ${unexplained} 处说不清来源：在弄清之前，它按源头对待，机器不该整本写。`)
  // 有说不清的差异时，别让 CI/脚本把它当成"没事"。
  if (unexplained > 0) process.exitCode = 1
}

if (process.argv.includes('--write')) {
  writeFileSync(READABLE, rebuilt, 'utf8')
  console.log('已写入 群.md')
}
