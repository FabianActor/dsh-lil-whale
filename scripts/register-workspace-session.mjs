#!/usr/bin/env node
// 把一个会话登记进某条鱼的工作区（<dshHome>\storages\workspace.json）。
//
// 为什么需要它：网页左侧的"工作区 / 未分组"读的是这张登记表，不是 sessions 目录。
// 会话文件搬进来了、名册（pins.json）也钉了，只要登记表里没有它，界面就会把它挂在
// 「未分组」下——功能不受影响，但人会以为搬错了。（2026-11-17 LeeaCP 迁移时撞到）
//
// 用法：
//   node scripts\register-workspace-session.mjs --member lee2 --session session-xxxxxxxx-...
//   node scripts\register-workspace-session.mjs --member lee2 --session session-xxxxxxxx-... --dry-run
//
// 只改这一个文件，写临时文件再 rename（进程没起时也可以用；进程在跑时先 fish.ps1 down）。
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { loadConfigOrExit } from './lib/config-path.mjs';

function argOf(name) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fail(message, next) {
  console.error('xx ' + message);
  if (next) console.error('NEXT: ' + next);
  process.exit(1);
}

function normPath(p) {
  return String(p ?? '').replace(/[\\/]+/g, '\\').replace(/\\+$/, '').toLowerCase();
}

function findSessionDir(root, sessionId) {
  if (!existsSync(root)) return null;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === sessionId) return full;
        stack.push(full);
      }
    }
  }
  return null;
}

function main() {
  const memberKey = argOf('member');
  const sessionId = argOf('session');
  const dryRun = process.argv.includes('--dry-run');
  if (!memberKey || !sessionId) {
    fail('缺少参数', 'node scripts\\register-workspace-session.mjs --member <键> --session <session-…> [--dry-run]');
  }
  if (!/^session-[0-9a-f-]{8,}$/i.test(sessionId)) {
    fail('形参不像会话 id：' + sessionId, '会话 id 形如 session-4e31957c-dcd5-4cf0-896e-e71adc2e0aea；从 <dshHome>\\sessions 下抄，别手打');
  }

  const cfg = loadConfigOrExit();
  const membersFile = cfg.membersFile;
  if (!membersFile || !existsSync(membersFile)) {
    fail('名册读不了：' + (membersFile || '(配置里没有 membersFile)'), '先确认 lil-whale.config.json 的 membersFile');
  }
  const members = JSON.parse(readFileSync(membersFile, 'utf8')).members ?? {};
  const m = members[memberKey];
  if (!m) fail('名册里没有这条鱼：' + memberKey, '核对键名（不是显示名）；名册：' + membersFile);
  if (!m.dshHome) fail('这条鱼没有 dshHome：' + memberKey, '名册里补上 dshHome 再试');

  const dshHome = String(m.dshHome);
  const wsFile = join(dshHome, 'storages', 'workspace.json');
  const sessionDir = findSessionDir(join(dshHome, 'sessions'), sessionId);
  if (!sessionDir) {
    fail('她家 sessions 下找不到这段会话：' + sessionId, '先把会话目录拷进 <dshHome>\\sessions\\<项目键>\\ 再登记');
  }
  if (!existsSync(wsFile)) {
    fail('她的界面登记文件不存在：' + wsFile, '先在网页里打开她一次（让 DSH 建 storages\\workspace.json），或参考 docs\\detail\\怎么生一条新鱼.md');
  }

  const data = JSON.parse(readFileSync(wsFile, 'utf8'));
  const homePathRaw = String(m.home ?? m.cwd ?? dshHome);
  let workspaces = Object.entries(data?.tables?.workspaces ?? {});
  let createdWorkspaceId = null;
  if (workspaces.length === 0) {
    // 老鱼（workbench 早期版本）只有 defaultWorkspaceId、tables.workspaces 是空的；
    // 界面不会自己补，所以这里按她家建一个"家"工作区再登记。
    const id = randomUUID();
    const now = new Date().toISOString();
    data.tables = data.tables ?? {};
    data.tables.workspaces = data.tables.workspaces ?? {};
    data.tables.workspaces[id] = {
      path: homePathRaw,
      title: '家',
      sessionIds: [],
      createdAt: now,
      updatedAt: now,
    };
    data.global = data.global ?? {};
    data.global.workspaceIds = Array.isArray(data.global.workspaceIds) ? data.global.workspaceIds : [];
    data.global.workspaceIds.push(id);
    if (!data.global.defaultWorkspaceId) data.global.defaultWorkspaceId = id;
    createdWorkspaceId = id;
    workspaces = Object.entries(data.tables.workspaces);
  }

  const homePath = normPath(homePathRaw);
  let target = workspaces.find(([, w]) => normPath(w?.path) === homePath);
  if (!target && workspaces.length === 1) target = workspaces[0];
  if (!target) {
    fail(
      '没有路径匹配她家的工作区（名册 home=' + (m.home ?? '(空)') + '）',
      '现有工作区：' + workspaces.map(([id, w]) => (w?.path ?? '?') + '（' + id + '）').join('；') + '。核对哪一个是她的家',
    );
  }

  const [wsId, ws] = target;
  ws.sessionIds = Array.isArray(ws.sessionIds) ? ws.sessionIds : [];
  if (ws.sessionIds.includes(sessionId) && !createdWorkspaceId) {
    console.log('· 已经登记过：' + sessionId + ' → ' + (ws.title ?? wsId) + '（' + (ws.path ?? '?') + '）');
    return;
  }

  if (!ws.sessionIds.includes(sessionId)) ws.sessionIds.push(sessionId);
  ws.updatedAt = new Date().toISOString();
  if (dryRun) {
    console.log('· dry-run：会登记 ' + sessionId + ' → ' + (ws.title ?? wsId));
    if (createdWorkspaceId) console.log('  会顺带建一个「家」工作区（她的表里一个都没有）');
    console.log('  登记后 sessionIds：' + JSON.stringify(ws.sessionIds));
    return;
  }

  const tmp = wsFile + '.tmp-' + process.pid;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tmp, wsFile);
  console.log('✓ 已登记 ' + sessionId);
  if (createdWorkspaceId) console.log('  顺带建了「家」工作区：' + homePathRaw);
  console.log('  工作区：' + (ws.title ?? wsId) + '（' + (ws.path ?? '?') + '）');
  console.log('  sessionIds 现在 ' + ws.sessionIds.length + ' 段');
  console.log('NEXT: 刷新她的网页（或 fish.ps1 down/up 她一次），「未分组」里就没了');
}

try {
  main();
} catch (e) {
  fail('执行失败：' + (e?.message ?? e), '把完整报错贴出来；这个脚本只改 workspace.json 的 sessionIds');
}
