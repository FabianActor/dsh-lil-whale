// 把一个「中立 persona」的 preset 装进某个 profile 的 patch 里（搬段那天用）。
//
// 为什么要有这个脚本：cordis.patch.yml 是 YAML，手改要管缩进、`- insert:` 的层级、
// 文件末尾换行、以及"跑第二遍会不会插两份"。这个脚本做四件事：
//   1) 现读当前 dsh 的 standard，生成中立 preset（复用 gen-neutral-preset.mjs，不手抄）
//   2) 幂等地插进 patch（已有就跳过），可选把默认 preset 也改成 neutral
//   3) 写之前留备份，写用 tmp + rename
//   4) 写完用 `dsh --profile <p> --patch <新文件> --dump-config` 验一遍（只读，不用重启）
//
// 用法：
//   node scripts/apply-neutral-preset.mjs --patch <cordis.patch.yml> [--default] [--dry-run]
//   可选：--profile whale（默认读配置的 whaleProfile）、--home <DSH_HOME>
//
// 退出码：0 成功（或已经装过）；1 失败。失败时把备份还原回去。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readConfig() {
  for (const p of [process.env.LIL_WHALE_CONFIG, path.join(repoRoot, 'lil-whale.config.json'), path.join(repoRoot, 'lil-whale.config.example.json')]) {
    if (p && fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return {};
}

const argv = process.argv.slice(2);
function flag(name) { return argv.includes(`--${name}`); }
function opt(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
}

const cfg = readConfig();
const patchArg = opt('patch', null);
const profile = opt('profile', cfg.whaleProfile || 'whale');
const dshHome = opt('home', cfg.selfDshHome || cfg.herDshHome || process.env.DSH_HOME);
const wantDefault = flag('default');
const dryRun = flag('dry-run');
// 2026-11-14：可选给这条鱼挂一只"只读看 B站"的眼睛（MCP）。
// 为什么由生成器产出：这段以前是手写进 patch 的，而 apply 重跑会切掉标记之后整段 ⇒
// 手写的那份会在某次重跑里悄悄消失。放进生成器，重跑等于重建，不会丢。
const withBili = opt('with-bili', null);

if (!patchArg) {
  console.error('缺 --patch：给我 profile 的 cordis.patch.yml 路径。');
  console.error('NEXT: node scripts\\apply-neutral-preset.mjs --patch "<她的 DSH_HOME>\\profiles\\whale\\cordis.patch.yml" --default');
  process.exit(1);
}
const patchFile = path.resolve(patchArg);
if (!fs.existsSync(patchFile)) {
  console.error(`patch 不存在：${patchFile}`);
  process.exit(1);
}
if (!dshHome) {
  console.error('没有 DSH_HOME，也没有 herDshHome —— 不知道去哪个 home 里验。');
  process.exit(1);
}

function runDsh(args) {
  const shim = process.platform === 'win32' ? 'dsh.cmd' : 'dsh';
  const r = spawnSync(shim, args, {
    cwd: repoRoot,
    env: { ...process.env, DSH_HOME: dshHome },
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// ---- 1) 生成中立 preset（复用生成器，不手抄）----
const genOut = path.join(repoRoot, 'tmp', `preset-neutral-${process.pid}.yml`);
const gen = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'gen-neutral-preset.mjs'), '--out', genOut, '--profile', profile, '--home', dshHome], {
  cwd: repoRoot,
  encoding: 'utf8',
  windowsHide: true,
});
if (gen.status !== 0 || !fs.existsSync(genOut)) {
  console.error('生成中立 preset 失败：');
  console.error((gen.stderr || gen.stdout || '').trim().slice(0, 800));
  process.exit(1);
}
const generated = fs.readFileSync(genOut, 'utf8');
fs.rmSync(genOut, { force: true });

// 去掉生成器头部的注释，只留 `- insert:` 这一段
const insertBlock = generated
  .split('\n')
  .filter((l) => !l.startsWith('#'))
  .join('\n')
  .replace(/^\s*\n/, '')
  .trimEnd();

// ---- 2) 幂等地插进 patch ----
let text = fs.readFileSync(patchFile, 'utf8');
const hadBom = text.charCodeAt(0) === 0xFEFF;
if (hadBom) text = text.slice(1);
const original = text;

// 上次追加的整段总是落在文件末尾：先切掉，再按当前生成器重写。
// 这样重跑 apply 能更新 persona 文案，而不是"已经装过"就跳过。
const MARKER = '# ---- 以下由 scripts/apply-neutral-preset.mjs 追加 ----';
const markerAt = text.indexOf(MARKER);
const base = markerAt >= 0 ? `${text.slice(0, markerAt).replace(/\n+$/, '')}\n` : text;

const hasPreset = /^\s*-\s*id:\s*preset-neutral\s*$/m.test(base);
const hasDefaultNeutral = /^\s*default:\s*neutral\s*$/m.test(base);

// ---- 1b) 可选：只读 B站 MCP 眼睛（--with-bili <鱼键>）----
function biliEyeBlock(member) {
  const pondRoot = path.resolve(cfg.poolDir || path.join(repoRoot, '..', 'pool'), '..');
  const poolDir = cfg.poolDir || path.join(pondRoot, 'pool');
  const stateDir = cfg.poolStateDir || path.join(poolDir, 'state');
  const py = cfg.biliPython || path.join(process.env.USERPROFILE || '', '.dsh', 'bili-duty', '.venv', 'Scripts', 'python.exe');
  const tools = [
    'bili_search', 'bili_video_info', 'bili_subtitle', 'bili_comments', 'bili_danmaku', 'bili_frames', 'bili_cover',
    'bili_hot_videos', 'bili_rank', 'bili_weekly_hot', 'bili_recommend', 'bili_video_zones', 'bili_hot_buzzwords',
    'bili_user_info', 'bili_user_videos',
  ].join(',');
  return [
    '# 只读的 B站 眼睛：15 个工具，没有评论/点赞/私信/登录。',
    '# 每条鱼一个 MCP 子进程；cookie 在 pool\\mcp\\bili\\bili_credential.json（共用同一个号）。',
    '- insert:',
    '    - id: mcp-bili-readonly',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        transport: stdio',
    '        serverName: bili',
    `        command: '${py}'`,
    '        args:',
    `          - '${path.join(poolDir, 'mcp', 'bili', 'mcp_server.py')}'`,
    `        cwd: '${path.join(poolDir, 'mcp', 'bili')}'`,
    '        env:',
    `          BILI_MCP_TOOLS: '${tools}'`,
    `          BILI_MEMBER: '${member}'`,
    `          BILI_STATE_DIR: '${path.join(stateDir, 'bili')}'`,
    `          BILI_DUTY_HOME: '${path.join(pondRoot, 'homes', member, 'bili')}'`,
    "          BILI_QUOTA_PER_DAY: '80'",
    "          PYTHONIOENCODING: 'utf-8'",
    "          PYTHONUTF8: '1'",
    '        failOnStartupError: false',
  ].join('\n');
}

const additions = [];
if (!hasPreset) additions.push(insertBlock);
if (wantDefault && !hasDefaultNeutral) {
  additions.push([
    '# 默认 preset 改成中立：她的每一段新会话都用「你能做 X」而不是「你是 X」。',
    '- id: agent-preset-registry',
    '  name: "@deepseek-ai/dsh-agent-preset-registry"',
    '  config:',
    '    default: neutral',
  ].join('\n'));
}

if (withBili) additions.push(biliEyeBlock(withBili));

if (additions.length === 0) {
  console.log('已经装过了：patch 里既有 preset-neutral' + (wantDefault ? '、默认也已是 neutral' : '') + '。什么都没改。');
  process.exit(0);
}

let next = base.endsWith('\n') || base === '' ? base : `${base}\n`;
next += `\n${MARKER}\n`;
for (const a of additions) next += `${a}\n`;

if (next === original) {
  console.log('已经是最新的：patch 里那段和当前生成器一致，什么都没改。');
  process.exit(0);
}

if (dryRun) {
  console.log('--dry-run：会写成下面这样（只显示追加段），不写盘：');
  console.log(next.slice(base.length));
  process.exit(0);
}

// ---- 3) 备份 + tmp + rename ----
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
const backup = `${patchFile}.bak-${stamp}`;
fs.copyFileSync(patchFile, backup);
const tmpFile = `${patchFile}.tmp-${process.pid}`;
fs.writeFileSync(tmpFile, (hadBom ? '\uFEFF' : '') + next, 'utf8');
fs.renameSync(tmpFile, patchFile);
console.log(`写好了：${patchFile}`);
console.log(`备份：${backup}`);

// ---- 4) 只读验证：--patch 把新文件当额外一层，看能不能合成 ----
const verify = runDsh(['--profile', profile, '--patch', patchFile, '--dump-config']);
const out = verify.stdout.replace(/\r\n/g, '\n');
const hasPresetAfter = /- id: preset-neutral/.test(out);
const hasNeutralDefault = /default: neutral/.test(out);
if (verify.status !== 0 || !hasPresetAfter || (wantDefault && !hasNeutralDefault)) {
  console.error('验证失败，正在还原备份。');
  if (verify.status !== 0) console.error((verify.stderr || verify.stdout).trim().slice(0, 800));
  console.error(`  exit=${verify.status} 出现 preset-neutral=${hasPresetAfter} 出现 default: neutral=${hasNeutralDefault}`);
  fs.copyFileSync(backup, patchFile);
  console.error('已还原。NEXT: 看上面报错；patch 没坏。');
  process.exit(1);
}

console.log(`验证通过：--dump-config exit 0，preset-neutral 在，${wantDefault ? 'default: neutral 在' : '默认 preset 没动'}。`);
console.log('NEXT: 重启她的窗；新会话第一次醒来先读 notes\\交接.md。');
