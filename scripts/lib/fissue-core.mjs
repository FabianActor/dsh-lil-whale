// fissue-core.mjs -- fissue（鱼群内 issue）的账本规则。纯函数，不碰文件。
//
// 为什么要这套东西（宿主 2026-11-19 定）：
// 之前 bug 从各处冒出来——群里、私聊、我自己的测试——收件人只有我一个，
// 而我在同一段时间里既要读、又要判断、又要修，于是"这条我回过了吗"只能靠记性。
// fissue 把"收"和"做"分开：**进账归我，动手一次只做一条**（池里 current.json 只许一个）。
//
// 账的形状：
//   `pool\fissue\issues.jsonl`  只追加的事件流（open / assign / comment / close / reopen / merge / reject）
//   状态、页面、索引都从事件流现算（投影可以重生成，事件不可以改）。
//
// 编号：账里存整数 `num`，展示才补零成 `fi-0001`；超过 9999 自动变 `fi-10000`。
// **排序、比较、计数一律用 num** —— 字符串排序会让 fi-10000 排在 fi-9999 前面（宿主 2026-11-19 拍板）。
//
// 投递格式（鱼在群里发一行，收件人扫描）：
//   fissue｜<一句话标题>
//   现象：...
//   证据：...
//   期望：...
//   前案：...
//   不确定：...
// 六格齐全才收；缺哪格退回并记 `reject`（缺栏也是事实，不能悄悄丢）。

export const FISSUE_FMT = 1;

/** 行首标记：`fissue｜`，全角/半角竖线与冒号都认，前面允许多余空格。 */
// 故意不带 `$`：标记只占第一行开头，后面哪怕跟很多行内容也应当被认出来
// （2026-11-19 测试抓到的：带 `$` 时 `test()` 对多行正文直接 false，而 `exec(第一行)` 又能过）。
export const MARKER_RE = /^[ \t>]*(?:\*\*|__)?[ \t]*fissue[ \t]*[｜|:：]/u;

/** 五个必填小节的标签（标题从标记行取，不在这里）。 */
// 2026-11-19：第二条鱼与第五条鱼同一天提「缺一格验收」——判据要能被别人复算。
// 验收 = 一行命令 + 一行预期输出（或说明为什么跑不了、看哪里）；写不出验法往往说明期望还没想清。
export const FIELD_LABELS = ['现象', '证据', '期望', '验收', '前案', '不确定'];

/** 编号补零：4 位起，超过就自然变宽（不截断）。 */
export function padNum(n) {
  const s = String(n);
  return s.length >= 4 ? s : s.padStart(4, '0');
}

/** 整数 -> 展示用编号。 */
export function issueId(n) {
  return `fi-${padNum(n)}`;
}

/** `fi-0007` / `fi-7` / `7` -> 整数；认不出来返回 null（读入时别猜）。 */
export function numOfId(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  const m = /^(?:fi-)?(\d+)$/iu.exec(String(value ?? '').trim());
  return m ? Number(m[1]) : null;
}

/** 粗略相似度（字符二元组 Jaccard），只用来**提示**可能重复，不做合并判断。 */
export function similarity(a, b) {
  const grams = (s) => {
    const t = String(s ?? '').replace(/\s+/gu, '');
    const out = new Set();
    for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2));
    return out;
  };
  const A = grams(a);
  const B = grams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit++;
  return hit / (A.size + B.size - hit);
}

/**
 * 解析一条群消息里的 fissue 投递。
 * 返回 { ok, title, fields, missing, marker }：
 *   ok=false 时 missing 说清缺哪几栏（标题缺记 '标题'）。
 * 小节的值可以跨行，一直到下一个"标签："行。
 */
export function parseFissueMessage(text) {
  const lines = String(text ?? '').split(/\r?\n/u);
  const firstLine = lines[0] ?? '';
  const first = MARKER_RE.exec(firstLine);
  if (!first) return { ok: false, title: '', fields: {}, missing: ['标记'], marker: null };

  // 标题：标记行剩下的部分；也容忍再写一个"标题："。
  let title = firstLine
    .slice(first[0].length)
    .trim()
    .replace(/^标题[ \t]*[：:][ \t]*/u, '')
    .replace(/\s*(?:\*\*|__)\s*$/u, '')
    .trim();

  const fields = {};
  let current = null;
  // 2026-11-19 r389：标签可以整段加粗（`**现象**：…`、`**现象：** …`），空格/下划线两种都认。
  const labelRe = new RegExp(
    `^[ \\t]*(?:\\*\\*|__)?[ \\t]*(${FIELD_LABELS.join('|')})[ \\t]*(?:\\*\\*|__)?[ \\t]*[：:][ \\t]*(?:\\*\\*|__)?[ \\t]*(.*)$`,
    'u',
  );
  for (const raw of lines.slice(1)) {
    const line = raw.replace(/\r$/u, '');
    const m = labelRe.exec(line);
    if (m) {
      current = m[1];
      fields[current] = m[2].trim().replace(/\\s*(?:\\*\\*|__)\\s*$/u, '').trim();
      continue;
    }
    if (current && line.trim()) {
      fields[current] = `${fields[current] ? fields[current] + '\n' : ''}${line.trim()}`;
    }
  }

  const missing = [];
  if (!title) missing.push('标题');
  for (const label of FIELD_LABELS) {
    if (!String(fields[label] ?? '').trim()) missing.push(label);
  }
  return { ok: missing.length === 0, title, fields, missing, marker: first[0] };
}

