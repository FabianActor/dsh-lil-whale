// 扫 PowerShell 脚本里对"只读/常量自动变量"的赋值（2026-11-18，小鱼丸私信 #13 / Leea 误用 $host 删目录事故）
// 这些名字在 PowerShell 里是 ReadOnly/Constant：赋值会变成非终止错误，不设 Stop 时脚本继续、退出码 0，
// 于是"路径没赋上、却拿真 HOME 照跑"——错的和对的在结果上长得一样。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const RESERVED = [
  '?', 'EnabledExperimentalFeatures', 'Error', 'ExecutionContext', 'false', 'HOME', 'Host',
  'IsCoreCLR', 'IsLinux', 'IsMacOS', 'IsWindows', 'PID', 'PSCulture', 'PSEdition', 'PSHOME',
  'PSStyle', 'PSUICulture', 'PSVersionTable', 'ShellId', 'true',
].map((s) => s.toLowerCase())
const ASSIGN_RE = /^\s*\$(?<name>[A-Za-z_?][A-Za-z0-9_?]*)\s*=/gm

function scriptsOf(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.ps1'))
    .map((d) => path.join(dir, d.name))
    .sort()
}

export function reservedHits(text) {
  const hits = []
  for (const m of text.matchAll(ASSIGN_RE)) {
    const name = m.groups.name
    if (RESERVED.includes(name.toLowerCase())) {
      const before = text.slice(0, m.index)
      hits.push({ name, line: before.split('\n').length })
    }
  }
  return hits
}

let pass = 0
let fail = 0
const ok = (cond, label, detail = '') => {
  if (cond) { pass += 1; console.log(`ok   ${label}`) } else { fail += 1; console.log(`FAIL ${label}${detail ? ' — ' + detail : ''}`) }
}

const files = [...scriptsOf(path.join(ROOT, 'scripts')), ...scriptsOf(path.join(ROOT, 'templates'))]
ok(files.length > 0, '找到脚本', files.length ? `${files.length} 个 .ps1` : '一个都没有')
let bad = 0
for (const file of files) {
  const hits = reservedHits(fs.readFileSync(file, 'utf8'))
  if (hits.length) {
    bad += hits.length
    console.log(`     ${path.relative(ROOT, file)}: ${hits.map((h) => `$${h.name}@L${h.line}`).join(', ')}`)
  }
}
ok(bad === 0, '没有对只读/常量自动变量的赋值', bad ? `${bad} 处` : `${files.length} 个文件`)

// 负样本：造两个脚本，一个坏一个好，确认检测能分辨
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llw-ps-res-'))
try {
  fs.writeFileSync(path.join(tmp, 'bad.ps1'), "param()\r\n$HOME = 'x'\r\nWrite-Output $HOME\r\n")
  fs.writeFileSync(path.join(tmp, 'good.ps1'), "param()\r\n$srcPath = 'x'\r\nWrite-Output $srcPath\r\n")
  ok(reservedHits(fs.readFileSync(path.join(tmp, 'bad.ps1'), 'utf8')).length === 1, '负样本能抓到 $HOME 赋值')
  ok(reservedHits(fs.readFileSync(path.join(tmp, 'good.ps1'), 'utf8')).length === 0, '负样本里 $srcPath 不误报')
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

// 静态接线：render-svg.ps1 用 $chromeArgs，不再出现 $args =（2026-11-18 里它命中过）
const rs = path.join(ROOT, 'scripts', 'render-svg.ps1')
if (fs.existsSync(rs)) {
  const src = fs.readFileSync(rs, 'utf8')
  ok(/\$chromeArgs\s*=\s*@\(/.test(src), 'render-svg.ps1 用 $chromeArgs')
  ok(!/^\s*\$args\s*=/m.test(src), 'render-svg.ps1 不再给 $args 赋值')
  ok(/&\s*\$edge\s+@chromeArgs/.test(src), 'render-svg.ps1 传参用 @chromeArgs')
}

console.log(`test-ps-reserved-names：合计 ${pass + fail}，PASS ${pass}，FAIL ${fail}`)
process.exit(fail === 0 ? 0 : 1)