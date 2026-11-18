// 第三方补丁脚本的行为测试（bili-eyes 转写失败文案）。
//
// 2026-11-18 小满验出一条真问题：`--check` 本应只读，实际会顺手把补丁打上——
// 于是"忘了重打"永远查不出来：检查的那一刻它自己把洞补了，然后回你一个 exit 0。
// 判据：检查器不能在检查的时候改变被检查的东西。
//
// 用法：node scripts/test-thirdparty-patch.mjs（PASS/FAIL 计数器在最后）

import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, readdirSync, rmSync, linkSync, statSync, existsSync } from 'node:fs';
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
  "  else if (result.plan?.inputs && result.plan.inputs.speechRate === 0) lines.push('（这段基本没人说话：音乐或环境声）');",
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

// 2026-11-18 LeeaCP（r298）：造多份安装的鱼塘——断链之后每份是独立文件，
// "只改一份"必须能被 --check 看见。
function makePondMulti(keys = ['a', 'b'], versions = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'llw-tpp-multi-'));
  const files = {};
  for (const k of keys) {
    const pkg = path.join(root, 'homes', k, 'dsh-home', 'profiles', k, 'node_modules', 'dsh-bili-eyes');
    const dir = path.join(pkg, 'src');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'dsh-bili-eyes', version: versions[k] || '0.8.3' }), 'utf8');
    const file = path.join(dir, 'look.js');
    writeFileSync(file, ORIGINAL, 'utf8');
    files[k] = file;
  }
  return { root, files };
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
  // 2026-11-18 小鱼丸 #1623：没有 transcript 对象时也是一句自己的话，不能掉进"没人说话"
  ok('第三半：没有 transcript 对象时有自己的一句', text.includes('没有拿到转写结果') && text.includes('else if (!result.transcript)'));
  ok('留了原始副本 look.js.orig-0.8.3（能重打也要能回退）', readFileSync(`${file}.orig-0.8.3`, 'utf8') === ORIGINAL);
  ok('留了当日备份 look.js.bak-20261118', readFileSync(`${file}.bak-20261118`, 'utf8') === ORIGINAL);
  ok('打完再 --check 应 exit 0', run(['--check', '--pond', root]).code === 0);
  rmSync(root, { recursive: true, force: true });
}

// 3b. 打了一半（标记在、推送句没补）：只读时能看见"可以补"，真打要补上另一半
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
  const check = run(['--check', '--pond', root]);
  ok('半打状态 --check exit 1', check.code === 1, `实际 ${check.code}`);
  ok('说"可以补"', check.out.includes('可以补'));
  ok('不再说成"找不到落点（插件版本可能变了）"', !check.out.includes('找不到落点'));
  const fix = run(['--pond', root]);
  ok('半打状态重跑能补上（不再空转）', fix.code === 0 && fix.out.includes('补上了另一半'), fix.out.trim().split('\n').slice(-2).join(' / '));
  ok('补完后 --check 真绿', run(['--check', '--pond', root]).code === 0);
  rmSync(root, { recursive: true, force: true });
}

// 3c. 只打了一半、缺的那半也找不到落点：要给出明确下一步（拿 orig 回滚），不能红着不动
{
  const { root, file } = makePond();
  run(['--pond', root]);
  const patched = readFileSync(file, 'utf8');
  // 标记在，但把推送分支整段换成一句认不出来的话
  const stuck = patched.replace(
    /if \(src && TRANSCRIPT_NOTE\[src\]\) \{[\s\S]*?\n  \}/,
    'lines.push(TRANSCRIPT_NOTE[src] || "");',
  );
  writeFileSync(file, stuck, 'utf8');
  const r = run(['--check', '--pond', root]);
  ok('无法自动补时 --check exit 1', r.code === 1, `实际 ${r.code}`);
  ok('明说"无法自动补"', r.out.includes('无法自动补'));
  ok('给出下一步：拿 orig 复制回去', r.out.includes('.orig-'));
  // 2026-11-18 小满：判不了 ≠ 你该动手；回滚是最重的动作，得先让人看 diff 再自己决定
  ok('先分清"判不了"（可能是上游自己修了）', r.out.includes('上游自己修了这句'));
  ok('回滚前要求先备份当前文件', r.out.includes('另存为') && r.out.includes('.bak-'));
  ok('提示不要直接回滚（先看 diff）', r.out.includes('先看 diff'));
  rmSync(root, { recursive: true, force: true });
}

