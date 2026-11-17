#!/usr/bin/env node
// test-migrate-attachments.mjs — 迁移附件命令的回归测试（纯本地临时目录，不碰真鱼塘）。
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { zstdCompressSync } from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SCRIPT = join(HERE, 'migrate-attachments.mjs')
let pass = 0
let fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log(`ok   ${name}`) } else { fail++; console.error(`FAIL ${name}`) } }

const sha = (buf) => createHash('sha256').update(buf).digest('hex')

const root = mkdtempSync(join(tmpdir(), 'llw-att-test-'))
const srcHome = join(root, 'old-home')
const tgtHome = join(root, 'new-home')
const srcStore = join(srcHome, 'attachments', 'v1')

function putImage(store, id, bytes) {
  const p = join(store, 'objects', id.slice(0, 2), id)
  mkdirSync(join(store, 'objects', id.slice(0, 2)), { recursive: true })
  writeFileSync(p, bytes)
}
function putFile(store, id, name, bytes) {
  mkdirSync(join(store, 'file-objects', id.slice(0, 2)), { recursive: true })
  writeFileSync(join(store, 'file-objects', id.slice(0, 2), id), bytes)
  mkdirSync(join(store, 'files', id.slice(0, 2), id), { recursive: true })
  writeFileSync(join(store, 'files', id.slice(0, 2), id, name), bytes)
}
function writeSession(home, proj, sess, refs) {
  const dir = join(home, 'sessions', proj, sess)
  mkdirSync(dir, { recursive: true })
  const lines = refs.map((id, i) => JSON.stringify({ seq: i, event: { kind: 'user', attachmentId: `sha256:${id}` } })).join('\n')
  writeFileSync(join(dir, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from(lines + '\n', 'utf8')))
}

try {
  const imgA = Buffer.from('image-a-bytes')
  const imgB = Buffer.from('image-b-bytes')
  const fileC = Buffer.from('file-c-bytes')
  const extra = Buffer.from('never-referenced')
  const idA = sha(imgA), idB = sha(imgB), idC = sha(fileC), idX = sha(extra)
  mkdirSync(join(tgtHome, 'sessions'), { recursive: true })
  putImage(srcStore, idA, imgA)
  putImage(srcStore, idB, imgB)
  putFile(srcStore, idC, 'a.txt', fileC)
  putImage(srcStore, idX, extra)
  writeSession(tgtHome, 'proj', 'sess-good', [idA, idB, idC])

  const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })

  // 1. 正常搬：三个引用都搬过去
  let r = run(['--source-home', srcHome, '--target-home', tgtHome])
  ok(r.status === 0, `正常搬 exit=0（实际 ${r.status}）`)
  ok(existsSync(join(tgtHome, 'attachments', 'v1', 'objects', idA.slice(0, 2), idA)), '图片 A 已搬')
  ok(existsSync(join(tgtHome, 'attachments', 'v1', 'objects', idB.slice(0, 2), idB)), '图片 B 已搬')
  ok(existsSync(join(tgtHome, 'attachments', 'v1', 'file-objects', idC.slice(0, 2), idC)), '文件对象已搬')
  ok(existsSync(join(tgtHome, 'attachments', 'v1', 'files', idC.slice(0, 2), idC, 'a.txt')), '文件名别名已搬')
  ok(!existsSync(join(tgtHome, 'attachments', 'v1', 'objects', idX.slice(0, 2), idX)), '没被引用的对象不搬')
  ok(readFileSync(join(tgtHome, 'attachments', 'v1', 'objects', idA.slice(0, 2), idA)).equals(imgA), '搬过去的字节一致')
  ok(r.stdout.includes('搬了 3 个'), `输出说了搬 3 个（实际：${r.stdout.trim().split(/\r?\n/).join(' | ')}）`)

  // 2. 幂等：再跑一次，0 个
  r = run(['--source-home', srcHome, '--target-home', tgtHome])
  ok(r.status === 0 && r.stdout.includes('搬了 0 个'), '重复跑不重复搬（搬了 0 个）')

  // 3. dry-run：新目标家一个都不写
  const tgtDry = join(root, 'new-home-dry')
  mkdirSync(join(tgtDry, 'sessions'), { recursive: true })
  writeSession(tgtDry, 'proj', 'sess-good', [idA])
  r = run(['--source-home', srcHome, '--target-home', tgtDry, '--dry-run'])
  ok(r.status === 0, `dry-run exit=0（实际 ${r.status}）`)
  ok(!existsSync(join(tgtDry, 'attachments')), 'dry-run 不落盘')

  // 4. 旧家缺附件：exit 1 且点名缺几个
  const tgtMiss = join(root, 'new-home-miss')
  mkdirSync(join(tgtMiss, 'sessions'), { recursive: true })
  const idMissing = sha(Buffer.from('gone'))
  writeSession(tgtMiss, 'proj', 'sess-miss', [idA, idMissing])
  r = run(['--source-home', srcHome, '--target-home', tgtMiss])
  ok(r.status === 1, `缺附件 exit=1（实际 ${r.status}）`)
  ok(r.stderr.includes('缺 1 个附件'), `错误里点名缺 1 个（实际：${r.stderr.trim().split(/\r?\n/)[0]}）`)
  ok(existsSync(join(tgtMiss, 'attachments', 'v1', 'objects', idA.slice(0, 2), idA)), '缺一个不影响其它照搬')

  // 5. 参数不对：说清 NEXT
  r = run(['--target-home', tgtHome])
  ok(r.status === 2 && r.stderr.includes('--source-home'), '缺 --source-home 时 exit=2 并说清缺什么')
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log(`test-migrate-attachments：合计 ${pass + fail}，PASS ${pass}，FAIL ${fail}`)
process.exit(fail === 0 ? 0 : 1)
