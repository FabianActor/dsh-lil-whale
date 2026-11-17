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
// 2026-11-17 r240：lee2（根鱼）那次 gen-family 拒绝写、install 只 Warn 吞了 —— 谱系必须多根 + 写完验节点。
ok('install 写完谱系会校验新鱼在节点里', install.includes('谱系里没有这条新鱼'));
ok('gen-family 允许并列多个鱼根', !read('scripts/gen-family.mjs').includes('鱼应该只有一个根'));
ok('doctor 有谱系（全鱼）一格', doctor.includes("Add-Row '谱系（全鱼）'"));

// 2026-11-16 r201：-SkipParent 的名字与说明不能让人读成"只装鱼、不装宿主"。
ok('SkipParent 有更明确的名字 SkipParentPlugins', install.includes("Alias('SkipParentPlugins')"));
ok('SkipParent 的说明写明第一次安装别用', install.includes('第一次安装别用'))

// 2026-11-16 第四份沉淀（P1/P2/P4）：布局判据、首鱼出生账、npx 探测。
const repairUndici = read('scripts/repair-undici.mjs');
ok('鱼塘布局判据不依赖 pool 目录是否已存在', !install.includes("Test-Path (Join-Path $PondRoot 'pool')"));
ok('首鱼也写 births.log', install.includes('births.log（首鱼出生账）'));
ok('repair-undici 会扫 npx 缓存', repairUndici.includes('_npx'));;

// 2026-11-16 r215：第一次安装必须先问名字与成员键，不许替用户决定。
ok('有 -ParentName 参数', install.includes('-ParentName'));
ok('有 -HumanName 参数', install.includes('-HumanName'));
ok('非交互时会停下并列出该问什么', install.includes('第一次安装前先问用户这几件事'));
ok('交互时会真问（用了 Read-Host）', /第一次安装[\s\S]{0,4000}?Read-Host/.test(install));
ok('名册里的父辈名不再写死"宿主"', !install.includes("name = '宿主'; kind = 'fish'"));
ok('安装器讲清“名字与成员键是两件事”', install.includes('名字和成员键是两件事'));
ok('每个提问都注明显示名可改/成员键可自定义', install.includes('可改成别的中文名') && install.includes('可自定义如 keeper'));
ok('名册里的人类名不再写死"人类"', !install.includes("name = '人类'; kind = 'human'"));

// 2026-11-16 r216：第一条鱼的键固定 fish；bind 也接受宿主。
ok('首次安装固定第一条鱼的键为 fish', install.includes('第一条鱼的成员键固定是 fish'));
ok('提问列表里不再询问小鱼键', !install.includes("Var = 'ChildMemberId'"));
ok('README 写清小鱼键固定 fish', readme.includes('小鱼的成员键固定为'));
ok('README 写清 bind 对宿主也适用', readme.includes('宿主与她的都一样'));

// 2026-11-17 r238：根鱼（并列、无家长）—— -Parent none 要有完整链路。
ok('fish.ps1 支持根鱼（-Parent 空/none）', fish.includes("$isRoot = ($parentKey -eq '' -or $parentKey -ceq 'none')"));
ok('根鱼调用 install 时传 -NoParent', fish.includes("$installArgs += '-NoParent'"));
ok('根鱼展示为「无（独立迁入）」', fish.includes('无（独立迁入，不挂在谁下面）'));
ok('install.ps1 有 -NoParent 开关', /\[switch\]\$NoParent/.test(install));
ok('根鱼名册 parent 为 null', install.includes('parent = $childParentId'));
ok('根鱼不建家长 pin 条目', install.includes('if (-not $NoParent) { $pins[$ParentMemberId] = $parentIds }'));
ok('根鱼 birth 行能写 parent=none', install.includes("if ($NoParent) { [string]'none' }"));
const membersAdd = read('scripts/members-add.mjs');
ok('members-add 接受 --parent none', membersAdd.includes("p === 'none'"));
const renderEnv = read('scripts/render-env.mjs');
ok('render-env 不把 none 当家长', renderEnv.includes("args.parentId !== 'none'"));
ok('render-env 根鱼 PARENT_ID 兜底 none', renderEnv.includes("me?.parent ?? 'none'"));

const fail = checks.filter((c) => !c.pass);
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
if (fail.length) {
  console.error(`test-install-agents：${checks.length} 项，FAIL ${fail.length} —— 身份纸的护栏被改掉了`);
  process.exit(1);
}
console.log(`PASS test-install-agents（${checks.length} 项：来源 / 覆盖 / 自检 / 修复开关 / 体检格）`);
