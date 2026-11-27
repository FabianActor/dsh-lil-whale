// 把一个「中立 persona」的 preset 装进某个 profile 的 patch 里（搬段那天用）。
//
// 为什么要有这个脚本：cordis.patch.yml 是 YAML，手改要管缩进、`- insert:` 的层级、
// 文件末尾换行、以及"跑第二遍会不会插两份"。这个脚本做四件事：
//   1) 现读当前 dsh 的 standard，生成中立 preset（复用 gen-neutral-preset.mjs，不手抄）
//   2) 幂等地插进 patch：只重建自己生成的那几段（`- insert:` 里的 preset-neutral、可选的 B站 眼睛），
//      标记行之后别人写进来的顶层段（设置页的 agent-default-model / ui-settings-general 等）原样保留
//      —— 2026-11-27 issue #10：以前把标记行之后整段切掉，设置页写进去的段会静默消失
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
import { loadConfig } from './lib/config-path.mjs';
import { mergeNeutralPatch, NEUTRAL_MARKER } from './lib/neutral-patch-core.mjs';
import { topBlockIds } from './lib/patch-preserve.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 配置三态见 lib/config-path.mjs：`LIL_WHALE_CONFIG` 给了但文件不在时退出（不落回真配置，r242）；
// 这份脚本在"没有配置"时也能跑（参数齐全就行），所以只拦"你给的路径不在"。
const cfgOut = loadConfig({ repoRoot });
if (cfgOut.error && cfgOut.source === 'env-given-missing') {
  console.error(`xx ${cfgOut.error}\n\nNEXT: ${cfgOut.next}`);
  process.exit(1);
}
function readConfig() {
  return cfgOut.cfg || {};
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

// ---- 2) 幂等地重写自己那几段 ----
const original = fs.readFileSync(patchFile, 'utf8');

// ---- 1b) 可选：只读 B站 MCP 眼睛（--with-bili <鱼键>）----
function biliEyeBlock(member) {
  const pondRoot = path.resolve(cfg.poolDir || path.join(repoRoot, '..', 'pool'), '..');
  const poolDir = cfg.poolDir || path.join(pondRoot, 'pool');
  const stateDir = cfg.poolStateDir || path.join(poolDir, 'state');
  const py = cfg.biliPython || path.join(process.env.USERPROFILE || '', '.dsh', 'bili-duty', '.venv', 'Scripts', 'python.exe');
  const tools = [
    'bili_search', 'bili_video_info', 'bili_subtitle', 'bili_comments', 'bili_danmaku', 'bili_frames', 'bili_grab', 'bili_cover',
    'bili_hot_videos', 'bili_rank', 'bili_weekly_hot', 'bili_recommend', 'bili_video_zones', 'bili_hot_buzzwords',
    'bili_user_info', 'bili_user_videos',
  ].join(',');
  return [
    '# 只读的 B站 眼睛：16 个工具，没有评论/点赞/私信/登录。',
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

const defaultBlock = [
  '# 默认 preset 改成中立：她的每一段新会话都用「你能做 X」而不是「你是 X」。',
  '- id: agent-preset-registry',
  '  name: "@deepseek-ai/dsh-agent-preset-registry"',
  '  config:',
  '    default: neutral',
].join('\n');

// 开了换段的鱼，新段一律用 neutral preset：默认 registry 也得是 neutral，
// 否则从设置页新起的会话又会回到 standard（issue #10 里那半条）。
function rotationEnabled(key) {
  const poolDir = cfg.poolDir || path.join(repoRoot, '..', 'pool');
  const stateDir = cfg.poolStateDir || path.join(poolDir, 'state');
  const dir = path.join(stateDir, 'rotation');
  const read = (f) => {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
  };
  const mine = read(path.join(dir, `${key}.json`));
  const on = (o) => Boolean(o) && (o.enabled === true || (o.enabled !== false && typeof o.rounds === 'number' && o.rounds > 0));
  if (mine) return on(mine);
  return on(read(path.join(dir, '_default.json')));
}

const rotationOn = rotationEnabled(profile);
const effectiveDefault = wantDefault || rotationOn;

const merged = mergeNeutralPatch({
  text: original,
  insertBlock,
  wantDefault: effectiveDefault,
  defaultBlock,
  biliBlock: withBili ? biliEyeBlock(withBili) : null,
  marker: NEUTRAL_MARKER,
});

// 安全闸：顶层 id 只许多、不许少。issue #10 的根因就是"少了也没人报"。
const afterIds = new Set(topBlockIds(merged.text));
const lost = topBlockIds(original).filter((id) => !afterIds.has(id));
if (lost.length) {
  console.error(`xx 这次重写会让这些顶层段消失：${lost.join('、')}`);
  console.error('   没有写盘。NEXT: 这不是你的 patch 的问题，是脚本的 bug —— 把 patch 复制一份留证，然后报 issue。');
  process.exit(1);
}

if (!merged.changed) {
  console.log('已经是最新的：patch 里那段和当前生成器一致，什么都没改。');
  process.exit(0);
}

if (rotationOn && !wantDefault) {
  console.log(`note：这条鱼开着换段（${profile}），默认 preset 一起补成 neutral。`);
}
if (merged.kept.length) {
  console.log(`保留（不是脚本写的）：${merged.kept.join('、')}`);
}

if (dryRun) {
  console.log('--dry-run：会写成下面这样，不写盘：');
  console.log(merged.text);
  process.exit(0);
}

// ---- 3) 备份 + tmp + rename ----
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
const backup = `${patchFile}.bak-${stamp}`;
fs.copyFileSync(patchFile, backup);
const tmpFile = `${patchFile}.tmp-${process.pid}`;
fs.writeFileSync(tmpFile, merged.text, 'utf8');
fs.renameSync(tmpFile, patchFile);
console.log(`写好了：${patchFile}`);
console.log(`备份：${backup}`);

// ---- 4) 只读验证：--patch 把新文件当额外一层，看能不能合成 ----
const verify = runDsh(['--profile', profile, '--patch', patchFile, '--dump-config']);
const out = verify.stdout.replace(/\r\n/g, '\n');
const hasPresetAfter = /- id: preset-neutral/.test(out);
const hasNeutralDefault = /default: neutral/.test(out);
if (verify.status !== 0 || !hasPresetAfter || (effectiveDefault && !hasNeutralDefault)) {
  console.error('验证失败，正在还原备份。');
  if (verify.status !== 0) console.error((verify.stderr || verify.stdout).trim().slice(0, 800));
  console.error(`  exit=${verify.status} 出现 preset-neutral=${hasPresetAfter} 出现 default: neutral=${hasNeutralDefault}`);
  fs.copyFileSync(backup, patchFile);
  console.error('已还原。NEXT: 看上面报错；patch 没坏。');
  process.exit(1);
}

console.log(`验证通过：--dump-config exit 0，preset-neutral 在，${effectiveDefault ? 'default: neutral 在' : '默认 preset 没动'}。`);
console.log('NEXT: 重启她的窗；新会话第一次醒来先读 notes\\交接.md。');
