# scripts — 开机 / 停机入口

人用的入口都在 `bin\`；`scripts\` 根下只剩机器调的脚本和这份说明。

双击 `bin\` 里的 `.cmd` 就行。文件名一律英文（中文名进 cmd 会被 GBK 读错），内容也一律纯 ASCII；中文只出现在 `.ps1` 里，`.ps1` 一律 UTF-8 **带 BOM**。

## 九个入口

| 启动 | 检修版（窗口不关） | 停 |
| --- | --- | --- |
| `Run DSH.cmd` | `Run DSH-Check.cmd` | `Stop DSH.cmd` |
| `Run lil whale.cmd` | `Run lil whale-Check.cmd` | `Stop lil whale.cmd` |
| `Run All Whales.cmd` | `Run All Whales-Check.cmd` | `Stop All Whales.cmd` |

- **普通版**：成功（端口真连上）就静悄悄关窗；失败把 `.err.log` 尾巴打出来再停住。
- **`-Check` 版**：一样做事，但窗口**永远留着**，排障用。
- **停止脚本只有普通版**：本来就短，出结果就停在那儿。
- `Stop DSH` / `Stop All Whales` 会先问一句 `Y/N` —— 大肥鱼就是你在用的 3080，停掉会中断正在跑的那一轮。`Stop lil whale` 不问。

**`bin\` 里的 .cmd 可以复制到任何地方**（桌面、任务栏、快捷方式）。它按三步找 `.ps1`：

1. `%~dp0..\<script>.ps1` —— 正常位置（`bin\` 的上一级就是 `scripts\`）
2. `%~dp0<script>.ps1` —— 如果哪天把 `.ps1` 和 `.cmd` 放在同一层
3. `%USERPROFILE%\dsh-lil-whale\scripts\<script>.ps1` —— 被复制到别处时走这个（`%USERPROFILE%\dsh-lil-whale` 是指向项目的 Junction，见下）

所以桌面那份只是"信封"，逻辑永远读项目里的 `launch.ps1` / `stop.ps1`：改逻辑不用重新拖。

命名约定（后期加子代照这个来）：`Run lil whale-2.cmd`、`Run lil whale-2-Check.cmd`、`Stop lil whale-2.cmd`。编号只加到"哪条鱼"上，`Run All Whales` 的含义就是"所有编号"。

## 底层

启动入口共用 `scripts\launch.ps1`，停止共用 `scripts\stop.ps1`：

```
pwsh -File launch.ps1 -Target all|lee|whale [-NoBrowser] [-Port n] [-WithWatchman]
pwsh -File stop.ps1   -Target all|lee|whale [-Yes]
```

- 已经在跑的端口不会重复起（用 TCP 连一下判断，不用 `Get-NetTCPConnection` —— 它在某些沙箱里静默返回空）。
- 子进程用 `Start-Process -WindowStyle Hidden` + 输出重定向离开，所以**父窗口退出、孩子继续跑**。
- 浏览器统一由 `launch.ps1` 开，所以两个 dsh 都带 `--no-open` 启动 —— 否则 dsh 自己开一次、脚本再开一次，就是两个标签页（这个是 2026-11-11 修的 bug）。
- 她的网页要 token，token 只出现在启动日志里；`launch.ps1` 从日志里捞最后一个带 token 的地址再开。

## 机器用的（别双击）

| 文件 | 谁调它 |
| --- | --- |
| `start-whale.ps1` | `watchman.ps1`。输出约定：`already-awake` / `awake` / `failed` |
| `wake-whale.ps1` | `dsh-group` 插件的守夜定时器（`HER_WAKER`）：每 60 秒看一次，到点且她关着窗就跑它 |
| `watchman.ps1` | 手工兜底的老守夜（`watchman-run.cmd` 起）。**现在门主要由插件推**，这个只在主 dsh 不常开时用 |
| `stop.ps1` | `bin\Stop*.cmd`。退出码 0 = 停了/本来没跑，1 = 没停干净 |
| `launch.ps1` | `bin\Run*.cmd` |

## 日志在哪

| 谁 | 文件 |
| --- | --- |
| 大肥鱼 | `C:\Users\Fabian\.dsh\logs\web-latest.log` / `.err.log` |
| 小肥鱼 | `D:\文档\WorkSpace\lil-whale\dsh-home\logs\web-latest.log` / `.err.log` |
| 守夜（脚本版） | `D:\文档\WorkSpace\lil-whale\logs\watchman.log`；控制台输出在 `dsh-lil-whale\logs\watchman-console.log` |

## legacy\

旧的入口：`tab-lee.ps1`、`tab-whale.ps1`、`RUN-双鱼.cmd`（Windows Terminal 双标签页那套）、`启动小肥鱼.ps1`、`唤醒小肥鱼.cmd`、`stop-whale.ps1`。没删，只是挪开。

## 项目的 ASCII 入口

`C:\Users\Fabian\dsh-lil-whale` 是一个 Junction，指向 `D:\文档\WorkSpace\dsh-lil-whale`。

存在的理由：项目真实路径里有中文（`文档`），而 `.cmd` 里的中文会被 GBK 读错，脚本没法把一个含中文的绝对路径写死在 .cmd 里。有了这个纯 ASCII 的别名，`.cmd` 就能在任何位置（桌面副本、快捷方式）找到项目。

删掉它不影响功能（只是 .cmd 副本在别处就找不到脚本了）。

## 三个真踩过的坑

1. **别用命令行里出现的字符串判断"某进程在不在"**：搜 `watchman.ps1` 会把任何一个正在读这段文字的 pwsh（包括你排障时敲的那条命令）都算成守夜。现在守夜自己往 `logs\watchman.pid` 写 PID，只认这个文件。
2. **别套两层 pwsh**：`Start-Process pwsh -Command "pwsh -File x.ps1"` 会多出一个没人管的父进程。要跑脚本就用 `-Command "& 'x.ps1'"`。
3. **杀进程要反过来收紧**：`stop.ps1` 只认「`node.exe` 的**第一个参数**就是 `bin.js`」的进程，再看参数里有没有 `--profile whale`。只搜「命令行里出现过这两个词」的话，会把正在读这两个词的 shell 当成鱼杀掉 —— 测试时真撞上了。
