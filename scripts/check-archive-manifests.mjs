#!/usr/bin/env node
// 归档目录体检（2026-11-19 r354）。
//
//   node scripts/check-archive-manifests.mjs --pool <鱼塘根>
//
// doctor 用它的 stdout 判分；单独跑也能看。它只读，不改任何东西。
//
// 每个归档目录输出一行：
//   ok         <目录>     事件流完整、moved 与盘上哈希一致、有 archive-done
//   legacy     <目录>     只有 manifest.json（r354 之前的旧归档，没有事件流）
//   partial    <目录>     有 archive-start / archive-done 之一但没搬完
//   mismatch   <目录>     moved 说搬过、盘上却没有或哈希不同（有人动过归档）
//   broken     <目录>     有 manifest.jsonl 但没有 archive-start（文件被改过？）
//   nomanifest <目录>     目录里两个清单都没有（谁动过？）
// 最后一行：checked=<N>
//
// 判据（继承 whale/fishball 2026-11-15 的结论）：记录不许被现实修正——这类目录先报，不修。
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  EVENTS_FILE,
  MANIFEST_FILE,
  parseArchiveEvents,
  replayPlanOf,
} from './lib/archive-manifest-core.mjs'
import { hashOfPath } from './lib/archive-manifest-core.mjs'

let poolDir = ''
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i]
  if (arg === '--pool') { poolDir = process.argv[i + 1] ?? ''; i += 1 }
  else if (arg.startsWith('--pool=')) poolDir = arg.slice('--pool='.length)
}

if (!poolDir) {
  console.error('xx 要给 --pool <鱼塘根>')
  console.error('NEXT: node scripts\\check-archive-manifests.mjs --pool D:\\...\\lil-whale')
  process.exit(2)
}

const archiveRoot = join(resolve(poolDir), 'archive')
const lines = []
let checked = 0

if (existsSync(archiveRoot)) {
  const dirs = readdirSync(archiveRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('fish-'))
    .map((entry) => entry.name)
    .sort()

  for (const name of dirs) {
    checked += 1
    const dir = join(archiveRoot, name)
    const manifestPath = join(dir, MANIFEST_FILE)
    const eventsPath = join(dir, EVENTS_FILE)
    const hasManifest = existsSync(manifestPath)
    const hasEvents = existsSync(eventsPath)

    if (!hasManifest && !hasEvents) {
      lines.push(`nomanifest ${name}`)
      continue
    }
    if (!hasEvents) {
      lines.push(`legacy ${name}`)
      continue
    }

    let state
    try {
      const text = readFileSync(eventsPath, 'utf8')
      state = parseArchiveEvents(text.split(/\r?\n/))
    } catch (error) {
      lines.push(`broken ${name} 事件流读不了：${error.message}`)
      continue
    }
    if (!state.start) {
      lines.push(`broken ${name} 事件流里没有 archive-start`)
      continue
    }

    const hashOf = (itemName) => {
      const target = join(dir, itemName)
      if (!existsSync(target)) return null
      try { return hashOfPath(target) } catch { return null }
    }
    const plan = replayPlanOf(state, hashOf)
    if (plan.mismatched.length) {
      lines.push(`mismatch ${name} ${plan.mismatched.map((x) => x.name).join('、')}`)
      continue
    }
    if (plan.missing.length || !plan.done) {
      const what = plan.missing.length ? plan.missing.map((x) => x.name).join('、') : '缺 archive-done'
      lines.push(`partial ${name} ${what}`)
      continue
    }
    lines.push(`ok ${name}`)
  }
}

for (const line of lines) console.log(line)
console.log(`checked=${checked}`)
