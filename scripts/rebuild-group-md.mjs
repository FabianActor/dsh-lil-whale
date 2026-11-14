// 从 messages.jsonl 重建 群.md（可读投影），并**说明每一处差异是怎么来的**。
//
// 小肥鱼 2026-11-11 给的判据（比"逐字一致"准）：
//   判据不是"一致吗"，而是"能不能指着每一处差异说出它是怎么来的"。
//   能，就是派生；有一处说不出来，那就是源头，机器不许整本写。
// 所以这个脚本的重点不是打印"一致/不一致"，是打印**差异清单 + 归类**。
//
// 跑法：node scripts\rebuild-group-md.mjs            只看对照（有未归类差异 → exit 1）
//       node scripts\rebuild-group-md.mjs --write    覆盖 群.md
//       node scripts\rebuild-group-md.mjs --migrate  格式迁移：跳过差异闸、整本重写（先备份！）
import {renameSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { config } from '../plugin/dsh-lil-whale-group/lib/config.js'

// 路径从 lil-whale.config.json 读（真源见 plugin/dsh-lil-whale-group/lib/config.js）
const GROUP_DIR = config().groupDir
const MESSAGES = `${GROUP_DIR}\\messages.jsonl`
// 整本写必须原子：宿主同时在对 群.md appendFileSync，直接 writeFileSync
// 会在窗口期被读到半截（更糟的是 append 的那几句被覆盖）。先 tmp 再 rename。
function writeAtomic(file, content) {
  const tmp = file + '.tmp-' + process.pid
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, file)
}

const READABLE = `${GROUP_DIR}\\群.md`

// 显示名从名册读（A.25/A.32：成员表只有一个真源）。读不到就退回旧三条。
function loadLabel() {
  const fallback = { lee: '大肥鱼', whale: '小肥鱼', fabian: 'Fabian' }
  try {
    const file = config().membersFile
    if (!file || !existsSync(file)) return fallback
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    // 名册的顶层是 { version, updatedAt, members: {…} }；也接受直接是成员表的旧形状。
    const roster = parsed?.members ?? parsed
    const label = {}
    for (const [key, member] of Object.entries(roster ?? {})) {
      if (key.startsWith('_') || typeof member !== 'object' || member === null) continue
      label[key] = String(member?.name ?? key)
    }
    return Object.keys(label).length > 0 ? label : fallback
  } catch {
    return fallback
  }
}
const LABEL = loadLabel()

// 改名史（A.79）：投影是"当时的纸"，历史行要写当时的名字。
// 名册里 `nameHistory: [{ name, until }]`，until 是这个名字用到什么时候（ISO）；
// 没有 until 的那条是当前名字。没有 nameHistory 的成员永远用当前名。
const HISTORY = (() => {
  const out = {}
  try {
    const file = config().membersFile
    if (!file || !existsSync(file)) return out
    const roster = JSON.parse(readFileSync(file, 'utf8'))?.members ?? {}
    for (const [key, member] of Object.entries(roster ?? {})) {
      if (Array.isArray(member?.nameHistory) && member.nameHistory.length > 0) out[key] = member.nameHistory
    }
  } catch {}
  return out
})()

/** 这条记录发生的时候，这个人叫什么。 */
function labelAt(key, iso) {
  const history = HISTORY[key]
  if (!Array.isArray(history) || history.length === 0) return LABEL[key] ?? key
  const t = Date.parse(String(iso ?? ''))
  for (const item of history) {
    if (!item?.until) return String(item?.name ?? LABEL[key] ?? key)
    if (!Number.isNaN(t) && t < Date.parse(item.until)) return String(item?.name ?? key)
  }
  return LABEL[key] ?? key
}

// 机器发的话要自己说出来（同 plugin/dsh-lil-whale-group/lib/index.js 的 provenanceOf）。
// `s` 平时是会话 id；不是会话 id 的值说明这句不是某一轮人说的。
const S_DISPLAY = { watch: '巡守' }

function provenanceOf(s) {
  // 只给"已知的机器来源"加标注：s 平时是座位 id（如 ae4daa）或会话 id，
  // 那些不该加；不认识的值也不加（宁可不标，不要给每条消息都加个后缀）。
  if (typeof s !== 'string') return ''
  const label = S_DISPLAY[s]
  return label ? `（${label}）` : ''
}

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

// 没有正文、也没有图的记录不参与重建：写进正文就等于编一句话，那比缺一段更糟。
// 多图（2026-11-15）：记录里 1 张是 image、多张是 images。
const imageListOf = (record) => {
  const list = []
  if (record?.image !== null && typeof record?.image === 'object') list.push(record.image)
  if (Array.isArray(record?.images)) {
    for (const item of record.images) {
      if (item !== null && typeof item === 'object') list.push(item)
    }
  }
  return list
}
const hasBody = (record) => {
  const text = typeof record?.text === 'string' ? record.text.trim() : ''
  return text !== '' || imageListOf(record).length > 0
}
const emptyText = records.filter((r) => !hasBody(r))

