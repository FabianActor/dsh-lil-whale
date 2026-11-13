# scripts — 开机 / 停机入口

人用的入口都在 `bin\`；`scripts\` 根下只剩机器调的脚本和这份说明。

双击 `bin\` 里的 `.cmd` 就行。文件名一律英文（中文名进 cmd 会被 GBK 读错），内容也一律纯 ASCII；中文只出现在 `.ps1` 里，`.ps1` 一律 UTF-8 **带 BOM**。

## 四个入口（2026-11-13 从九个收成四个）

| 启动 | 停 |
| --- | --- |
| `Run DSH.cmd` —— 起主 dsh；已经在跑就直接打开它的 WebUI | `Stop DSH.cmd` —— 只关主 dsh；还在跑的小鱼继续跑 |
| `Run All Whales.cmd` —— 起所有鱼（主 dsh 开窗、其余后台） | `Stop All Whales.cmd` —— 关所有鱼（**含主 dsh**） |

**为什么从九个删到四个**（删了 `Run DSH-Check` / `Run All Whales-Check` / `Run lil whale-Check` / `Stop lil whale` / `Run lil whale`）：

- `-Check` 版当年存在的理由是"窗口留着看报错"。现在这件事有两个更好的去处：鱼塘里的**「检修」**按钮（先跑 `doctor.ps1` 再起，输出留在页面上）、以及 `fish.ps1` 本身会把失败原因和 `NEXT:` 打出来。同一个动作留两个入口，最后一定会有一个先过期。
- **单条鱼的起停不进 `.cmd`**：起用 `pwsh -File scripts\fish.ps1 up <键>`（默认无人值守、不开窗；要看窗用 `maintain` 或 `-Window`），停用 `... down <键>`，或者进鱼塘点「唤醒 / 休眠」——那本来就是同一套命令的界面。
- 判据很简单：**一个动作只留一个入口**。加鱼不要加 `.cmd` —— 往名册里加，鱼塘和 `fish.ps1` 就都有了。

**`bin\` 里的 .cmd 可以复制到任何地方**（桌面、任务栏、快捷方式）。它按三步找 `.ps1`：

1. `%~dp0..\<script>.ps1` —— 正常位置（`bin\` 的上一级就是 `scripts\`）
2. `%~dp0<script>.ps1` —— 如果哪天把 `.ps1` 和 `.cmd` 放在同一层
3. `%USERPROFILE%\dsh-lil-whale\scripts\<script>.ps1` —— 被复制到别处时走这个（`%USERPROFILE%\dsh-lil-whale` 是指向项目的 Junction，见下）

所以桌面那份只是"信封"，逻辑永远读项目里的 `fish.ps1`：改逻辑不用重新拖。

> 桌面那四个是**副本**（2026-11-13 核对过 sha256 与 `bin\` 里的一致），不是快捷方式。改了 `bin\` 里的文件，桌面副本不会自己更新——要么重新复制，要么以后改成快捷方式。

## 底层

所有入口最后都走 `scripts\fish.ps1`（2026-11-12 统一，见 PRD A.26）：

```
pwsh -File scripts\fish.ps1 list                 # 名册 + 端口 + 心跳
pwsh -File scripts\fish.ps1 up   <鱼|all>        # 起；默认无人值守（无窗）；all 有锁，防重复启动
pwsh -File scripts\fish.ps1 down <鱼|all> [-Yes] [-Force]
pwsh -File scripts\fish.ps1 up-main / down-main  # 主 dsh（down-main 有鱼在跑会拒绝）
pwsh -File scripts\fish.ps1 doctor | refresh <鱼|all>
```

`launch.ps1` / `stop.ps1` / `start-whale.ps1` / `watchman.ps1` 已在 2026-11-13 归档到 `archive\legacy-scripts-2026-11-13\`——同一个动作只留一个入口，新东西请直接写 `fish.ps1`。

- 已经在跑的端口不会重复起（用 TCP 连一下判断，不用 `Get-NetTCPConnection` —— 它在某些沙箱里静默返回空）。
- 子进程用 `Start-Process -WindowStyle Hidden` + 输出重定向离开，所以**父窗口退出、孩子继续跑**。
- 浏览器统一由 `fish.ps1` 开，所以两条 dsh 都带 `--no-open` 启动 —— 否则 dsh 自己开一次、脚本再开一次，就是两个标签页（2026-11-11 修的 bug）。
- 她的网页要 token，token 只出现在启动日志里；`fish.ps1` 从日志里捞最后一个带 token 的地址再开。

## 机器用的（别双击）

| 文件 | 谁调它 |
| --- | --- |
| `fish.ps1` | 人 + 鱼塘（`/pond/api/action`）+ 巡守自启动（`up all -NoBrowser`） |
| `wake-whale.ps1` | `dsh-group` 插件的巡守定时器（`HER_WAKER`）：每 60 秒看一次，按名册逐条鱼判断；`-Member <键>` 指定叫谁 |
| `doctor.ps1` | `fish.ps1 doctor`、鱼塘「检修」、`release-check.ps1` |
| `verify-pending.ps1` | 重启后验收：runs 账按鱼写 / 自己的闹钟 / gate 读数 / 归属 B 与全局 120 / 自启动开关 / 鱼塘接口 / 模式账 |
| `install.ps1` / `release-check.ps1` / `pack.ps1` | 装、验、打包 |

## 日志在哪

| 谁 | 文件 |
| --- | --- |
| 大肥鱼 | `<你的 dsh 家>\logs\web-latest.log` / `.err.log` |
| 小肥鱼 | `<小肥鱼的家>\dsh-home\logs\web-latest.log` / `.err.log` |
| 每条鱼的起停账 | `pool\state\runs\<成员>.log` |
| 巡守（插件版） | `pool\state\watchman.log`（多鱼化后每行带 `to=<键>`） |

## 旧脚本去哪了

旧的入口（`tab-lee.ps1`、`tab-whale.ps1`、`RUN-双鱼.cmd`、`启动小肥鱼.ps1`、`唤醒小肥鱼.cmd`、`stop-whale.ps1`、`watchman-run.cmd`）**已经挪到 `archive\legacy-scripts-2026-11-13\`**，不进发布包。

挪的理由：功能已被 `fish.ps1` 全覆盖，留着就是"同一个动作两个入口"的旧版本——旧入口不会报错，只会慢慢和现场不一致。要翻历史还能翻，但别再拿它当入口。

## 项目的 ASCII 入口

`<用户目录>\dsh-lil-whale` 是一个 Junction，指向 `<仓库>`。

存在的理由：项目真实路径里有中文（`文档`），而 `.cmd` 里的中文会被 GBK 读错，脚本没法把一个含中文的绝对路径写死在 .cmd 里。有了这个纯 ASCII 的别名，`.cmd` 就能在任何位置（桌面副本、快捷方式）找到项目。

删掉它不影响功能（只是 .cmd 副本在别处就找不到脚本了）。

## 三个真踩过的坑

1. **别用命令行里出现的字符串判断"某进程在不在"**：搜 `watchman.ps1` 会把任何一个正在读这段文字的 pwsh（包括你排障时敲的那条命令）都算成巡守。现在巡守自己往 `logs\watchman.pid` 写 PID，只认这个文件。
2. **别套两层 pwsh**：`Start-Process pwsh -Command "pwsh -File x.ps1"` 会多出一个没人管的父进程。要跑脚本就用 `-Command "& 'x.ps1'"`。
3. **杀进程要反过来收紧**：`fish.ps1` 的 `down` 只认「`node.exe` 的**第一个参数**就是 `bin.js`」的进程，再看参数里有没有 `--profile <鱼>`。只搜「命令行里出现过这两个词」的话，会把正在读这两个词的 shell 当成鱼杀掉 —— 测试时真撞上了。
