// 第三方补丁脚本的行为测试（bili-eyes 转写失败文案）。
//
// 2026-11-18 小满验出一条真问题：`--check` 本应只读，实际会顺手把补丁打上——
// 于是"忘了重打"永远查不出来：检查的那一刻它自己把洞补了，然后回你一个 exit 0。
// 判据：检查器不能在检查的时候改变被检查的东西。
//
// 用法：node scripts/test-thirdparty-patch.mjs（PASS/FAIL 计数器在最后）

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'patch-bili-eyes-note.mjs');

let pass = 0;
let fail = 0;
function ok(name, cond, extra = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${extra ? ' → ' + extra : ''}`);
  }
}

function run(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

// 造一个"上游原版"的 look.js（与 0.8.3 的形状一致：顶层两句文案表 + 单行 push）
const ORIGINAL = [
  '// upstream fixture',
  'const TRANSCRIPT_NOTE = {',
  "  'no-key': '没有台词：本机转写服务没开，也没有字幕',",
  "  none: '没有台词',",
  '};',
  '',
  'function compactCells(result) {',
  '  const lines = [];',
  '  const src = result.transcript?.source;',
  '  if (src && TRANSCRIPT_NOTE[src]) lines.push(`（${TRANSCRIPT_NOTE[src]}）`);',
  '  return lines;',
  '}',
  '',
].join('\n');

function makePond() {
  const root = mkdtempSync(path.join(tmpdir(), 'llw-tpp-'));
  const dir = path.join(root, 'homes', 'a', 'dsh-home', 'profiles', 'a', 'node_modules', 'dsh-bili-eyes', 'src');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'look.js');
  writeFileSync(file, ORIGINAL, 'utf8');
  return { root, file };
}

console.log('第三方补丁：行为测试');

// 1. --check 只读：报可打、exit 1、文件一个字节都不变
{
  const { root, file } = makePond();
  const r = run(['--check', '--pond', root]);
  ok('--check 空安装时 exit 1', r.code === 1, `实际 ${r.code}`);
  ok('--check 说"未写入"', r.out.includes('--check，未写入'), r.out.trim().split('\n').pop());
  ok('--check 不改文件（检查器不能在检查时改被检查的东西）', readFileSync(file, 'utf8') === ORIGINAL);
  rmSync(root, { recursive: true, force: true });
}

// 2. --dry-run 只读、exit 0
{
  const { root, file } = makePond();
  const r = run(['--dry-run', '--pond', root]);
  ok('--dry-run exit 0', r.code === 0, `实际 ${r.code}`);
  ok('--dry-run 不改文件', readFileSync(file, 'utf8') === ORIGINAL);
  rmSync(root, { recursive: true, force: true });
}

// 3. 真打：补三句 + 带 error
{
  const { root, file } = makePond();
  const r = run(['--pond', root]);
  const text = readFileSync(file, 'utf8');
  ok('打补丁 exit 0', r.code === 0, `实际 ${r.code}`);
  ok('文件里有 MARK', text.includes('2026-11-18 本地补丁'));
  ok('补了 asr-failed', text.includes("'asr-failed'"));
  ok('补了 file-failed', text.includes("'file-failed'"));
  ok('补了 no-audio', text.includes("'no-audio'"));
  ok('带上了 transcript.error', text.includes('const why = String(result.transcript?.error'));
  ok('写了备份文件', run(['--check', '--pond', root]).code === 0);
  rmSync(root, { recursive: true, force: true });
}

// 4. 幂等：第二次打 0 个
{
  const { root } = makePond();
  run(['--pond', root]);
  const again = run(['--pond', root]);
  ok('重复打补丁不重复改（本次打 0）', again.out.includes('本次打 0'), again.out.trim().split('\n').pop());
  rmSync(root, { recursive: true, force: true });
}

// 5. 没装插件的鱼塘：exit 2，且说清"没找到"
{
  const root = mkdtempSync(path.join(tmpdir(), 'llw-tpp-empty-'));
  const r = run(['--check', '--pond', root]);
  ok('没安装时 exit 2（不欠，不是失败）', r.code === 2, `实际 ${r.code}`);
  ok('说清"没有找到"', r.out.includes('没有找到任何 dsh-bili-eyes 安装'));
  rmSync(root, { recursive: true, force: true });
}

// 6. 静态接线：doctor 有这一格、fish.ps1 的两个自动触发点都在
{
  const doctor = readFileSync(path.join(HERE, '..', 'scripts', 'doctor.ps1'), 'utf8');
  ok('doctor 有「第三方补丁（bili-eyes）」格', doctor.includes('第三方补丁（bili-eyes）'));
  ok('doctor 调 --check', doctor.includes('--check'));
  const fish = readFileSync(path.join(HERE, '..', 'scripts', 'fish.ps1'), 'utf8');
  ok('fish.ps1 定义 Show-BiliEyesPatchStatus', fish.includes('function Show-BiliEyesPatchStatus'));
  ok('起鱼时自动跑（Invoke-Up 里调用）', /function Invoke-Up[\s\S]*?Show-BiliEyesPatchStatus/.test(fish));
  ok('读升级单时自动跑（Invoke-UpgradeCheck 里调用）', /function Invoke-UpgradeCheck[\s\S]*?Show-BiliEyesPatchStatus/.test(fish));
}

console.log('');
console.log(`test-thirdparty-patch：合计 ${pass + fail}，PASS ${pass}，FAIL ${fail}`);
process.exit(fail > 0 ? 1 : 0);
