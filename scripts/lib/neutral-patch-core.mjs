// 补 neutral preset 时，"标记行之后"哪些段是脚本自己生成的、哪些是别人写进去的（issue #10）。
//
// 背景：apply-neutral-preset.mjs 一直把标记行之后整段都当成"上次自己生成的"，切掉重写。
// 而设置页、`dsh plugin add`、早先手写的段也可能落在标记行之后——它们会在一次重跑里静默消失：
// 本机 2026-11-27 实测 203 行 → 186 行，`agent-default-model` / `ui-settings-general` /
// `agent-preset-registry` 三段没了，boot 行的 cfgProvider 变 unknown，而 doctor 全过。
//
// 这个模块只做切分与拼装，不碰文件、不跑 dsh，所以能被测试直接喂字符串。
//
// 顶层段 = 一行以 `- ` 开头（列 0）；段前紧挨着的注释/空行算这一段的"头"，
// 跟着段一起搬（否则每跑一次注释就往上飘一行）。

/** 生成段的标记行；与 apply-neutral-preset.mjs 里那个常量是同一个字符串。 */
export const NEUTRAL_MARKER = '# ---- 以下由 scripts/apply-neutral-preset.mjs 追加 ----';

/** 只有这些 id 的段是脚本生成、可以丢弃重建的。其余一律保留。 */
export const GENERATED_IDS = ['preset-neutral', 'mcp-bili-readonly'];

function idsIn(chunkText) {
  const out = [];
  const re = /^\s*-\s*id:\s*(\S+)\s*$/gm;
  let m;
  while ((m = re.exec(chunkText))) out.push(m[1]);
  return out;
}

/**
 * 把标记行之后的尾巴切成顶层段。
 * 返回 [{ ids, generated, text }]；`text` 含段前注释，去掉了首尾空行。
 */
export function splitTailChunks(tail) {
  const lines = String(tail).split(/\r?\n/);
  const chunks = [];
  let pending = []; // 段前的注释/空行
  let cur = null;
  const flush = () => {
    if (!cur) return;
    while (cur.length && cur[cur.length - 1].trim() === '') cur.pop();
    while (cur.length && cur[0].trim() === '') cur.shift();
    const text = cur.join('\n');
    if (text.trim()) {
      const ids = idsIn(text);
      chunks.push({ ids, generated: ids.some((id) => GENERATED_IDS.includes(id)), text });
    }
    cur = null;
  };
  for (const line of lines) {
    if (line.startsWith('- ')) {
      flush();
      cur = [...pending, line];
      pending = [];
      continue;
    }
    if (cur) cur.push(line);
    else pending.push(line);
  }
  flush();
  return chunks;
}

/**
 * 重写 patch：保留别人的段，重建自己的段。
 *
 * @param {object} p
 * @param {string} p.text            现在的 patch 全文（可带 BOM）
 * @param {string} p.insertBlock     生成器产出的 `- insert:` 段（含 preset-neutral）
 * @param {boolean} p.wantDefault    要不要把默认 preset 改成 neutral
 * @param {string} p.defaultBlock    `- id: agent-preset-registry … default: neutral` 段
 * @param {string|null} p.biliBlock  `--with-bili` 给的段；不给就沿用文件里已有的那份
 * @param {string} p.marker
 * @returns {{ text: string, added: string[], dropped: string[], kept: string[], changed: boolean }}
 */
export function mergeNeutralPatch({ text, insertBlock, wantDefault, defaultBlock, biliBlock = null, marker = NEUTRAL_MARKER }) {
  const bom = String(text).charCodeAt(0) === 0xfeff ? '\uFEFF' : '';
  const body = bom ? String(text).slice(1) : String(text);
  const at = body.indexOf(marker);
  const head = at >= 0 ? body.slice(0, at) : body;
  const tail = at >= 0 ? body.slice(at + marker.length) : '';

  // 生成段丢掉；别人的段留着。B站那段只有在这次明确给了 --with-bili 时才重建。
  const chunks = splitTailChunks(tail);
  const kept = [];
  const dropped = [];
  for (const c of chunks) {
    const isOurs = c.generated && (c.ids.includes('mcp-bili-readonly') ? Boolean(biliBlock) : true);
    if (isOurs) dropped.push(...c.ids);
    else kept.push(c);
  }
  const keptText = kept.map((c) => c.text).join('\n\n');

  // "已有"要在 保留段 + 标记行之前 的范围里判断：别人的段也算数，别重复插一份。
  const scope = `${head}\n${keptText}`;
  const hasPreset = /^\s*-\s*id:\s*preset-neutral\s*$/m.test(scope);
  const hasDefaultNeutral = /^\s*default:\s*neutral\s*$/m.test(scope);

  const additions = [];
  if (!hasPreset) additions.push(insertBlock);
  if (wantDefault && !hasDefaultNeutral) additions.push(defaultBlock);
  if (biliBlock) additions.push(biliBlock);

  const headText = head.replace(/\n+$/, '');
  const parts = [];
  if (headText.trim()) parts.push(headText);
  parts.push(marker);
  const ours = additions.join('\n\n');
  if (ours.trim()) parts.push(ours);
  let next = parts.join('\n\n').replace(/\n+$/, '') + '\n';
  if (keptText.trim()) next += `\n${keptText}\n`;

  return {
    text: bom + next,
    added: additions.length ? ['(generated)'] : [],
    dropped,
    kept: kept.map((c) => c.ids[0] || '(anonymous)'),
    changed: next !== body,
  };
}
