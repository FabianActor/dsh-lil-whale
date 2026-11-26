#!/usr/bin/env node
// fi-0022（2026-11-26）：boot 行只记"配置里写的"路由两格 —— cfg-provider / cfg-model
//
// 这条 fissue 原话是"boot 行记了 provider 会过期"。核现场时发现 boot 行**根本没有**
// provider/model 两格，所以那是预测。这次只加"读文件读到的"两格，名字带 cfg；
// 运行态那一半（"进程真的切了吗"）没有读数，另开一条挂着。
//
// 这里验四件：
//  ① 只认 `agent-default-model` 那一块（同一个 patch 里 `llm-pi-ai` 也有一串 provider/model）；
//  ② 读不到就是 null，不给默认值（fi-0031 的教训）；
//  ③ 比较只认"变了"，没变不写行；
//  ④ 代码里没有叫 route-switch 的东西（名字贵了，它就会替运行态说话）。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseDefaultModel, routeCfgDiff, routeCfgLine } from '../plugin/dsh-lil-whale-group/lib/route-cfg.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0
let fail = 0
const failures = []
function ok(cond, name) {
  if (cond) pass += 1
  else { fail += 1; failures.push('  ✗ ' + name) }
}

// ---------- ① 只认自己那一块 ----------
const patch = `# Your patch layer
- id: ui-settings-general
  name: "@deepseek-ai/dsh-client-ui-settings-general"
  config:
    welcomeNoticeVersion: 2026-09-28.1
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: qwen-platform
    model: deepseek-v4.1-flash-1017
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      xiaomi:
        models:
          - id: mimo-v2.6-flash
            provider: someone-else
            model: not-mine
`
const parsed = parseDefaultModel(patch)
ok(parsed.provider === 'qwen-platform', 'provider 取 agent-default-model 那一块，不取 llm-pi-ai 里的同名键')
ok(parsed.model === 'deepseek-v4.1-flash-1017', 'model 同上')

// 块在后面也能找到（llm-pi-ai 在前）
const reversed = `- id: llm-pi-ai
  config:
    provider: someone-else
- id: agent-default-model
  config:
    provider: opencode-go
    model: hungerg-free
`
const r2 = parseDefaultModel(reversed)
ok(r2.provider === 'opencode-go' && r2.model === 'hungerg-free', '块在中间时仍只取自己那块')

// ---------- ② 读不到就是 null ----------
const empty = parseDefaultModel('- id: ui-settings-general\n  config:\n    x: 1\n')
ok(empty.provider === null && empty.model === null, '没有这一块 ⇒ null（不写 sock 默认值）')
const half = parseDefaultModel('- id: agent-default-model\n  config:\n    provider: qwen-platform\n')
ok(half.provider === 'qwen-platform' && half.model === null, '只有 provider 时 model 仍 null')
const commented = parseDefaultModel('- id: agent-default-model\n  config:\n    provider: qwen-platform  # 注释\n    model: "x-1"\n')
ok(commented.provider === 'qwen-platform' && commented.model === 'x-1', '行尾注释去掉、引号去掉')

// ---------- ③ 只认"变了" ----------
const base = { provider: 'opencode-go', model: 'hungerg-free' }
ok(routeCfgDiff(base, { provider: 'opencode-go', model: 'hungerg-free' }) === null, '没变 ⇒ null（不写行）')
ok(routeCfgDiff(base, { provider: 'qwen-platform', model: 'hungerg-free' }).provider === true, 'provider 变了要报')
ok(routeCfgDiff(base, { provider: 'opencode-go', model: 'deepseek-v4.1-flash-1017' }).model === true, 'model 变了要报')
ok(routeCfgLine(base, { provider: 'qwen-platform', model: 'x' }, 'fishball').includes('from-cfg=opencode-go/hungerg-free'), '行里 from 带旧值')
ok(routeCfgLine(base, { provider: 'qwen-platform', model: 'x' }, 'fishball').includes('to-cfg=qwen-platform/x'), '行里 to 带新值')

// ---------- ④ 代码里没有 route-switch ----------
const idx = readFileSync(join(root, 'plugin/dsh-lil-whale-group/lib/index.js'), 'utf8')
ok(!/route-switch/.test(idx), '代码里不出现 route-switch（名字贵了就会替运行态说话）')
ok(/cfgProvider: bootRoute\.provider/.test(idx), 'boot 行带 cfgProvider')
ok(/cfgModel: bootRoute\.model/.test(idx), 'boot 行带 cfgModel')
ok(/note: 'route-cfg-changed'/.test(idx), '变化记 route-cfg-changed')
ok(/recordRouteCfg\(bootMember \?\? CFG\.selfProfile\)/.test(idx), '启动时比较一次（热重载会重新 apply）')
ok(/const ROUTE_STATE_DIR = join\(POOL_STATE, 'route'\)/.test(idx), '上次的值落在 pool\state\route\（跨得过重载）')

console.log(`合计 ${pass + fail}，PASS ${pass}，FAIL ${fail}`)
for (const line of failures) console.log(line)
process.exit(fail === 0 ? 0 : 1)
