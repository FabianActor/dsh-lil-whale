#!/usr/bin/env node
/**
 * fi-0017（r426）的行为测试：绑定/解绑的规则与写入形状。
 *
 * 这批断言盯的是"三个入口会不会各认一个答案"：
 *   1) 会话 id 与家目录的判定（不读会话内容）
 *   2) 只有 kind=fish 能绑；会话必须真在那个成员的 dshHome 里
 *   3) 绑 = 替换；同一段会话只归一个人（别人手里的同一段要摘掉）
 *   4) 解绑只认"现在真绑着的那一段"，不碰别人的
 *   5) 视图里每段被绑会话都标出"还在不在盘上"
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  sessionIdOf,
  homeOfMember,
  sessionExistsInHome,
  fishOf,
  findBinding,
  bindingProblem,
  unbindProblem,
  applyBind,
  applyUnbind,
  bindingsView,
  stateLogLine,
} from '../plugin/dsh-lil-whale-group-ui/lib/bindings-core.js'

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) pass++
  else failures.push(`${name}${detail ? `：${detail}` : ''}`)
}

const SID = 'session-ae4daabd-a9f9-4541-ba03-9ff7cea21a88'
const SID2 = 'session-b502eb87-85f5-498f-a50f-91c688d9f674'

// ---------- 1) 会话 id 形状 ----------
check('正常 id 通过', sessionIdOf(SID) === SID)
check('带空白会被去掉', sessionIdOf(`  ${SID}\n`) === SID)
check('短 id 拒', sessionIdOf('session-abc') === null)
check('大写十六进制拒', sessionIdOf(SID.toUpperCase()) === null)
check('非字符串拒', sessionIdOf(42) === null && sessionIdOf(null) === null)
check('别的前缀拒', sessionIdOf('sid-' + SID.slice(8)) === null)

// ---------- 2) 家目录与"在不在这个家里" ----------
const tmp = mkdtempSync(join(tmpdir(), 'llw-bind-'))
const homeA = join(tmp, 'homeA')
const homeB = join(tmp, 'homeB')
mkdirSync(join(homeA, 'sessions', '--proj-a--', SID), { recursive: true })
writeFileSync(join(homeA, 'sessions', '--proj-a--', SID, 'session.v4.jsonl.zstd'), 'x')
mkdirSync(join(homeB, 'sessions'), { recursive: true })

check('homeOfMember：dshHome 优先', homeOfMember({ dshHome: homeA, home: homeB }) === homeA)
check('homeOfMember：只有 home 时推 dsh-home', homeOfMember({ home: homeA }).replace(/\\/g, '/').endsWith('homeA/dsh-home'))
check('homeOfMember：都没有 → null', homeOfMember({}) === null)
check('会话在 homeA 里', sessionExistsInHome(homeA, SID) === true)
check('会话不在 homeB 里', sessionExistsInHome(homeB, SID) === false)
check('坏 id 不查盘', sessionExistsInHome(homeA, 'nope') === false)
check('家不存在 → false', sessionExistsInHome(join(tmp, 'nope'), SID) === false)

// 空会话目录（刚建、文件还没落）也算"在这里"
const SID_EMPTY = 'session-11111111-2222-3333-4444-555555555555'
mkdirSync(join(homeA, 'sessions', '--proj-a--', SID_EMPTY), { recursive: true })
check('空会话目录也算在', sessionExistsInHome(homeA, SID_EMPTY) === true)

// ---------- 3) 名册与判定 ----------
const roster = {
  members: {
    lee: { name: 'Leea', kind: 'fish', role: 'watcher', dshHome: homeA },
    whale: { name: '小肥鱼', kind: 'fish', role: 'member', dshHome: homeB },
    fabian: { name: 'Fabian', kind: 'human', role: 'human' },
  },
}
const fish = fishOf(roster)
check('fishOf 只挑鱼', fish.length === 2 && fish.map((f) => f.key).join(',') === 'lee,whale')
check('fishOf 带 dshHome', fish[0].dshHome === homeA)
check('fishOf 名字兜底不丢', fish[1].name === '小肥鱼')

check('绑 homeA 的会话给 lee：可以', bindingProblem({ roster, memberKey: 'lee', sessionId: SID }) === null)
const notInHome = bindingProblem({ roster, memberKey: 'whale', sessionId: SID })
check('绑 homeA 的会话给 whale：拒', notInHome?.error === 'session-not-in-home')
check('拒的理由里带她的家', String(notInHome?.message ?? '').includes(homeB))
check('绑人类：拒', bindingProblem({ roster, memberKey: 'fabian', sessionId: SID })?.error === 'not-fish')
check('绑不存在的成员：拒', bindingProblem({ roster, memberKey: 'nobody', sessionId: SID })?.error === 'no-member')
check('坏 id：拒', bindingProblem({ roster, memberKey: 'lee', sessionId: 'zzz' })?.error === 'bad-session-id')

const pins0 = { lee: [SID], whale: [] }
check('解绑没绑着的：409', unbindProblem({ pins: pins0, memberKey: 'whale', sessionId: SID })?.status === 409)
check('解绑真绑着的：可以', unbindProblem({ pins: pins0, memberKey: 'lee', sessionId: SID }) === null)

// ---------- 4) 写入形状（不改入参 / 同一段只归一个人） ----------
const before = JSON.stringify(pins0)
const bound = applyBind(pins0, 'whale', SID)
check('applyBind 不改入参', JSON.stringify(pins0) === before)
check('applyBind：whale 拿到这段', JSON.stringify(bound.whale) === JSON.stringify([SID]))
check('applyBind：lee 手里的同一段被摘掉', bound.lee.length === 0)
const bound2 = applyBind(bound, 'whale', SID2)
check('再绑一段 = 替换', JSON.stringify(bound2.whale) === JSON.stringify([SID2]))
const unbound = applyUnbind(bound, 'whale')
check('applyUnbind：回到 []', Array.isArray(unbound.whale) && unbound.whale.length === 0)
check('applyUnbind 不改入参', bound.whale.length === 1)

// ---------- 5) 视图 ----------
const view = bindingsView({
  roster,
  pins: { lee: [SID, SID_EMPTY], whale: [] },
  liveKeys: ['whale'],
  exists: (id) => id === SID,
})
check('视图里的鱼带 live', view.members.find((m) => m.key === 'whale')?.live === true)
check('视图列出两段被绑会话', view.bound.length === 2)
check('在盘上的那段标 exists=true', view.bound.find((b) => b.sessionId === SID)?.exists === true)
check('不在盘上的那段标 exists=false', view.bound.find((b) => b.sessionId === SID_EMPTY)?.exists === false)
check('findBinding 找得到 lee', findBinding(view.pins, SID)?.member === 'lee')
check('findBinding 找不到 → null', findBinding(view.pins, SID2) === null)

// ---------- 6) 记账行 ----------
const line = stateLogLine({ ts: '2026-11-23 13:30:00', action: 'unbind', memberKey: 'lee', sessionId: SID, by: 'panel' })
check('账行有动作与成员', line.includes('| unbind |') && line.includes('member=lee'))
check('账行有会话与来源', line.includes(`session=${SID}`) && line.includes('by=panel'))
check('账行是单行', !/[\r\n]/.test(line))

rmSync(tmp, { recursive: true, force: true })

if (failures.length) {
  console.log(`✗ 不合 ${failures.length} 格`)
  for (const f of failures) console.log(`  - ${f}`)
  console.log(`\n合计 ${pass + failures.length}，PASS ${pass}，FAIL ${failures.length}`)
  process.exit(1)
}
console.log(`✓ 全部 ${pass} 格通过`)
