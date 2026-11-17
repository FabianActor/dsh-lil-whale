#!/usr/bin/env node
// 测试 scripts/register-workspace-session.mjs（工作区登记）。
// 用临时目录 + 临时配置（LIL_WHALE_CONFIG）跑真实脚本，不碰鱼塘数据。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'register-workspace-session.mjs');
const SID = 'session-e17c3c91-3e85-42f7-8116-05626cb3443f';
const SID2 = 'session-7c592e1a-41b7-4cd3-b998-bbc5f7e67b9e';

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log('ok  ' + name);
  } else {
    fail++;
    console.log('xx  ' + name + (detail ? ' —— ' + detail : ''));
  }
}

function makeFixture({ wsPath, sessions = [SID], workspaces } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'llw-wsreg-'));
  const home = join(root, 'homes', 'lee2');
  const dshHome = join(home, 'dsh-home');
  const poolDir = join(root, 'pool');
  mkdirSync(join(dshHome, 'sessions', 'pk'), { recursive: true });
  mkdirSync(join(dshHome, 'storages'), { recursive: true });
  mkdirSync(poolDir, { recursive: true });
  for (const sid of sessions) mkdirSync(join(dshHome, 'sessions', 'pk', sid), { recursive: true });
  mkdirSync(home, { recursive: true });

  const membersFile = join(poolDir, 'members.json');
  writeFileSync(
    membersFile,
    JSON.stringify(
      {
        version: 1,
        members: {
          lee2: { name: 'LeeaCP', kind: 'fish', role: 'member', parent: null, home, dshHome, profile: 'lee2', port: 3085, sessionId: SID },
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  const wsFile = join(dshHome, 'storages', 'workspace.json');
  const ws = workspaces ?? [
    {
      id: 'ws-1',
      path: wsPath ?? home,
      title: '家',
      sessionIds: [],
      createdAt: '2026-11-17T09:12:45.509Z',
      updatedAt: '2026-11-17T09:12:45.509Z',
    },
  ];
  writeFileSync(
    wsFile,
    JSON.stringify(
      {
        unit: { name: 'workspace', version: 2 },
        global: { initialized: true, workspaceIds: ws.map((w) => w.id), defaultWorkspaceId: ws.length > 0 ? ws[0].id : null, archivedSessionIds: [], pinnedSessionIds: [] },
        tables: { workspaces: Object.fromEntries(ws.map((w) => [w.id, { path: w.path, title: w.title, sessionIds: w.sessionIds, createdAt: w.createdAt, updatedAt: w.updatedAt }])) },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  const cfgFile = join(root, 'lil-whale.config.json');
  writeFileSync(cfgFile, JSON.stringify({ repoRoot: join(root, 'app'), poolDir, membersFile }, null, 2), 'utf8');
  return { root, home, dshHome, membersFile, wsFile, cfgFile };
}

function run(args, cfgFile) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, LIL_WHALE_CONFIG: cfgFile },
  });
}

function readWs(wsFile) {
  return JSON.parse(readFileSync(wsFile, 'utf8')).tables.workspaces;
}

// 1. 正常登记
{
  const f = makeFixture();
  const r = run(['--member', 'lee2', '--session', SID], f.cfgFile);
  check('正常登记 exit 0', r.status === 0, r.stderr);
  check('正常登记打印 ✓', /✓ 已登记/.test(r.stdout), r.stdout);
  const ws = Object.values(readWs(f.wsFile))[0];
  check('workspace.json 里出现了会话', ws.sessionIds.includes(SID));
  check('updatedAt 被刷新', ws.updatedAt !== '2026-11-17T09:12:45.509Z');
  rmSync(f.root, { recursive: true, force: true });
}

// 2. 幂等
{
  const f = makeFixture();
  run(['--member', 'lee2', '--session', SID], f.cfgFile);
  const r = run(['--member', 'lee2', '--session', SID], f.cfgFile);
  const ws = Object.values(readWs(f.wsFile))[0];
  check('第二次 exit 0', r.status === 0, r.stderr);
  check('第二次说已经登记过', /已经登记过/.test(r.stdout), r.stdout);
  check('不产生重复项', ws.sessionIds.filter((x) => x === SID).length === 1);
  rmSync(f.root, { recursive: true, force: true });
}

// 3. --dry-run 不落盘
{
  const f = makeFixture();
  const before = readFileSync(f.wsFile, 'utf8');
  const r = run(['--member', 'lee2', '--session', SID, '--dry-run'], f.cfgFile);
  check('dry-run exit 0', r.status === 0, r.stderr);
  check('dry-run 提示会登记', /dry-run：会登记/.test(r.stdout), r.stdout);
  check('dry-run 文件没变', readFileSync(f.wsFile, 'utf8') === before);
  rmSync(f.root, { recursive: true, force: true });
}

// 4. 会话文件不在她家
{
  const f = makeFixture({ sessions: [SID2] });
  const before = readFileSync(f.wsFile, 'utf8');
  const r = run(['--member', 'lee2', '--session', SID], f.cfgFile);
  check('找不到会话时 exit 1', r.status === 1, 'status=' + r.status);
  check('说清找不到哪段', /找不到这段会话/.test(r.stderr), r.stderr);
  check('失败时文件没变', readFileSync(f.wsFile, 'utf8') === before);
  rmSync(f.root, { recursive: true, force: true });
}

// 5. 名册里没有这条鱼
{
  const f = makeFixture();
  const r = run(['--member', 'nobody', '--session', SID], f.cfgFile);
  check('无名成员 exit 1', r.status === 1, 'status=' + r.status);
  check('点出键名问题', /名册里没有这条鱼/.test(r.stderr), r.stderr);
  rmSync(f.root, { recursive: true, force: true });
}

// 6. 多个工作区且没有一个路径对得上
{
  const f = makeFixture({
    workspaces: [
      { id: 'ws-1', path: 'C:\\elsewhere\\a', title: '别处A', sessionIds: [], createdAt: 'x', updatedAt: 'x' },
      { id: 'ws-2', path: 'C:\\elsewhere\\b', title: '别处B', sessionIds: [], createdAt: 'x', updatedAt: 'x' },
    ],
  });
  const r = run(['--member', 'lee2', '--session', SID], f.cfgFile);
  check('路径不匹配 exit 1', r.status === 1, 'status=' + r.status);
  check('列出候选工作区', /现有工作区/.test(r.stderr), r.stderr);
  rmSync(f.root, { recursive: true, force: true });
}

// 7. 路径大小写 / 尾分隔符不同也能匹配
{
  const root = mkdtempSync(join(tmpdir(), 'llw-wsreg-'));
  const home = join(root, 'Homes', 'Lee2');
  const dshHome = join(home, 'dsh-home');
  mkdirSync(join(dshHome, 'sessions', 'pk', SID), { recursive: true });
  mkdirSync(join(dshHome, 'storages'), { recursive: true });
  const membersFile = join(root, 'members.json');
  writeFileSync(membersFile, JSON.stringify({ members: { lee2: { kind: 'fish', home, dshHome } } }), 'utf8');
  const wsFile = join(dshHome, 'storages', 'workspace.json');
  writeFileSync(
    wsFile,
    JSON.stringify({ tables: { workspaces: { 'ws-1': { path: home.toUpperCase() + '\\', title: '家', sessionIds: [] } } } }, null, 2) + '\n',
    'utf8',
  );
  const cfgFile = join(root, 'cfg.json');
  writeFileSync(cfgFile, JSON.stringify({ membersFile }), 'utf8');
  const r = run(['--member', 'lee2', '--session', SID], cfgFile);
  check('大小写/尾斜杠差异仍匹配 exit 0', r.status === 0, r.stderr || r.stdout);
  rmSync(root, { recursive: true, force: true });
}

// 8. 缺参数
{
  const f = makeFixture();
  const r = run(['--member', 'lee2'], f.cfgFile);
  check('缺 --session exit 1', r.status === 1, 'status=' + r.status);
  check('用法提示', /--session/.test(r.stderr), r.stderr);
  rmSync(f.root, { recursive: true, force: true });
}

// 9. 一个工作区都没有（老鱼，tables.workspaces 空）⇒ 建「家」并登记
{
  const f = makeFixture({ workspaces: [] });
  const r = run(['--member', 'lee2', '--session', SID], f.cfgFile);
  check('空工作区 exit 0', r.status === 0, r.stderr);
  const full = JSON.parse(readFileSync(f.wsFile, 'utf8'));
  const list = Object.values(full.tables.workspaces);
  check('建了一个工作区', list.length === 1);
  check('标题是家', list[0].title === '家');
  check('会话已登记', list[0].sessionIds.includes(SID));
  check('defaultWorkspaceId 补上了', !!full.global.defaultWorkspaceId);
  check('打印顺带建了', /顺带建了/.test(r.stdout), r.stdout);
  rmSync(f.root, { recursive: true, force: true });
}

console.log('test-register-workspace：合计 ' + (pass + fail) + '，PASS ' + pass + '，FAIL ' + fail);
process.exit(fail === 0 ? 0 : 1);
