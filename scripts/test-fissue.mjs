#!/usr/bin/env node
'use strict';
/**
 * test-fissue.mjs -- fissue 账本规则 + 收件台 CLI 的测试。
 *
 * 分两层：纯函数（解析/折叠/校验/渲染）直接 import；CLI 用临时鱼塘跑一遍
 * （临时 config + 临时 group/messages.jsonl，绝不碰真鱼塘）。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  FIELD_LABELS,
  foldIssues,
  issueId,
  numOfId,
  padNum,
  parseFissueMessage,
  renderIndex,
  renderIssue,
  similarity,
  validateEvents,
} from './lib/fissue-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const FISSUE = join(HERE, 'fissue.mjs');

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  ok  ${name}`);
  } else {
    fail += 1;
    console.log(`  xx  ${name}${detail ? `：${detail}` : ''}`);
  }
}
function section(title) {
  console.log(`\n== ${title} ==`);
}

function fullMessage(title, extra = {}) {
  const values = {
    现象: '切 tab 后草稿复活',
    证据: '实机：删空 → 切私聊 → 切回群，原文又出现',
    期望: '删掉的就该不在了',
    验收: '刷新面板后删空 → 切走 → 切回，输入框应为空',
    前案: '搜过 messages.jsonl 没有同样描述',
    不确定: '不确定是不是只在有历史草稿时复现',
    ...extra,
  };
  const lines = [`fissue｜${title}`];
  for (const label of FIELD_LABELS) {
    if (values[label] === null) continue;
    lines.push(`${label}：${values[label]}`);
  }
  return lines.join('\n');
}

section('编号与展示');
ok('padNum(1) = 0001', padNum(1) === '0001');
ok('padNum(9999) = 9999', padNum(9999) === '9999');
ok('padNum(10000) = 10000（自动加宽，不截断）', padNum(10000) === '10000');
ok('issueId(7) = fi-0007', issueId(7) === 'fi-0007');
ok('numOfId 认 fi-0012 与 12', numOfId('fi-0012') === 12 && numOfId('12') === 12);
ok('numOfId 认不出就 null', numOfId('fi-x') === null && numOfId(null) === null);

section('投递解析');
const parsed = parseFissueMessage(fullMessage('草稿复活'));
ok('六格齐全 ok', parsed.ok === true, `missing=${parsed.missing.join('、')}`);
ok('标题取标记行', parsed.title === '草稿复活', parsed.title);
ok('六个小节都有值', FIELD_LABELS.length === 6 && FIELD_LABELS.every((l) => parsed.fields[l]), JSON.stringify(parsed.fields));
const missingPrior = parseFissueMessage(fullMessage('缺前案', { 前案: null }));
ok('缺「前案」→ 不收且点名', missingPrior.ok === false && missingPrior.missing.includes('前案'), missingPrior.missing.join('、'));
ok('没有标记 → 不收（missing=标记）', parseFissueMessage('随便一句话').missing[0] === '标记');
const halfColon = parseFissueMessage('fissue|半角冒号标题\n现象:值一\n证据:值二\n期望:值三\n验收:值六\n前案:值四\n不确定:值五');
ok('半角冒号与半角竖线都认', halfColon.ok === true && halfColon.title === '半角冒号标题', JSON.stringify(halfColon.missing));
const multi = parseFissueMessage('fissue｜多行值\n现象：第一行\n第二行还在现象里\n证据：证据\n期望：期望\n验收：验收\n前案：前案\n不确定：不确定');
ok('小节值可跨行', multi.fields['现象'] === '第一行\n第二行还在现象里', JSON.stringify(multi.fields['现象']));
ok('标题写成「标题：」也认', parseFissueMessage('fissue｜标题：被剥离\n现象：a\n证据：b\n期望：c\n验收：v\n前案：d\n不确定：e').title === '被剥离');

section('事件折叠');
const t0 = '2026-11-19T01:00:00.000Z';
const events = [
  { ev: 'open', num: 1, at: t0, from: 'xiaoman', title: '甲', msg: 42, fields: { 现象: 'p', 证据: 'e', 期望: 'x', 验收: 'v', 前案: 'f', 不确定: 'u' } },
  { ev: 'open', num: 2, at: t0, from: 'fishball', title: '乙', fields: { 现象: 'p', 证据: 'e', 期望: 'x', 验收: 'v', 前案: 'f', 不确定: 'u' } },
  { ev: 'assign', num: 1, at: t0, to: 'lee' },
  { ev: 'comment', num: 1, at: t0, from: 'lee', text: '收到' },
  { ev: 'merge', num: 2, at: t0, into: 1, why: '同一条' },
  { ev: 'close', num: 1, at: t0, by: 'lee', commit: 'abc1234', verify: '跑测试' },
  { ev: 'reject', at: t0, line: 9, from: 'whale', why: '缺 前案' },
];
const folded = foldIssues(events);
ok('两条 issue 都在', folded.issues.size === 2);
ok('fi-0001 被关闭且带证据', folded.issues.get(1).status === 'closed' && folded.issues.get(1).closed.commit === 'abc1234');
ok('fi-0002 记成了并入 fi-0001', folded.issues.get(2).mergedInto === 1 && folded.issues.get(2).status === 'closed');
ok('comment 收进讨论', folded.issues.get(1).comments.length === 1);
ok('reject 单独成列', folded.rejects.length === 1 && folded.rejects[0].line === 9);
ok('折叠无自洽问题', folded.problems.length === 0, folded.problems.join('；'));

section('事件流校验');
ok('完整事件流通过', validateEvents(events).ok === true, validateEvents(events).problems.join('；'));
// 2026-11-19：旧五格（缺验收）不判红；但缺硬栏仍判红。
const legacyOpen = [{ ev: 'open', num: 1, at: t0, title: '旧五格', fields: { 现象: 'p', 证据: 'e', 期望: 'x', 前案: 'f', 不确定: 'u' } }];
ok('旧五格（缺验收）不判红', validateEvents(legacyOpen).ok === true, validateEvents(legacyOpen).problems.join('；'));
const hardMissing = [{ ev: 'open', num: 1, at: t0, title: '缺现象', fields: { 证据: 'e', 期望: 'x', 验收: 'v', 前案: 'f', 不确定: 'u' } }];
ok('缺「现象」仍判红', validateEvents(hardMissing).problems.some((p) => p.includes('缺「现象」')));
const legacyPage = renderIssue(foldIssues(legacyOpen).issues.get(1), { generatedAt: '2026-11-19 09:00' });
ok('旧五格页面标出「验收」没写', legacyPage.includes('（没写；旧五格格式，开工前补一句可复算的验法）'));
const gap = [...events, { ev: 'open', num: 4, at: t0, title: '跳号', fields: { 现象: 'p', 证据: 'e', 期望: 'x', 验收: 'v', 前案: 'f', 不确定: 'u' } }];
ok('跳号被点名', validateEvents(gap).problems.some((p) => p.includes('不连续')), validateEvents(gap).problems.join('；'));
const noCommit = [{ ev: 'open', num: 1, at: t0, title: 't', fields: { 现象: 'p', 证据: 'e', 期望: 'x', 验收: 'v', 前案: 'f', 不确定: 'u' } }, { ev: 'close', num: 1, at: t0, by: 'lee', verify: 'x' }];
ok('close 没有 commit 被点名', validateEvents(noCommit).problems.some((p) => p.includes('没有 commit')));
const orphan = [{ ev: 'assign', num: 9, at: t0, to: 'lee' }];
ok('事件指向不存在的号被点名', foldIssues(orphan).problems.length > 0);

section('渲染');
const indexMd = renderIndex(folded, { generatedAt: '2026-11-19 09:00' });
ok('索引含编号与状态', indexMd.includes('fi-0001') && indexMd.includes('closed（并入 fi-0001）'));
ok('索引说明是生成物', indexMd.includes('别手改'));
const page = renderIssue(folded.issues.get(1), { generatedAt: '2026-11-19 09:00' });
ok('页面六节都在', FIELD_LABELS.every((l) => page.includes(`## ${l}`)));
ok('页面带关闭证据', page.includes('## 关闭证据') && page.includes('abc1234'));
ok('页面带来自与行号', page.includes('来自') && page.includes('群第 42 行'));

section('相似度只作提示');
ok('完全相同接近 1', similarity('草稿复活了', '草稿复活了') > 0.99);
ok('完全不同很低', similarity('草稿复活', '渲染慢') < 0.2);

section('CLI：临时鱼塘走一遍');
function makePond() {
  const tmp = mkdtempSync(join(tmpdir(), 'llw-fissue-'));
  const pond = join(tmp, 'pond');
  mkdirSync(join(pond, 'group'), { recursive: true });
  mkdirSync(join(pond, 'state'), { recursive: true });
  const cfgPath = join(tmp, 'config.json');
  writeFileSync(cfgPath, JSON.stringify({ poolDir: pond, poolStateDir: join(pond, 'state'), groupDir: join(pond, 'group') }, null, 2) + '\n', 'utf8');
  const messages = join(pond, 'group', 'messages.jsonl');
  const rec = (from, text) => JSON.stringify({ ts: Date.now(), from, to: 'lee', text }) + '\n';
  writeFileSync(
    messages,
    rec('lee', '普通聊天，不该被收') +
      rec('xiaoman', fullMessage('第一条：草稿复活')) +
      rec('fishball', 'fissue｜缺栏的一条\n现象：只有现象') +
      rec('whale', fullMessage('第二条：渲染慢', { 现象: '长列表滚动掉帧' })),
    'utf8',
  );
  return { tmp, pond, cfgPath, messages };
}
function runClI(args, cfgPath) {
  const r = spawnSync(process.execPath, [FISSUE, ...args], {
    env: { ...process.env, LIL_WHALE_CONFIG: cfgPath },
    encoding: 'utf8',
  });
  return { code: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}` };
}

const t = makePond();
const scan = runClI(['scan'], t.cfgPath);
ok('scan 退出 0', scan.code === 0, scan.out);
ok('scan 收到两条、退回一条', /新收 2 条，退回 1 条/u.test(scan.out), scan.out);
const issuesFile = join(t.pond, 'fissue', 'issues.jsonl');
const lines = readFileSync(issuesFile, 'utf8').trim().split(/\r?\n/u);
ok('事件流 = 2 open + 1 reject', lines.length === 3 && lines.filter((l) => l.includes('"open"')).length === 2 && lines.filter((l) => l.includes('"reject"')).length === 1);
ok('INDEX.md 生成', existsSync(join(t.pond, 'fissue', 'INDEX.md')));
ok('open 页两页', existsSync(join(t.pond, 'fissue', 'open', 'fi-0001.md')) && existsSync(join(t.pond, 'fissue', 'open', 'fi-0002.md')));
const again = runClI(['scan'], t.cfgPath);
ok('再扫不重复收', /新收 0 条，退回 0 条/u.test(again.out), again.out);
const list = runClI(['list'], t.cfgPath);
ok('list 显示两条与“没在做”', list.out.includes('fi-0001') && list.out.includes('fi-0002') && list.out.includes('没在做'), list.out);
const claim = runClI(['claim', 'fi-0001'], t.cfgPath);
ok('claim 成功', claim.code === 0 && claim.out.includes('claim fi-0001'), claim.out);
const claim2 = runClI(['claim', 'fi-0002'], t.cfgPath);
ok('已有在做时第二条 claim 被拒', claim2.code === 1 && claim2.out.includes('已经有在做的一条'), claim2.out);
const closeNoCommit = runClI(['close', 'fi-0001', '--verify', '看了'], t.cfgPath);
ok('close 缺 commit 被拒', closeNoCommit.code === 1 && closeNoCommit.out.includes('--commit'), closeNoCommit.out);
const closeOk = runClI(['close', 'fi-0001', '--commit', 'abc1234', '--verify', '刷 3080 复现三遍'], t.cfgPath);
ok('close 成功', closeOk.code === 0, closeOk.out);
ok('关闭后页面搬到 closed/', existsSync(join(t.pond, 'fissue', 'closed', 'fi-0001.md')) && !existsSync(join(t.pond, 'fissue', 'open', 'fi-0001.md')));
const check = runClI(['check'], t.cfgPath);
ok('check 绿', check.code === 0 && check.out.includes('ok fissue'), check.out);
appendFileSync(issuesFile, 'this is not json\n', 'utf8');
const bad = runClI(['check'], t.cfgPath);
ok('坏行让 check 变红（exit 1）', bad.code === 1 && bad.out.includes('不是 JSON'), bad.out);

section('CLI：merge 与 reopen');
const t2 = makePond();
runClI(['scan'], t2.cfgPath);
const merge = runClI(['merge', 'fi-0002', '--into', 'fi-0001', '--why', '同一条'], t2.cfgPath);
ok('merge 成功', merge.code === 0, merge.out);
const mergedList = runClI(['list'], t2.cfgPath);
ok('merge 后 fi-0002 显示并入', mergedList.out.includes('closed（并入 fi-0001）') || mergedList.out.includes('→ fi-0001'), mergedList.out);
const reopen = runCli2(t2.cfgPath);
function runCli2(cfgPath) {
  return runClI(['reopen', 'fi-0002', '--why', '又出现了'], cfgPath);
}
ok('reopen 成功', reopen.code === 0, reopen.out);
ok('reopen 后回到 open 页', existsSync(join(t2.pond, 'fissue', 'open', 'fi-0002.md')));

console.log(`\ntest-fissue：合计 ${pass + fail}，PASS ${pass}，FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
