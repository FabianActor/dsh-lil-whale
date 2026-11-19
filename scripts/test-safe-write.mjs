// 测试：safe-write 的只读门 + "补丁脚本里不许有裸写调用"的静态扫描（fi-0003）
//
// 分三层：
//   A. safe-write 行为：readOnly 时每个入口都抛，非 readOnly 时真的写；
//   B. 扫描器夹具：4 种真调用必须红、4 种假调用必须绿、顺序敏感一格必须证明"剥层在前会漏"；
//   C. 真文件：scripts/patch-bili-eyes-note.mjs 里裸写调用必须是 0。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeText, appendText, renameFile, copyFileTo, ensureDir, restoreText } from './lib/safe-write.mjs'
import { scanWriteCalls, describeHits, stripNonCode, SCANNER_HEADER } from './lib/scan-write-calls.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let pass = 0
const fails = []
function ok(name, cond) {
  if (cond) {
    pass += 1
    console.log(`ok   ${name}`)
  } else {
    fails.push(name)
    console.log(`FAIL ${name}`)
  }
}

// ── A. safe-write 行为 ─────────────────────────────────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llw-safe-write-'))
try {
  const target = path.join(tmpDir, 'a.txt')
  const other = path.join(tmpDir, 'b.txt')

  ok('非只读时 writeText 真的写', (() => { writeText(false, target, 'hello'); return fs.readFileSync(target, 'utf8') === 'hello' })())
  ok('readOnly 时 writeText 抛错', (() => { try { writeText(true, target, 'nope'); return false } catch (e) { return /只读模式/.test(e.message) } })())
  ok('抛错时文件没被改', fs.readFileSync(target, 'utf8') === 'hello')
  ok('非只读时 appendText 追加', (() => { appendText(false, target, '!'); return fs.readFileSync(target, 'utf8') === 'hello!' })())
  ok('readOnly 时 appendText 抛错', (() => { try { appendText(true, target, 'x'); return false } catch { return true } })())
  ok('readOnly 时 renameFile 抛错', (() => { try { renameFile(true, target, other); return false } catch { return true } })())
  ok('非只读时 renameFile 成功', (() => { renameFile(false, target, other); return fs.existsSync(other) && !fs.existsSync(target) })())
  ok('readOnly 时 copyFileTo 抛错', (() => { try { copyFileTo(true, other, target); return false } catch { return true } })())
  ok('非只读时 copyFileTo 成功', (() => { copyFileTo(false, other, target); return fs.readFileSync(target, 'utf8') === 'hello!' })())
  ok('readOnly 时 ensureDir 抛错', (() => { try { ensureDir(true, path.join(tmpDir, 'd')); return false } catch { return true } })())
  ok('非只读时 ensureDir 建目录', (() => { ensureDir(false, path.join(tmpDir, 'd')); return fs.existsSync(path.join(tmpDir, 'd')) })())
  ok('restoreText 只在内容不同时写回', (() => { writeText(false, target, 'changed'); restoreText(false, target, 'orig'); return fs.readFileSync(target, 'utf8') === 'orig' })())
  ok('readOnly 时 restoreText 也抛错', (() => { try { restoreText(true, target, 'x'); return false } catch { return true } })())
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

// ── B. 扫描器夹具 ──────────────────────────────────────────
const realCalls = [
  "fs.writeFileSync(p, s);",
  "fs.writeFileSync (p, s);",
  "fs['writeFileSync'](p, s);",
  "fs\n  .writeFileSync(p, s);",
]
for (const [i, src] of realCalls.entries()) {
  const hits = scanWriteCalls(src)
  ok(`第 ${i + 1} 种真调用必须被抓到`, hits.length === 1 && hits[0].name === 'writeFileSync')
}

const fakeCalls = [
  "// fs.writeFileSync(p, s); 注释里不算",
  "const a = 'fs.writeFileSync(p, s)';",
  "const b = `fs.writeFileSync(p, s)`;",
  "const re = /[a-z]writeFileSync/;",
]
for (const [i, src] of fakeCalls.entries()) {
  ok(`第 ${i + 1} 种假调用必须放过`, scanWriteCalls(src).length === 0)
}

// 顺序敏感：先剥层、再找方括号，就会把 `fs['writeFileSync']` 那格漏掉
const bracketOnly = "fs['writeFileSync'](p, s);"
const strippedFirst = stripNonCode(bracketOnly)
const missedByStripFirst = /\bwriteFileSync\s*\(/.test(strippedFirst)
ok('剥层在前会漏掉方括号那格（所以顺序不能换）', missedByStripFirst === false)
ok('当前实现按"先方括号、后剥层"抓到它', scanWriteCalls(bracketOnly).length === 1)

// 报告形状：第一行永远声明非目标
const header = describeHits('demo.mjs', []).shift()
ok('扫描器第一行声明"已知不查"', header === SCANNER_HEADER && header.includes('动态拼名'))

// ── C. 真文件：补丁脚本里裸写调用 0 处 ─────────────────────
const patchScript = path.join(HERE, 'patch-bili-eyes-note.mjs')
const patchSource = fs.readFileSync(patchScript, 'utf8')
const patchHits = scanWriteCalls(patchSource)
ok('patch-bili-eyes-note.mjs 里没有裸的写调用', patchHits.length === 0)
if (patchHits.length > 0) for (const row of describeHits('patch-bili-eyes-note.mjs', patchHits)) console.log('  ' + row)

// safe-write 自己必须确实拿着底层写（它是唯一的门）——别把门锁在一个不存在的房间里
const gateSource = fs.readFileSync(path.join(HERE, 'lib', 'safe-write.mjs'), 'utf8')
ok('safe-write 里确实有底层 fs 写', /fs\.writeFileSync/.test(gateSource) && /fs\.renameSync/.test(gateSource))

console.log(`\ntest-safe-write：合计 ${pass + fails.length}，PASS ${pass}，FAIL ${fails.length}`)
for (const fail of fails) console.log(`  xx ${fail}`)
process.exit(fails.length === 0 ? 0 : 1)