// 3c2. 从没成功打过补丁（标记在、但 orig 从没生成过）：不能让人去 diff 一个不存在的文件
//      2026-11-18 小鱼丸：假塘里只有 look.js 一个文件，提示却写"与 look.js.orig-unknown 对一下"——
//      指向不存在的文件。判据：报缺席前先列目录真实有什么。
{
  const { root, file } = makePond();
  run(['--pond', root]);
  const patched = readFileSync(file, 'utf8');
  const stuck = patched.replace(
    /if \(src && TRANSCRIPT_NOTE\[src\]\) \{[\s\S]*?\n  \}/,
    'lines.push(TRANSCRIPT_NOTE[src] || "");',
  );
  writeFileSync(file, stuck, 'utf8');
  for (const name of readdirSync(path.dirname(file))) {
    if (name.startsWith('look.js.orig-')) rmSync(path.join(path.dirname(file), name));
  }
  const r = run(['--check', '--pond', root]);
  ok('没有 orig 时 --check exit 1', r.code === 1, `实际 ${r.code}`);
  ok('明说"没有 orig 可对"', r.out.includes('没有 orig 可对'));
  ok('不再让人去 diff 一个不存在的文件', !r.out.includes('对一下；若上游已自行修复'));
  ok('给出替代下一步（手工补 / 从同版本另一台拿）', r.out.includes('从同版本另一台'));
  // 2026-11-18 小满：别让读者自己去列目录；也给出"三句都在就是上游改措辞"的读法
  ok('把同目录真实文件名列出来', r.out.includes('目录里实际有：') && r.out.includes('look.js'));
  ok('给出可执行的判断（三句都在 = 上游改过措辞）', r.out.includes('上游改过措辞') && r.out.includes('asr-failed'));
  rmSync(root, { recursive: true, force: true });
}

// 3c3. orig 存在但版本名读不到：按目录里真实的那份对，而不是按当前 version 拼一个不存在的名字
{
  const { root, file, pkg } = makePond();
  run(['--pond', root]);
  const patched = readFileSync(file, 'utf8');
  const stuck = patched.replace(
    /if \(src && TRANSCRIPT_NOTE\[src\]\) \{[\s\S]*?\n  \}/,
    'lines.push(TRANSCRIPT_NOTE[src] || "");',
  );
  writeFileSync(file, stuck, 'utf8');
  const dir = path.dirname(file);
  const origName = readdirSync(dir).find((n) => n.startsWith('look.js.orig-'));
  const renamed = 'look.js.orig-0.7.0';
  rmSync(path.join(dir, renamed), { force: true });
  if (origName && origName !== renamed) rmSync(path.join(dir, origName));
  writeFileSync(path.join(dir, renamed), ORIGINAL, 'utf8');
  writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'dsh-bili-eyes' }), 'utf8'); // 版本读不到
  const r = run(['--check', '--pond', root]);
  ok('版本读不到时仍能指出目录里真实那份 orig', r.out.includes(renamed), r.out.trim().split('\n').slice(-4).join(' / '));
  ok('并说明 unknown 是"版本没读到"', r.out.includes('版本没读到'));
  // 2026-11-18 小鱼丸/小满：名字里没有 unknown 时，不能解释一个不在本行里的词
  ok('名字里没有 unknown 就不解释 unknown', !r.out.includes('unknown 是「版本没读到」') && !r.out.includes('unknown 不是版本号'));
  ok('但仍要说清"插件版本没读到"', r.out.includes('插件版本没读到'));
  rmSync(root, { recursive: true, force: true });
}

