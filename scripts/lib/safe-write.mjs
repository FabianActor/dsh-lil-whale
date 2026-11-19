// 只读模式下的写入口（fi-0003，LeeaCP 提，2026-11-19 定稿）
//
// 背景：`patch-bili-eyes-note.mjs` 里 `--check` / `--dry-run` 的只读保证，原来靠 7 个调用点
// 各自写 `if (readOnly) { ...未写入... }`。漏一处就静默写盘，而且"漏了"跟"没漏"在输出上
// 长得一样。现在所有落盘动作只走这个模块：第一行先问 readOnly，过了才写。
//
// 为什么不是"调用点记得传 readOnly"就够：因为那还是"靠记得"。这里把判定放在**唯一的门**上，
// 并且 `scripts/test-safe-write.mjs` 用静态扫描盯着补丁脚本——它只许出现这些封装，不许出现
// 裸的 `fs.writeFileSync(...)` 之类。
//
// 已知不查（见扫描器输出第一行）：动态拼名、变量取属性、模板字符串的 ${} 里——追下去要写解析器，
// 解析器自己又要被测。边界写在纸上，比假装查不到更好。

import fs from 'node:fs'

function guard(readOnly, target, action) {
  if (!readOnly) return
  throw new Error(`只读模式：试图${action} ${target}`)
}

/** 写整份文本（UTF-8） */
export function writeText(readOnly, file, text) {
  guard(readOnly, file, '写')
  fs.writeFileSync(file, text, 'utf8')
}

/** 追加文本（UTF-8） */
export function appendText(readOnly, file, text) {
  guard(readOnly, file, '追加')
  fs.appendFileSync(file, text, 'utf8')
}

/** 原子替换：先写临时文件，再改名到目标 */
export function renameFile(readOnly, from, to) {
  guard(readOnly, to, '改名成')
  fs.renameSync(from, to)
}

/** 复制文件（名字避开 fs.copyFile，免得扫描器把封装当裸调用） */
export function copyFileTo(readOnly, from, to) {
  guard(readOnly, to, '复制到')
  fs.copyFileSync(from, to)
}

/** 建目录 */
export function ensureDir(readOnly, dir) {
  guard(readOnly, dir, '创建目录')
  fs.mkdirSync(dir, { recursive: true })
}

/** 失败了要把文件恢复成原样时用：只在内容确实被改过时才写回去 */
export function restoreText(readOnly, file, original) {
  guard(readOnly, file, '恢复')
  if (fs.readFileSync(file, 'utf8') !== original) fs.writeFileSync(file, original, 'utf8')
}
