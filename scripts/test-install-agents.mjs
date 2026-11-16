// 静态检查：身份纸（AGENTS.md）的写法和修法不许退化（2026-11-16 r190）。
// 为什么用 grep 而不是跑 install：完整安装会改很多真实文件；这条守的是"代码里还留着那四道护栏"。
// 它防的是"改回去"：来源又变成安装参数、只在不存在时写、或者把 -RepairAgents 删掉。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const app = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(app, p), 'utf8');
const install = read('scripts/install.ps1');
const doctor = read('scripts/doctor.ps1');

const checks = [];
const ok = (name, cond, detail = '') => checks.push({ name, pass: !!cond, detail });

ok('开关 -RepairAgents 存在', /\[switch\]\$RepairAgents,/.test(install));
ok('-RepairAgents 有独立分支（只重写身份纸）', /\nif \(\$RepairAgents\) \{/.test(install));
ok('身份纸的家从名册取（不再只认安装参数）', install.includes('$rosterForAgents.members.$childMember'));
ok('写入门槛带 -or $Force', install.includes('if (-not (Test-Path $agentsPath) -or $Force)'));
ok('写后自检：家不存在就 Die', install.includes('AGENTS.md 指向的家不存在'));
ok('写后自检：没有 START.md 就 Die', install.includes('AGENTS.md 指向的家没有 START.md'));
ok('doctor 有四路对齐格', doctor.includes("Add-Row ('身份纸（"));
ok('doctor 的 NEXT 指向 -RepairAgents', doctor.includes('-RepairAgents -ChildMemberId'));

// 2026-11-16 r195：装前必须确认鱼塘根、必须有 pnpm（第三方装机实测 P4/P10/P2）。
ok('有 -PondRoot 参数', /\[string\]\$PondRoot = ''/.test(install));
ok('有 -RepoPrepared 内部开关（防止复制后递归）', /\[switch\]\$RepoPrepared/.test(install));
ok('不在 app 布局时要求 -PondRoot', install.includes('这个项目要装在 <鱼塘根>\\app 里'));
ok('会建 <鱼塘根>\\app 并复制仓库', install.includes("$target = Join-Path $pond 'app'") && install.includes('已把仓库内容复制到'));
ok('复制完从新位置继续装', install.includes('从复制过去的那份继续安装'));
ok('装插件前检查 pnpm', install.includes('Get-Command pnpm') && install.includes('npm install --global pnpm@10'));

// 2026-11-16 r198：会话由用户选，安装脚本不替人挑（更不许拿"安装这段会话"顶替）。
// 2026-11-16 r199：安装目录不许静默选（第三方装机实测：agent 把仓库和 pool/homes 塞进会话工作区）。
const readme = read('README.md');
ok('install.ps1 能交互地问鱼塘根', install.includes('Read-Host "鱼塘根目录'));
ok('install.ps1 明确要求先问用户', install.includes('先问用户：把鱼塘放在哪个目录'));
ok('README 装了「先问用户目录」的声明', readme.includes('装之前先做一件事：问用户'));

const fish = read('scripts/fish.ps1');
ok('有 sessions 命令（列候选会话）', fish.includes('function Invoke-Sessions') && fish.includes("'sessions'"));
ok('安装说明：会话由用户决定，脚本不替挑', install.includes('这两段由用户决定，安装脚本不替你挑'));
ok('安装说明指向 fish.ps1 sessions', install.includes('fish.ps1 sessions $ParentMemberId'));

const fail = checks.filter((c) => !c.pass);
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
if (fail.length) {
  console.error(`test-install-agents：${checks.length} 项，FAIL ${fail.length} —— 身份纸的护栏被改掉了`);
  process.exit(1);
}
console.log(`PASS test-install-agents（${checks.length} 项：来源 / 覆盖 / 自检 / 修复开关 / 体检格）`);
