/**
 * 鱼塘「换绑」那条路：静态接线 + 候选表行为。
 *
 * 为什么要有这一格：菜单那版的错不在服务端，在"界面自己决定列什么"。
 * 这次把那条路撤了，改由 `sessionCandidatesOf()` 一次算清"哪段能绑、现在归谁、是不是正被用"，
 * 界面只照着画；这份测试钉住三件事：路由在、菜单没了、候选表的标记没被写反。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bindingProblem, shortSessionId, sessionCandidatesOf, stateLogLine } from '../plugin/dsh-lil-whale-group-ui/lib/bindings-core.js'

let pass = 0
let fail = 0
const ok = (name, condition, detail = '') => {
  if (condition) { pass += 1; console.log('PASS ' + name) }
  else { fail += 1; console.log('FAIL ' + name + (detail ? '：' + detail : '')) }
}

const root = mkdtempSync(join(tmpdir(), 'llw-pond-bind-'))
try {
  const home = join(root, 'homes', 'whale', 'dsh-home')
  const other = join(root, 'homes', 'fishball', 'dsh-home')
  const mkSession = (base, project, id) => {
    const dir = join(base, 'sessions', project, id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.v4.jsonl.zstd'), 'x')
  }
  const sA = 'session-aaaaaaaa-1111-2222-3333-444444444444'
  const sB = 'session-bbbbbbbb-1111-2222-3333-444444444444'
  mkSession(home, '--D-ws--', sA)
  mkSession(home, '--D-ws--', sB)
  mkSession(other, '--D-ws--', 'session-cccccccc-1111-2222-3333-444444444444')
  mkdirSync(join(home, 'storages'), { recursive: true })
  writeFileSync(join(home, 'storages', 'workspace.json'), JSON.stringify({
    tables: { workspaces: { w1: { path: join(root, 'homes', 'whale'), sessionIds: [sA] } } },
  }))

  const roster = {
    members: {
      lee: { kind: 'fish', role: 'watcher', name: 'Leea', home: join(root, 'lee'), dshHome: join(root, 'lee', 'dsh-home') },
      whale: { kind: 'fish', role: 'member', name: '小肥鱼', home: join(root, 'homes', 'whale'), dshHome: home },
      fishball: { kind: 'fish', role: 'member', name: '小鱼丸', home: join(root, 'homes', 'fishball'), dshHome: other },
      fabian: { kind: 'human', name: 'Fabian' },
    },
  }
  const pins = { whale: [sB], fishball: [] }
  const out = sessionCandidatesOf({
    roster,
    memberKey: 'whale',
    pondRoot: root,
    pins,
    liveSessionIds: [sA],
  })
  ok('候选里两条都在', out.sessions.length === 2, String(out.sessions.length))
  const a = out.sessions.find((s) => s.id === sA)
  const b = out.sessions.find((s) => s.id === sB)
  ok('A 可绑（登记在她家工作区）', a?.eligible === true && a?.registered === true)
  ok('A 标记正在使用', a?.inUse === true)
  ok('B 已绑给她（当前）', b?.boundTo === 'whale')
  ok('B 未登记工作区仍可绑', b?.eligible === true && b?.registered === false)
  ok('不是她的会话不会出现在她的候选里', !out.sessions.some((s) => s.project !== '--D-ws--'))
  ok('短 id 带省略号', shortSessionId(sA).endsWith('…') && shortSessionId(sA).length < sA.length)
  ok('坏 id 不给短形式', shortSessionId('nope') === '')

  // 工作区不匹配要被挡下：把小肥鱼的会话登记到别处，再算一次。
  writeFileSync(join(home, 'storages', 'workspace.json'), JSON.stringify({
    tables: { workspaces: { w1: { path: join(root, 'homes', 'whale', 'notes'), sessionIds: [sA] } } },
  }))
  const bad = sessionCandidatesOf({ roster, memberKey: 'whale', pondRoot: root, pins: {}, liveSessionIds: [] })
  const badA = bad.sessions.find((s) => s.id === sA)
  ok('工作区不对时不可绑且给出理由', badA?.eligible === false && /工作区/.test(String(badA?.reason)))

  // 巡守那一支（issue #4，2026-11-24 r459）：他没有沙箱根，会话建在他当天干活的地方。
  // 四格照报告里那台机器的真实布局写：鱼塘在盘根、巡守的日常目录是鱼塘的兄弟、以及别的盘。
  const wHome = join(root, 'lee-home')
  mkdirSync(join(wHome, 'storages'), { recursive: true })
  const wInside = 'session-eeeeeeee-1111-2222-3333-444444444444'
  const wSibling = 'session-ffffffff-1111-2222-3333-444444444444'
  const wDeep = 'session-9a9a9a9a-1111-2222-3333-444444444444'
  const wRoot = 'session-8b8b8b8b-1111-2222-3333-444444444444'
  for (const id of [wInside, wSibling, wDeep, wRoot]) mkSession(wHome, '--G--', id)
  const watcherWs = {}
  watcherWs.wIn = { path: join(root, 'homes', 'lee'), sessionIds: [wInside] }
  watcherWs.wSib = { path: 'G:\\1', sessionIds: [wSibling] }
  watcherWs.wDeep = { path: 'G:\\大肥鱼\\dsh-fish\\home', sessionIds: [wDeep] }
  watcherWs.wRoot = { path: 'G:\\', sessionIds: [wRoot] }
  writeFileSync(join(wHome, 'storages', 'workspace.json'), JSON.stringify({ tables: { workspaces: watcherWs } }))
  const wRoster = {
    members: {
      lee: { kind: 'fish', role: 'watcher', name: 'Leea', home: join(root, 'lee'), dshHome: wHome },
      whale: roster.members.whale,
    },
  }
  const wBind = (id) => bindingProblem({ roster: wRoster, memberKey: 'lee', sessionId: id, pondRoot: root })
  ok('巡守：鱼塘里的会话照旧可绑', wBind(wInside) === null)
  ok('巡守：鱼塘的兄弟目录（G:\\1）可绑', wBind(wSibling) === null, JSON.stringify(wBind(wSibling)))
  ok('巡守：别的盘深处的目录可绑', wBind(wDeep) === null, JSON.stringify(wBind(wDeep)))
  const wRootProblem = wBind(wRoot)
  ok('巡守：整盘（G:\\）仍然拒，但换成了"太宽"', wRootProblem?.error === 'session-workspace-too-broad' && /整盘/.test(String(wRootProblem?.message)))
  ok('普通鱼没被放宽：G:\\1 的会话仍拒', (() => {
    // 把小肥鱼的会话登记到 G:\1，再按普通鱼那条严格分支算一遍
    const before = readFileSync(join(home, 'storages', 'workspace.json'), 'utf8')
    writeFileSync(join(home, 'storages', 'workspace.json'), JSON.stringify({ tables: { workspaces: { w1: { path: 'G:\\1', sessionIds: [sA] } } } }))
    const r = bindingProblem({ roster, memberKey: 'whale', sessionId: sA, pondRoot: root })
    writeFileSync(join(home, 'storages', 'workspace.json'), before)
    return r?.error === 'session-workspace-mismatch'
  })())

  // 绑定账：放行了鱼塘外的工作区，就得把"他会醒在哪儿"记下来（r459）
  const bindLine = stateLogLine({ ts: '2026-11-24 21:40:00', action: 'bind', memberKey: 'lee', sessionId: wSibling, cwd: 'G:\\1' })
  ok('绑定账带 cwd', bindLine.endsWith(' cwd=G:\\1'), bindLine)
  ok('绑定账仍是单行 fmt=1', bindLine.split('\n').length === 1 && bindLine.includes('| fmt=1 '))
  const unbindLine = stateLogLine({ ts: '2026-11-24 21:40:00', action: 'unbind', memberKey: 'lee', sessionId: wSibling })
  ok('解绑账不带 cwd（那段会话已经不算数）', !unbindLine.includes('cwd='), unbindLine)
  ok('没给 cwd 时不写空字段', !stateLogLine({ ts: 'x', action: 'bind', memberKey: 'lee', sessionId: wSibling, cwd: null }).includes('cwd='))

  // 静态接线
  // 读源码一律按本文件的位置算，不按 CWD：release-check 会从仓库根跑包里那份副本，
// 用相对路径就会读到工作区的新文件，把「包里的样子」验成「我这台机器上的样子」。
const SELF = fileURLToPath(import.meta.url)
const REPO_ROOT = resolve(dirname(SELF), '..')
const readSrc = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8')
const clientSrc = readSrc('plugin/dsh-lil-whale-group-ui/lib/client.js')
  const uiSrc = readSrc('plugin/dsh-lil-whale-group-ui/lib/index.js')
  ok('客户端的候选来自新路由', clientSrc.includes('/group/api/bind-candidates?member='))
  ok('客户端只留一个「换绑」按钮', clientSrc.includes("bind: '换绑'") && !clientSrc.includes('解绑该会话'))
  ok('会话行菜单已撤掉', !clientSrc.includes('lil-whale.binding') && !clientSrc.includes("inject: ['slots', 'contextMenus']"))
  ok('build 标记 v68', clientSrc.includes('client build v68 · bind-cwd'))
  ok('服务端有候选路由', uiSrc.includes("path: '/group/api/bind-candidates'"))
  ok('服务端用同一个判定层', uiSrc.includes('sessionCandidatesOf({ roster'))
  ok('卡片状态里带会话', uiSrc.includes('sessionShort: boundList[0]'))
  ok('读源码按文件位置算，不按 CWD', !/readFileSync\('plugin\//.test(readFileSync(SELF, 'utf8')))
ok('旧的「鱼塘外面」代理规则已撤', !readSrc('plugin/dsh-lil-whale-group-ui/lib/bindings-core.js').includes('session-workspace-outside-pond'))
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log(`\ntest-pond-bind：合计 ${pass + fail}，PASS ${pass}，FAIL ${fail}`)
if (fail > 0) process.exit(1)
