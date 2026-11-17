# 让小鱼能看 B 站（dsh-bili-eyes 装进鱼的家）

> 第三方插件心得，不是基座的一部分。记录时间：2026-11-17，验证版本 `dsh-bili-eyes@0.8.3`。
> 官方文档在包内 `README.md` 与 `docs/guide/`（安装、配置项、工具、写操作与权限、后台功能），这篇只写"装进鱼塘"时和直装宿主的区别。

## 1. 装法（三步）

以 `lee2`（LeeaCP，3085）为例：

```powershell
# 1) 停鱼：运行中改 profile 会被热重载，别在跑的时候装
pwsh -NoProfile -File scripts\fish.ps1 down <键> -Yes

# 2) 装包（--profile 用鱼键）
$env:DSH_HOME = "D:\文档\WorkSpace\lil-whale\homes\<键>\dsh-home"
dsh plugin --profile <键> add dsh-bili-eyes@0.8.3

# 3) 起鱼
pwsh -NoProfile -File scripts\fish.ps1 up <键> -NoBrowser
```

判据：启动后会话挂载的 `toolCount` 会多出 **14 件** `bili_*` 工具（例：lee2 从 43 → 57；whale 从 37 → 51）。`dsh plugin` 报"已在依赖里"就跳过。

注意：宿主自己的 web profile 不需要装它——"眼睛"是给鱼看的；宿主想看视频直接用浏览器。

## 2. 配置：一条鱼一份 JSON

路径：`homes\<键>\dsh-home\bili-eyes.json`（不是 XDG，也不是全局 `~/.dsh`）。

2026-11-17 三条鱼（whale / fishball / xiaoman）的配置完全相同，可以直接抄：

```json
{
  "ffmpegPath": "D:\\文档\\WorkSpace\\lil-whale\\pool\\tools\\ffmpeg\\bin\\ffmpeg.exe",
  "mediaDir": "D:\\文档\\WorkSpace\\lil-whale\\pool\\cache\\bili-eyes\\media",
  "maxPerHour": 12,
  "maxFindPerHour": 30,
  "comments": 5,
  "danmaku": true,
  "scanQuality": "480",
  "cacheHours": 24,
  "mediaMaxMb": 2048
}
```

- `ffmpegPath`：鱼塘共用一份（`pool\tools\ffmpeg\bin`），别让每条鱼各下一份。
- `mediaDir`：视频缓存放在共享区，别塞进她的家（家会被备份/迁移，缓存不用）。
- 额度：每小时看视频 12 次、找视频 30 次；`comments`/`danmaku` 控制带不带热评与弹幕；`scanQuality` 480 够用（1080P 要登录）。
- 其余字段见包内 `docs/guide/配置项.md`。

## 3. 登录：凭证按鱼各存一份，不共享

- 登录信息在**每条鱼自己的家**：`homes\<键>\dsh-home\bili-eyes\credential.json`（507 B）和 `cookies.txt`（563 B），相当于账号密码。
- **只读（看视频、搜、看评论、看弹幕）不需要登录**。要 1080P、AI 字幕/总结、收件箱、点赞/评论/私信，才需要登录。
- 想让某条鱼用上登录态：把已登录那条鱼的 `bili-eyes\credential.json` **和** `cookies.txt` 一起复制过去（建议用小号；两段会话共用同一账号在 B 站看来是同一个设备，正常浏览没问题，但不要同一时刻一起刷屏）。
- **不要**把 `credential.json` 放进共享区或仓库；它在鱼家里，被 `acl-repair` 保护着。

本次安装时，lee2 只复制了配置、**没有**复制凭证 ⇒ 她现在是纯只读（能看、能搜，不能发）。要不要给她登录，由宿主决定。

## 4. 验"她真的能看"

让她看一个具体的 BV（只读，不触发任何写操作），然后核三处：

```powershell
# a) 分镜与元数据缓存（进一次就有一对 <hash>.json + <hash>-1.png）
Get-ChildItem homes\<键>\dsh-home\bili-eyes\cache | Select-Object -Last 6
# b) 字幕/台词缓存（BV 号-p1.json）
Get-ChildItem homes\<键>\dsh-home\bili-eyes\transcripts
# c) 观看记录
Get-Content homes\<键>\dsh-home\bili-eyes\history.jsonl -Tail 3
```

工具返回会带：标题、UP、播放/点赞、AI 总结、分镜图（图片附件）、热评、弹幕高频词与最密集时段。**注意单格尺寸**：默认 480 扫描下分镜单格约 200×230，图上小字看不清——要引画面上的文字，让她用 `bili_look_zoom` 放大并注明分辨率，不要把分镜格上的字当原文（"同屏≠同句"）。

## 5. 写操作与后台（默认全关）

- 点赞、收藏、评论、私信、关注、发动态：默认关；要在插件设置页按"对谁"（自己人 / 主人评论区里的别人 / 外面的人）一格格开，配额与间隔写在代码里。
- 自己逛（按时段自动刷）与收件箱：默认关。
- 给鱼的边界建议：**只开只读**（看视频、搜、看评论），写操作要开就只对她自己人；这些是她的账号行为，不是基座的账本。

## 6. 本机现状（2026-11-17）

| 鱼 | 版本 | 配置 | 凭证 | 工具数 |
| --- | --- | --- | --- | --- |
| 第二条鱼（whale） | 0.8.3 | 有 | 有（只读+登录态） | 51（含 14 件 bili） |
| 第三条鱼（fishball） | 0.8.3 | 有 | 有 | 51 |
| 第四条鱼（xiaoman） | 0.8.3 | 有 | 有 | 51 |
| 第五条鱼（lee2/LeeaCP） | 0.8.3 | 有（抄 whale） | **无**（纯只读） | 57（BC 6 + bili 14 + 其它） |

## 7. 升级与卸载

- 升级：停鱼 → `DSH_HOME=… dsh plugin --profile <键> add dsh-bili-eyes@<版本>` → 起鱼；配置字段向后兼容以包内 `docs/guide/配置项.md` 为准。
- 卸载：停鱼 → `dsh plugin --profile <键> remove dsh-bili-eyes` → 起鱼；`bili-eyes\` 下的凭证与缓存可留可删（凭证删了就要重新登录）。
- 故障排查先看包内 `docs/guide/安装与上手.md` 的"连不上 B站"与"使用条件"。