// 3c5. 没有 orig、版本也读不到：不要冒出一句解释 unknown 的话（此路径根本没生成过 orig）
{
  const { root, file, pkg } = makePond();
  run(['--pond', root]);
  const patched = readFileSync(file, 'utf8');
  const stuck = patched.replace(
    /if \(src && TRANSCRIPT_NOTE\[src\]\) \{[\s\S]*?\n  \}/,
    'lines.push(TRANSCRIPT_NOTE[src] || "");',
  );
  writeFileSync(file, stuck, 'utf8');
  const dir = path.dirname(file);
  for (const name of readdirSync(dir)) {
    if (name.startsWith('look.js.orig-')) rmSync(path.join(dir, name));
  }
  writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'dsh-bili-eyes' }), 'utf8');
  const r = run(['--check', '--pond', root]);
  ok('没有 orig 且版本读不到时，不解释未出现的词', !r.out.includes('orig 名字里的 unknown'), r.out.trim().slice(-200));
  rmSync(root, { recursive: true, force: true });
}

// 3d. 与 pnpm store 共享 inode（硬链接）：打补丁要断开链接，且 store 那份恢复成上游原样
//     2026-11-18 LeeaCP：原地写会把 store 也改掉；store 按内容 hash 命名，名字与内容对不上时
//     pnpm install/verify 可能重新解包，补丁就没了。
{
  const root = mkdtempSync(path.join(tmpdir(), 'llw-tpp-link-'));
  const mkLook = (member) => {
    const pkg = path.join(root, 'homes', member, 'dsh-home', 'profiles', member, 'node_modules', 'dsh-bili-eyes');
    mkdirSync(path.join(pkg, 'src'), { recursive: true });
    writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'dsh-bili-eyes', version: '0.8.3' }), 'utf8');
    return path.join(pkg, 'src', 'look.js');
  };
  const aFile = mkLook('a');
  const bFile = mkLook('b');
  writeFileSync(aFile, ORIGINAL, 'utf8');
  linkSync(aFile, bFile); // 两份 node_modules 共享一个 inode
  const storeFile = path.join(root, 'store', 'look.js');
  mkdirSync(path.dirname(storeFile), { recursive: true });
  linkSync(aFile, storeFile); // store 那份也挂同一个 inode
  const r = run(['--pond', root]);
  const aText = readFileSync(aFile, 'utf8');
  const bText = readFileSync(bFile, 'utf8');
  ok('共享 inode 的两个安装都打上了', aText.includes('2026-11-18 本地补丁') && bText.includes('2026-11-18 本地补丁'));
  ok('打完不再是同一个 inode（各鱼一份，nlink=1）', statSync(aFile).nlink === 1 && statSync(bFile).nlink === 1);
  ok('store 那份恢复成上游原样', readFileSync(storeFile, 'utf8') === ORIGINAL);
  ok('store 的链接计数回到 1', statSync(storeFile).nlink === 1);
  rmSync(root, { recursive: true, force: true });
}