function blockOf(record) {
  const text = typeof record?.text === 'string' ? record.text.trim() : ''
  const images = imageListOf(record)
  if (text === '' && images.length === 0) return ''
  const who = labelAt(String(record?.from ?? ''), record?.ts)
  // 来源标注：机器发的（s 不是会话 id）要在纸上写出来，否则和人说的长得一样。
  const origin = provenanceOf(record?.s)
  // 收信人：2026-11-12 19:46 起的投影格式，只有指名（to 是某个成员）才写箭头。
  // 不写箭头 = 公开（to:"all"）；读记录的人靠这个分辨"这条在对谁说话"。
  const to = String(record?.to ?? '')
  const toLabel = to !== '' && to !== 'all' ? ` → ${labelAt(to, record?.ts)}` : ''
  // 带图的记录也要重建出来 —— 2026-11-12 现场：只有图没有字的消息被这里整条跳过，
  // 于是 群.md 里有那行、重建结果里没有，对不上就成了"说不清的差异"。
  const body = images.length === 0
    ? text
    : `${images.map((image) => `（图片 images/${image.month}/${image.id}.${image.ext}）`).join('\n')}${text === '' ? '' : `\n\n${text}`}`
  return `**${stampOf(String(record?.ts ?? ''))} · ${who}${origin}${toLabel}**\n\n${body}\n`
}

