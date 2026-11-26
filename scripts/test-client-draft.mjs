#!/usr/bin/env node
/**
 * 群聊草稿的两处接线（2026-11-19 r353）。
 *
 * 他报的 bug：群聊输入框写了字、删掉、切去私聊、再回到群聊，删掉的草稿又回来了。
 * 根因是草稿快照只在这页**第一次挂载**时读（initialTextRef），切 tab 只卸载输入框、
 * 页面组件不卸载，所以"页面卸载时清草稿"那条路永远走不到；回到群聊时 textarea 用
 * 那份挂载时的旧快照做 defaultValue，中间删掉的字仍然在。
 *
 * 这个测试只查线头（纯前端，没有 DOM 可跑）。注意这个文件不用分号，正则别写死分号：
 *   1) 切走时先把还没落盘的那 300ms 写掉（flushGroupDraft）；
 *   2) 定时器到点后归零，让"还有没有没落盘的字"可判定；
 *   3) 切回群聊时按 localStorage 现在这份重放输入框，不用挂载时的快照；
 *   4) build 标记跟着变，免得刷新后还以为跑的是旧包。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { MIN_CLIENT_BUILD, clientBuildOf, describeClientBuildFailure } from './lib/client-build.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const SRC = readFileSync(join(ROOT, 'plugin/dsh-lil-whale-group-ui/lib/client.js'), 'utf8')

let total = 0
let failed = 0
function ok(name, cond, detail = '') {
  total += 1
  if (cond) return
  failed += 1
  console.error(`xx ${name}${detail ? `：${detail}` : ''}`)
}

ok('存在 flushGroupDraft', SRC.includes('const flushGroupDraft = useCallback('), '没找到 flushGroupDraft')
ok('flushGroupDraft 会清 timer', /flushGroupDraft[\s\S]{0,400}clearTimeout\(draftTimerRef\.current\)/.test(SRC), 'flush 里没有 clearTimeout')
ok('flushGroupDraft 会写草稿', /flushGroupDraft[\s\S]{0,500}writeDraft\(GROUP_DRAFT_KEY, draftValueRef\.current\)/.test(SRC), 'flush 里没写草稿')
ok('switchTab 调 flushGroupDraft', SRC.includes('flushGroupDraft()'), 'switchTab 没调 flush')
ok('switchTab 先 flush 再 setTab', /if \(key !== 'group'\) \{\s*flushGroupDraft\(\)\s*setTab\(key\)\s*return\s*\}/.test(SRC), '顺序不对')
ok('定时器到点后归零', /draftTimerRef\.current = setTimeout\(\(\) => \{\s*draftTimerRef\.current = null\s/.test(SRC), '回调里没有归零')
ok('切回群聊时重放草稿', /if \(tab !== 'group'\) return\s[\s\S]{0,200}readDraft\(GROUP_DRAFT_KEY\)/.test(SRC), '没找到重放逻辑')
ok('重放写进输入框', /const stored = readDraft\(GROUP_DRAFT_KEY\)\s[\s\S]{0,120}el\.value = stored\s/.test(SRC), '没写 el.value')
ok('重放后同步 hasText', /el\.value = stored\s[\s\S]{0,120}setHasText\(stored\.trim\(\) !== ''\)/.test(SRC), '没同步 hasText')
ok('build 标记够新', (clientBuildOf(SRC)?.version ?? 0) >= MIN_CLIENT_BUILD, describeClientBuildFailure(SRC))
ok('style: 后面那些名字都声明过（r500：删一节时删掉过 rowStyle）', (() => {
  const declared = new Set()
  for (const m of SRC.matchAll(/\b(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1])
  for (const m of SRC.matchAll(/\b(?:const|let)\s*\[([^\]]*)\]\s*=/g)) for (const n of m[1].split(',')) declared.add(n.trim())
  for (const m of SRC.matchAll(/\b(?:const|let)\s*\{([^}]*)\}\s*=/g)) for (const n of m[1].split(',')) declared.add(n.trim().split(':').pop().trim())
  for (const m of SRC.matchAll(/\bimport\s*\{([^}]*)\}/g)) for (const n of m[1].split(',')) declared.add(n.trim().split(/\s+as\s+/).pop())
  const missing = []
  for (const m of SRC.matchAll(/style:\s*([A-Za-z_$][\w$]*)\s*[,}]/g)) if (!declared.has(m[1])) missing.push(m[1])
  if (missing.length > 0) console.error('  没有声明的 style 名字：' + [...new Set(missing)].join(','))
  return missing.length === 0
})(), '有 style: 引用了没声明的名字')

console.log(`test-client-draft：合计 ${total}，PASS ${total - failed}，FAIL ${failed}`)
process.exit(failed === 0 ? 0 : 1)
