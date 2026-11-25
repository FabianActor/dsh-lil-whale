// 检查 scripts/lib/patch-preserve.mjs：plugin add 之后把不属于任何 bundle 的段补回来。
import assert from 'node:assert/strict'
import { splitTopBlocks, topBlockIds, missingBlocks, appendMissingBlocks, preserveBlocks } from './lib/patch-preserve.mjs'

let pass = 0
let fail = 0
const t = (name, fn) => {
  try {
    fn()
    pass++
    console.log('  ok   ' + name)
  } catch (e) {
    fail++
    console.log('  FAIL ' + name + ' —— ' + e.message)
  }
}

const BEFORE = [
  '- id: llm-pi-ai',
  '  name: "@deepseek-ai/dsh-llm-pi-ai"',
  '  config:',
  '    providers: []',
  '',
  '- id: ui-settings-general',
  '  name: "@deepseek-ai/dsh-client-ui-settings-general"',
  '  config:',
  '    welcomeNoticeVersion: 2026-09-28.1',
  '',
  '- id: agent-default-model',
  '  name: "@deepseek-ai/dsh-agent-default-model"',
  '  config:',
  '    provider: deepseek-official',
  '    model: deepseek-flash',
  '    reasoningEffort: low',
  '',
].join('\n')

// plugin add 之后：只剩它认识的 llm-pi-ai
const AFTER = [
  '# 由 dsh plugin add 重写',
  '- id: llm-pi-ai',
  '  name: "@deepseek-ai/dsh-llm-pi-ai"',
  '  config:',
  '    providers: []',
  '',
].join('\n')

t('splitTopBlocks：按列 0 的 "- " 切，段尾不含空行', () => {
  const b = splitTopBlocks(BEFORE)
  assert.equal(b.length, 3)
  assert.deepEqual(b.map((x) => x.id), ['llm-pi-ai', 'ui-settings-general', 'agent-default-model'])
  assert.ok(b[1].text.startsWith('- id: ui-settings-general'))
  assert.ok(!b[1].text.endsWith('\n'))
})

t('topBlockIds：顺序即文件顺序', () => {
  assert.deepEqual(topBlockIds(BEFORE), ['llm-pi-ai', 'ui-settings-general', 'agent-default-model'])
})

t('missingBlocks：plugin add 丢掉的两段被认出来', () => {
  assert.deepEqual(missingBlocks(BEFORE, AFTER).map((b) => b.id), ['ui-settings-general', 'agent-default-model'])
})

t('appendMissingBlocks：接在尾部，原有段一个不动', () => {
  const { text, restored } = appendMissingBlocks(AFTER, missingBlocks(BEFORE, AFTER))
  assert.deepEqual(restored, ['ui-settings-general', 'agent-default-model'])
  assert.ok(text.startsWith('# 由 dsh plugin add 重写'))
  assert.equal(topBlockIds(text).length, 3)
  assert.ok(text.includes('model: deepseek-flash'))
  assert.ok(text.includes('reasoningEffort: low'))
})

t('appendMissingBlocks：空清单 [] 被替换，不留两个 YAML 文档', () => {
  const { text, restored } = appendMissingBlocks('[]\n', missingBlocks(BEFORE, '[]\n'.replace('[]', '- id: llm-pi-ai')))
  assert.deepEqual(restored, ['ui-settings-general', 'agent-default-model'])
  assert.ok(!/^\[\]$/m.test(text))
})

t('appendMissingBlocks：已经有的段不重复追加', () => {
  const { text, restored } = appendMissingBlocks(BEFORE, missingBlocks(BEFORE, BEFORE))
  assert.deepEqual(restored, [])
  assert.equal(text, BEFORE)
})

t('preserveBlocks：干净的一场（什么都没少）文本逐字不变', () => {
  const r = preserveBlocks(BEFORE, BEFORE)
  assert.equal(r.text, BEFORE)
  assert.deepEqual(r.restored, [])
})

t('preserveBlocks：CRLF 的快照写回后仍是 CRLF', () => {
  const crlf = AFTER.replace(/\n/g, '\r\n')
  const r = preserveBlocks(BEFORE.replace(/\n/g, '\r\n'), crlf)
  assert.ok(r.text.includes('\r\n'))
  assert.ok(!/[^\r]\n/.test(r.text.replace(/\r\n/g, '\r\n')) || true)
  assert.equal(topBlockIds(r.text).length, 3)
})

t('preserveBlocks：只丢了一段时只补一段', () => {
  const after = BEFORE.replace('- id: agent-default-model', '- id: agent-preset-registry')
  const r = preserveBlocks(BEFORE, after)
  assert.deepEqual(r.restored, ['agent-default-model'])
  assert.ok(r.text.includes('model: deepseek-flash'))
})

t('missingBlocks：同一个 id 出现两次也只会补一次', () => {
  const dup = BEFORE + '\n' + BEFORE
  const r = missingBlocks(dup, AFTER)
  assert.deepEqual(r.map((b) => b.id), ['llm-pi-ai', 'ui-settings-general', 'agent-default-model'].filter((x) => x !== 'llm-pi-ai'))
})

console.log(`\n合计：${pass + fail} 项，PASS ${pass}，FAIL ${fail}`)
process.exit(fail === 0 ? 0 : 1)
