// 账本里的每个字节都要能被印出来（第四条鱼 #1014，2026-11-17）。
//
// 现场：一条群消息里 markdown 的 `b 被 PowerShell 双引号 here-string 当成了退格符（0x08），
// 落盘后显示成 "undles=" —— 一个"合法但少一个字符"的字段名，按字段读的脚本不会报错。
//
// 规则：C0 控制字符（除换行）与 DEL 一律换成可见占位 <0xNN>；换行保留（一条消息可以多行）。
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
