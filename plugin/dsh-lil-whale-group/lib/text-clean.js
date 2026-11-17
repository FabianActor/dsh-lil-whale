// 账本里的每个字节都要能被印出来（第四条鱼 #1014，2026-11-17）。
//
// 现场：一条群消息里 markdown 的 `b 被 PowerShell 双引号 here-string 当成了退格符（0x08），
// 落盘后显示成 "undles=" —— 一个"合法但少一个字符"的字段名，按字段读的脚本不会报错。
//
// 规则：C0 控制字符（除换行）与 DEL 一律换成可见占位 <0xNN>；换行保留（一条消息可以多行）。
//
// 2026-11-17 第四条鱼补两句（#1016）：扫字节之前先问"它是不是本来就不是文本"——
// UTF-16LE 的 "no" 是 6e 00 6f 00，按 UTF-8 读就是一片 NUL，那不是坏字节，是读法不对。
// 所以这里既给字符级的 printableText，也给字节级的 encodingOf / scanBytes。
const UNPRINTABLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function printableText(value) {
  if (typeof value !== 'string') return value;
  return value.replace(
    UNPRINTABLE,
    (ch) => '<0x' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0') + '>',
  );
}

export function countUnprintable(value) {
  if (typeof value !== 'string') return 0;
  const m = value.match(UNPRINTABLE);
  return m ? m.length : 0;
}

/**
 * 猜一个 Buffer 的编码。只为"扫之前先分清楚文本还是二进制/UTF-16"这一件事，
 * 不是通用编码识别器：能认 BOM、能认"偶数位/奇数位大量 0x00"这两种最常见的情况。
 */
export function encodingOf(buf) {
  if (!buf || buf.length === 0) return 'empty';
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'utf-8-bom';
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 'utf-16le-bom';
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return 'utf-16be-bom';
  const n = Math.min(buf.length, 512);
  let pairs = 0;
  let zerosEven = 0;
  let zerosOdd = 0;
  for (let i = 0; i + 1 < n; i += 2) {
    pairs += 1;
    if (buf[i] === 0) zerosEven += 1;
    if (buf[i + 1] === 0) zerosOdd += 1;
  }
  if (pairs >= 2 && zerosOdd / pairs > 0.6) return 'utf-16le';
  if (pairs >= 2 && zerosEven / pairs > 0.6) return 'utf-16be';
  return 'utf-8';
}

/**
 * 扫一段字节里有没有"不可打印字符"。
 * 返回 { encoding, decoded, unprintable: [{ index, char, code }] }；
 * UTF-16 会先解码再扫——这样 NUL 是编码差异，不会被当成内容坏了。
 */
export function scanBytes(buf) {
  const encoding = encodingOf(buf);
  if (encoding === 'empty') return { encoding, decoded: '', unprintable: [] };
  if (encoding === 'utf-16le-bom' || encoding === 'utf-16be-bom') {
    // 用 Node 的 TextDecoder（buf 可能是 Buffer 或 Uint8Array）
    try {
      const view = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      const decoded = new TextDecoder(encoding === 'utf-16le-bom' ? 'utf-16le' : 'utf-16be').decode(view);
      return { encoding, decoded, unprintable: occurrencesOf(decoded) };
    } catch {
      return { encoding, decoded: '', unprintable: [] };
    }
  }
  if (encoding === 'utf-16le' || encoding === 'utf-16be') {
    try {
      const view = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      const decoded = new TextDecoder(encoding === 'utf-16le' ? 'utf-16le' : 'utf-16be').decode(view);
      return { encoding, decoded, unprintable: occurrencesOf(decoded) };
    } catch {
      return { encoding, decoded: '', unprintable: [] };
    }
  }
  const raw = buf.toString ? buf.toString('utf8') : String(buf);
  return { encoding, decoded: raw, unprintable: occurrencesOf(raw) };
}

function occurrencesOf(str) {
  const out = [];
  const re = new RegExp(UNPRINTABLE.source, 'g');
  let m;
  while ((m = re.exec(str)) !== null) {
    out.push({ index: m.index, char: m[0], code: m[0].charCodeAt(0) });
  }
  return out;
}
