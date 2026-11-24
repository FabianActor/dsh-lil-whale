// 文本文件的指纹：先归一化换行，再 hash（2026-11-24 r453）。
//
// 为什么：`.gitattributes` 加了 `* text=auto` 之后，同一份模板在 Windows 检出是 CRLF、
// 在别的机器或包里可能是 LF——内容一个字没变，raw sha256 却会变。
// 指纹的用途是回答"是不是同一份内容"，不是"是不是同一套换行"。
//
// 边界：只给文本文件用（模板、配置、脚本）；二进制不要走这里。

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

/** 把 CRLF 归一成 LF（只动 0x0D 0x0A 这一对，UTF-8 多字节序列里不会出现单字节 0x0D）。 */
export function normalizeNewlines(buffer) {
  const out = Buffer.allocUnsafe(buffer.length)
  let n = 0
  for (let i = 0; i < buffer.length; i += 1) {
    const byte = buffer[i]
    if (byte === 0x0d && i + 1 < buffer.length && buffer[i + 1] === 0x0a) continue
    out[n] = byte
    n += 1
  }
  return out.subarray(0, n)
}

/** 归一化后的 sha256（64 位十六进制）。 */
export function sha256OfTextFile(file) {
  return createHash('sha256').update(normalizeNewlines(readFileSync(file))).digest('hex')
}

/** 归一化后的前 8 位（纸上的 template=<sha8> 用这一种）。 */
export function sha8OfTextFile(file) {
  return sha256OfTextFile(file).slice(0, 8)
}
