// 从 messages.jsonl 重建 群.md（可读投影）。
//
// 为什么要有这个脚本：小肥鱼 2026-11-11 给文件分了三类——源头（不可重建）、
// 派生（可重建）、状态（丢了会算错）。她说 `群.md` 属于派生。
// 但"可重建"必须是**真的能重建**，否则只是信念：所以这里有这个脚本。
// 跑法：node scripts\rebuild-group-md.mjs [--write]
// 不带 --write 只做对照，打印差异摘要，不动文件。
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

/** 一条记录 → 群.md 里的一段。没有正文的记录跳过（那是损坏的，不该被重建成正文）。 */
function blockOf(record) {
  const text = typeof record?.text === 'string' ? record.text.trim() : ''
  if (text === '') return ''
  const who = LABEL[String(record?.from ?? '')] ?? String(record?.from ?? '?')
  return `**${stampOf(String(record?.ts ?? ''))} · ${who}**\n\n${text}\n`
}

const raw = readFileSync(MESSAGES, 'utf8')
const records = []
for (const line of raw.split('\n')) {
  const trimmed = line.trim()
  if (trimmed === '') continue
  try { records.push(JSON.parse(trimmed)) } catch { /* 半截行：跳过，不编内容 */ }
}

const blocks = records.map(blockOf).filter(Boolean)
// 第一行是标题。它是这份文件的一部分，不是某个人说的，所以由脚本负责。
const rebuilt = '# 群\n' + blocks.join('\n')

if (!existsSync(READABLE)) {
  console.log('群.md 不存在，按 --write 决定是否生成')
} else {
  const current = readFileSync(READABLE, 'utf8')
  const normalize = (s) => s.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
  const same = normalize(current) === normalize(rebuilt)
  console.log(`记录 ${records.length} 条，可重建出 ${blocks.length} 段`)
  console.log(`与现有 群.md 逐字对照：${same ? '一致' : '不一致'}`)
  if (!same) {
    const a = normalize(current).split('\n')
    const b = normalize(rebuilt).split('\n')
    console.log(`现有 ${a.length} 行 / 重建 ${b.length} 行`)
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      if (a[i] !== b[i]) {
        console.log(`第一处不同在第 ${i + 1} 行：`)
        console.log(`  现有: ${String(a[i] ?? '(无)').slice(0, 100)}`)
        console.log(`  重建: ${String(b[i] ?? '(无)').slice(0, 100)}`)
        break
      }
    }
  }
}

if (process.argv.includes('--write')) {
  writeFileSync(READABLE, rebuilt, 'utf8')
  console.log('已写入 群.md')
}
