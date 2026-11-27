// apply-neutral-preset.mjs 的补丁拼接逻辑（issue #10）。
// 跑法：node scripts/test-neutral-patch.mjs
import assert from 'node:assert/strict';
import { mergeNeutralPatch, splitTailChunks, NEUTRAL_MARKER } from './lib/neutral-patch-core.mjs';

let n = 0;
function ok(name, fn) {
  fn();
  n++;
  console.log(`ok ${n} - ${name}`);
}

const INSERT = [
  '- insert:',
  '    - id: preset-neutral',
  "      name: '@deepseek-ai/dsh-preset'",
  '      config:',
  '        persona: can',
].join('\n');

const DEFAULT_BLOCK = [
  '- id: agent-preset-registry',
  '  name: "@deepseek-ai/dsh-agent-preset-registry"',
  '  config:',
  '    default: neutral',
].join('\n');

const SETTINGS = [
  '- id: agent-default-model',
  '  name: "@deepseek-ai/dsh-agent-default-model"',
  '  config:',
  '    provider: deepseek-official',
].join('\n');

const UI_SETTINGS = [
  '- id: ui-settings-general',
  '  name: "@deepseek-ai/dsh-client-ui-settings-general"',
  '  config:',
  '    welcomeNoticeVersion: 2026-09-28.1',
].join('\n');

function withMarker({ before = '- insert:\n    - id: other-thing\n', ours = INSERT, after = '' }) {
  return `${before}\n${NEUTRAL_MARKER}\n\n${ours}\n\n${after}`.replace(/\n+$/, '\n');
}

ok('切尾巴：段前注释跟着段一起走', () => {
  const chunks = splitTailChunks('\n# 注释甲\n- id: a\n  x: 1\n\n# 注释乙\n- insert:\n    - id: preset-neutral\n');
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[0].ids, ['a']);
  assert.match(chunks[0].text, /^# 注释甲/);
  assert.equal(chunks[1].generated, true);
});

ok('别人的顶层段全部保留（issue #10 的主症状）', () => {
  const text = withMarker({ after: `${SETTINGS}\n\n${UI_SETTINGS}\n` });
  const r = mergeNeutralPatch({ text, insertBlock: INSERT, wantDefault: false, defaultBlock: DEFAULT_BLOCK });
  assert.match(r.text, /- id: agent-default-model/);
  assert.match(r.text, /- id: ui-settings-general/);
  assert.deepEqual(r.kept, ['agent-default-model', 'ui-settings-general']);
});

ok('自己的 insert 段会被替换（文案更新能落地）', () => {
  const text = withMarker({});
  const newer = INSERT.replace('persona: can', 'persona: can-v2');
  const r = mergeNeutralPatch({ text, insertBlock: newer, wantDefault: false, defaultBlock: DEFAULT_BLOCK });
  assert.match(r.text, /persona: can-v2/);
  assert.equal((r.text.match(/- id: preset-neutral/g) || []).length, 1);
});

ok('幂等：同样的输入跑两遍，第二遍不改', () => {
  const text = withMarker({ after: SETTINGS });
  const first = mergeNeutralPatch({ text, insertBlock: INSERT, wantDefault: false, defaultBlock: DEFAULT_BLOCK });
  const second = mergeNeutralPatch({ text: first.text, insertBlock: INSERT, wantDefault: false, defaultBlock: DEFAULT_BLOCK });
  assert.equal(second.changed, false);
  assert.equal(second.text, first.text);
});

ok('wantDefault：补一次，第二次不再补', () => {
  const text = withMarker({});
  const first = mergeNeutralPatch({ text, insertBlock: INSERT, wantDefault: true, defaultBlock: DEFAULT_BLOCK });
  assert.match(first.text, /default: neutral/);
  const second = mergeNeutralPatch({ text: first.text, insertBlock: INSERT, wantDefault: true, defaultBlock: DEFAULT_BLOCK });
  assert.equal(second.changed, false);
});

ok('设置页写过 default: neutral 时不重复插', () => {
  const text = withMarker({ after: DEFAULT_BLOCK });
  const r = mergeNeutralPatch({ text, insertBlock: INSERT, wantDefault: true, defaultBlock: DEFAULT_BLOCK });
  assert.equal((r.text.match(/- id: agent-preset-registry/g) || []).length, 1);
});

ok('B站眼睛：不给 --with-bili 就原样留着，不删', () => {
  const bili = ['- insert:', '    - id: mcp-bili-readonly', "      name: '@deepseek-ai/dsh-mcp-client'"].join('\n');
  const text = withMarker({ after: bili });
  const r = mergeNeutralPatch({ text, insertBlock: INSERT, wantDefault: false, defaultBlock: DEFAULT_BLOCK });
  assert.match(r.text, /- id: mcp-bili-readonly/);
});

ok('B站眼睛：给了 --with-bili 就用新的替换', () => {
  const old = ['- insert:', '    - id: mcp-bili-readonly', '      command: old'].join('\n');
  const fresh = ['- insert:', '    - id: mcp-bili-readonly', '      command: new'].join('\n');
  const text = withMarker({ after: old });
  const r = mergeNeutralPatch({ text, insertBlock: INSERT, wantDefault: false, defaultBlock: DEFAULT_BLOCK, biliBlock: fresh });
  assert.match(r.text, /command: new/);
  assert.equal((r.text.match(/- id: mcp-bili-readonly/g) || []).length, 1);
});

ok('BOM 留着；标记行之前的内容一个字不动', () => {
  const head = '- insert:\n    - id: keep-me\n      x: 1';
  const text = `\uFEFF${head}\n${NEUTRAL_MARKER}\n\n${INSERT}\n`;
  const r = mergeNeutralPatch({ text, insertBlock: INSERT, wantDefault: false, defaultBlock: DEFAULT_BLOCK });
  assert.equal(r.text.charCodeAt(0), 0xfeff);
  assert.ok(r.text.includes(head));
});

ok('顶层 id 一个不少（安全闸靠它）', () => {
  const text = withMarker({ before: '- insert:\n    - id: other-thing\n', after: SETTINGS });
  const r = mergeNeutralPatch({ text, insertBlock: INSERT, wantDefault: false, defaultBlock: DEFAULT_BLOCK });
  for (const id of ['other-thing', 'preset-neutral', 'agent-default-model']) {
    assert.ok(r.text.includes(`- id: ${id}`), id);
  }
});

console.log(`\nPASS test-neutral-patch（${n} 条）`);