// 3e. 已经原地打过（store 被污染）的旧状态：--detach 断开链接并恢复 store
{
  const root = mkdtempSync(path.join(tmpdir(), 'llw-tpp-link-old-'));
  const mkLook = (member) => {
    const pkg = path.join(root, 'homes', member, 'dsh-home', 'profiles', member, 'node_modules', 'dsh-bili-eyes');
    mkdirSync(path.join(pkg, 'src'), { recursive: true });
    writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'dsh-bili-eyes', version: '0.8.3' }), 'utf8');
    return path.join(pkg, 'src', 'look.js');
  };
  const aFile = mkLook('a');
  const bFile = mkLook('b');
  writeFileSync(aFile, ORIGINAL, 'utf8');
  linkSync(aFile, bFile);
  const storeFile = path.join(root, 'store', 'look.js');
  mkdirSync(path.dirname(storeFile), { recursive: true });
  linkSync(aFile, storeFile);
  // 真实情况里装过补丁的鱼都留了 .orig-* 备份；detach 靠它把 store 恢复成原样
  writeFileSync(`${aFile}.orig-0.8.3`, ORIGINAL, 'utf8');
  writeFileSync(`${bFile}.orig-0.8.3`, ORIGINAL, 'utf8');
  // 造"旧脚本原地写"的结果：补丁内容写穿硬链接，a/b/store 全变成补丁版
  const patched = ORIGINAL.replace(
    /const TRANSCRIPT_NOTE = \{[\s\S]*?\n\};/,
    [
      'const TRANSCRIPT_NOTE = {',
      "  'no-key': '没有台词：本机转写服务没开，也没有字幕',",
      "  none: '没有台词',",
      '  // 2026-11-18 本地补丁：转写/台词文件失败时，不能掉进「没人说话」那句',
      "  'asr-failed': '台词没转成：转写服务报错了（不是没人说话）',",
      "  'file-failed': '台词文件读不了（不是没人说话）',",
      "  'no-audio': '这段没有音轨（不是没人说话）',",
      '};',
    ].join('\n'),
  ).replace(
    'if (src && TRANSCRIPT_NOTE[src]) lines.push(`（${TRANSCRIPT_NOTE[src]}）`);',
    [
      'if (src && TRANSCRIPT_NOTE[src]) {',
      "    const why = String(result.transcript?.error ?? '').trim().replace(/\\s+/g, ' ');",
      "    lines.push(`（${TRANSCRIPT_NOTE[src]}${why ? `；原因：${why.slice(0, 160)}` : ''}）`);",
      '  }',
    ].join('\n'),
  );
  writeFileSync(aFile, patched, 'utf8'); // 写穿链接：store 也是补丁内容
  ok('造出的坏状态：store 里也是补丁内容', readFileSync(storeFile, 'utf8') === patched);
  const r = run(['--detach', '--pond', root]);
  ok('--detach exit 0', r.code === 0, `实际 ${r.code}`);
  ok('--detach 后 store 恢复原样', readFileSync(storeFile, 'utf8') === ORIGINAL);
  // 2026-11-18 小鱼丸 #1623 之后，--detach 跑完还会把缺的第三半补上（补丁内容只增不减）
  const stillPatched = [aFile, bFile].every((f) => {
    const s = readFileSync(f, 'utf8');
    return s.includes('asr-failed') && s.includes('没有拿到转写结果');
  });
  ok('--detach 后各鱼仍是补丁版（第三半也补上）', stillPatched);
  ok('--detach 后各自独立（nlink=1）', statSync(aFile).nlink === 1 && statSync(bFile).nlink === 1);
  ok('--detach 后 --check 仍绿', run(['--check', '--pond', root]).code === 0);
  rmSync(root, { recursive: true, force: true });
}

// 3f. 只缺第三半时 --check 要报出来、重跑要能补上（2026-11-18 小鱼丸 #1623）
{
  const { root, file } = makePond();
  run(['--pond', root]);
  const three = readFileSync(file, 'utf8');
  const two = three.replace(/  else if \(!result\.transcript\) \{[\s\S]*?\n  \}\n/, '');
  writeFileSync(file, two, 'utf8');
  const c = run(['--check', '--pond', root]);
  ok('只缺第三半时 --check exit 1', c.code === 1, `实际 ${c.code}`);
  ok('并点名"没有转写结果"', c.out.includes('没有转写结果'));
  const f = run(['--pond', root]);
  ok('重跑能把第三半补上', f.code === 0 && readFileSync(file, 'utf8').includes('没有拿到转写结果'));
  ok('补完 --check 绿', run(['--check', '--pond', root]).code === 0);
  rmSync(root, { recursive: true, force: true });
}

