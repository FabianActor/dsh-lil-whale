#!/usr/bin/env node
/**
 * test-run-state.mjs — 上一轮收没收尾，用什么判、写成什么名（r348）。
 *
 * 背景（小肥鱼 2026-11-18 私聊第 45 行）：同一天两条"重启"记录，
 *   runs\<鱼>.log 里 19:16:44 有 stopped、watchman.log 里 19:17:22 写 resumed reason=unclean。
 * 不是谁写重了，是**两本账在记两个不同的进程**（fish.ps1 停的是鱼、巡守自己没留收尾）。
 * 而且 watchman.log 全史 resumed=97、stopped=1 ⇒ 这个字段几乎每次启动都亮：
 * 恒亮的字段不携带"上次是不是崩了"的信息，它说的是"这里没人留收尾行"——那是结构，不是事故。
 * 所以 r348 把判断依据换成自己的 runs 账（有 stopped ⇒ closed），并把字段名改成
 * `no-stop-record`（字段名要说它回答什么，不要说"崩了"）。
 *
 * 这个测试守四件事：
 *   1. 新行写 `reason=no-stop-record`，不再写 `reason=unclean`；
 *   2. 巡守那一支复用块 3 取好的 `previousRun`（不能在本轮 started 之后再读同一份账，否则永远 open）；
 *   3. 读端两种拼法都认（历史行不改，读的人不能只认新名）；
 *   4. 旧函数 `lastRunState()`（读 watchman.log 判主语）已经删掉，别让两条判据重新打架。
 *
 * 跑法：node scripts/test-run-state.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'plugin', 'dsh-lil-whale-group', 'lib', 'index.js'), 'utf8').replace(/\r\n/g, '\n');

let pass = 0;
const fails = [];
function ok(name, cond, detail = '') {
  if (cond) pass += 1;
  else fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

// 1. 写入侧：两条 resumed 都写新名，且不再写旧名
const runResumed = SRC.split('\n').filter((line) => line.includes("runLog(self, 'resumed'"));
const watchResumed = SRC.split('\n').filter((line) => line.includes("watchmanLog('resumed'"));
ok('runs 账：resumed 行存在', runResumed.length === 1, `找到 ${runResumed.length} 行`);
ok('runs 账：resumed 写 no-stop-record', runResumed.every((line) => line.includes('reason=no-stop-record')), runResumed.join(' | '));
ok('runs 账：resumed 不再写 unclean', runResumed.every((line) => !line.includes('reason=unclean')), runResumed.join(' | '));
ok('watchman 账：resumed 行存在', watchResumed.length === 1, `找到 ${watchResumed.length} 行`);
ok('watchman 账：resumed 写 no-stop-record', watchResumed.every((line) => line.includes('reason=no-stop-record')), watchResumed.join(' | '));
ok('watchman 账：resumed 不再写 unclean', watchResumed.every((line) => !line.includes('reason=unclean')), watchResumed.join(' | '));

// 2. 巡守那一支必须复用块 3 取好的状态（否则读到自己刚写的 started，永远 open）
ok('块 3 存了 previousRun', SRC.includes('let previousRun = null') && SRC.includes('previousRun = lastRun'));
ok('巡守支用 previousRun', SRC.includes('const lastRun = previousRun'));
const watcherReadIndex = SRC.indexOf('const lastRun = previousRun');
const watcherNullSafe = SRC.slice(watcherReadIndex, watcherReadIndex + 400).includes("lastRun === null || lastRun.closed === null");
ok('巡守支对 null 安全（变量在块外声明）', watcherNullSafe);

// 3. 读端两种都认（历史行不改）
const readerStart = SRC.indexOf('function lastNoStopRecordOf');
ok('读端函数改名了', readerStart > 0);
const reader = readerStart > 0 ? SRC.slice(readerStart, readerStart + 800) : '';
ok('读端认新名 no-stop-record', reader.includes("reason=no-stop-record"));
ok('读端也认旧名 unclean', reader.includes("reason=unclean"));
ok('读端先筛 resumed 行', reader.includes("includes('| resumed |')"));
ok('crash 告警用的是读端', SRC.includes('lastNoStopRecordOf(member.key)'));

// 4. 旧的"读 watchman.log 判主语"已经退休
ok('旧函数 lastRunState() 已删', !SRC.includes('function lastRunState()'));
ok('再没有地方调 lastRunState()', !/lastRunState\(\)/.test(SRC));

// 5. 结论写进 started 的行（prev-run 三态保留）
ok('started 行仍写 prev-run=', SRC.includes('prev-run=${prevText}'));
ok('prev-run 三态保留', SRC.includes("'unknown' : lastRun.closed ? 'closed' : 'open'") || SRC.includes(": lastRun.closed ? 'closed' : 'open'"));

console.log(`test-run-state：合计 ${pass + fails.length}，PASS ${pass}，FAIL ${fails.length}`);
for (const fail of fails) console.log(`  xx ${fail}`);
process.exit(fails.length === 0 ? 0 : 1);
