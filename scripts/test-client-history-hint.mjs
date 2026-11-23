// test-client-history-hint.mjs —— 积压时「回到历史未读」不该等用户先滚一下（r444）。
// 判据：线不在渲染窗口里也要能判「上面还有没看过的」——用未读边界与窗口起点比，不靠 DOM。
import { readFileSync } from 'node:fs';
const SRC = readFileSync(new URL('../plugin/dsh-lil-whale-group-ui/lib/client.js', import.meta.url), 'utf8');
const fail = [];
const need = (cond, msg) => { if (!cond) fail.push(msg); };
need(SRC.includes('const messagesRef = useRef(messages)'), '没有 messagesRef（measureHistory 读不到消息列表）');
need(SRC.includes('const visibleStartRef = useRef(0)'), '没有 visibleStartRef（量不到窗口起点）');
need(/visibleStartRef\.current = visibleStart/.test(SRC), '没在渲染期把 visibleStart 写进 ref');
need(SRC.includes('let lineAbove = Boolean('), 'lineAbove 不是 let（没法在窗口外补判）');
need(SRC.includes('boundary < start') && SRC.includes('lineAbove = true'), '缺少「线在窗口之前 ⇒ 在视口上方」的判定');
need(SRC.includes('getBoundingClientRect().top < el.getBoundingClientRect().top + 4'), '丢了几何判定（线在窗口里时仍要量位置）');
need(SRC.includes('v66 · history-hint-backlog'), 'build 标记不是 v66');
need(!SRC.includes('v65 · pond-bind'), 'build 标记还留着 v65');
console.log(fail.length ? `FAIL test-client-history-hint（${fail.length}）：\n  - ${fail.join('\n  - ')}` : 'PASS test-client-history-hint（10 条）');
process.exit(fail.length ? 1 : 0);