// 3g. 第四/五半（2026-11-18 小满 #1625）：表外名字与"空台词"不能落进"没人说话"
//     裁决：`file-empty` / `asr-empty` 不合并进"没人说话"——"我什么都没拿到"不是对内容的断言。
{
  const { root, file } = makePond();
  run(['--pond', root]);
  const text = readFileSync(file, 'utf8');
  ok('第四半：file-empty 有自己的话', text.includes("'file-empty'"));
  ok('第四半：asr-empty 有自己的话', text.includes("'asr-empty'"));
  ok('第四半：空台词说的是"台词是空的"', text.includes('台词是空的'));
  ok('第五半：表外名字有分支', /else if \(src && !\['file', 'subtitle', 'asr'\]\.includes\(src\)\)/.test(text));
  ok('第五半：提示里带出 src 本身', text.includes('台词状态没识别'));
  ok('第五半：说明这不是内容判断', text.includes('这是插件里的名字，不是内容判断'));
  ok('第四/五半与"没人说话"那句顺序正确（表外分支在 speechRate 之前）', text.indexOf('台词状态没识别') < text.indexOf('speechRate === 0'), '');
  ok('再 --check 仍绿', run(['--check', '--pond', root]).code === 0);
  rmSync(root, { recursive: true, force: true });
}

// 3h. 只缺第四/五半（三半已是旧版）：--check 要点名、重跑要能补上（不能让"已打过补丁"的安装停在旧版）
{
  const { root, file } = makePond();
  run(['--pond', root]);
  const full = readFileSync(file, 'utf8');
  // 退化成"三半版"：去掉空台词两条与表外名字那段
  const threeHalves = full
    .replace(/  'file-empty':[^\n]*\n/, '')
    .replace(/  'asr-empty':[^\n]*\n/, '')
    .replace(/  else if \(src && !\['file', 'subtitle', 'asr'\]\.includes\(src\)\) \{\n[\s\S]*?\n  \}\n/, '');
  writeFileSync(file, threeHalves, 'utf8');
  const c = run(['--check', '--pond', root]);
  ok('只缺第四/五半时 --check exit 1', c.code === 1, `实际 ${c.code}`);
  ok('并点名"空台词 / 表外名字"', c.out.includes('空台词') && c.out.includes('表外名字'), c.out.trim().split('\n').find((l) => l.includes('还差')) || '');
  const f = run(['--pond', root]);
  const after = readFileSync(file, 'utf8');
  ok('重跑能补上第四/五半', f.code === 0 && after.includes("'file-empty'") && after.includes('台词状态没识别'));
  ok('补完 --check 绿', run(['--check', '--pond', root]).code === 0);
  rmSync(root, { recursive: true, force: true });
}


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

// 7. 2026-11-18 小鱼丸 #1626 / 小肥鱼 #1627：账本里"我是谁"和"通道交付算不算一次叫醒"
{
  const lib = readFileSync(path.join(HERE, '..', 'plugin', 'dsh-lil-whale-group', 'lib', 'index.js'), 'utf8');
  ok('boot 行带 member=（名册键）', /member:\s*bootMember \?\? '\(unresolved\)'/.test(lib));
  ok('boot 的 member 只写能证明的（selfMemberKeyRaw）', lib.includes('const bootMember = selfMemberKeyRaw()'));
  ok('通道交付也记一行 woke（trigger=channel）', lib.includes('trigger=channel'));
  ok('通道交付的 woke 行带 to=/channel=/pending=', /trigger=channel to=\$\{member\} channel=\$\{channel\.key\} pending=/.test(lib));
}


