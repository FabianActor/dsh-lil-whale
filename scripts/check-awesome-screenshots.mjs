#!/usr/bin/env node
// 校验两个包目录下的 screenshots.json——给 awesome-dsh-plugin 市场详情页的声明。
//
// 规则照 https://github.com/awesome-dsh-plugin/awesome-dsh-plugin 的 scripts/probe-screenshots.mjs：
//   - 文件必须放在 package.json 旁边（monorepo 条目对应子目录里）；
//   - 1–8 张；相对路径（相对这个文件），不许 `..` 爬出插件目录；
//   - 绝对 URL 只收 GitHub 托管（这里不发网络请求，只做形状检查）；
//   - 三种形状都收：数组 / {"screenshots": [...]} / 单键映射 URL→列表。
//
// 这个脚本只查本地仓库，不发网络请求；市场那边的存活检查由 probe 自己跑。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES = ['plugin/dsh-lil-whale-group', 'plugin/dsh-lil-whale-group-ui']
const MAX_SHOTS = 8
const HOSTS = new Set([
  'raw.githubusercontent.com',
  'user-images.githubusercontent.com',
  'camo.githubusercontent.com',
  'github.com',
])

const problems = []
const fail = (message) => problems.push(message)

function listOf(doc, entryUrl) {
  if (Array.isArray(doc)) return doc
  if (Array.isArray(doc?.screenshots)) return doc.screenshots
  if (Array.isArray(doc?.[entryUrl])) return doc[entryUrl]
  if (doc && typeof doc === 'object' && Object.keys(doc).length === 1) {
    const only = Object.values(doc)[0]
    if (Array.isArray(only)) return only
  }
  return null
}

let total = 0
for (const pkg of PACKAGES) {
  const file = path.join(REPO, pkg, 'screenshots.json')
  if (!fs.existsSync(file)) {
    // 没声明不算错：市场会回退去 README 里抽图。
    console.log(`- ${pkg}/screenshots.json（没有声明，跳过）`)
    continue
  }
  let doc
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    fail(`${pkg}/screenshots.json 不是合法 JSON：${e.message}`)
    continue
  }
  const list = listOf(doc, '')
  if (list === null) {
    fail(`${pkg}/screenshots.json 形状不对：只用数组、{"screenshots":[...]} 或单键映射`)
    continue
  }
  if (list.length === 0) fail(`${pkg}/screenshots.json 一张图都没列`)
  if (list.length > MAX_SHOTS) fail(`${pkg}/screenshots.json 列了 ${list.length} 张，上限 ${MAX_SHOTS}`)
  console.log(`- ${pkg}/screenshots.json：${list.length} 张`)
  for (const raw of list) {
    if (typeof raw !== 'string' || !raw.trim()) {
      fail(`${pkg}/screenshots.json 里有非字符串条目：${JSON.stringify(raw)}`)
      continue
    }
    const s = raw.trim()
    if (/^https?:\/\//i.test(s)) {
      let u = null
      try { u = new URL(s) } catch { /* 报在下面 */ }
      if (u === null || u.protocol !== 'https:' || !HOSTS.has(u.hostname)) {
        fail(`${pkg}/screenshots.json 的绝对地址必须是 GitHub 托管的 https 图：${s}`)
      } else {
        console.log(`  ok（绝对）${s}`)
      }
      total += 1
      continue
    }
    if (s.startsWith('/') || s.split('/').includes('..')) {
      fail(`${pkg}/screenshots.json 的相对路径不许爬出插件目录：${s}`)
      continue
    }
    const abs = path.join(REPO, pkg, s)
    if (!fs.existsSync(abs)) {
      fail(`${pkg}/screenshots.json 指向的图片不存在：${s}`)
      continue
    }
    const bytes = fs.statSync(abs).size
    if (bytes === 0) {
      fail(`${pkg}/screenshots.json 指向的图片是空文件：${s}`)
      continue
    }
    console.log(`  ok ${s}（${bytes} B）`)
    total += 1
  }
}

if (problems.length > 0) {
  console.error(`\nxx screenshots：${problems.length} 个问题`)
  for (const p of problems) console.error(`   - ${p}`)
  process.exit(1)
}
console.log(`\nscreenshots：PASS（共 ${total} 张引用）`)
