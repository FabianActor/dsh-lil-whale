// test-fish-dsh-resolve.mjs —— 测试机第二份（P1–P5）的静态断言。
import fs from 'node:fs';
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const fish = read('../scripts/fish.ps1');
const install = read('../scripts/install.ps1');
const doctor = read('../scripts/doctor.ps1');
const cfg = read('../lil-whale.config.example.json');
const cat = read('../templates/工具目录.json');
const up = read('../upgrade.json');
const fail = [];
const need = (c, m) => { if (!c) fail.push(m); };
need(/function Resolve-DshCommand/.test(fish), 'fish.ps1 没有 Resolve-DshCommand');
need(/Get-Command dsh -ErrorAction SilentlyContinue/.test(fish), '没有先找 PATH 里的 dsh');
need(/\$Cfg\.dshExe/.test(fish), '没有读配置 dshExe');
need(/npx -y @deepseek-ai\/dsh/.test(fish), '没有 npx 兜底');
need(/\$DshCmd = Resolve-DshCommand/.test(fish), 'Start-Fish 没调 Resolve-DshCommand');
need(/"\$DshCmd web --no-open"/.test(fish), '巡守命令没换成 $DshCmd');
need(/\$DshCmd --profile/.test(fish), '鱼命令没换成 $DshCmd');
need(!/"dsh web --no-open"/.test(fish) && !/; dsh --profile/.test(fish), '还留着写死的 dsh');
need(/function Wait-Port\(\[int\]\$p, \[int\]\$Seconds = 120, \[string\]\$ErrLog = ''\)/.test(fish), 'Wait-Port 没收 stderr 日志参数');
need(/不是内部或外部命令\|is not recognized\|EADDRINUSE\|Cannot find module\|ENOENT/.test(fish), 'Wait-Port 没有硬错误集');
need(/\$portOk = Wait-Port \$fishPort -ErrLog \$err/.test(fish), '调用 Wait-Port 没传 ErrLog');
need(!/\$hbAge -le 90/.test(fish), '心跳仍在当"会话挂上"的判据');
need(/if \(\$url -match 'token='\)/.test(fish), '开窗前没检查 token');
need(/effectiveChild = if \(\$ChildMemberId\) \{ \$ChildMemberId \} else \{ \$ChildProfile \}/.test(install), 'install.ps1 没算有效成员键');
need(/\$owner -eq \$effectiveChild/.test(install), '端口自查没比有效成员键');
need(/codeFp=\(\[0-9a-f\]\+\)/.test(doctor), 'doctor 没读磁盘 codeFp');
need(/\$fpBad = @\(\$liveBoot/.test(doctor), 'doctor 没按进程比 codeFp');
need(/"dshExe":/.test(cfg), '示例配置没有 dshExe');
need(/"tool-office"/.test(cat), '工具目录缺 tool-office');
need(/v57.*或更高/.test(up), '升级单验收还写死 v57');

// 测试机第三份（D1/D3/D4/D5）
need(doctor.includes("'plugin/dsh-lil-whale-group/lib/code-fp.js'"), 'doctor 的 code-fp 路径不对（应为正斜杠写法）');
need(!doctor.includes('plugindsh-lil-whale-grouplibcode-fp.js'), 'doctor 还留着被吃掉反斜杠的旧路径');
need(/只在最近 3 份|只保留最近 3 份|Skip 3/.test(install), 'install.ps1 没有轮转 环境.md.bak（D5）');
need(/另加手写的 group_say/.test(install), 'install.ps1 的工具数口径没说明 group_say（D3）');
need(/'自启动开关' 'INFO'/.test(read('../scripts/verify-pending.ps1')), 'verify-pending 的自启动开关仍是 WARN（D4）');


// 测试机第四份（D6）：-Upgrade 时沿用自己登记的端口
need(/原地升级：沿用/.test(install), '-Upgrade 没有"沿用自己登记的端口"的分支（D6）');
need(/if \(\$Upgrade -and \$registeredPorts\.ContainsKey\(\$portWanted\)/.test(install), 'D6 分支条件不在（没检查 -Upgrade 与登记）');

console.log(fail.length ? `FAIL test-fish-dsh-resolve（${fail.length}）：\n  - ${fail.join('\n  - ')}` : 'PASS test-fish-dsh-resolve（27 条）');
process.exit(fail.length ? 1 : 0);
