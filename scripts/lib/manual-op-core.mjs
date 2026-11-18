/**
 * 人工操作的账（r342）。
 *
 * 背景：2026-11-18 19:29:50 手动删了 3 个过期的媒体缓存（18,117,679 B）。
 * 删之前只在聊天里说过，账上一行没留；事后第三条鱼核对目录时只能问
 * "这 18 MB 是谁清的"——"人做过但没记账"和"被人偷偷清了"事后长得一样。
 *
 * 机器自己做的动作（prune / rotate / 唤醒）由机器写账；
 * 人做的动作（手删、手搬、手改）由人在这里补一行。
 *
 * 一行一个动作，只追加、不修改：
 *   <本地时间> | manual-rm | fmt=1 by=<谁> removed=<几个> bytes=<多少字节> note=<做了什么/为什么>
 */

export const MANUAL_FMT = 1;
export const MANUAL_KINDS = ['manual-rm', 'manual-other'];

export function tsLocal(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

/** 接受 "2026-11-18 19:29:50"（本地时间）或任何 Date 能解析的 ISO 串；看不懂返回 null。 */
export function parseAt(text) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const s = text.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function countArg(value, name) {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} 必须是非负整数：${value}`);
  return n;
}

/** 纯格式化 + 校验；不合法就抛错（宁可写不进去，也不要写一行看不懂的账）。 */
export function formatManualOp({ ts, kind = 'manual-rm', by, removed = 0, bytes = 0, note } = {}) {
  const byText = String(by ?? '').trim();
  const noteText = String(note ?? '').trim();
  if (byText === '') throw new Error('缺少 by（谁做的）');
  if (noteText === '') throw new Error('缺少 note（做了什么、为什么）——空着不如不写');
  if (!MANUAL_KINDS.includes(kind)) throw new Error(`kind 只认 ${MANUAL_KINDS.join(' / ')}：${kind}`);
  if (/[\r\n]/.test(noteText)) throw new Error('note 里不要换行（一行一个动作）');
  if (noteText.includes('|')) throw new Error('note 里不要竖线（竖线是字段分隔符）');
  if (!ts || String(ts).trim() === '') throw new Error('缺少 ts');
  return `${String(ts).trim()} | ${kind} | fmt=${MANUAL_FMT} by=${byText} removed=${countArg(removed, 'removed')} bytes=${countArg(bytes, 'bytes')} note=${noteText}`;
}
