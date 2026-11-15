// 给新出生的鱼把「脑子」装上：模型配置 + 中立预设。
//
// 为什么需要这一步（2026-11-15 测试鱼二代时发现）：
//   install.ps1 用 `dsh --from-default-profile web` 建的 profile 是空的——
//   只有默认的 deepseek-official 通道、没有她的模型、没有 preset-neutral。
//   结果：她能起来、能加载群插件，但一开口就没模型可调（或者用的是宿主的默认通道）。
//   以前这些是手工补的，所以每生一条鱼都得记着补一次。
//
// 这个脚本做两件事：
//   1) 如果 child patch 里没有 llm-pi-ai，就把 parent（家长）profile 里的
//      llm-pi-ai + agent-default-model 两段原样抄过来（家长用什么模型、她也用什么）；
//   2) 调 apply-neutral-preset.mjs 把中立预设装进 child，并设成默认。
//
// 用法：
//   node scripts/seed-child-profile.mjs --parent-patch <家长 patch> --child-patch <孩子 patch> \
//        --profile <孩子 profile 名> --home <孩子 DSH_HOME>
// 退出码：0 成功（或已经装过）；1 失败。

import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const argv = process.argv.slice(2)
function opt(name, fallback) {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
function die(msg) {
  console.error('error: ' + msg)
  process.exit(1)
}

const parentPatch = opt('parent-patch', null)
const childPatch = opt('child-patch', null)
const profile = opt('profile', null)
const dshHome = opt('home', null)
if (!parentPatch || !childPatch || !profile || !dshHome) {
  die('缺少参数：--parent-patch --child-patch --profile --home（全部必填）')
}
for (const p of [parentPatch, childPatch]) {
  if (!existsSync(p)) die('文件不存在：' + p)
}

const WANT = ['llm-pi-ai', 'agent-default-model']

// 从 parent patch 里切出某个 id 的整段（到下一个顶层 `- id:` 或文件末尾）
function extractBlock(text, id) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => l === `- id: ${id}`)
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('- ')) {
      end = i
      break
    }
  }
  while (end > start && lines[end - 1].trim() === '') end--
  return lines.slice(start, end).join('\n')
}

const parentText = readFileSync(parentPatch, 'utf8')
const childPath = childPatch
let childText = readFileSync(childPath, 'utf8')
const eol = childText.includes('\r\n') ? '\r\n' : '\n'

const blocks = []
const added = []
for (const id of WANT) {
  if (new RegExp(`^- id: ${id}$`, 'm').test(childText)) continue
  const block = extractBlock(parentText, id)
  if (!block) {
    console.error(`warn: 家长 patch 里没有 ${id}，跳过这一段`)
    continue
  }
  blocks.push(block)
  added.push(id)
}
if (blocks.length > 0) {
  copyFileSync(childPath, childPath + '.bak-before-model-' + Date.now())
  // 空 profile 的补丁是"注释 + 一行 []"（空 YAML 列表）。直接往后面接 `- id:` 会变成
  // 两个 YAML 文档 → dsh 解析报 "end of the stream or a document separator is expected"。
  // 所以有 `[]` 就替换掉它，没有才追加。（2026-11-15 21:0x，干净装机检查抓到的。）
  const emptyList = /^\[\]\s*$/m
  if (emptyList.test(childText)) {
    childText = childText.replace(emptyList, blocks.join(eol))
  } else {
    if (!childText.endsWith('\n')) childText += eol
    childText += eol + blocks.join(eol) + eol
  }
  writeFileSync(childPath, childText, 'utf8')
  console.log('已补模型配置：' + added.join(', '))
} else {
  console.log('模型配置已存在，跳过')
}

// 中立预设
const r = spawnSync(
  process.execPath,
  [join(repoRoot, 'scripts', 'apply-neutral-preset.mjs'), '--patch', childPath, '--profile', profile, '--home', dshHome, '--default'],
  { stdio: 'inherit' },
)
if (r.status !== 0) die('apply-neutral-preset.mjs 失败（exit ' + r.status + '）')
console.log('ok: ' + profile + ' 的模型与中立预设都装好了')
