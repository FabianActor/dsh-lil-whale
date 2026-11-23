/**
 * 鱼塘「换绑」那条路：静态接线 + 候选表行为。
 *
 * 为什么要有这一格：菜单那版的错不在服务端，在"界面自己决定列什么"。
 * 这次把那条路撤了，改由 `sessionCandidatesOf()` 一次算清"哪段能绑、现在归谁、是不是正被用"，
 * 界面只照着画；这份测试钉住三件事：路由在、菜单没了、候选表的标记没被写反。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shortSessionId, sessionCandidatesOf } from '../plugin/dsh-lil-whale-group-ui/lib/bindings-core.js'

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

  // 静态接线
  const clientSrc = readFileSync('plugin/dsh-lil-whale-group-ui/lib/client.js', 'utf8')
  const uiSrc = readFileSync('plugin/dsh-lil-whale-group-ui/lib/index.js', 'utf8')
  ok('客户端的候选来自新路由', clientSrc.includes('/group/api/bind-candidates?member='))
  ok('客户端只留一个「换绑」按钮', clientSrc.includes("bind: '换绑'") && !clientSrc.includes('解绑该会话'))
  ok('会话行菜单已撤掉', !clientSrc.includes('lil-whale.binding') && !clientSrc.includes("inject: ['slots', 'contextMenus']"))
  ok('build 标记 v65', clientSrc.includes('client build v65 · pond-bind'))
  ok('服务端有候选路由', uiSrc.includes("path: '/group/api/bind-candidates'"))
  ok('服务端用同一个判定层', uiSrc.includes('sessionCandidatesOf({ roster'))
  ok('卡片状态里带会话', uiSrc.includes('sessionShort: boundList[0]'))
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log(`\ntest-pond-bind：合计 ${pass + fail}，PASS ${pass}，FAIL ${fail}`)
if (fail > 0) process.exit(1)
