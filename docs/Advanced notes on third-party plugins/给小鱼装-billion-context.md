# 给小鱼装 billion-context（两种情形：全新装 / 从老对话迁成鱼）

> 这一篇是**第三方插件**的心得，不是基座的一部分。基座不依赖 billion-context，装不装都能跑。
> 记录时间：2026-11-17。当时验证的版本：**billion-context 0.1.216**（npm 最新），宿主 web profile 0.1.216，四条鱼 0.1.216。
> 官方文档以包内 `README.md` 和 `docs/` 为准；这里只写"在鱼塘里装"和"按官方文档装"不一样的地方。

## 0. 先记住三件事

1. **XDG 是开关，不是习惯。** billion-context 的数据/配置/状态/缓存都不在 `DSH_HOME` 里，而在四个 XDG 环境变量指向的目录。鱼塘的启动器（`scripts\fish.ps1`，r239 起）**只有**在 `<家>\dsh-home\xdg` 存在时，才给这条鱼注入 `XDG_CONFIG_HOME / XDG_DATA_HOME / XDG_STATE_HOME / XDG_CACHE_HOME`，否则她的 billion-context 会落进宿主的全局库（`%USERPROFILE%\.local\share\billion-context\sessions\index.db`），几条鱼共用一本。
2. **装完要重启那条鱼。** 插件是在进程启动时加载的；`dsh plugin add` 只改 profile 里的包，不改已经在跑的进程。
3. **历史会被回填，但时间会塌。** 鱼第一次挂上会话时，billion-context 会把**已有的会话历史一起回填**进她的库（实测：一次 2,336 条 refs、baseline 563,700 tok）；但回填后库里所有消息的 `ts` 都是**回填那一刻的批次时间**——"这句话是什么时候说的"在库里查不到，要时间就回原始会话文件（`dsh-home\sessions\**\session.v4.jsonl.zstd`）。

## 1. 全新安装（推荐，四条鱼都是这么装的）

以 `fishball` 为例，`<键>=fishball`，家 `D:\文档\WorkSpace\lil-whale\homes\fishball`。

**第 1 步：停鱼。**

```powershell
pwsh -NoProfile -File scripts\fish.ps1 down fishball -Yes
```

运行中改 profile 会热重载，正在跑的会话可能被抽走工具绑定。

**第 2 步：建 XDG 目录 + 种子配置。**

```powershell
$key='fishball'
$home = "D:\文档\WorkSpace\lil-whale\homes\$key"
foreach ($d in 'config','data','state','cache') { New-Item -ItemType Directory -Force "$home\dsh-home\xdg\$d" | Out-Null }
$cfgDir = "$home\dsh-home\xdg\config\billion-context"
New-Item -ItemType Directory -Force $cfgDir | Out-Null
@'
{"providers":{},"compress":{"preserveRecentMessages":5},"promptCache":{"routing":"enabled"},"rollout":{"features":{"pluginFullResendWatermark":true}}}
'@ | Set-Content "$cfgDir\billion-context.json" -Encoding utf8
```

这份种子是从已经跑通的鱼（lee2）抄的：清空 `providers` 是为了避免模型端点路由警告；其余用默认。

**第 3 步：把包装进这条鱼的 profile。**

```powershell
$env:DSH_HOME = "$home\dsh-home"
dsh plugin --profile fishball add billion-context@0.1.216
```

- `--profile` 用**鱼键**（不是 `web`）。
- 装完检查：`$home\dsh-home\profiles\fishball\package.json` 的依赖里要有 `"billion-context": "0.1.216"`。
- 若 pnpm 报 `minimumReleaseAgeExclude` 提示，可忽略（新发布版本被包管理器按"最小发布年龄"提示）。
- **坑（PowerShell）**：`$home` 是只读变量，`$home=...` 会被拒绝且脚本继续跑，`DSH_HOME` 变成空串、装进默认 profile。用 `$fh` 之类的名字。

**第 4 步：起鱼。**

```powershell
pwsh -NoProfile -File scripts\fish.ps1 up fishball -NoBrowser
```

判据：输出里有这一行 ⇒ XDG 注入生效：

```
bili/压缩状态用她自己的目录（...\homes\fishball\dsh-home\xdg）
```