const blocks = records.map(blockOf).filter(Boolean)
// 第一行是标题。它是这份文件的一部分，不是某个人说的，所以由脚本负责。
// 第二行是分界标记：格式被推翻过的地方必须留痕，否则读的人分不清"没写收信人"和"不指名"。
const HEADER_NOTE = '> 2026-11-12 19:46 起：指名消息的表头写成 `时间 · 谁 → 收信人`（不写箭头 = 公开）。更早的消息也按同一规则重排过，原始备份 `群.md.bak-20261112-194734`。\n'
const rebuilt = `# 群\n\n${HEADER_NOTE}\n` + blocks.join('\n')

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
function classify(hunk, a, b) {
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
  // 改名漂移：投影是"当时的纸"，但写它的人用的是进程启动时缓存的旧显示名。
  // 只差标题里的名字（时间、来源标注、箭头都一样）时，这一处是可解释的。
  const headerOf = (line) => /^\*\*(.+?) · (.+?)(（[^）]*）)?( → .+?)?\*\*$/.exec(line);
  const shapeOf = (line) => {
    const m = headerOf(line);
    if (m === null) return null;
    return `**${m[1]} · <name>${m[3] ?? ''}${m[4] ? ' → <name>' : ''}**`;
  };
  if (removed.length > 0 && hunk.ins.length === removed.length) {
    const insLines = hunk.ins.map((i) => b[i]);
    const shaped = removed.map(shapeOf);
    if (shaped.every((x) => x !== null) && insLines.map(shapeOf).every((x, i) => x === shaped[i])) {
      return {
        known: true,
        why: '改名漂移：只差标题里的显示名（时间/来源/箭头都一致）——写它的人用了进程里缓存的旧名字。',
      };
    }
  }
  // 新增记录还没投影：纯插入，且每段表头的时间戳在 jsonl 里都有对应记录。
  if (removed.length === 0 && hunk.ins.length > 0) {
    const insLines = hunk.ins.map((i) => b[i]);
    const headers = [];
    let cur = null;
    for (const line of insLines) {
      const m = headerOf(line);
      if (m !== null) {
        cur = { ts: m[1] };
        headers.push(cur);
        continue;
      }
      cur = null;
    }
    const allKnown = headers.length > 0 && headers.every((h) => records.some((r) => stampOf(String(r.ts ?? '')) === h.ts));
    if (allKnown) {
      return { known: true, why: `新增记录还没投影：${headers.length} 段的时间戳在 jsonl 里都有对应记录。` };
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

let unexplained = 0
if (!existsSync(READABLE)) {
  console.log('群.md 不存在：按 --write 决定是否生成')
} else {
  const a = normalize(readFileSync(READABLE, 'utf8')).split('\n')
  const b = normalize(rebuilt).split('\n')
  const hunks = hunksOf(lineDiff(a, b))
  console.log(`现有 ${a.length} 行 / 重建 ${b.length} 行 / 差异 ${hunks.length} 处`)

  hunks.forEach((hunk, index) => {
    const verdict = classify(hunk, a, b)
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

// ---------- 私聊的可读投影（dm\私聊-<a>__<b>.md） ----------
// 和 群.md 同一条规矩：能从 jsonl 整本重建；说不清来源的差异不许静默覆盖。
// 标题和正文格式必须与宿主 sayPrivate() 写的逐字一致，否则一写就对不上。
const DM_DIR = config().dmDir || `${GROUP_DIR}\\dm`
const dmWrites = []
let dmUnexplained = 0

if (existsSync(DM_DIR)) {
  for (const name of readdirSync(DM_DIR).filter((n) => n.endsWith('.jsonl'))) {
    const stem = name.slice(0, -'.jsonl'.length)
    const [x, y] = stem.split('__')
    const source = `${DM_DIR}\\${name}`
    const target = `${DM_DIR}\\私聊-${stem}.md`
    const dmRecords = []
    let dmBad = 0
    for (const line of readFileSync(source, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      try { dmRecords.push(JSON.parse(trimmed)) } catch { dmBad += 1 }
    }
    const dmBlocks = dmRecords.map((record) => {
      const text = typeof record?.text === 'string' ? record.text.trim() : ''
      const images = imageListOf(record)
      if (text === '' && images.length === 0) return ''
      const who = labelAt(String(record?.from ?? ''), record?.ts)
      const body = images.length === 0
        ? text
        : `${images.map((image) => `（图片 images/${image.month}/${image.id}.${image.ext}）`).join('\n')}${text === '' ? '' : `\n\n${text}`}`
      return `**${stampOf(String(record?.ts ?? ''))} · ${who}**\n\n${body}\n`
    }).filter(Boolean)
    const dmRebuilt = `# 私聊 · ${LABEL[x] ?? x} / ${LABEL[y] ?? y}\n\n` + dmBlocks.join('\n')
    dmWrites.push({ target, rebuilt: dmRebuilt })

    if (!existsSync(target)) {
      console.log(`[私聊] ${stem}: 还没有可读投影（${dmRecords.length} 条，--write 会生成）`)
      continue
    }
    const a = normalize(readFileSync(target, 'utf8')).split('\n')
    const b = normalize(dmRebuilt).split('\n')
    const hunks = hunksOf(lineDiff(a, b))
    if (hunks.length === 0) {
      console.log(`[私聊] ${stem}: 没有差异（${dmRecords.length} 条，坏行 ${dmBad} 条）`)
      continue
    }
    console.log(`[私聊] ${stem}: 差异 ${hunks.length} 处`)
    for (const hunk of hunks) {
      for (const i of hunk.del.slice(0, 2)) console.log(`  现有: ${String(a[i]).slice(0, 90)}`)
      for (const j of hunk.ins.slice(0, 2)) console.log(`  重建: ${String(b[j]).slice(0, 90)}`)
    }
    dmUnexplained += hunks.length
  }
}
if (dmUnexplained > 0) process.exitCode = 1

// 格式迁移：跳过"说不清就不许整本写"这道闸，整本重写一次。
// 前提是已经手工备份（本脚本不替你备份）——迁移是把旧的投影按新规则重排，
// 差异必然"说不清"，所以这一刻只能靠人先留底。
if (process.argv.includes('--migrate')) {
  writeAtomic(READABLE, rebuilt)
  // 私聊投影也一起迁移：迁移模式已跳过差异闸（前提是有人先备份）。
  // 只重写群、不重写私聊，会让"面板发的私聊"这类旧缺口永远留在纸上。
  for (const item of dmWrites) {
    writeAtomic(item.target, item.rebuilt)
    console.log(`已按新格式重写 ${item.target}`)
  }
  console.log(`已按新格式整本重写 群.md（${blocks.length} 段，指名带箭头的 ${records.filter((r) => r?.to && r.to !== 'all').length} 条）`)
  process.exitCode = 0
}

if (process.argv.includes('--write')) {
  // 有说不清的差异时不许整本写：2026-11-13 扫描 P2#25 —— 脚本 exit 1 却把 群.md 写掉了，
  // 结果"成功看起来像失败"，而文件其实已经被覆盖。
  if (unexplained > 0) {
    console.log(`群.md 有 ${unexplained} 处说不清的差异：这次不写它，先把差异弄清。`)
  } else {
    writeAtomic(READABLE, rebuilt)
    console.log('已写入 群.md')
  }
  if (dmUnexplained === 0) {
    for (const item of dmWrites) {
      writeAtomic(item.target, item.rebuilt)
      console.log(`已写入 ${item.target}`)
    }
  } else {
    console.log('私聊投影有说不清的差异：一份都没写，先把差异弄清。')
  }
}