/**
 * 事件流 -> 每条 issue 的状态。
 * 返回 { issues: Map<num, issue>, rejects: [], problems: [] }。
 * problems 是"账自己不自洽"的地方（例如重复 open、close 没有证据）；check 用。
 */
export function foldIssues(events) {
  const issues = new Map();
  const rejects = [];
  const problems = [];

  // 先建 open（顺序无关，重复会被点出来）
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    if (ev.ev === 'reject') {
      rejects.push(ev);
      continue;
    }
    if (ev.ev !== 'open') continue;
    const num = ev.num;
    if (!Number.isInteger(num) || num <= 0) {
      problems.push(`open 的 num 不是正整数：${JSON.stringify(ev).slice(0, 120)}`);
      continue;
    }
    if (issues.has(num)) {
      problems.push(`${issueId(num)} 重复 open`);
      continue;
    }
    issues.set(num, {
      num,
      id: issueId(num),
      status: 'open',
      title: String(ev.title ?? ''),
      fields: ev.fields && typeof ev.fields === 'object' ? { ...ev.fields } : {},
      from: String(ev.from ?? ''),
      at: String(ev.at ?? ''),
      msg: Number.isInteger(ev.msg) ? ev.msg : null,
      events: [ev],
      comments: [],
      assignee: null,
      closed: null,
      mergedInto: null,
      problems: [],
    });
  }

  // 再按顺序应用其余事件
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    if (ev.ev === 'open' || ev.ev === 'reject') continue;
    const num = ev.num;
    const it = issues.get(num);
    if (!it) {
      problems.push(`${ev.ev} 指向不存在的 ${issueId(num ?? 0)}（没有 open）`);
      continue;
    }
    it.events.push(ev);
    switch (ev.ev) {
      case 'assign':
        it.assignee = String(ev.to ?? ev.by ?? '');
        break;
      case 'comment':
        it.comments.push({ at: String(ev.at ?? ''), from: String(ev.from ?? ''), text: String(ev.text ?? '') });
        break;
      case 'close':
        it.status = 'closed';
        it.closed = {
          at: String(ev.at ?? ''),
          by: String(ev.by ?? ''),
          commit: String(ev.commit ?? ''),
          verify: String(ev.verify ?? ''),
          note: String(ev.note ?? ''),
        };
        break;
      case 'reopen':
        it.status = 'open';
        it.closed = null;
        break;
      case 'merge':
        it.status = 'closed';
        it.mergedInto = numOfId(ev.into);
        break;
      default:
        it.problems.push(`未知事件 ${String(ev.ev)}`);
    }
  }

  // merge 的目标必须存在且不是自己
  for (const it of issues.values()) {
    if (it.mergedInto === null) continue;
    if (!issues.has(it.mergedInto)) {
      problems.push(`${it.id} 并入了不存在的 ${issueId(it.mergedInto)}`);
    }
  }

  return { issues, rejects, problems };
}

/**
 * 校验事件流本身（不依赖投影）。
 * 返回 { ok, problems }。check 命令与测试共用。
 */
export function validateEvents(events) {
  const problems = [];
  if (!Array.isArray(events)) return { ok: false, problems: ['事件流不是数组'] };

  const openNums = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || typeof ev !== 'object' || !ev.ev) {
      problems.push(`第 ${i + 1} 个事件没有 ev 字段`);
      continue;
    }
    if (!['open', 'assign', 'comment', 'close', 'reopen', 'merge', 'reject'].includes(ev.ev)) {
      problems.push(`第 ${i + 1} 个事件类型不认识：${ev.ev}`);
      continue;
    }
    if (ev.ev === 'reject') {
      if (!Number.isInteger(ev.line) || ev.line <= 0) problems.push(`第 ${i + 1} 个 reject 缺 line`);
      continue;
    }
    if (!Number.isInteger(ev.num) || ev.num <= 0) {
      problems.push(`第 ${i + 1} 个 ${ev.ev} 的 num 不是正整数`);
      continue;
    }
    if (ev.ev === 'open') {
      openNums.push(ev.num);
      if (!String(ev.title ?? '').trim()) problems.push(`${issueId(ev.num)} 的 open 没有标题`);
      // 2026-11-19：「验收」是后来加的第六格；旧五格（缺验收）不该让 check 判红。
      // 缺验收只在页面上标注、开工前要一句验法——这是软缺；其余五格仍是硬缺。
      for (const label of FIELD_LABELS) {
        if (label === '验收') continue;
        if (!String(ev.fields?.[label] ?? '').trim()) problems.push(`${issueId(ev.num)} 缺「${label}」`);
      }
    }
    if (ev.ev === 'close') {
      if (!String(ev.commit ?? '').trim()) problems.push(`${issueId(ev.num)} 的 close 没有 commit`);
      if (!String(ev.verify ?? '').trim()) problems.push(`${issueId(ev.num)} 的 close 没有验证`);
    }
    if (ev.ev === 'merge' && !numOfId(ev.into)) {
      problems.push(`${issueId(ev.num)} 的 merge 没有 into`);
    }
  }

  // 编号从 1 开始、连续、不重复
  const sorted = [...openNums].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i + 1) {
      problems.push(`open 的编号不连续：期望 ${issueId(i + 1)}，实际 ${issueId(sorted[i])}（从 1 起、不许跳号）`);
      break;
    }
  }
  const dup = sorted.filter((n, i) => i > 0 && sorted[i - 1] === n);
  if (dup.length > 0) problems.push(`重复 open：${[...new Set(dup)].map(issueId).join('、')}`);

  return { ok: problems.length === 0, problems };
}