**第 5 步：自检。**

```powershell
# a) 启动痕迹：pkg 版本、codeFp、profile 对不对
Get-Content app\logs\plugin-boot.log -Tail 5
# b) 会话挂载后工具数应 +6（compress / decompress / search_context / acp_status / acp_cache / acp_read_original_image）
Select-String app\logs\plugin-boot.log -Pattern 'session-mounted'
# c) 她的库文件出现了
Get-ChildItem "$home\dsh-home\xdg\data\billion-context\sessions"
# d) 用 CLI 看会话（要带上她的 XDG 环境变量）
$env:XDG_CONFIG_HOME="$home\dsh-home\xdg\config"; $env:XDG_DATA_HOME="$home\dsh-home\xdg\data"
$env:XDG_STATE_HOME="$home\dsh-home\xdg\state"; $env:XDG_CACHE_HOME="$home\dsh-home\xdg\cache"
node "$home\dsh-home\profiles\fishball\node_modules\billion-context\dist\index.js" sessions ls
```

`no sessions found` 不等于坏了——说明她**还没活动**（库刚建、会话还没挂载过）。她下一次说话/被唤醒后再看就会发现 `sessions 1 / blocks N / refs N`。

## 2. 怎么验"真的接上了"（小鱼丸定的口径）

不要看"库文件存在"就当装上。用**她今天说过的一句原话**去库里搜。

1. **对照组**：先在原始会话文件里搜到这句原话（`dsh-home\sessions\**\session.v4.jsonl.zstd`，多帧 zstd，用 7-Zip 或自写解帧脚本；Node 的 `zstdDecompressSync` 只解第一帧，别用）。
2. **被测组**：用 billion-context 的检索（或直接查库里 `content` 表）搜同一句。
3. 判据：对照组有 → 被测组也有 ⇒ 接上了；对照组有、被测组没有 ⇒ 没接上（不是"历史太长"）。
4. 时间戳不要用来过滤：库里 `ts` 全是回填时刻。

## 3. 从"用过 billion-context 的老对话"迁成鱼（lee2 的做法）

场景：宿主有一段很久的会话（`session-e17c3c91-…`），想把它变成鱼塘里一条独立的鱼（名字 LeeaCP、键 `lee2`、端口 3085），历史、压缩库、附件都要带过来。

