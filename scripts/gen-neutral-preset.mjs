// 生成「中立 persona」的 preset 定义：从当前装着的 dsh 现读 standard 的插件清单，
// 只替换 persona 那一行的 prefix，其余原样搬过来。
//
// 为什么是生成而不是手写：preset 的 plugins 列表是完整快照，覆盖后不会自动合并上游更新
// （见 @deepseek-ai/dsh-agent-preset-registry README「用户覆盖替换完整子插件列表」）。
// 手抄 = 把今天这份冻结进仓库；生成 = 升级 dsh 后重跑一次就跟着走。
//
// 用法：
//   node scripts/gen-neutral-preset.mjs [--profile whale] [--out templates/preset-neutral.yml]
// 环境：DSH_HOME 指到目标 home（默认读 lil-whale.config.json 的 herDshHome）。
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
function opt(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
}

const cfg = readConfig();
const profile = opt('profile', cfg.whaleProfile || 'whale');
const outFile = path.resolve(repoRoot, opt('out', 'templates/preset-neutral.yml'));
const dshHome = opt('home', cfg.herDshHome || process.env.DSH_HOME);
if (!dshHome) {
  console.error('没有 DSH_HOME，也没有 herHome —— 不知道去哪个 home 里读 profile。');
  process.exit(1);
}

// 能力陈述，不是身份断言：不出现"你是 X"，只出现"你能做 X"。
// 判据（小肥鱼定的）：第一句里出现的是 `are` 还是 `can`——以 `You can` 开头，一个词就能判。
const NEUTRAL_PREFIX = [
  'You can do exactly what the tools and context provided allow: read and write files, run commands, and call APIs.',
  'Do not claim a role or identity beyond what those capabilities establish; let your persona emerge from what you actually do.',
].join(' ');

function runDsh(args) {
  // Windows 上 `dsh` 是 .cmd 外壳，不带 shell 找不到（spawnSync EINVAL）。
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

function dumpConfig() {
  const r = runDsh(['--profile', profile, '--dump-config']);
  if (r.status !== 0) throw new Error(`dump-config 失败（exit ${r.status} signal ${r.signal} error ${r.error && r.error.code}）: ${(r.stderr || "").slice(0, 400)}`);
  return r.stdout.replace(/\r\n/g, '\n');
}

function extractPreset(yaml, presetId) {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((l) => l === `- id: preset-${presetId}`);
  if (start < 0) throw new Error(`dump-config 里找不到 - id: preset-${presetId}`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^- (id|insert|override|group):/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end);
}

function transform(block, { fromId, toId }) {
  const out = [];
  let replacedId = false;
  let replacedPrefix = false;
  for (const line of block) {
    if (!replacedId && line === '  config:' ) { /* no-op, keep order */ }
    if (!replacedId && line.trim() === `id: ${fromId}`) {
      out.push(line.replace(`id: ${fromId}`, `id: ${toId}`));
      replacedId = true;
      continue;
    }
    if (!replacedPrefix && /^\s+prefix: You are a coding agent powered by the/.test(line)) {
      const indent = line.match(/^\s+/)[0];
      // 单引号包住：prefix 里有 ": "，裸写会被 YAML 当成 mapping（实测 bad indentation）。
      out.push(`${indent}prefix: '${NEUTRAL_PREFIX.replace(/'/g, "''")}'`);
      replacedPrefix = true;
      continue;
    }
    out.push(line);
  }
  if (!replacedId) throw new Error(`没找到 config.id: ${fromId}`);
  if (!replacedPrefix) throw new Error('没找到 persona 的 prefix 行 —— standard 的样子变了，先看一眼再跑');
  return out;
}

const yaml = dumpConfig();
const standard = extractPreset(yaml, 'standard');
const neutral = transform(standard, { fromId: 'standard', toId: 'neutral' })
  // 第一行换成 preset-neutral 的行 id；order 放到最后
  .map((l, i) => (i === 0 ? '- id: preset-neutral' : l))
  .map((l) => (/^\s+order: 1$/.test(l) ? l.replace('order: 1', 'order: 9') : l));

const dshVersion = (() => {
  try {
    const r = runDsh(['--version']);
    return (r.stdout || '').trim() || 'unknown';
  } catch { return 'unknown'; }
})();

const body = [
  '# 中立 persona 的 preset（生成物，别手改）',
  '#',
  `# 来源：dsh ${dshVersion} 的 preset-standard（--dump-config 现读）`,
  `# 生成：${new Date().toISOString()}  脚本：scripts/gen-neutral-preset.mjs`,
  '# 用法：把下面这一段插进她的 profile patch（cordis.patch.yml）的 - insert: 列表里，',
  '#       然后在她那段新会话上选 preset=neutral；不要改默认 preset，除非确实要所有新会话都中立。',
  '#',
  '# 升级 dsh 之后重跑本脚本 —— preset 的 plugins 是完整快照，覆盖后不会自动合并上游更新。',
  '',
  '- insert:',
  ...neutral.map((l) => (l === '' ? '' : `    ${l}`)),
  '',
].join('\n');

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, body, 'utf8');
console.log(`写好了：${path.relative(repoRoot, outFile)}`);
console.log(`  standard 插件行数：${standard.length}（含缩进子行）`);
console.log(`  persona prefix 已换成能力陈述（${NEUTRAL_PREFIX.length} 字符）`);
console.log('  下一步：插进她的 profile patch，用 --dump-config 确认 preset-neutral 能挂上（不用重启）。');




