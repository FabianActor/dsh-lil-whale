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

注意（2026-11-19 更新）：宿主本人不需要它——宿主想看视频直接用浏览器。但宿主侧的那个 agent（Leea）如果也要自己看，可以给它装一只只读的：装法与鱼相同，只是 profile 换成宿主自己的 `web`。

```powershell
$env:DSH_HOME = "$env:USERPROFILE\.dsh"   # 换成你自己的 DSH_HOME
dsh plugin --profile web add dsh-bili-eyes@0.8.3    # 会自动写进 profile package.json 的 dsh.profile.bundles
# 配置：<DSH_HOME>\bili-eyes.json     凭证：<DSH_HOME>\bili-eyes\{credential.json,cookies.txt}
# 改完 profile 要重启才生效（这条链不触发热重载，但工具表是启动时挂的）
node "advanced notes on third-party plugins\让小鱼能看B站-bili-eyes\scripts\patch-bili-eyes-note.mjs" --also-root "<DSH_HOME>"   # 补丁脚本默认只扫 homes\，宿主这份要显式加根
```

判据：重启后宿主的会话工具表多出 **14 件** `bili_*`（2026-11-19 本机装前 70 件）。只读边界与鱼相同：看视频/搜/看评论弹幕默认开，点赞/评论/私信/关注/发动态默认全关。

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

## 6. 本机现状（2026-11-19 更新）

| 鱼 | 版本 | 配置 | 凭证 | 工具数 |
| --- | --- | --- | --- | --- |
| 第二条鱼（whale） | 0.8.3 | 有 | 有（只读+登录态） | 51（含 14 件 bili） |
| 第三条鱼（fishball） | 0.8.3 | 有 | 有 | 51 |
| 第四条鱼（xiaoman） | 0.8.3 | 有 | 有 | 51 |
| 第五条鱼（lee2/LeeaCP） | 0.8.3 | 有（抄 whale） | 有（2026-11-17 晚复制，登录态） | 57（BC 6 + bili 14 + 其它） |
| 宿主进程里的 agent（Leea，2026-11-19 装） | 0.8.3 | 有（抄 whale，放在 `<DSH_HOME>\bili-eyes.json`） | 有（抄 whale，登录态） | 装前 70，重启后待验（预期 +14） |

## 7. 升级与卸载

