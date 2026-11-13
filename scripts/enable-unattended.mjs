#!/usr/bin/env node
/**
 * 【已退役 · 2026-11-13】把一条鱼改成「无人值守」的旧办法。
 *
 * 为什么退役：这个脚本往 profile patch 里写 `- id: agent-loop` 的
 * `config.agents[].resumeSessionId`。那条路会让 host 在启动时直接
 * `persistence.open()` + `initializeAgent()`，**绕开 session-controller 的
 * `composeAgent()`** —— 而 preset 的工具正是在那里挂的。结果：会话挂上了、
 * 心跳在写，但 agent 手里只剩两个工具（`group_say` / `working_directory`）。
 * 小鱼丸 2026-11-13 全天都在这个状态里（PRD A.54）。
 *
 * 现在的做法：插件自己调 `ctx.get('sessionController').agents.resume(sessionId)`，
 * 由 session-controller 负责 preset 挂载（`plugin/dsh-group/lib/index.js` 的
 * `scheduleOwnMount()` / `ensureOwnMounted()`）。不需要改任何 profile patch。
 *
 * 所以这个文件保留但**拒绝写入**：
 *   - `--dry-run` 会打印说明并退出 0（给还按旧文档操作的人一个交代）；
 *   - 其他情况退出 1，并告诉你该看哪儿。
 *
 * 真要把某个 profile 里残留的旧块摘掉：`node scripts\disable-unattended.mjs --member <键>`。
 */
const args = new Set(process.argv.slice(2))

const EXPLAIN = [
  'enable-unattended.mjs 已退役（2026-11-13）。',
  '',
  '它写的是 agent-loop 的 resumeSessionId —— 那条路会绕开 session-controller 的',
  'preset 挂载，结果是她只剩 group_say / working_directory 两个工具（PRD A.54）。',
  '',
  '现在不需要它：无人值守由插件自己调 sessionController.agents.resume() 完成。',
  '  - 起鱼：pwsh -File scripts\\fish.ps1 up <键>        （默认就是无人值守）',
  '  - 检修：pwsh -File scripts\\fish.ps1 maintain <键>   （开窗看日志）',
  '  - 回无人值守：pwsh -File scripts\\fish.ps1 restore <键>',
  '  - 清旧块：node scripts\\disable-unattended.mjs --member <键>',
  '',
  '如果她起来了但工具不全，看 pool\\group\\plugin.log 里的 session-mount-failed / session-mounted。',
].join('\n')

if (args.has('--dry-run')) {
  console.log(EXPLAIN)
  process.exit(0)
}

console.error(EXPLAIN)
console.error('')
console.error('NEXT: 不要再用这个脚本；起鱼用 fish.ps1 up <键>（它已经默认无人值守）。')
process.exit(1)