/** 展示用：状态一栏的写法（merge 要说清去哪了，不然像凭空关掉）。 */
export function statusLabel(issue) {
  if (!issue) return 'missing';
  if (issue.status === 'open') return 'open';
  if (issue.mergedInto !== null) return `closed（并入 ${issueId(issue.mergedInto)}）`;
  return 'closed';
}

/** 生成 INDEX.md。确定性输出：同样的状态与时间，永远同一份（测试可比）。 */
export function renderIndex(folded, { generatedAt = '' } = {}) {
  const rows = [...folded.issues.values()].sort((a, b) => a.num - b.num);
  const out = [
    '# fissue 索引',
    '',
    '> 生成物，别手改。来源 `pool\\fissue\\issues.jsonl`（只追加的事件流）。',
    `> 生成于 ${generatedAt || '（未记时间）'}；编号 ` + '`fi-NNNN`，账里存整数、展示才补零。',
    '',
    '| 编号 | 状态 | 标题 | 来自 | 开于 |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const it of rows) {
    out.push(`| ${it.id} | ${statusLabel(it)} | ${mdCell(it.title)} | ${mdCell(it.from)} | ${mdCell(it.at)} |`);
  }
  if (rows.length === 0) out.push('| （还没有） | — | — | — | — |');
  out.push('');
  if (folded.rejects.length > 0) {
    out.push('## 退回的投递（缺栏）');
    out.push('');
    for (const r of folded.rejects) {
      out.push(`- 第 ${r.line ?? '?'} 行 · ${r.from ?? '?'} · ${r.why ?? ''}`);
    }
    out.push('');
  }
  return out.join('\n');
}

/** 生成单条 issue 的页面。时间用原样记录（不做时区换算）。 */
export function renderIssue(it, { generatedAt = '' } = {}) {
  const fields = it.fields ?? {};
  const out = [
    `# ${it.id} · ${it.title || '（没有标题）'}`,
    '',
    `- 状态：${statusLabel(it)}`,
    `- 来自：${it.from || '?'}${it.msg ? `（群第 ${it.msg} 行）` : ''}`,
    `- 开于：${it.at || '?'}`,
    `- 认领：${it.assignee || '（还没）'}`,
    `- 生成于：${generatedAt || '（未记时间）'}`,
    '',
  ];
  for (const label of FIELD_LABELS) {
    const raw = String(fields[label] ?? '').trim();
    // 老五格（2026-11-19 之前）没有「验收」：照收，但页面上把缺的那格标出来。
    const text = raw !== '' ? raw : (label === '验收' ? '（没写；旧五格格式，开工前补一句可复算的验法）' : '（没写）');
    out.push(`## ${label}`, '', text, '');
  }
  if (it.closed) {
    out.push('## 关闭证据', '', `- 提交：${it.closed.commit || '（没写）'}`, `- 验证：${it.closed.verify || '（没写）'}`, `- 备注：${it.closed.note || '（没写）'}`, `- 关闭人：${it.closed.by || '?'} · ${it.closed.at || '?'}`, '');
  }
  if (it.comments.length > 0) {
    out.push('## 讨论', '');
    for (const c of it.comments) out.push(`- ${c.at || '?'} · ${c.from || '?'}：${c.text}`, '');
  }
  out.push('## 经过', '');
  for (const ev of it.events) {
    const bits = Object.entries(ev)
      .filter(([k]) => !['ev', 'fields', 'title'].includes(k))
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`);
    out.push(`- ${ev.ev} · ${bits.join(' ')}`);
  }
  out.push('');
  return out.join('\n');
}

function mdCell(value) {
  return String(value ?? '').replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ').trim();
}
