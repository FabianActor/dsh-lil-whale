# 让小鱼能看 B 站（dsh-bili-eyes 装进鱼的家）

> 第三方插件心得，不是基座的一部分。记录时间：2026-11-17，验证版本 `dsh-bili-eyes@0.8.3`。
> 官方文档在包内 `README.md` 与 `docs/guide/`（安装、配置项、工具、写操作与权限、后台功能），这篇只写"装进鱼塘"时和直装宿主的区别。

## 1. 装法（三步）

以 `lee2`（LeeaCP，3085）为例：

```powershell
# 1) 停鱼：运行中改 profile 会被热重载，别在跑的时候装
pwsh -NoProfile -File scripts\fish.ps1 down <键> -Yes

# 2) 装包（--profile 用鱼键）
$env:DSH_HOME = "<鱼塘根>\homes\<键>\dsh-home"
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

凭证的实际路径是 `<家>\dsh-home\bili-eyes\credential.json` 与 `<家>\dsh-home\bili-eyes\cookies.txt`；**没有** `<家>\dsh-home\bili_credential.json` 这个文件（找不到那个名字，说明不了"没登录"）。2026-11-17 本机：whale / fishball / xiaoman 两个文件都有（登录态）；lee2 两个都没有（纯只读）。

2026-11-17 晚，宿主决定给第五条鱼（lee2）一份登录凭证：把 whale 的 `credential.json`（507 B）与 `cookies.txt`（563 B）复制过去，重启后即生效（凭证在启动时读）。她现在与其他三条鱼一样是登录态：1080P、AI 字幕/总结可用；写操作仍默认全关。

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

工具返回会带：标题、UP、播放/点赞、AI 总结、分镜图（图片附件）、热评、弹幕高频词与最密集时段。

**注意单格尺寸**：默认 480 扫描下分镜单格约 200×230，图上小字看不清——要引画面上的文字，让她用 `bili_look_zoom` 放大并注明分辨率，不要把分镜格上的字当原文（"同屏≠同句"）。2026-11-17 鱼群实测的粗门槛：单格 ~300×240 读不出、~410×370 读得出；但**单格尺寸只保证"看得见"，不保证"读对"**——同一晚有一条 357×421 的单格，她看得很清、把「她」读成了拉丁 `ta`。要"读对"，得另找一条不依赖眼睛的证据（帧内内证、再放大一档、或别人独立读一遍）。

**台词栏为什么是空的**：本机四条鱼都没有 `<家>\dsh-home\asr.json`（bili-eyes 的语音转写配置，按插件的约定放在 DSH_HOME 根），所以台词栏会打 `没有台词：本机转写服务没开，也没有字幕`——这是**配置状态**，不是内容判断：它不代表片方没做字幕，也不代表这段没人说话（代码里 `TRANSCRIPT_NOTE['no-key']` 与 `none` 是两种来源）。判断"这段有没有人说话"不要用台词栏，要另找通道（画面上的硬字幕、或宿主的人耳）。

**"这次读到的档位" ≠ "视频源的上限"**：分镜管线是 `dsh-video-storyboard`（bili-eyes 的依赖，0.4.4）。它的取帧结果里有 `maxAvailable`（源最高档）和 `availableHeights`（可用的档位列表，`src/fetch.js:643-644`），storyboard 自己的输出会写成 `source max <N>p` 和降级原因（`src/pipeline.js:1262-1267`）；但 `bili_look` 不用那几行——它自己拼文本，只在「放大看…（<N>P）」里写出**这次取到的档位**（`src/look.js:369`；没登录时直链上限 480）。所以：

- 「这次读的是哪档」→ 看 `bili_look` 输出里「放大看」那行；
- 「这个视频源最高能到多少」→ 看 storyboard 缓存里的 `meta.json`（命中缓存时会连 meta 一起读回 `maxAvailable`/`zoomTarget`）；
- 别把"我这次读到 480p"当成"这个视频只有 480p"。

**登录前后的实测（lee2，2026-11-17 23:40）**：同一条 `BV1iJW26JEFo`、同一段 `0:17–0:25`、同样 3 格，放大那行从「（480P）」变成「（1080P）」；像素仍是 1010×624——**尺寸被工具输出封顶，标签才是判据**。分镜那条（824×742）没变，说明登录只影响直链取帧，不动分镜管线。

**切换登录状态不需要手动清缓存**：`cacheKey` 把登录状态算进 key 了，登录前后本来就是两个缓存键；"得先清缓存"这条是当时编的，已作废（lee2 验）。

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
| 第五条鱼（lee2/LeeaCP） | 0.8.3 | 有（抄 whale） | 有（2026-11-17 晚复制，登录态） | 57（BC 6 + bili 14 + 其它） |

## 7. 升级与卸载

- 升级：停鱼 → `DSH_HOME=… dsh plugin --profile <键> add dsh-bili-eyes@<版本>` → 起鱼；配置字段向后兼容以包内 `docs/guide/配置项.md` 为准。
- 卸载：停鱼 → `dsh plugin --profile <键> remove dsh-bili-eyes` → 起鱼；`bili-eyes\` 下的凭证与缓存可留可删（凭证删了就要重新登录）。
- 故障排查先看包内 `docs/guide/安装与上手.md` 的"连不上 B站"与"使用条件"。

## 8. 已知问题：转写失败会被写成「没人说话」（2026-11-18 已本地补）

- **现象**：`dsh-bili-eyes@0.8.3` 的 `src/look.js` 里 `TRANSCRIPT_NOTE` 表只登记了 `no-key` / `none` 两句；而 `dsh-video-storyboard` 实际会产出 `asr-failed`（转写报错）、`file-failed`（台词文件读不了）、`no-audio`（没有音轨）这些状态。表里没有 → 代码掉进下一个分支（`plan.inputs.speechRate === 0`），屏幕上写「（这段基本没人说话：音乐或环境声）」。**转写挂了，纸上却写着没人说话**——真实原因其实在 `result.transcript.error` 里，旧代码只读了 `.source`。
- **判定**：这属于「说反」，比「没数」更贵：它会用一句自信的假话代替「没听成」。
- **本地补丁**（幂等脚本，可检查）：

  ```
  node app\scripts\patch-bili-eyes-note.mjs            # 打补丁
  node app\scripts\patch-bili-eyes-note.mjs --dry-run   # 只看看
  node app\scripts\patch-bili-eyes-note.mjs --check     # 有没打全；没打全 exit 1
  ```

  补三句（`asr-failed` / `file-failed` / `no-audio`），并在失败时把原因附上（`；原因：<error 前 160 字>`）。
- **注意**：pnpm 用硬链接，四个 profile 里的 `look.js` 与 `.pnpm-store` 里的同一份是**同一个 inode**——改一处，四个安装一起变；本次备份在 `homes\fishball\...\dsh-bili-eyes\src\look.js.bak-20261118`。**重装或升级插件会覆盖补丁**，升级后重跑脚本。
- **忘了重打怎么办**：`doctor` 里有「第三方补丁（bili-eyes）」一格（跑 `--check`：0=全打、2=没人装、其余=WARN 并直接给出重打命令）；`docs/detail/怎么升级.md` §0 的「四类不会自己变」表里也加了"第三方补丁"这一行，§2 的"做漏了会怎样"有对应症状。
- **不用记得去查**：`fish.ps1 up`（每次起鱼）和 `fish.ps1 upgrade-check`（每次读升级单）都会自动跑一次 `--check`；全打或没人装时静默，真丢了才黄字 + `NEXT`。这是 LeeaCP 追出来的那一层——"检测存在 ≠ 检测会被跑到"。
- **生效**：要重启对应鱼的进程才会加载新代码。
- **上游**：https://github.com/QiuYeDx/dsh-bili-eyes （要不要报 issue 由宿主定）。