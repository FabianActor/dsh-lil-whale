// 卡住要说话（2026-11-23，fi-0016 / GitHub #1）。
//
// 场景：鱼在私聊里接到一句要动手的话，跑到需要审批的工具（plan mode 的
// exit_plan_mode、sandbox 写权限、ask_user_question），审批弹在它自己的
// WebUI 里。群/私聊这一侧从此没有任何动静：面板照旧「在跑」，通道里一片安静。
// 从通道看，「她卡住了」和「她不理你」长得一模一样。
//
// 这一版只做能给的那一档，不碰审批本身：
//   - 判据是启发式：这一轮还忙，而她的会话文件已经 N 分钟没有新写入
//     ⇒ 说「可能在等审批或等回答」，措辞必须带「可能」。
//     （不能只看「投递后有没有长过」：她先写了一句、再去点审批，文件就不再动了；
//      所以看的是最后一次写入离现在多久，投递只提供「她在回你」这个上下文。）
//   - 不在通道里替她说话，也不叫醒任何人：只由通道侧写一条系统行给人看。
//   - 只在投递之后判；没有投递就没有「她在回你」这个上下文，宁可不报。
//
// 为什么不用「忙」当唯一依据：长时间思考、慢模型、卡住的工具调用都会显示忙。
// 为什么不用「审批队列」：dsh 没有把 pending-interaction 落到可读的地方，
// 靠超时猜是这一档的已知代价。

export const STALL_AFTER_MS = 4 * 60 * 1000; // 投递后 4 分钟还没有新写入，才开始怀疑
export const STALL_MAX_MS = 60 * 60 * 1000; // 超过一小时不再报：那已经不是「在等一次点击」

/**
 * 判这一段算不算「可能卡住」。
 *
 * @param {object} input
 * @param {number} input.now 现在的毫秒时间戳
 * @param {number|null} input.deliveredAt 这次投递的毫秒时间戳（没有投递就传 null）
 * @param {number|null} input.sessionMtime 会话日志文件的 mtime（读不到传 null）
 * @param {string|null} input.agentStatus 宿主给的 agent 状态（'idle' / 'busy' / 其它）
 * @returns {{kind: 'none'|'idle'|'working'|'stalled'|'too-old', ageSec: number, lastAt: number|null}}
 */
export function classifyStall(input = {}) {
  const { now, deliveredAt, sessionMtime, agentStatus } = input;
  if (!Number.isFinite(deliveredAt)) return { kind: 'none', ageSec: 0, lastAt: null };
  const at = Number.isFinite(now) ? now : Date.now();
  const ageMs = Math.max(0, at - deliveredAt);
  const ageSec = Math.round(ageMs / 1000);
  // 最后一次动静：投递时刻与会话文件 mtime 里更晚的那个。
  const lastAt = Number.isFinite(sessionMtime) ? Math.max(deliveredAt, sessionMtime) : deliveredAt;
  const quietMs = Math.max(0, at - lastAt);
  if (ageMs > STALL_MAX_MS) return { kind: 'too-old', ageSec, lastAt };
  if (agentStatus === 'idle') return { kind: 'idle', ageSec, lastAt };
  // 最近 N 分钟内还写过：哪怕很慢，也算在动。
  if (quietMs < STALL_AFTER_MS) return { kind: 'working', ageSec, lastAt };
  return { kind: 'stalled', ageSec, lastAt };
}

/** 本地 HH:MM（不引时区，只给人看）。 */
export function hhmmOf(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 给人看的系统行。它明确是「系统」，并且明确只是「可能」。
 * @param {{label:string, port:number|string, since:number}} input
 */
export function stallSentenceOf({ label, port, since }) {
  const who = typeof label === 'string' && label.trim() !== '' ? label.trim() : '她';
  const url = port === undefined || port === null || port === '' ? '' : `http://127.0.0.1:${port}/`;
  const tail = url === '' ? '去她自己的 WebUI 看一眼。' : `去 ${url} 看一眼，点一下就好。`;
  return `【系统】${who} 可能在等审批或等回答（自 ${hhmmOf(since)} 起没有新动静）。${tail}`;
}
