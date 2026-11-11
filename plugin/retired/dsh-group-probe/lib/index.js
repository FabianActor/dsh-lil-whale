// dsh-group-probe —— 最小探针
//
// 目的只有一个：证明「本地 bundle 能被 apply」这件事是真的。
// 2026-11-08 那次实验里出现过「apply 了但什么都没发生」，一直没查清是
// 配置没合成、还是合成了但没挂载、还是挂了但插件自己 silent。这次一次分清。
//
// 它做的事：启动时往 probe.log 追加一行，带上 pid、进程的 DSH_HOME、当前时间。
// 不注册工具、不改界面、不读任何业务数据。
//
// 为什么写文件而不是只写 stdout：stdout 会被宿主吞掉或被日志轮转吃掉，
// 文件是唯一能在重启之后拿出来对的证据。

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const name = 'dsh-group-probe'
const inject = []

const PROBE_LOG = 'D:\\文档\\WorkSpace\\dsh-lil-whale\\probe\\apply.log'

function apply() {
  const home = process.env.DSH_HOME ?? '(unset → ~/.dsh)'
  const line = [
    new Date().toISOString(),
    `pid=${process.pid}`,
    `home=${home}`,
    `cwd=${process.cwd()}`,
  ].join('\t')

  try {
    mkdirSync(dirname(PROBE_LOG), { recursive: true })
    appendFileSync(PROBE_LOG, line + '\n', 'utf8')
  } catch (error) {
    // 探针自己不许把宿主搞挂
    console.error(`[${name}] 写 probe.log 失败：`, error)
  }

  console.log(`[${name}] loaded ${line}`)
}

export { name, inject, apply }
