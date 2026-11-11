# scripts — 开机/停机入口

双击 `.cmd` 就行。所有 `.cmd` 的文件名可以是中文，但**内容一律纯 ASCII**（cmd 用 GBK 读文件，中文会乱码）；中文只在 `.ps1` 里，`.ps1` 一律 UTF-8 **带 BOM**。

## 人用的（双击这些）

| 文件 | 干什么 | 窗口 |
| --- | --- | --- |
| `启动全部.cmd` | 大肥鱼（3080）+ 小肥鱼（3082） | **成功就关**，失败留着 |
| `启动大肥鱼.cmd` | 只开 3080（`dsh web`） | 同上 |
| `启动小肥鱼.cmd` | 只开 3082（她的 HOME + whale profile） | 同上 |
| `启动全部-检修.cmd` | 同「启动全部」，但窗口**永远留着** | 不关 |
| `启动大肥鱼-检修.cmd` | 同「启动大肥鱼」，窗口永远留着 | 不关 |
| `启动小肥鱼-检修.cmd` | 同「启动小肥鱼」，窗口永远留着 | 不关 |
| `停止全部.cmd` | 小肥鱼 + 大肥鱼 + 脚本版守夜 | 留着 |
| `停止大肥鱼.cmd` | 只停 3080 | 留着 |
| `停止小肥鱼.cmd` | 只停 3082（认 `--profile whale`，不会误杀 3080） | 留着 |

停止脚本只有普通版（没有检修版）：它们本来就短，出结果就停在那儿。
**停大肥鱼 / 停全部会先问一句 Y/N** —— 大肥鱼就是你在用的 3080，停掉会中断正在跑的那一轮。

六个「启动」都走同一个 `launch.ps1`，只是参数不同：

```
pwsh -File launch.ps1 -Target all|lee|whale [-NoBrowser] [-Port n] [-WithWatchman]
```

- 已经在跑的端口不会重复起（判断方式是 TCP 连一下，不用 `Get-NetTCPConnection` —— 它在某些沙箱里静默返回空）。
- 起子进程用 `Start-Process -WindowStyle Hidden` + 输出重定向，所以**成功之后父窗口退出、孩子继续跑**。
- 失败时会把 `.err.log` 的尾巴打出来 —— 这就是「窗口该不该留着」的判据，不是靠猜。
- 她的网页要 token，token 只出现在启动日志里；`launch.ps1` 会从日志里捞最后一个带 token 的地址再开浏览器。

## 机器用的（别双击）

| 文件 | 谁调它 |
| --- | --- |
| `start-whale.ps1` | `watchman.ps1`。输出约定：`already-awake` / `awake` / `failed` |
| `wake-whale.ps1` | `dsh-group` 插件的守夜定时器（`HER_WAKER`）。插件里每 60 秒看一次，到点且她关着窗就跑它 |
| `watchman.ps1` | 手工兜底用的老守夜（`watchman-run.cmd` 起来）。**现在门主要由插件推**，这个只在主 dsh 不常开时用 |
| `stop.ps1` | `停止*.cmd` 三个。退出码 0 = 停了/本来没跑，1 = 没停干净 |

## 日志在哪

| 谁 | 文件 |
| --- | --- |
| 大肥鱼 | `C:\Users\Fabian\.dsh\logs\web-latest.log` / `.err.log` |
| 小肥鱼 | `D:\文档\WorkSpace\lil-whale\dsh-home\logs\web-latest.log` / `.err.log` |
| 守夜（脚本版） | `D:\文档\WorkSpace\lil-whale\logs\watchman.log`、控制台输出在 `dsh-lil-whale\logs\watchman-console.log` |

## legacy\

搬进去的旧入口：`tab-lee.ps1`、`tab-whale.ps1`、`RUN-双鱼.cmd`（Windows Terminal 双标签页那套，现在不需要窗口了）、`启动小肥鱼.ps1`（被 `launch.ps1` 取代）、`唤醒小肥鱼.cmd`。

没删，只是挪开；确认不需要了再删。

## 两个踩过的坑

1. **别按命令行字符串判断"某进程在不在"**：`Get-CimInstance` 里搜 `watchman.ps1`，会把任何一个正在读这句话的 pwsh（包括你排障时敲的那条命令）都算成守夜。现在守夜自己往 `logs\watchman.pid` 写 PID，只认这个文件。
2. **别套两层 pwsh**：`Start-Process pwsh -Command "pwsh -File x.ps1"` 会多出一个没人管的父进程。要跑脚本就用 `-Command "& 'x.ps1'"`，让 `Start-Process` 直接持有它。
3. **杀进程要和 1 号坑反着来**：`stop.ps1` 只认「`node.exe` 的第一个参数就是 `bin.js`」的进程，然后才看它带不带 `--profile whale`。只搜「命令行里出现过 `bin.js` 和 `--profile whale`」的话，会把一个正在读这两个词的人的 shell 当成鱼杀掉 —— 这个我测试时真撞上了。