// 8. 2026-11-18 LeeaCP（r298）：断开硬链接后"改一处、四处一起变"没了——
//    只打一份，另外几份会静默停在旧版，而 --check 只看标记在不在。
//    --check 要多比一层：同版本的多份安装，内容必须一致。
{
  const a = makePondMulti(['a', 'b']);
  const patchAll = run(['--pond', a.root]);
  ok('多安装：一起打补丁 exit 0', patchAll.code === 0, patchAll.out.slice(-200));
  const same = run(['--check', '--pond', a.root]);
  ok('多安装：内容一致时 --check exit 0', same.code === 0, same.out.slice(-200));
  ok('多安装：一致时不说"版本不齐"', !/版本不齐/.test(same.out), same.out.slice(-300));

  // 只改一份（模拟"只给一条鱼打了、另外没打"）：标记都在，只有内容变了
  appendFileSync(a.files.b, '\n// drift: 只改了 b 这一份\n', 'utf8');
  const drift = run(['--check', '--pond', a.root]);
  ok('多安装：只改一份时 --check exit 1', drift.code === 1, `exit=${drift.code}`);
  ok('多安装：点名"补丁版本不齐"', /补丁版本不齐/.test(drift.out), drift.out.slice(-300));
  ok('多安装：两份成员都点到（a、b）', /a/.test(drift.out) && /b/.test(drift.out), drift.out.slice(-300));
  ok('多安装：给出下一步（逐份 --dry-run）', /逐份跑 --dry-run/.test(drift.out), drift.out.slice(-300));
  // 2026-11-18 LeeaCP（r299）：报"不齐"之后还要说清哪一份旧——路径 + mtime，
  // 否则人还得自己到四台里去找。这里点名"最早修改"的那一组（线索，不是结论）。
  ok('多安装：每组列出路径与 mtime', /look\.js（\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}）/.test(drift.out), drift.out.slice(-600));
  ok('多安装：点名哪一组最早修改（名字 + 时间）', /最早修改的是 a（\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}）/.test(drift.out), drift.out.slice(-600));
  // 2026-11-18 LeeaCP（r303）：期望内容才是判据——a 与期望一致，b 是旧的，且能报第一处差异。
  ok('期望内容：与期望一致的是 a', /与期望一致的是 a/.test(drift.out), drift.out.slice(-800));
  ok('期望内容：点名与期望不一致的是 b', /与期望不一致的是 b/.test(drift.out), drift.out.slice(-800));
  ok('期望内容：给出第一处差异行号', /第一处差异在 L\d+/.test(drift.out), drift.out.slice(-800));
  rmSync(a.root, { recursive: true, force: true });

  // 多数派/mtime 会指错人：三份里两份新、一份被单独改成"看起来打了、其实不是期望内容"。
  // 只有跟期望比不会——这是 LeeaCP 私信里那条「期望值才是判据」的反例。
  const r = makePondMulti(['a', 'b', 'c']);
  run(['--pond', r.root]);
  const origC = `${r.files.c}.orig-0.8.3`;
  ok('回退用例：orig 副本存在', existsSync(origC));
  appendFileSync(r.files.c, '\n// drift: c 被单独追加过，mtime 最新\n', 'utf8'); // 标记都在，内容不是期望
  const back = run(['--check', '--pond', r.root]);
  ok('回退用例：--check exit 1', back.code === 1, `exit=${back.code}`);
  ok('回退用例：期望内容点名 c 是旧的（不按 mtime/多数派指 a、b）', /与期望不一致的是 c/.test(back.out), back.out.slice(-800));
  rmSync(r.root, { recursive: true, force: true });

  // 不同版本各自打好：不比内容，但要说清"版本不同"
  const d = makePondMulti(['a', 'b'], { b: '0.8.4' });
  run(['--pond', d.root]);
  const mixed = run(['--check', '--pond', d.root]);
  ok('多版本：各自补齐时 --check exit 0', mixed.code === 0, mixed.out.slice(-300));
  ok('多版本：说明"安装的插件版本不同"', /安装的插件版本不同/.test(mixed.out), mixed.out.slice(-300));
  rmSync(d.root, { recursive: true, force: true });
}

console.log(`test-thirdparty-patch：合计 ${pass + fail}，PASS ${pass}，FAIL ${fail}`);
process.exit(fail > 0 ? 1 : 0);
