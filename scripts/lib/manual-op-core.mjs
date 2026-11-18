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

/**
 * 抛错时带上"这类错该怎么改"（r347，小鱼丸 2026-11-18 私聊）。
 *
 * 为什么不用一句通用 NEXT：字符集被拒时，通用 NEXT 会让人去找一个根本
 * 不存在的换行——提示指错了地方，比没有提示更浪费时间。hint 是给 CLI
 * 选 NEXT 用的，不是给人看的；message 自己必须能读。
 *
 * hint 取值：missing / charset / field / kind。
 */
function reject(message, hint) {
  const e = new Error(message);
  e.hint = hint;
  return e;
}

/** 纯格式化 + 校验；不合法就抛错（宁可写不进去，也不要写一行看不懂的账）。 */
export function formatManualOp({ ts, kind = 'manual-rm', by, removed = 0, bytes = 0, note } = {}) {
  const byText = String(by ?? '').trim();
  const noteText = String(note ?? '').trim();
  if (byText === '') throw reject('缺少 by（谁做的）', 'missing');
  if (noteText === '') throw reject('缺少 note（做了什么、为什么）——空着不如不写', 'missing');
  if (!MANUAL_KINDS.includes(kind)) throw reject(`kind 只认 ${MANUAL_KINDS.join(' / ')}：${kind}`, 'kind');
  // by 也是行内字段：换行能造出第二行，竖线能造出第二个 by（小鱼丸 2026-11-18 20:2x 实测两枪都进了账）。
  if (/[\r\n|]/.test(byText)) throw reject('by 里不要换行或竖线（它是一行账里的字段值）', 'field');
  if (!/^[A-Za-z0-9_.-]{1,32}$/.test(byText)) {
    throw reject(`by 只许字母/数字/下划线/点/连字符，1–32 位（中文、空格、换行都不行）：${byText}`, 'charset');
  }
  if (/[\r\n]/.test(noteText)) throw reject('note 里不要换行（一行一个动作）', 'field');
  if (noteText.includes('|')) throw reject('note 里不要竖线（竖线是字段分隔符）', 'field');
  if (!ts || String(ts).trim() === '') throw reject('缺少 ts', 'missing');
  const line = `${String(ts).trim()} | ${kind} | fmt=${MANUAL_FMT} by=${byText} removed=${countArg(removed, 'removed')} bytes=${countArg(bytes, 'bytes')} note=${noteText}`;
  // 最后一道：这一行必须正好是"两段竖线分隔、没有换行"——拼出来的东西再自己验一次。
  if (/\r|\n/.test(line)) throw reject('格式化结果是多行：有一个字段没洗干净', 'field');
  const bars = (line.match(/\|/g) || []).length;
  if (bars !== 2) throw reject(`格式化结果竖线数不对（期望 2，实际 ${bars}）：${line}`, 'field');
  return line;
}

/**
 * 末字节检查（r347）：追加账本前先确认"最后一行已经结束"。
 *
 * 为什么必须先查：追加式账本不能回滚。上一行没有换行结尾时直接 append，
 * 两条记录会粘成一行（写前 88 字节、写后 168 字节、行数只 +1 ⇒ 行数不变量
 * 也看不出问题），事后再修只能靠人。检查放在 append 之前，代价是一次 read。
 *
 * 不替人补换行：补一个 '\n' 不改已有内容，但它仍是"手改账本"这个动作，
 * 得由一个明确的命令去做（--fix-eof），而不是悄悄发生在记账路径里。
 */
export function endOfFileProblem(raw) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw ?? ''), 'utf8');
  if (buf.length === 0) return null;
  if (buf[buf.length - 1] === 0x0a) return null;
  return { bytes: buf.length, tail: buf.subarray(Math.max(0, buf.length - 24)).toString('utf8') };
}