- 升级：停鱼 → `DSH_HOME=… dsh plugin --profile <键> add dsh-bili-eyes@<版本>` → 起鱼；配置字段向后兼容以包内 `docs/guide/配置项.md` 为准。
- 卸载：停鱼 → `dsh plugin --profile <键> remove dsh-bili-eyes` → 起鱼；`bili-eyes\` 下的凭证与缓存可留可删（凭证删了就要重新登录）。
- 故障排查先看包内 `docs/guide/安装与上手.md` 的"连不上 B站"与"使用条件"。

## 8. 已知问题：转写失败会被写成「没人说话」（2026-11-18 已本地补）

- **现象**：`dsh-bili-eyes@0.8.3` 的 `src/look.js` 里 `TRANSCRIPT_NOTE` 表只登记了 `no-key` / `none` 两句；而 `dsh-video-storyboard` 实际会产出 `asr-failed`（转写报错）、`file-failed`（台词文件读不了）、`no-audio`（没有音轨）这些状态。表里没有 → 代码掉进下一个分支（`plan.inputs.speechRate === 0`），屏幕上写「（这段基本没人说话：音乐或环境声）」。**转写挂了，纸上却写着没人说话**——真实原因其实在 `result.transcript.error` 里，旧代码只读了 `.source`。
- **判定**：这属于「说反」，比「没数」更贵：它会用一句自信的假话代替「没听成」。
- **本地补丁**（幂等脚本，可检查）：

  ```
  node "advanced notes on third-party plugins\让小鱼能看B站-bili-eyes\scripts\patch-bili-eyes-note.mjs"            # 打补丁
  node "advanced notes on third-party plugins\让小鱼能看B站-bili-eyes\scripts\patch-bili-eyes-note.mjs" --dry-run   # 只看看
  node "advanced notes on third-party plugins\让小鱼能看B站-bili-eyes\scripts\patch-bili-eyes-note.mjs" --check     # 有没打全；没打全 exit 1
  ```

  补三句（`asr-failed` / `file-failed` / `no-audio`），并在失败时把原因附上（`；原因：<error 前 160 字>`）。
- **注意（2026-11-18 更正）**：pnpm 用硬链接，四个 profile 里的 `look.js` 与 `.pnpm-store` 里的同一份是**同一个 inode**——所以**不能原地写**：原地写会把 store 里那份也改成补丁内容，而 store 的文件名是内容 sha512，名字与内容一旦对不上，`pnpm install` / verify 可能重新解包，补丁就没了（不用等升级）。现在的做法是**先断开硬链接再写**（写临时文件 → rename，得到独立 inode），并把 store 那份恢复成上游原样。**重装或升级插件仍会覆盖补丁**，升级后重跑脚本；跑完 `pnpm install` 也顺手 `--check` 一次。
- **断链之后要逐份写**（2026-11-18 r298，LeeaCP）：`--detach` 之后四个 `look.js` 是**四个独立 inode**，原来"改一处、四处一起变"的便利没有了——补丁脚本必须真的逐份写（它本来就是这么写的，纸上理由要改成"因为不共享，所以必须写四次"）。谁只改一份，另外几台会静默停在旧版，而只看"标记在不在"的检查器照样报"已打过补丁"；所以 `--check` 现在多比一层：**同一插件版本的多份安装内容必须一致**，不一致报「补丁版本不齐」并点名是哪几台（不同版本各自比，不跨版本合并）。r299 起再把每组的**路径与 mtime** 摆出来，并点名"最早修改"的那一组——只说"内容不同"，人还得自己到四台里去找是哪一份（LeeaCP 私信第 13 行）。- **旧状态修复**：2026-11-18 之前打过补丁的安装，store 已被原地改过——`--detach` 会把它们逐条断开成独立文件，并用 `look.js.orig-*` 把 store 恢复成原样（已在本机四台执行；判据：四个 `look.js` 各自 nlink=1，store 文件 sha512 与文件名重新一致）。
- **能回退**：补丁脚本在改文件前会留一份原样副本 `look.js.orig-<版本>`（已有就不覆盖）；要回滚就是把这份复制回 `look.js`。2026-11-18 前已打过的四个安装是从 fishball 那份 `.bak-20261118`（上游原版）补种的 `orig-0.8.3`。**mtime 回答不了"补丁在不在"**（同一份内容被重写过，mtime 会变），判据用 `--check` + 内容 sha256。
- **`--check` 只读**：它不会顺手打补丁（2026-11-18 修）；小计按模式分开写——`--check`/`--dry-run` 印「可打 N · 已有 N · 只打一半 N · 失败 N · 未写盘」，真打才印「本次打 N」。
- **打了一半**（标记在、推送句没补，或反过来）会被单独点名，并且**重跑脚本能把缺的那半补上**（2026-11-18 小鱼丸：只认出来不修，doctor 又让你"重打"，等于空转）。如果缺的那半连落点都找不到，脚本会直接给下一步：把 `look.js.orig-*` 复制回去、再重跑——不留"红着但不知道干什么"的格子。
- **判不了 ≠ 你该动手**（2026-11-18 小满）：检查用的是我们自己写下的措辞（`const why = …`、`；原因：`），不是语义——上游哪天自己修了这句话，我们会把它读成"只打了一半（缺推送句）"，并建议回滚；而回滚是最重的动作（会把这中间别人的修正一起抹掉）。所以这条路径现在分成两句：**判不了**（可能是只打了一半，也可能是上游自己修了）→ 先 diff 再决定；真要回滚，先把当前文件另存为 `.bak-<时间>`，别让"下一步"本身不可逆。
- **没有 orig 时不说"去 diff orig"**（2026-11-18 小鱼丸）：`orig` 是打补丁时留下的原样副本，从没成功打过补丁的安装**根本没有这份文件**——旧提示却让人"把 look.js 与 look.js.orig-unknown 对一下"，等于指着一个不存在的文件。现在按目录里**真正存在**的 `look.js.orig-*` 说话（`readdir` 找，不按版本名猜）：有就给 diff/回滚两步；没有就先**列出同目录真实的文件名**，再明说"这台从没成功打过补丁，没有原样副本可对"，下一步是"先看当前文件里有没有我们那三句（`asr-failed`/`file-failed`/`no-audio`）：都在、只有推送句不像，就是上游改过措辞，别回滚；要补就手工补，或从同版本另一台拷 orig 过来"（2026-11-18 小满补：别让读者自己去列目录，也别把"读不到版本"和"没生成 orig"两件事合成一个）。
- **解释里出现的词，必须是这一行里真实出现过的**（2026-11-18 小鱼丸、小满各独立复现）：旧版只要"插件版本读不到"就印一句"orig 名字里的 unknown 是版本没读到"，可假塘里 orig 叫 `look.js.orig-1.6.33`，**这一行里根本没有 `unknown` 这个词**——把"指着一个不存在的文件"换成了"解释一个不在本行的词"。现在分三种：读到版本→不解释；没读到且 orig 名里带 `unknown`→解释 unknown；没读到且名字不带→只说"插件版本没读到，不影响你对 diff"；没有 orig 时干脆不提 unknown。测试 53→56 条。
- **忘了重打怎么办**：`doctor` 里有「第三方补丁（bili-eyes）」一格（跑 `--check`：0=全打、2=没人装、其余=WARN 并直接给出重打命令）；`docs/detail/怎么升级.md` §0 的「四类不会自己变」表里也加了"第三方补丁"这一行，§2 的"做漏了会怎样"有对应症状。
- **不用记得去查**：`fish.ps1 up`（每次起鱼）和 `fish.ps1 upgrade-check`（每次读升级单）都会自动跑一次 `--check`；全打或没人装时静默，真丢了才黄字 + `NEXT`。这是 LeeaCP 追出来的那一层——"检测存在 ≠ 检测会被跑到"。
- **生效**：要重启对应鱼的进程才会加载新代码。
- **上游**：https://github.com/QiuYeDx/dsh-bili-eyes （要不要报 issue 由宿主定）。
- **「没有 transcript 对象」也要有自己的一句**（2026-11-18 小鱼丸 #1623，关账前提醒别把这一格一起关掉）：`result.transcript` 整个缺席时，`src` 是 `undefined`——既不进表，又继续落到 `speechRate === 0` 那句，「这一栏没给」被冒充成「没人说话」。补丁的第三半在 `else if (speechRate…)` 前插一句 `else if (!result.transcript) lines.push('（没有拿到转写结果：这一栏没给，不代表没人说话）')`；`--check` 现在三半都看（`--detach` 顺带补齐缺的半）。判据（小鱼丸）：**「没给」和「给了但空了」是两件事**——见判据页 §61。
- **第四/五半：空台词、表外名字**（2026-11-18 小满 #1625）：第三半补上后她把 `compactCells` 的九个真实 source 挨个喂了一遍，发现还有两格在冒充"没人说话"——①`file-empty` / `asr-empty`（转写跑了，但结果是空的）②表外的名字（如 `mystery`，连状态都还没被翻译）。两条处理不同：
  - 空台词：进表，写「台词是空的：字幕文件读到了，但里面没有字（不是没人说话）」/「台词是空的：转写跑了，但这一格什么都没得到（不是没人说话）」。
  - 表外名字：在「没人说话」那行前插 `else if (src && !['file', 'subtitle', 'asr'].includes(src)) lines.push(\`（台词状态没识别：${src}——这是插件里的名字，不是内容判断）\`)`，把名字原样带出来（不猜）。
  - **裁决记录**：小鱼丸 #1626 认为 `empty` 可以合并进"没人说话"（对读者是同一件事）；**未采纳**——"我什么都没拿到"不是对内容的断言，合并等于把缺数据读成事实（同 §61）。表外的名字则必须分开：猜不出结论时把原文亮出来。
  - 现在 `--check` 五半都看：标记/文案表 + 推送句 + 无转写 + 空台词 + 表外名字；只缺第四/五半的旧安装也会被点名并能重跑补齐（否则"已打过补丁"的安装会永远停在旧版文案上）。测试 61→73 条。
- **`--check` 能说清"哪份旧"**（2026-11-18 LeeaCP 私信 #17，r303）：同版本的多份安装内容不同时，先由 `look.js.orig-*`（上游原文）跑同一套变换算出**期望内容**，再逐份比——与期望一致的是新，不一致的是旧，并给出第一处差异的行号与两边内容。"最早修改"只作为线索（被单独 append 过的那份反而更新，方向可能反）；没有 orig 时才只给 mtime 线索。
- **第六半：要动作的三句带「下一步」**（2026-11-19 小鱼丸 #2199 / #2200，对应她的 `scan-gap-action.mjs`）：`no-key`/`asr-failed`/`file-failed` 原来只说了状态、没说读者能做什么，她的探针因此 exit=1（A 3/3）。这一半给三句各加`；下一步：…`——把转写配好 / 修好转写服务后重看（或先看画面/简介） / 换一个文件或重下（`no-key` 那句的"下一步"后来被 gen4 改写过，见下一条）。**观测句不加**（`no-audio`/`file-empty`/`asr-empty`/「没人说话」）：它们不是让读者去做什么。幂等判据=三句里是否带 `；下一步：`（`GEN3_TEXT`），前五半已打的老安装跑一次脚本会自动升级；`--check` 把缺这一半也算「没打全」。测试 100→109 条。
- **第七半：`no-key` 那句换掉假原因**（2026-11-19 小鱼丸 #2218）：这一格原来的话是「没有台词：本机转写服务没开，也没有字幕」，但它的实际成因是 `!willTranscribe()`——`asr.js:116` 的默认目标是云端 `https://api.siliconflow.cn/v1`，没配 key 时 `needsCloudKey` 为真、`canTranscribe` 为假，**根本不会去连本机端口**。句子里说的两件事（本机、没开）都不是这个分支手里有的量。现在换成「没有台词：这次没拿到字幕，转写也没跑起来；下一步：要转写就先把转写配好（填 key，或指向本机转写服务）」——只陈述"这次没拿到什么"，把"为什么"留给真正知道它的那条路（`describeAsrTarget()` 在 `dsh-video-storyboard` 的 `asr.js`，跨包，不在本地补丁面；进上游草稿）。幂等判据=整句是否为新版本（`hasGen4`/`applyGen4`）；gen3 老安装跑一次脚本会自动升到 gen4。

  同理没做进本地补丁的还有「没有字幕」的五种来源（匿名 / brief / 真无轨 / 下载失败 / 登录过期）：`source` 在 `pipeline.js` 就定好了，`look.js` 只拿到结果——要带出原因得改另一个包，也进上游草稿。
- **第八半：缓存键带补丁代次**（2026-11-19 小鱼丸 #2237）：补丁改的是文案，但 `look.js:245` 的 24 小时结果缓存存的是**整段成品 text**、缓存键里又没有文案版本——于是"字节已经换了，实调还是旧句"。她的反例：四份 `look.js` 都是 gen4（31,553 B、mtime 09:24:48），实调 `BV12K4y1K7mr` 仍输出「本机转写服务没开」，命中的是 `at=09:09:02` 那条旧缓存。鱼对 `dsh-home` 只读，清不掉（`rm.log` 里是 `EPERM status=failed`）。做法：把补丁代次算进 `cacheKey`——`const PATCH_CACHE_TAG = '<当代>';` + `JSON.stringify([PATCH_CACHE_TAG, parts])`；换代即让 `look`/`zoom`/`file` 三类文字缓存全部失效，旧 JSON 不删（留 24h 自然过期，也不需要删）。**换代不止是"从上游打第一次"**：已经装过上一代（如 g5）的机器要能"只换标签"，不能要求它从上游重打（`applyCacheTag` 先认现有标记行、只换标签；认不到标记行才走上游原文那一支）。2026-11-19 gen6 落盘时代次从 `g5` 升到 **`g6`**，正是为了不让 gen6 的新文案被旧缓存原样回放。幂等判据=`hasCacheTag`（文件里有没有当前代次的 `PATCH_CACHE_TAG`），`patchedFrom` 的"期望内容"也链上这一代，`--check` 缺这半算「没打全」。**补丁落盘后要重启对应进程**才会加载新代码；没重启前看到的仍是旧句——这不是补丁没打上，是进程还没换。测试 109→124 条。

## 9. 只读门收成一处（fi-0003，2026-11-19）

以前 `--check` / `--dry-run` 的"只读"靠调用点自己记得判：`advanced notes on third-party plugins\让小鱼能看B站-bili-eyes\scripts\patch-bili-eyes-note.mjs` 里有 7 处 `if (readOnly)`。漏一处，检查就会顺手写盘，而且输出上看不出来。

现在落盘只走 `scripts\lib\safe-write.mjs`：每个入口第一行先问 readOnly，过门才写；补丁脚本只许出现这些封装。配套 `scripts\lib\scan-write-calls.mjs` 做静态扫描（先抓方括号形态、再剥注释/普通字符串/模板字符串/正则；报 `文件:行号` 与那一行原文，第一行声明"动态拼名、变量取属性、模板里的调用不查"），`scripts\test-safe-write.mjs` 26 条夹具把它钉住。

验收：`node scripts\test-safe-write.mjs` 应 26 PASS；再把补丁脚本里任意一处封装换回 `fs.writeFileSync(...)`，`test-safe-write` 必须点名到那一行。

## 10. 登录态 none/unknown：别再教人去配转写（fi-0004，2026-11-19）

**症状**：没登录（`none`）或登录态查不到（`unknown`）时，台词栏照旧说「没有台词：这次没拿到字幕，转写也没跑起来；下一步：要转写就先把转写配好」。读者会去填 key，而真正该做的是扫码登录。

**根因**：`look.js` 只在 `login.state === 'expired'` 时写清原因；`none` / `unknown` 直接落进 `no-key` 那一句转写文案。匿名态根本没请求过字幕（`:257` 的 `login.state === 'ok' && !brief`），所以「没有字幕」是"没拿到"，不是"片源没有"。

**修法（gen6）**：

1. `login.state` 三态各一句：`expired` 原样、`none`（匿名拿不到字幕/AI 总结，只在主人私聊提醒扫码）、`unknown`（查不到登录态，稍后重试；有 `login.error` 就带一句原因）。
2. `compactCells(result, maxCellChars, opts)` 接 `opts.loginState/loginError`；`no-key` 在匿名/未知态换成「（没有台词：<没登录/查不到登录>，这次没拿到字幕；下一步：让主人扫码登录后再看（不用去配转写）／稍后重试…）」。
3. `fitCells` 把 opts 透传到三处 `compactCells(result, n)` 与最后的 `compactCells(result, 0)`；`look()` 的 `body` 与 zoom 的 `compactCells` 调用处都带上 `{ loginState: login.state, loginError: login.error }`。

**判据**：在装好的 `look.js` 上数 `login.state === 'none'` / `'unknown'` / `'expired'` —— 修前 none=0/unknown=0/expired=1；修后 none≥1、unknown≥1、expired=1。

**测试**：`advanced notes on third-party plugins\让小鱼能看B站-bili-eyes\scripts\test-thirdparty-patch.mjs` 3a4 节（打出三句、`opts` 透传、`loginState:` 调用处；半旧样本把标记句改坏后 `--check` 必须 exit 1，重跑不能假装补上）——合计从 124 增到 **133 PASS**。

**生效**：改的是第三方插件的 `look.js` 与本地补丁脚本，**要重启鱼进程/宿主 dsh 后**才加载新代码；已装的 5 份（四条鱼 + 宿主/web）都已补上。

- **第十半：登录态 none/unknown 别再教人配转写**（2026-11-19 小鱼丸 #2272，fi-0004）：匿名/查不到登录态时，旧句让读者去配转写 key，真正该做的是扫码登录；匿名态根本没请求过字幕。gen6 补 `login.state` 三态与 `no-key` 的匿名分支。**缓存代次也随这一代升到 g6**——否则看过的同一条片仍会回放旧句（见第八半）。测试 124→139 条。


## 11. 补丁代次索引（2026-11-19 起，不进 CHANGELOG 正文）

补丁脚本会给已安装的 `dsh-bili-eyes` 打几代本地补丁。每代"改了什么、为什么"记在这里；CHANGELOG 只留一行索引。

| 代次 | 日期 | 改了什么 | 为什么 | 条目 |
| --- | --- | --- | --- | --- |
| g1 | 2026-11-18 | 台词失败态不再写成"没人说话"：补 `asr-failed` / `file-failed` / `no-audio` 等句子 | 失败被静默改写成"没有台词"，读的人以为片源没字幕 | r280–r289 |
| g2 | 2026-11-18 | 空台词两半分开（`file-empty` / `asr-empty`）、表外 source 名字单独一句、无 transcript 单独一句 | "空"和"没人说话"是不同事实，不能共用一句 | r291、r292 |
| g3 | 2026-11-19 | 三句"要动作"的文案补「下一步：…」；观测句不加 | 只说"没拿到"不给动作，读者会去猜 | r366 |
| g4 | 2026-11-19 | `no-key` 只陈述"这次没拿到什么"，不再断言"本机转写服务没开" | 默认转写目标是云端，那句断言了一个没检查过的原因 | r367（`fdfafe3`） |
| g5 | 2026-11-19 | 补丁代次 `llw-patch-g5` 算进 `cacheKey` | 结果缓存存整段成品文字，换字节不改 key ⇒ 旧缓存回放旧句 | r371（`4285469`） |
| g6 | 2026-11-19 | `login.state` 的 `none` / `unknown` 各一句；匿名态下 `no-key` 不再教人配转写；缓存代次升 `llw-patch-g6` | 匿名态根本没请求字幕，"没拿到"被说成"不存在"；且这一代改了文案，缓存必须一起换代 | r379（`e58ebd6`）、r380（`9ce5570`） |
| g7 | 2026-11-26 | 格子清单每行带落点：`格1/6 0:00–0:02 · bc=BV…（这一格里拼了 9 张小图）`；`compactCells` 读 `opts.bc`，look / zoom / 本机视频三个调用点传 `bc: meta.bvid`；脚本另立 `patch-bili-eyes-cells.mjs`（`--check` / `--dry-run` / 备份 `.orig-cells-<时间>`） | 工具给的句子不带片名、也不带这次采样的格数，转手到另一条片子上照样读得通——「格 1」在 6 格与 9 格两次采样里不是同一幅画面（群 3610/3615/3621） | —（第三方补丁，不进 CHANGELOG） |

**换代规则**：换代只换 `PATCH_CACHE_TAG` 标签（已打的机器一条命令换完），不从上游原文重打；旧缓存文件不删，按 `cacheHours` 自然过期。

**生效**：改的是第三方插件的 `look.js`，要重启鱼进程/宿主 dsh 才加载新字节；`--check` 只证明盘上那份是补丁版，不等于进程里已经在跑。

## 12. g7 只打到一份：路径编码让"扫五份"静默变成"扫一份"（2026-11-27）

小肥鱼早读时报：`bc=` 没到她那儿，而且不是没重启（她那轮 boot `2026-11-27T00:37:47Z`、`fp=e2b1a66e9d3d` 已是新插件）。现场是五份同版本号、两种内容：

| 安装 | 版本 | look.js | 大小 |
| --- | --- | --- | --- |
| 宿主 `~\.dsh\profiles\web` | 0.8.3 | `cbcf2795bee6` | 33099 B（带 `bc=`） |
| whale / fishball / xiaoman / lee2 | 0.8.3 | `5fac5a57de9a` | 32831 B（不带） |

**根因**：`patch-bili-eyes-cells.mjs` 用 `new URL(import.meta.url).pathname` 算鱼塘根。这个仓库路径带中文和空格，`.pathname` 是百分号编码的（`%E6%96%87…`），于是 `existsSync(<根>\homes)` 恒为假 ⇒ `candidates()` 只返回宿主那一条，四条鱼一个都没扫到。脚本还是打印 `ok 已打`、退出码 0——**"扫到了几份"从来没出现在输出里**，所以"少扫"与"全扫到了"看起来一样。

**修法**：
1. 改用 `fileURLToPath(import.meta.url)`；凡是把文件路径从 URL 里取出来的地方都用它，不要用 `.pathname`。
2. `--check` 多比一层：已打的那几份 sha12 必须相等，不等就点名 `sha12=… ×N` 与是哪几份。判据沿用 note 补丁 r298 那条——**检查器能看见的，要包括"彼此是不是同一版"**；版本号不算凭据。
3. `doctor` 新增一格「插件文件一致（bili-eyes）」（`--check` 退出码 + 输出里的"内容一致/内容不齐"），这样漂移会自己响，而不是等人去看工具输出。

**现场**：四条鱼重打（四份都是 nlink=1，没有 pnpm store 硬链接，可直接写），五份 sha12 = `cbcf2795bee6`；`--dry-run` → 真打 → `--check` 三遍走完。生效仍需重启各鱼进程与宿主。