**关键前提：复制不是搬。** 迁完必须把旧家里那份会话移走（改名/归档到 `backup\`），否则同一个 `session id` 在两个进程里各写各的 = **split-brain**，两份历史会当场分叉。基座 doctor 现在有「会话分身（全鱼）」会抓这个。

**第 0 步：建鱼。** 用 `fish.ps1 new -Key lee2 -Name LeeaCP -Parent none`（根鱼、不挂家长），得到家 `homes\lee2`、端口 3085、profile `lee2`。

**第 1 步：搬会话文件。**

- 新家目录：`homes\lee2\dsh-home\sessions\<新 projectKey>\session-<id>\session.v4.jsonl.zstd`
- `projectKey` 由会话首帧的 `cwd` 算出来（鱼塘有算法在 `scripts\migrate-pond.mjs`）；迁移后要**把首帧 cwd 改成新家路径**（只改首帧，不要重写整段）。
- 实测量级：15.9 MB / 8,529 帧 / 改 1 处 cwd。

**第 2 步：搬附件。**

会话里只存附件的 `sha256` 引用，字节在 `<DSH_HOME>\attachments\v1\` 下（对象在 `objects\`、文件在 `file-objects\` 与 `files\`）。不搬 ⇒ 打开旧对话报 `Attachment object is missing.`。

```powershell
node scripts\migrate-attachments.mjs --source-home "C:\Users\<你>\.dsh" --target-home "D:\...\homes\lee2\dsh-home"
```

脚本会先扫目标家会话日志收集引用，只搬引用到的，逐字节校验；旧家缺失的对象逐条点名。实测 138 个对象（135 图片 + 3 文件，约 18 MB）。

**第 3 步：搬压缩库（billion-context 的数据）。**

思路：从旧库导出 → 在新家的空库里恢复。旧库在 `%USERPROFILE%\.local\share\billion-context\sessions\index.db`（WAL 模式，可能 500 MB 级）。

1. `sessions archive <会话id>` 把旧库里那一段导出成 `archive.jsonl`（实测 45 MB）。
2. 在新家把空库建出来：带上新家 XDG 环境跑一次 `node …\dist\index.js sessions ls`（只建 schema，不写数据）。
3. **插一行 sessions 壳**（0.1.215 实测的坑）：`sessions restore` 只 **UPDATE** 已有会话行，空库里没有行就什么都不恢复。直接在 `index.db` 的 `sessions(session_id, created_at, updated_at)` 插一行，再 restore。
4. 把 `archive.jsonl` 放进她的 store 目录，`sessions restore`，然后核对：`sessions 1 / blocks 128 / refs 9,753 / messages 11,678 / content 11,842`（都应与旧库一致）。
5. **升级前备份**（0.1.215 → 0.1.216 实测无损，但先备份）：停鱼，把 `xdg\data\billion-context` 整个拷到 `backup\lee2-bc-0.1.215-<日期>\`。

> 0.1.216 的 `sessions restore` 是否仍是"只 UPDATE"没有复验；升级后要迁移时，先 `sessions ls` 看有没有壳行，没有就按上面第 3 步插一行。

**第 4 步：装包、绑定、起鱼。**

```powershell
dsh plugin --profile lee2 add billion-context@0.1.216   # 若已有旧版，就是升级
pwsh -NoProfile -File scripts\fish.ps1 bind lee2 -Session session-<id>
pwsh -NoProfile -File scripts\fish.ps1 up lee2 -NoBrowser
```

**第 5 步：登记工作区（不然界面里她挂在「未分组」）。**

DSH 界面读的是 `dsh-home\storages\workspace.json` 的登记表，不是 sessions 目录。用 `scripts\register-workspace-session.mjs --member lee2 --session session-<id>`；表里一个工作区都没有时脚本会按她家补一个「家」。

**第 6 步：收尾（最重要）。**

- 把旧家那份会话目录整个移到 `backup\<名字>-<日期>\`，**不要直接删**。
- 跑 `doctor`，确认「会话分身（全鱼）」是 OK。旧家里 5 段同伴会话可以留着不动（它们没被复制）。
- 旧库冻结：宿主那本 536 MB 的全局库不要搬、不要 checkpoint、不要再写入；要看旧历史就按上面第 1 步回原始会话文件。

## 4. 本机现状（2026-11-17 22:52）

| 鱼 | 版本 | 库 | 说明 |
| --- | --- | --- | --- |
| Leea（宿主 web） | 0.1.216 | 全局库（`%USERPROFILE%\.local\share\billion-context`，约 536 MB） | 宿主自用，冻成只读档案，不再写 |
| 第二条鱼（whale） | 0.1.216 | `xdg\data\...\index.db` 163,840 B，空 | 睡觉中，等她下次活动才建库 |
| 第三条鱼（fishball） | 0.1.216 | 10.9 MB，1 段会话 / 2,342 refs / 9 blocks | 已验收（历史回填） |
| 第四条鱼（xiaoman） | 0.1.216 | 163,840 B，空 | 等她下次活动 |
| 第五条鱼（lee2/LeeaCP） | 0.1.216 | 65.3 MB，1 段会话 / 10,300 refs / 138 blocks（29 active） | 迁移来的库，升级无损 |

## 5. 升级与回滚

- **升级**：`fish.ps1 down <键> -Yes` → 备份 `xdg\data\billion-context\sessions` → `DSH_HOME=… dsh plugin --profile <键> add billion-context@<版本>` → 起鱼 → `sessions ls` 核数字。0.1.215→0.1.216 实测 SQLite 表结构没变（14 张表同一套），风险点在包代码（`dist\index.js` 6.26 MB→6.32 MB）。
- **回滚**：停鱼，删 `xdg\data\billion-context`，重装旧版本再起；原始会话文件不受影响（库只是索引）。若回滚后想找回索引，重新挂载会回填。
- **看日志**：`<家>\dsh-home\xdg\state\billion-context\bili.log`。
- **不要**把两条鱼的 XDG 指到同一个目录：多实例共享 sessions 目录是上游支持的拓扑，但同一段会话被两个实例各走一遍是 split-brain（上游日志里也会这么写）。
