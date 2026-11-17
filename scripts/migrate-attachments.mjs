#!/usr/bin/env node
// migrate-attachments.mjs — 把会话里引用到的附件（图片/文件）从旧家搬到新家。
//
// 为什么要这一步：会话日志（session.v4.jsonl.zstd）只记 sha256 引用，字节存在
//   <DSH_HOME>\attachments\v1\{objects,file-objects,files}\...
// 只搬会话文件、不搬这些字节，界面打开那段会话就会报 "Attachment object is missing."
// （2026-11-17 把旧会话迁成 LeeaCP 时撞到）。
//
// 用法：
//   node scripts\migrate-attachments.mjs --source-home C:\Users\<你>\.dsh --target-home <家>\dsh-home
//   可选：--session-file <session.v4.jsonl.zstd>（可重复；默认扫 target-home 下所有会话）
//         --dry-run（只报告，不写）
//
// 只搬"目标会话真的引用到的"对象；目标里已有的跳过（内容寻址，重复无害）；每个字节都核对 sha256。

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const REF_PATTERN = /"attachmentId":"sha256:([0-9a-f]{64})"/g

function parseArgs(argv) {
  const out = { sessions: [], dryRun: false, sourceHome: null, targetHome: null, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--source-home') out.sourceHome = argv[++i]
    else if (a === '--target-home') out.targetHome = argv[++i]
    else if (a === '--session-file') out.sessions.push(argv[++i])
    else if (a === '--dry-run') out.dryRun = true
    else if (a === '--help' || a === '-h') out.help = true
    else { console.error(`xx 不认识的参数：${a}`); process.exit(2) }
  }
  return out
}

function usage() {
  console.log(`用法：
  node scripts\\migrate-attachments.mjs --source-home <旧 DSH_HOME> --target-home <新 DSH_HOME> [--dry-run] [--session-file <文件>...]

说明：会话日志只记附件 sha256 引用，字节在 <DSH_HOME>\\attachments\\v1。
      只搬目标会话引用到的对象；已存在的跳过；每个字节核对 sha256。`)
}

// 读出多帧 zstd 会话日志里的全部文本（每帧是一次追加，帧头是 zstd magic）。
function readSessionText(file) {
  const raw = readFileSync(file)
  const frames = []
  let i = 0
  while (i < raw.length) {
    const at = raw.indexOf(ZSTD_MAGIC, i)
    if (at < 0) break
    const next = raw.indexOf(ZSTD_MAGIC, at + 1)
    frames.push(raw.subarray(at, next < 0 ? raw.length : next))
    i = next < 0 ? raw.length : next
  }
  const texts = []
  for (const frame of frames) {
    try {
      const t = zstdDecompressSync(frame).toString('utf8')
      if (t.startsWith('{')) texts.push(t)
    } catch { /* 半帧/坏帧跳过：下一帧照常读 */ }
  }
  return texts.join('')
}

function walkSessions(root, acc = []) {
  if (!existsSync(root)) return acc
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) walkSessions(full, acc)
    else if (entry.isFile() && entry.name === 'session.v4.jsonl.zstd') acc.push(full)
  }
  return acc
}

function sha256Of(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { usage(); return }
  if (!args.sourceHome || !args.targetHome) { usage(); console.error('xx 缺 --source-home 或 --target-home'); process.exit(2) }
  const sourceHome = resolve(args.sourceHome)
  const targetHome = resolve(args.targetHome)
  const sourceStore = join(sourceHome, 'attachments', 'v1')
  const targetStore = join(targetHome, 'attachments', 'v1')
  if (!existsSync(join(targetHome, 'sessions'))) {
    console.error(`xx 目标家下面没有 sessions\\：${targetHome}`)
    console.error('NEXT: 确认 --target-home 指向某条鱼的 dsh-home（里面应该有 sessions\\ 目录）。')
    process.exit(2)
  }
  if (!existsSync(sourceStore)) {
    console.error(`xx 旧家下面没有 attachments\\v1：${sourceStore}`)
    console.error('NEXT: 确认 --source-home 是当初跑那段会话的 DSH_HOME（默认是 C:\\Users\\<你>\\.dsh）。')
    process.exit(2)
  }

  const sessionFiles = args.sessions.length > 0
    ? args.sessions.map((f) => resolve(f))
    : walkSessions(join(targetHome, 'sessions'))
  if (sessionFiles.length === 0) {
    console.log('这一段没有会话文件，没什么可搬的。')
    return
  }

  const ids = new Set()
  for (const file of sessionFiles) {
    if (!existsSync(file)) { console.error(`xx 会话文件不存在：${file}`); process.exit(2) }
    for (const m of readSessionText(file).matchAll(REF_PATTERN)) ids.add(m[1])
  }

  const images = []
  const files = []
  const missing = []
  for (const id of ids) {
    const s2 = id.slice(0, 2)
    if (existsSync(join(sourceStore, 'objects', s2, id))) images.push(id)
    else if (existsSync(join(sourceStore, 'file-objects', s2, id))) files.push(id)
    else missing.push(id)
  }

  let copied = 0
  let already = 0
  const copyOne = (src, dst, expected) => {
    mkdirSync(dirname(dst), { recursive: true })
    copyFileSync(src, dst)
    const got = sha256Of(dst)
    if (got !== expected) { console.error(`xx 复制后校验失败：${dst}（期望 ${expected}，实际 ${got}）`); process.exit(1) }
  }

  // 按"附件"计数（一个文件附件会落两份字节：file-objects 里一份、files\<sha2>\<id>\<名字> 一份）。
  for (const id of images) {
    const s2 = id.slice(0, 2)
    const dst = join(targetStore, 'objects', s2, id)
    if (existsSync(dst)) { already++; continue }
    copied++
    if (!args.dryRun) copyOne(join(sourceStore, 'objects', s2, id), dst, id)
  }
  for (const id of files) {
    const s2 = id.slice(0, 2)
    const dstObject = join(targetStore, 'file-objects', s2, id)
    const dstFilesDir = join(targetStore, 'files', s2, id)
    const srcFilesDir = join(sourceStore, 'files', s2, id)
    const done = existsSync(dstObject) && (!existsSync(srcFilesDir) || existsSync(dstFilesDir))
    if (done) { already++; continue }
    copied++
    if (args.dryRun) continue
    copyOne(join(sourceStore, 'file-objects', s2, id), dstObject, id)
    if (existsSync(srcFilesDir)) {
      for (const name of readdirSync(srcFilesDir)) {
        const src = join(srcFilesDir, name)
        if (!statSync(src).isFile()) continue
        copyOne(src, join(dstFilesDir, name), id)
      }
    }
  }

  console.log(`扫描会话 ${sessionFiles.length} 段，引用附件 ${ids.size} 个（图片 ${images.length}、文件 ${files.length}）`)
  console.log(`新家已有 ${already} 个，${args.dryRun ? '待搬' : '搬了'} ${copied} 个`)
  if (missing.length > 0) {
    console.error(`xx 旧家里缺 ${missing.length} 个附件（这些会一直打不开）：`)
    for (const id of missing.slice(0, 5)) console.error(`   sha256:${id}`)
    console.error('NEXT: 从备份里找回旧家的 attachments\\v1，或者接受这几张图/文件丢了；本命令可以重复跑。')
    process.exit(1)
  }
  console.log('NEXT: 刷新那个窗口的页面（会话已经加载过的，关掉再打开），图片/文件就能读了。')
}

main()
