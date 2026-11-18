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
  const pkg = path.join(root, 'homes', 'a', 'dsh-home', 'profiles', 'a', 'node_modules', 'dsh-bili-eyes');
  const dir = path.join(pkg, 'src');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'dsh-bili-eyes', version: '0.8.3' }), 'utf8');
  const file = path.join(dir, 'look.js');
  writeFileSync(file, ORIGINAL, 'utf8');
  return { root, file, pkg };
}

console.log('第三方补丁：行为测试');

// 1. --check 只读：报可打、exit 1、文件一个字节都不变
{
  const { root, file } = makePond();
  const r = run(['--check', '--pond', root]);
  ok('--check 空安装时 exit 1', r.code === 1, `实际 ${r.code}`);
  ok('--check 说"未写入"', r.out.includes('--check，未写入'), r.out.trim().split('\n').pop());
  ok('--check 不改文件（检查器不能在检查时改被检查的东西）', readFileSync(file, 'utf8') === ORIGINAL);
  // 2026-11-18 小满：一个字节都没写，"本次打 1"却印出来了——汇报用的数要跟模式一致
  ok('--check 的小计不说"本次打"', !/本次打 \d/.test(r.out), r.out.trim().split('\n').find((l) => l.includes('小计')) || '');
  ok('--check 的小计写"可打"', /可打 1/.test(r.out));
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

// 3. 真打：补三句 + 带 error + 原始副本和备份
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
  ok('留了原始副本 look.js.orig-0.8.3（能重打也要能回退）', readFileSync(`${file}.orig-0.8.3`, 'utf8') === ORIGINAL);
  ok('留了当日备份 look.js.bak-20261118', readFileSync(`${file}.bak-20261118`, 'utf8') === ORIGINAL);
  ok('打完再 --check 应 exit 0', run(['--check', '--pond', root]).code === 0);
  rmSync(root, { recursive: true, force: true });
}

// 3b. 打了一半（标记在、推送句没补）要被单独点名，不能归成"版本可能变了"
{
  const { root, file } = makePond();
  run(['--pond', root]);
  const patched = readFileSync(file, 'utf8');
  // 把推送分支还原成上游单行版：只剩"标记在、推送句没补"
  const halfText = patched.replace(
    /if \(src && TRANSCRIPT_NOTE\[src\]\) \{[\s\S]*?\n  \}/,
    'if (src && TRANSCRIPT_NOTE[src]) lines.push(`（${TRANSCRIPT_NOTE[src]}）`);',
  );
  writeFileSync(file, halfText, 'utf8');
  const r = run(['--check', '--pond', root]);
  ok('半打状态 exit 1', r.code === 1, `实际 ${r.code}`);
  ok('点名"只打了一半"', r.out.includes('只打了一半'));
  ok('不再说成"找不到落点（插件版本可能变了）"', !r.out.includes('找不到落点'));
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
