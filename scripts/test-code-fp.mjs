// 代码指纹测试（2026-11-17 r255）。
//
// 验三件事：
//   1. 同一份代码算两次一样、两个副本一样；
//   2. 内容改一个字节，指纹必须变（这是它存在的理由）；
//   3. CLI 能给人手算一次（探针脚本用它，不用自己拼 sha256）。
//
// 用法：node scripts\test-code-fp.mjs

import { appendFileSync, cpSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codeFingerprint } from '../plugin/dsh-lil-whale-group/lib/code-fp.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIB = join(ROOT, 'plugin', 'dsh-lil-whale-group', 'lib')

let pass = 0
let fail = 0
const failures = []
function check(label, actual, expected) {
  if (actual === expected) {
    pass += 1
    return
  }
  fail += 1
  failures.push({ label, actual, expected })
}
function ok(label, condition, detail = '') {
  if (condition) {
    pass += 1
    return
  }
  fail += 1
  failures.push({ label, actual: detail || 'false' })
}

// —— 1. 格式与稳定性 ——
const first = codeFingerprint(LIB)
check('指纹是 12 位十六进制', /^[0-9a-f]{12}$/.test(first.fp), true)
ok('文件数 > 0', first.files > 0, String(first.files))
check('同一份代码算两次一样', codeFingerprint(LIB).fp, first.fp)

// —— 2. 副本相同、改一个字节就变 ——
const tmp = mkdtempSync(join(tmpdir(), 'llw-code-fp-'))
try {
  cpSync(LIB, join(tmp, 'lib'), { recursive: true })
  check('副本与原目录指纹相同', codeFingerprint(join(tmp, 'lib')).fp, first.fp)

  const files = readdirSync(join(tmp, 'lib')).filter((name) => name.endsWith('.js'))
  ok('副本里至少有 2 个 js', files.length >= 2, String(files.length))
  appendFileSync(join(tmp, 'lib', files[0]), '\n// 改一个字节\n', 'utf8')
  ok('改一个文件内容后指纹变', codeFingerprint(join(tmp, 'lib')).fp !== first.fp)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

// —— 3. CLI（探针用它手算） ——
const cli = join(LIB, 'code-fp.js')
const run = spawnSync(process.execPath, [cli], { encoding: 'utf8' })
check('CLI 退出码 0', run.status, 0)
const line = String(run.stdout ?? '').trim()
ok('CLI 输出形状对', /^codeFp=[0-9a-f]{12} files=\d+$/.test(line), line)
check('CLI 算出的指纹与函数一致', line.split(' ')[0], `codeFp=${first.fp}`)

// —— 4. 读不了的目录要明说，不能假装算出个指纹 ——
const missing = codeFingerprint(join(LIB, 'no-such-dir'))
check('读不了时 fp=unknown', missing.fp, 'unknown')
ok('读不了时带 error', typeof missing.error === 'string' && missing.error.length > 0, String(missing.error))

// —— 汇总 ——
if (fail > 0) {
  for (const item of failures) {
    console.log(`xx ${item.label}`)
    console.log(`   期望：${JSON.stringify(item.expected)}`)
    console.log(`   实际：${JSON.stringify(item.actual)}`)
  }
}
console.log(`test-code-fp：合计 ${pass + fail}，PASS ${pass}，FAIL ${fail}`)
process.exit(fail === 0 ? 0 : 1)
