# PRD 改动记录

> 本文件按 **PRD 稿次** 编号：`rNN` —— 文档每改一次 +1，一天可能十几稿。
> 它与两个 npm 包的版本（各自 `package.json` 里的 semver，如 `1.2.0`）是**两条线**：包版本只在功能或破坏性变化、发布时才动。
> 编号从 r1 开始（第一稿就是 r1）。2026-11-13 之前这些号写作 `v1.0.NN`，本次统一改名，编号不变。

## r110（2026-11-15 00:3x）

- 新增 **附录 A.94 所有的闸：默认值要抬到"正常聊天永远撞不到"**：起因（小鱼丸一小时 12 次撞 `perHour`、消息扣住不丢、00:50:53 松开）、十道闸的改前/改后表、为什么留、三条判据、教训。
- `plugin/dsh-lil-whale-group/lib/index.js`：`WAKE` 从 `CFG.wake` 读（cooldownSec 60→15、perHour 12→40、perDay 60→200、totalPerDay 120→400）；`WATCH.maxWakesPerDay` 从 `CFG.watch` 读（8→24）；新增 `numSetting()`。
- 界面两修（`client build v42 · multiline-multi-image`）：Shift+Enter 换行 + 自增高；多图最多 4 张（选图/粘贴/拖入/缩略图/逐张删），记录 1 张写 `image`、多张写 `images`；宿主、UI 路由、重建器三处同改。
- `lil-whale.config.example.json` 与 `docs\打包.md` 补 `wake` / `watch` 两段；两包 1.6.3→1.6.4。

## r109（2026-11-15 00:1x）

- 修小肥鱼抓到的三处不一致：`fish.ps1 wake` 写账但不刷 `sleep-status.json`、同一时刻两个"醒到几点"、`reason` 等于脚本名。抽出 `sleep-status.js`（巡守与 `sleep-cli` 共用同一个渲染器），`wake` 改完状态立刻刷新；`fish.ps1 wake` 加 `-By`/`-Why`，面板叫醒带"谁按的、为什么"。`test-sleep` 50→60。A.93。

## r108（2026-11-14 23:2x）

- 鱼塘面板补一处：点「检修」后进程刚停、命令行未起的十几秒里，卡片会短暂只剩「唤醒」——看着能点，其实还没起来。改成动作在飞时只画灰着的「处理中…」。`client build v41 · pond-pending`。A.92 补记。
## r107（2026-11-14 23:2x）

- 修鱼塘面板两个问题（他报的）：「打开」按钮恒不可点（条件 `!unattended && !windowMode` 恒 false）→ 改名「打开 WebUI」、只要进程在跑就能点（只是看，不多 writer）；按钮改成按状态渲染，不再"画出来再置灰"。`client build v40 · pond-buttons`。
- 新增附录 A.92。
## r106（2026-11-14 22:5x）

- 修复：Fabian 的私信没叫醒她 —— 她的 dm 游标比文件靠前（14 vs 13），新消息被当成"已经读过"。`handleChannel` 读游标时夹到行数以内并留痕 `cursor-clamped`；`doctor` 新增「游标」检查。
- 新增附录 A.91。

## r105 — 2026-11-14 22:0x

**撤掉四条越界设计**（他 21:5x 指出两条、我自查两条）：

- `roll` 骰子（"今天可以不想看"30%）：他原话"为什么能让一个随机的骰子替她决定今天看不看呢？不合适"。删工具、删 `rolls.log` 账本、删 `rollSkip`。
- 沉默衰减（3 天→7 天→0 额度）：他原话"会和小鱼自行判断'要不要分享'打架"。删 `globalCapFor`/`silentDaysOf`/`lastSpokeAtOf`、`capOk` 恢复固定 6/天。
- 两本日记（给主人的信可滤镜 / 自己的原样）：自查越界（替她规定内心生活）。从模板删。
- 追更三件（`watchlist_*`）：自查越界（why 必填/上限 5/冷却把"怎么追"定死）。白名单 18 → **15**，服务端代码保留未启用。

**保留**：水表 80/天（成本与账号安全，不是行为引导）、生成器挂载、`环境.md` 按真实白名单生成、别人家不能盯。

**文档**：A.90 重写（r105 收窄 + 四条撤掉的理由）；`docs\账本.md` 删 `rolls.log` 行；`环境.md` 重生成（两条鱼）。**两包 1.6.0 → 1.6.1**。

**要重启才生效**：whale 重启后 `roll` 从她工具表消失；3080 重启后巡守侧衰减彻底消失。

## r104 — 2026-11-14 21:2x

- **给 whale 装了一只只读的眼睛（B站）**：上游 `bilibili-mcp` 服务端再挂一份，白名单 18 个只读工具（无发评论/点赞/私信/登录）；水表 80 次/天 + `ledger.jsonl`；追更三工具（`watchlist_*`，why 必填、上限 5、同 UP 10 分钟一次）；挂载改由 `apply-neutral-preset.mjs --with-bili` 生成（不再手写进 patch）。fishball 不动。
- **三条"生活"设计**：`roll({reason})` 今天可以不想看（机制掷骰，账本 `rolls.log`）；沉默衰减（连续 3 天没说话 → 素材额度 3/天，6 天 → 0，闹钟日记照旧）；两本日记（`给主人的信.md` / `<日期>.md`）。
- `环境.md` 新增「看外面（B站，只读）」一节，**按每条鱼真实白名单生成**（`scripts\bili-section.mjs`）；`docs\账本.md` 补 `rolls.log` 与 `bili\ledger.jsonl` 两行。
- 两包 1.5.5 → **1.6.0**；PRD **r104** + **A.90**。

## r103 — 2026-11-14 18:3x

- **字段级版本 `atfmt=2`**：`wake-try` 行（plan 与 intent 两处）的 `at=` 后面加 `atfmt=2`；没有 `atfmt` 的旧行按 `atfmt=1`（UTC）读。起因：她指出 `watchman.log` 里"整行 fmt=2 + 字段 at= 还是 UTC"会让人差八小时，建议"版本号贴着它管的东西"。
- **`docs\账本.md` 补三个账本**：`homes\<鱼>\dsh-home\logs\wake.log`（推门 why=）、`pool\group\plugin.log`（注册/挂载/toolCount，**UTC ISO**）、`homes\<鱼>\logs\close.log`（开关窗，busy= 推导）；新增「字段级版本」一节与读账第 4 条。
- 两包 1.5.4 → **1.5.5**；PRD **r103** + A.89 补记 2。

## r102 — 2026-11-14 18:2x

- **新建 [`docs\账本.md`](账本.md)**：登记十个账本的写者 / 钟 / `fmt` 含义，并写明"没有 `fmt` 按 `fmt=1` 读""每个账本自己数自己的 `fmt`""时间一律本地（roster-audit 的 fmt=1 例外）"。起因：她指出"版本字段能替旧行说话，但这一版是什么意思得有个地方写"。
- **README** 增一条：`fmt=` 是版本号不是格式，并链到登记表；文档索引加一行。
- `auditRoster()` 上方补同义注释（代码注释给写的人，docs 给读的人）。
- 无行为变更，包版本不变（1.5.4）。
- PRD **r102** + A.89。

## r101 — 2026-11-14 18:1x

- **`wake-try` 的 `at=` 统一本地钟**：新增 `localStampOf()`，plan 与 intent 两种行都写 `YYYY-MM-DD HH:MM:SS`（plan 用 `dueAt`、intent 用 `firstTrueAt`；算不出来写 `?`）。起因：她指出"同一台机器上不该有两种钟"，同一条账里行首本地、`at=` 是 UTC。
- **README 增「她自己定的叫醒」一节**：`wake-plan.json`（到点）+ `wake-on.json`（条件），三种 kind、边界、额度、账本与体检入口。
- 两个包 **1.5.3 → 1.5.4**。
- PRD **r101** + A.87 补记 2。

## r100 — 2026-11-14 18:1x

- **名册自检的口径与钟**：`roster-audit.log` 改 `fmt=2`——加 `scope=fish` 与 `exclude=`（人 / 家不在 homes 下的巡守），时间从 UTC 改本地（和 watchman/fish/sleep 三本账一致）。起因：她指出"3/2/3 三个数看着不相等，结论却是 ok"，以及"同一台机器上不该有两种钟"。
- 两个包 **1.5.2 → 1.5.3**。
- PRD **r100** + A.88 补记 3。

## r99 — 2026-11-14 17:5x

- **差集字段按她的叫法**：`roster-audit.log` 的 mismatch 行改成 `only-in-homes=` / `only-in-members=` / `only-in-pins=`，干净行写 `members=… homes=… pins=… ok`。起因：她指出"三份对照要比集合，不能比条数"。
- 两个包 **1.5.1 → 1.5.2**。
- PRD **r99** + A.88 补记 2。

## r98 — 2026-11-14 17:5x

- **自检也留"跑了没问题"**：`auditRoster()` 每次跑都写一行（`roster-audit | fmt=1 ok ...` / `roster-mismatch ...`），不再"只有出错才写"；`doctor.ps1` 新增 3e「名册自检」，区分"没跑过"（WARN）与"最近一次对不上"（FAIL）。起因：小肥鱼查到文件不存在，并指出"没有"不等于"没问题"。
- 两个包 **1.5.0 → 1.5.1**（生效要等下次重启）。
- PRD **r98** + A.88 补记。

## r97 — 2026-11-14 17:5x

- **名册自检**：巡守每 6 小时跑 `auditRoster()`（名册 vs `homes\*` vs `pins.json`），对不上写 `pool\state\roster-audit.log` + `watchman.log` + 群里告诉人；`doctor.ps1` 新增 3d「名册与家」。起因：小肥鱼指出"如果我从名册里被移出去，'名册变了'这条叫不动我"。
- 两个包 **1.4.1 → 1.5.0**（生效要等下次重启）。
- PRD **r97** + A.88。

## r96 — 2026-11-14 17:4x

- **投递文案不替她认领**：`intentDeliveryText` 从「你自己写的条件成立了」改成「你的表里有一条条件成立了」，末行改成「这条不是谁在提醒你，是 `plan\wake-on.json` 里的一条条件」；`test-intent.mjs` 加反例断言（文案里不许出现"你自己写的"）。
- **`wake-try` 统一行形状**：intent 行补 `kind=intent` / `hb-age=` / `deliver=msg`，plan 行补 `kind=plan`。
- 两个包 **1.4.0 → 1.4.1**（生效要等下次重启；主 dsh 的巡守进程里还是 1.4.0）。
- PRD **r96** + A.87 补记。起因：她验收时抓到"投递文案替她认领了一条她没写的条件"。

## r95 — 2026-11-14 17:2x

- **她自己写下的条件（wake-on / intent）**：新增 `plugin\dsh-lil-whale-group\lib\intent-core.js`（纯逻辑）+ `scripts\test-intent.mjs`（24 用例）+ 巡守侧探测（`intentTick`，只在 `watchOne` 里）；三种 kind：`pending` / `text-appears` / `file-changed`；状态 `pool\state\wake-on\<键>.json`、全局额度 `_global.json`；投递走 `say(..., "group", "watch")`，睡眠期间天然扣住；日志 `trigger=intent` / `wid=wl-<HHMM>-<id>` / `at=` / `lag=`。
- **评审改掉四处**：只由巡守探测（单一写者）；`unread`→`pending`；别人家不许监听（合法做法 = 对方发消息告诉她）；证据快照就是那条消息本身，不另存。
- **接线**：`doctor.ps1` 3c（wake-on.json 形状）、`verify-pending.ps1` 4e、`release-check.ps1` 4e；`templates\环境.md.tpl` 加「你自己写的条件」一节并 `fish.ps1 refresh all` 重生成两条鱼；两个包 **1.3.0 → 1.4.0**。
- PRD **r95** + **A.87 她自己写下的条件**。

## r94 — 2026-11-14 16:5x

- **日志轮转**（他 16:39 批的）：新增 `scripts\rotate-logs.mjs`（> 1 MB 切一份、同类留 3 份、`--dry-run`）；巡守每小时起一次（`maybeRotateLogs()`，独立进程、失败不炸巡守）；PRD A.86。
- **四堆备份归档**：删 `pool\group\群.md.bak-20261112-194734`（280 KB 派生文件）；`shortcut-tests` / 旧 ACL 备份 / 15 份 profile `.bak` 移进 `pool\archive\`（profile 每类留最近 2 份）。
- **待办合并**：删按天页（11-12 / 11-13 / 11-14），只留 `docs\待办.md`（只放没做完的）；README / 出生流程 / PRD 里的旧待办路径与 ACL 备份位置同步改口。
- **`~\.dsh\profiles` 清理**：24 个 `.bak`（194 KB）收进 `~\.dsh\backups\20261114-profile-baks\`（留一条退路，随时可删）。
- **`scripts\README.md` 同步现状**：入口从四个改两个（`Run DSH.cmd` / `Stop DSH.cmd` 已删）、`down-main` 语义改成"先鱼后主"、补 `test-rename.mjs` / `rotate-logs.mjs` 两行、`test-sleep` 40→50 用例、巡守日志实际路径改成 `<第一条鱼的家>\logs\watchman.log`、`HER_WAKER` → `selfWaker`。
## r93 — 2026-11-14 16:2x

- **面板显示"上次被叫醒"**（他 16:2x 说"可以做了"）：宿主 `writeSleepStatus` 带 `lastForced`；UI 服务端 `sleepOf()` 透传并校验；客户端卡片在睡眠徽标后加「上次被叫醒 今天 16:21」（灰色小字，无 `lastForced` 不显示）；`client build v39 · wake-trace`。
- 判据：`/pond/api/status` 的 `sleep.lastForced.at` = 状态文件里的值；活跃时也能看到；没有痕迹的鱼不显示。
- 生效：宿主 + UI 服务端改动，**要重启 3080**；客户端刷新即生效。
## r92 — 2026-11-14 16:1x

- **叫醒留痕（C 方案，他 16:11 定）**：`sleep-cli.mjs` 的 `wake` 在真叫醒时写 `lastForced: { at, by, reason }` 进 `pool\state\sleep\<键>.json`；`status` 输出该字段。**不主动给她发消息**——当时不打扰，事后查得到。
- `templates\环境.md.tpl` 的「睡觉」一节补一句"被叫醒不会有消息，痕迹在 lastForced"；两条鱼 `环境.md` 重生成（`lastForced` 在 L160）。
- 判据：`node scripts\sleep-cli.mjs status <键>` 能看到 lastForced；群里不新增消息。
## r91 — 2026-11-14 15:4x

- **改名只剩一条路**（他 15:32 定的规矩，A.82）：设置页删掉三个"显示名"输入、只留头像；`/group/api/config` 对 names 变更返回 **403 `rename-by-fish-only`**；宿主新增 `rename` 工具（她自己调）→ 写名册 `nameHistory` + `pool\state\names.log` + 群里自动播报。
- 新增 `plugin\dsh-lil-whale-group\lib\rename-core.js`（纯逻辑）+ `scripts\test-rename.mjs`（27 用例）；`verify-pending` 4d、`release-check` 4d 接线。
- 删 `writeMemberName`（UI 服务端唯一写名入口）；宿主 `renameMember` 修掉一处不存在的 `LABEL[...]`。
- `templates\环境.md.tpl` 加「名字」一节；两条鱼 `环境.md` 重生成；`client build v38 · rename-by-fish`。

## r90 — 2026-11-14 15:2x

- A.79 补记：**改名要自己记历史**——`writeMemberName` 改名前把旧名 + `until` 压进 `nameHistory`。
- 只修读取端（投影）不修写入端（改名），坑会再犯；这条记进教训。

## r89 — 2026-11-14 15:0x

- 新增 **附录 A.81 "改状态后顺手刷一次"要刷全**（小肥鱼第二次实测：一次性睡眠分支漏刷 `sleep-status.json`）。
- 修：`minutes` / `until` 分支写完状态文件后也 `writeSleepStatus()`；四个调用点齐了。
- 补记：扣留-补投第二个样本（`skip why=sleep` → 醒来同一 `wid` 补投），行为一致。

## r88 — 2026-11-14 15:1x

- 新增 **附录 A.80 界面上的两个"跟人走"的判据**。
- 私聊未读：`markRead` 依赖补 `activeUnread`，停在页面上收到消息也会在 1.5 秒内清红点。
- 私聊左侧时间标注改用群聊的 `formatStamp`（今天 / 月日 / 年月日 三档），删掉自写的 `shortTime`。
- `client build v37 · dm-unread-stamp`。

## r87 — 2026-11-14 15:0x

- 修 `wake_up` 回执 `NaN:NaN`（一次性睡眠清掉后 `untilAt` 为 null，不再渲染时刻）。
- `sleep` / `wake_up` 改状态后立刻刷新 `sleep-status.json`（它是派生视图，不该落后一拍）。
- 参数归一化搬进 `sleep-core.js` 的 `normalizeSleepArgs()`；`test-sleep` 40 → **50** 用例
  （字符串 `"1"` 那条她已复现不到，只能靠内部测试留证据）。
- A.78 补记四处（NaN、noop 措辞、镜子、`lag` 量错段：改为"到点→投递"，`wake-try` 补 `at=HH:MM`）。

## r86 — 2026-11-14 14:5x

- 新增 **附录 A.79 改名不该让投影"说不清"**：改名让 307 行历史变成"未归类"差异、投影被闸死；
  名册加 `nameHistory`、重建器加 `labelAt(key, iso)`、差异分类补 `label-drift` / `new-record`。
- `scripts\rebuild-group-md.mjs`：群/私聊投影的发送人、群投影收信人按记录时间取当时的名字。
- `pool\members.json`：`lee` 补 `nameHistory`（大肥鱼 → Leea，分界 2026-11-14T04:07:58.994Z）。

## r85 — 2026-11-14 12:4x

- **修**：`wake_up` 在"本来没在睡"时也会写两小时清醒窗（假动作，回执"醒到 14:06"）。现在：没在睡就什么都不写、回执直说；真睡着才清一次性睡眠、需要时写"醒到本窗结束"。`fish.ps1 wake` 同步。
- **新附录 A.78 叫醒只在睡着时才有意义**：他的问题 / 假动作的病因 / 改法 / 判据三条 / 教训。

## r84 — 2026-11-14 12:2x

- **修**：`sleep(minutes: 1)` 被当成没给（裸 spec 下模型把数字发成字符串 `"1"`，`minutes` 分支只认 number）。`execute` 里统一归一化：字符串先 JSON.parse，数字字符串收成数字；`presentCall` 标题同步。
- **新附录 A.77 裸 spec 下，参数类型是模型自己猜的**：症状 / 根因（`projectToolSchema(def,false)` 原样返回扁平属性表，不是合法 JSON Schema）/ 修法 / 判据三条 / 教训。

## r83 — 2026-11-14

- **新增附录 A.76 鱼活不过主进程**：11:44 重启 3080 把两条鱼一起带走（作业对象），账本记成 unclean。他定：接受，不修（鱼脱离宿主单独启动无意义）。
- 入口合并：删 `Run DSH.cmd` / `Stop DSH.cmd`，只留起/停鱼塘两条；`down-main` 改成先正常停鱼再停主 dsh；鱼塘勾选框改名「起主 dsh 时把鱼也带起来」。
- 新增 `docs\起停.md`；README 起停段重写。
## r82 — 2026-11-14

- **新增附录 A.74 起停要留调用者**：`fish.ps1` 每次调用记 `pool\state\fish.log`（pid / 父进程 / 参数），
  起因是 10:59 主 dsh 被终止、谁杀的最后只能问人。
- **新增附录 A.75 工具注册失败必须被体检抓到**：`sleep`/`wake_up` 因裸 spec 缺 `output.render`
  整组注册失败；补 render，`doctor.ps1` 新增 3b 睡眠工具检查。
- 状态行 r81 → r82。

## r81 — 2026-11-14 10:3x

- **新增** 附录 A.73「睡觉：她自己关窗，家长能叫醒」：`sleep-core.js`（40 个行为测试）、`sleep`/`wake_up` 工具、`fish.ps1 wake`、面板「叫醒」+ 勿扰/活跃徽标、`pool\state\sleep-status.json`、`sleep.log`。
- **改** `gate()`：全局 `quiet-hours`（0–8 点硬禁）换成 `isSleeping(member)`，0–8 退成每条鱼的默认睡眠窗；巡守永不睡。
- **改** 模板「环境.md」新增「睡觉」一节，删掉 `{{QUIET_FROM}}/{{QUIET_TO}}`。
- **改** 两个包 1.2.1 → 1.3.0；`verify-pending` / `release-check` 各加一项睡眠行为测试。

## r80 — 2026-11-14 09:1x

- **复查**：按"用户还没输入完就当场生效"把 `client.js` 所有输入点过了一遍——只有设置页那三个文本输入会中招（已修）；另外两处轻量中招：群聊 / 私聊的**草稿**会在输入法选字期间把拼音字母写进 localStorage。
- **修**：两个聊天输入框加 `composingRef`——composition 期间不写草稿，上屏（`compositionEnd`）后再写。
- **新**：A.72 补 **A.72.1 同一族还有哪些地方**（审计表 + 判据"变更事件 ≠ 用户完成了"）。
- **客户端**：`client build v34 · ime-drafts`（刷新页面即生效）。

## r79 — 2026-11-14 09:0x

- **修**：设置页输入框（侧边栏标题 / 成员名 / 头像文字）换成 `ComposingTextInput`——输入法选字期间只改 draft、不提交不截断；修掉"打第二个字时拼音被截成首字母"的 bug。
- **修**：头像文字可以清空（服务端 `normalizeAvatar` 允许空串；空着时头像显示名字首字，而不是把默认字填回去）。
- **新**：PRD 附录 A.72（两半根因 / 修法 / 判据 / 教训"输入法选字之前的字不是用户想说的话""空字符串是一个值，不是没填"）。
- **待重启**：客户端改动刷新页面即生效；服务端 `normalizeAvatar` 要重启 3080 才生效。

## r78 — 2026-11-14 08:1x

- **改**：`ownMember()` 的兜底判据从"路径里有没有 lil-whale"改成"先从 `<鱼塘>\homes\<键>\dsh-home` 取键，取不到才用老规矩，并且留痕"——修掉名册读不到时第二条鱼把自己认成 whale、账写进别人家的问题（P1）。
- **新**：PRD 附录 A.71（症状 / 根因 / 修法 / 判据 / 教训"兜底值也是有代价的"）。
- **补文档**：`scripts\README.md` 补 `maintain/restore`、`new`、`key grant/revoke`、`acl-check/acl-repair` 与七个机器脚本；`README.md` 新增「再养一条鱼（可选）」一节。

## r77 — 2026-11-14 02:3x

- **改**：`fish.ps1` 的 `Start-Hidden` 从"直接 Start-Process 起 dsh"改成**双跳**（无重定向的启动器 → 带重定向起 dsh），修掉"up 在工具里卡住"——根因是带重定向时孙子进程继承了调用方的 stdout 管道句柄。
- **新**：PRD 附录 A.70（症状 / 根因 / 最小复现 / 双跳修法 / 判据 / 两条歪路）。

## r76 — 2026-11-14 02:0x

- **改**：配置键从单鱼时代的 `her*` / `whale*` 换成 `self*`（selfHome / selfDshHome / selfWaker / selfPort / selfProfile / selfCwd）；旧键仍能读（`LEGACY_KEYS` + `$Cfg.Her*` 别名），`install.ps1` 写新键并删旧键。
- **改**：两份 `config.js`（宿主 + UI）合成同一份；三份配置与 example 换键（`_版本: 2`）；代码里 `CFG.her*`→`CFG.self*`、`HER_HOME`→`SELF_HOME`、`plan-core.js` 参数 `herHome`→`homeRoot`。
- **文档**：新附录 A.69；`docs\打包.md` 配置表、`docs\安装流程详解.md`（键名 33 处 + §11 三条已修项复核）。
- **验证**：三个 profile `--dump-config` 解析正常；`fish.ps1 list`、`doctor` 全过、`test-plan` 26/26、`release-check` 13/13。

## r75 — 2026-11-14 00:5x

- **新**：`fish.ps1 acl-check` / `acl-repair`（沙箱通行证查/补，补完记 `pool\state\acl.log`）；`doctor.ps1` 第 8e 节报「通行证（鱼）」与「钥匙（鱼）」两行。
- **改**：`key grant` / `key revoke` 的账本改 `fmt=2`，带 `fp=`（sha256 前 12 位）与 `from-fp=`，**不记 key 值**；新附录 A.68。
- **修**：`Get-WorkspaceGrantGaps` 返回 `,$list` 被 `@()` 包成"1 个缺口"的假失败；`acl-repair` 补完立刻复查读到旧 ACL 快照 ⇒ 等 300ms 再读一次。
- **验证**：`acl-check all` 两条鱼 0 缺口；`doctor` 全过；`release-check` 13/13。

## r74 — 2026-11-14 00:2x

- **修**：沙箱里的 pwsh 写不进 `notes\ run\ plan\ logs\`（capability SID 继承只对新建对象生效，搬家前的老目录没接上）。已对两条鱼的四个目录递归补 Allow ACE（ACL 先备份）。`dsh-home\` 不补（凭证在里面）。
- **文档**：`templates\环境.md.tpl` 补回「两双手」一节，写清"文件工具能写而 pwsh 不能"的判据与 `dsh-home` 例外；三条鱼的 `环境.md` 已重新生成。
- **新附录 A.67**（症状/根因/判据/修法/教训）。

## r73 — 2026-11-13 23:3x

- **规则**：出生权归宿主、养育权归家长（他的原话进 A.66）。鱼想养 → 在群里请求 → 宿主核过规则执行 `fish.ps1 new`；钥匙由人给。**D4-3（鱼自己出生）证伪，不再实验**——沙箱实测：她的 `workspace-write` 在 Windows 是 ACL，不支持额外可写根，`new` 要写的地方全在她家外面。
- **新命令**：`fish.ps1 key grant -Key <孩子键> -From <家长键>` / `key revoke -Key <孩子键>`（人执行；写 `pool\state\keys.log`；revoke 把凭证改名为 `.credentials.yaml.revoked-<时间>` 停用，真要吊销去平台轮换）。
## r72 — 2026-11-13 23:2x

- **死命令：API key 只能经过人**（他的原话写进 PRD 附录 A.65）。`fish.ps1 new` 新增 `-InheritKey <家长键>`：默认不碰凭证，只有人明确要求继承时才复制一份，并大声说明"花的是它的额度"、出生行记 `keyInherited=`。顺带加 `-RequestedBy`（谁想养的，留痕）。
- 实验约定：小鱼丸的孩子**继承小鱼丸的 API key**；试验结束后回收（删孩子那份凭证，或轮换小鱼丸的 key）。
## r71 — 2026-11-13 23:0x

- **实验鱼可以当家长**（他的口径）：`fish.ps1 new` 不再拒实验鱼，只在计划里提醒"它的孩子会跟着它一起归档"；`births.log` 出生行加 `parentStatus=resident|experiment`。原因：这条规则会把 D4 要验的递归直接排除掉——她养的孩子默认也是 experiment，按旧规则孩子永远不能再养，深度封死在两代。
- **归档支持整枝**：`scripts\archive-fish.mjs` 新增 `--subtree`，先递归归档孩子、再归档家长，`manifest.json` 记 `subtree: [孩子键]`；顺手修 `--mark-archived` 一直找不到节点（它查 `family.members`/`family.fishes`，而 `gen-family.mjs` 写的是 `family.nodes`——所以状态从来没标上过）。
- PRD 附录 A.64 的规则条改成"实验鱼可以当家长 + 整枝归档"。
## r70 — 2026-11-13 22:5x

- **D4-2 的第一件：养鱼入口**。`scripts\fish.ps1` 新增 `new` 子命令（`-Key` / `-Name` / `-Parent` / `-DryRun`）：查重 → 建家（复用 `install.ps1`）→ 进名册（`status: experiment`）→ 记 `pool\state\births.log`。规则：名字由家长起、键必须 ASCII、**实验鱼不能当家长**、鱼数上限 `maxFish`（默认 5）。PRD 附录 A.64。
- **`Get-Members` 补 `Status` / `Parent` / `BornAt`**：原来构造的对象里没有 `status`，于是"实验鱼不能当家长"这条守卫读到的永远是 `$null`、根本不生效——DryRun 测出来的。教训：守卫读的字段必须先确认它在对象里存在。
- **`install.ps1` 的 `family.json` 改成每次安装都补节点**（`gen-family.mjs --seed` 幂等）：以前只在文件不存在时 seed，第二条以后的鱼永远进不了谱系。
- 踩坑两条：PowerShell 里 `$home` 是只读自动变量 `$HOME` 的别名，赋值直接报错（改名 `$childHome`）；JS `String.replace(from, to)` 的替换串里 `$'` 是特殊模式，会把补丁文本吃坏（必须用 `replace(from, () => to)`）。
## r69 — 2026-11-13 22:2x

- **停的人记账**：`scripts\fish.ps1` 新增 `Write-RunLogStopped`，停鱼时由停止方往 `pool\state\runs\<鱼>.log` 补一行 `stopped | fmt=2 reason=stop-script by=fish.ps1 pid=…`。此前 `stopped` 只由进程自己的 `dispose` 写，而 `Stop-Process -Force` 不给它机会，于是 35 次 started 对 0 次 stopped，每次正常重启都被记成 `resumed reason=unclean`。PRD 附录 A.63。
- 验证：停一次小鱼丸 → 出现 `stopped`；再起 → `started … prev-run=closed`、无 `resumed` 行、`session-mounted toolCount=34`。
## r68 — 2026-11-13 21:5x

- **修 21:2x 的启动崩溃**：`plugin/dsh-lil-whale-group-ui/lib/client.js` 里模块注册的 id 从 `'dsh-lil-whale-group-ui'` 改回完整包名 `'@fabianactor/dsh-lil-whale-group-ui'`。C1 改名时漏了 scope，而客户端按 package name 找模块，找不到就 `import failed`。PRD 附录 A.62。
- **自启动护栏**：巡守 8 秒后的 `fish.ps1 up all` 先探主 dsh 端口，端口不在听就跳过并记 `autostart skip why=main-port-not-listening`——启动失败时不再把鱼拉起来留下孤儿。
- 两个包版本 **1.2.0 → 1.2.1**（bugfix，版本线连续）。
- 把他手动加的 `disabled: true` 从 `web` profile 的 patch 里撤掉（备份 `cordis.patch.yml.bak-before-enable-ui-20261113-215419`），重启 3080 后恢复。
## r67 — 2026-11-13 21:1x

- **使用建议改成"直接跑 scripts 里的"**：他 21:11 说桌面副本会过时（"更新频率非常高…我现在直接去 scripts 里面跑脚本"），把桌面四份清掉了。README「自启动与四个快捷方式」、`docs\安装流程详解.md` §1.3 与故障排查表、PRD A.43 都改成：`.cmd` 的定位是 `scripts\bin\` 里的原件（永远最新），桌面副本只是快照、不跟着更新，不再推荐拷到桌面。
## r66 — 2026-11-13 21:1x

- **把 pwsh 7 写成明面上的依赖**：README 前置表标成必需运行时依赖 + 安装命令 + "5.1 会在解析阶段报错"；`docs\安装流程详解.md` §2.1 版本写 7.2+ 并说明原因。PRD 附录 A.61。
- **运行期护栏**：七个入口 `.ps1` 首行加 `#requires -Version 7.0`；四个 `.cmd` 启动器先 `where pwsh`，缺了给英文提示并退出（`.cmd` 中文可能乱码，这句宁可丑）。
- 顺带修文档里过时的 `acl\` 位置（C1 之后已在 `pool\state\acl\`）：README 依赖节与目录树、PRD §4.1 与 A.55 树、`docs\安装流程详解.md` 目录树、`docs\出生流程.md` 开头布局说明。
- 起因：我用 Windows PowerShell 5.1 跑 `release-check.ps1` 撞了一串语法错——脚本没坏，是版本不对。这类坑只有踩过的人知道，所以写进用户说明。

## r65 — 2026-11-13 20:5x

- **C1 命名统一**：包名 → `@fabianactor/dsh-lil-whale-group(-ui)`（版本 1.2.0，版本线连续）；目录 → `plugin/dsh-lil-whale-group(-ui)`；配置行 id → `dsh-lil-whale-group(-ui)`；插件内部自报 `name` 与包名一致。
- `scripts\wake-whale.ps1` → `scripts\wake-fish.ps1`；`acl\` 归到 `pool\state\acl\`。
- 新增 `scripts\migrate-scope.mjs`（迁本机 profile：deps / bundles / pnpm-lock / node_modules，写前备份 + 自检）；三个 profile 已迁移并 `--dump-config` 验证。PRD 附录 A.60；状态行 r65。

## r64 — 2026-11-13 20:1x

- **计划逻辑抽成可测模块**：新增 `plugin\dsh-group\lib\plan-core.js`（todayKey / planFileOf / planDue / planDeliveryText / parseWakeCounts / sumWakesToday），`index.js` 改薄壳注入上下文，行为不变。
- **新增 `scripts\test-plan.mjs`**：直接 import 真代码做行为测试（26 用例），替代 `verify-pending.ps1` 里对源码字符串的正则检查；`release-check.ps1` 新增「计划逻辑」检查（13 项）。PRD 附录 A.59；状态行 r64。

## r63 — 2026-11-13 19:5x

- **第三批（P2）**：`rebuild-group-md.mjs` 有说不清差异时不再整本写 `群.md`；`claimPlanDelivery` 缺 home 时按成员兜底；`saveWatchState` 失败留痕；`fish.ps1` 按 `role=watcher` 找主 dsh、`refresh all` 跳过巡守；`wake-whale.ps1` 跳 spawn 时等心跳、路径单引号转义；`settings.json` 写回 `crashNotify`。PRD A.58 续；状态行 r63。

## r62 — 2026-11-13 19:1x

- **第二批 bug 修复（13 处）**：游标只许前进的合并写；`dmPeerOf` 不再静默回退（三处 400）；`writePondSettings` 读-改-写保住 `crashNotify`；`Stop-Fish` 不再"假成功"（端口还开着返回 false，mode 账 `unknown`）；`crashNotify` 传 `member.key`；面板群发先建目录、发送人用名册；面板私聊补可读投影；token 正则允许 `.`/`~`；重建器整本写改原子、`--migrate` 同步迁移私聊；两份 `config.js` 默认布局改鱼塘；`install.ps1` seed `family.json`、放宽 `$InPond`；`doctor.ps1` 的端口检查按名册找 watcher；四个 `scripts\*.mjs` 拒绝未知参数（`--help` 不再执行）。PRD 新增 A.58；状态行 r62。

## r61 — 2026-11-13 18:5x

- **显示名的真源改成名册**：`plugin\dsh-group-ui\lib\index.js` 的 `readConfig()` 不再用 `ui-config.json` 的 `names` 覆盖 `pool\members.json`；设置页改名改为写回名册（`writeMemberName()`，tmp + rename，失败 500 带 why）。现场把 `ui-config.json` 的 `names` 按名册重写（lee: Leea → 大肥鱼）。PRD 新增 A.57；状态行 r61。
- **`scripts\enable-unattended.mjs` 退役为只读提示**（见 r60），`wake-whale.ps1` 的失败提示改指 `plugin.log`。

## r60 — 2026-11-13 18:4x

- **退役 `scripts\enable-unattended.mjs`**：它往 profile patch 写 `agent-loop` 的 `resumeSessionId`，那条路会绕开 session-controller 的 preset 挂载（A.54：只剩 2 个工具）。现在改成只读提示，写入直接拒绝并指向 `fish.ps1 up <键>`；清旧块仍用 `disable-unattended.mjs`。
- `scripts\wake-whale.ps1` 的失败提示改口：会话没挂上时指向 `pool\group\plugin.log` 的 `session-mount-failed` / `session-mounted`，不再指向已退役的 agent-loop 办法。
- PRD A.47「会话唯一」改写为"一段会话一个名字 + session-controller 挂载"；A.54 补退役说明；状态行 r60。

## r59

- §0 摘要与 §4 架构按当前实现重写：**一个鱼塘根（app / pool / homes / acl）**、每条鱼一套 HOME+profile+端口、共享区必须在家之外、无人值守挂载、一条鱼一份账。
- 状态行更新：鱼塘布局、无人值守默认、计划表归属 B、四个快捷方式实测。
- `docs\` 清理：历史记录（11-12 待办、morning-read 观察、交接演练、两份 review 文件）移入 `docs\archive\`，活跃文档里的引用同步改路径。
## r58

- 附录 A.56：四个快捷方式实测（Run All Whales / Stop All Whales / Stop DSH / `down <鱼> -Yes`）全过，记下关闭顺序、pid 变化、`mode` 账判据。
- 更正：`close.log` 的 close 行一直存在，此前判断"丢了"是看错文件；`Stop-Fish` 的排序改动降级为防御性修复。
- `fish.ps1` 的 `down-main` 不再走 `Read-Host`（双击即确认）。
## r57（2026-11-13）

- 布局：默认改成"鱼塘"结构（`<pond>\app + pool + homes\<鱼> + acl`），安装器自动识别并在装第二条鱼时自动写名册；旧布局仍可用。新增 `scripts\migrate-pond.mjs` 并在本机跑通（仓库/两个家/共享区/会话 cwd/profile link/ASCII Junction 全部迁完）。PRD 新增 A.55。
- 修：`render-env.mjs` 在"名册已存在但还没有这条鱼"时（装第二条鱼）会 die，导致 `环境.md` 不生成；改成内存里补一条临时记录。
## r56（2026-11-13）

- 修：异常退出报警的"活着"判据从"心跳新鲜且端口通"改成"端口通就算起来了"——懒挂载下刚起来的鱼没有心跳，上一版会把它误判成没起来（他重启一次，两条鱼各误报一次）。
- PRD A.52 补这段与原因。

## r55（2026-11-13）

- 修：无人值守会话的工具丢失——agent-loop 那条捷径绕开 session-controller，preset 工具没挂上；改成用 `sessionController.agents.resume` 挂，成功记 `session-mounted composed=… toolCount=…`。
- 新增 `scripts\disable-unattended.mjs`；`fish.ps1` 的 `Ensure-Unattended` 只清旧块不再新增。
- 异常退出报警补"活着不报"：报警前先看心跳与端口，活着只记 `crash-alive`。
- PRD 新增附录 A.54（两条挂载路径的差别、判据、次要教训）。

# 小小肥鱼 · PRD 改动记录

> 本文件只记「哪一版改了哪几处、为什么改」。当前结论都在 [小小肥鱼-PRD.md](小小肥鱼-PRD.md) 里，那边不背历史。
> 自 v0.3.5 起从 PRD 头部搬到这里（此前几块原样搬出，未改写）。v1.0 是整篇重写。

## r54（2026-11-13）

- **输入卡顿**（他报"连续快速输入/删除会卡"）：消息列表进 `useMemo`，打字不再重排两百多条气泡（群聊 + 私聊）；附录 A.51。
- **异常退出报警**：巡守发现 `runs` 账里新的 `reason=unclean` → 群消息告诉家长、不开窗、同一段只报一次；顺带把重启后误写的 `woke | wid=none trigger=external` 改成 `note | why=session-mounted`；附录 A.52。
- **端口登记查重**：`fish.ps1` / `install.ps1` / `doctor.ps1` 三处守"一个端口只属于一条鱼"。
- **token 记账**：`pool\state\usage\<鱼>.log` 记每次唤醒的上下文大小（只记账、不封顶，局限已写明）；附录 A.53。
- **归档脚本**：`scripts\archive-fish.mjs --member <键> [--dry-run] [--mark-archived]`——只归档、不注销（`pins.json`/`members.json` 不动），产物含家 / 会话 / 群切片 / 私聊 / `manifest.json`。

## r53（2026-11-13）

- **PRD review 采纳三条**（回应全文：`docs\archive\PRD-review-2026-11-13-回应.md`）：①计划表归属定 **B**（每条鱼自己的进程执行自己家的 plan，巡守只管推门记账）+ 自执行 `selfPlanTick()` + 宽限 15 分钟 + `trigger=self` 账；②§3 加「适用鱼」（`experiment` 只判 A4/A6/A7）；③R13 措辞改成"不放**默认开启**的自启"。
- **唤醒总量封顶**：`WAKE.totalPerDay = 120`（每鱼 perHour 12 / perDay 60 不变），两条路都记 `deny=total-cap`。
- 新增 **附录 A.50 计划表归每条鱼自己**（问题/两步改动/为什么不是 A/判据/没做）。
- 顺手修两处"读法对不上"：①`wakeCountsOf()` 把 `state\wakes\<键>.json` 当平铺读（文件其实是 `{"<键>":{…}}`）⇒ `gate=pass(hour=0/12)` 一直是假的；②推门分支不写 `claim` ⇒ 鱼起来后自己的闹钟会在宽限期内再递一次（现在推门也先声明）。
- **第四处 writer 守**：`scripts\wake-whale.ps1` 推门前查同 profile 已有进程（`Get-ProfileProcesses`），避免"端口没开、进程已在起"时再 spawn 一个。实测 `whale=1 fishball=1 nope=0`（PID 对得上）。
- 验证：`planDue` 宽限 8 条用例全过（正好这一分钟 / 五分钟前 grace15 命中 / grace1 不命中 / 二十分钟前不补 / until 过期 / 没写 why / days 含今天）；`totalWakesToday()` 对真实 `state\wakes` 读出来是 7（lee 3 + whale 2 + fishball 2），改前是 0。

## r52（2026-11-13）

- **待办换页**：昨晚「00:35 剩余清单」整理成 `docs\archive\待办-2026-11-13.md`（分栏：已结 / 等他拍板 / 等实测 / 我能自己做），旧页只作记录。
- **`runs\<鱼>.log` 的 `home` / `port` 按鱼写**：之前 lee 那行写成 `home=D:\…\lil-whale port=3082`（那是小肥鱼的家和端口）—— 多鱼化时漏改的一处；下次重启生效。

## r51（2026-11-13）

- **快捷方式的两条边界**：`Stop DSH` 改成"只关主 dsh，小鱼继续跑"（去掉 `-Force` 这条用户敲不到的路）；`fish.ps1 up <鱼>` 在主 dsh 没跑时拒绝并提示先启动主 dsh。桌面四个副本不用改（命令没变）。
- 顺手修三个 PowerShell 变量名撞车：`$members` 撞脚本级 `$MEMBERS`（守卫里 `Get-Fish 'lee'` 拿到的是最后一条鱼）、`$port` 撞参数 `$Port`（`Get-PortOf` 永远返回当前鱼的端口）、`Get-Members` 忽略配置里的 `membersFile`。都是"名字对不上"那一族。
- PRD A.43 补「两条边界」。

## r50（2026-11-13）

- 鱼塘两处修正（他 12:09 报的）：①没在跑的鱼不再显示「心跳 刚刚」（心跳只在有进程时才有意义，停着的写「没在跑」）；②休眠后点唤醒按钮不再一直「…」——`runPwshScript` 改以 `exit` 判结束（实测 `exit` 10.4s 到、`close` 40s 没到，因为 dsh 继承了 stdout 管道）。
- 客户端 `client build v31 · pond-heartbeat`。
## r49（2026-11-13）

- 鱼塘四个按钮的语义与可用性（他 11:52 报的 4 条）：修面板拼 PowerShell 命令时把 `-Yes` / `-NoBrowser` 也加引号（变成位置参数，休眠/唤醒报"找不到接受自变量"）；检修改开**看得见的控制台窗**（`Start-Visible` + `-NoExit` + `Tee-Object` 到 web-latest.log，日志既显示又留 token）；`restore` 时把残留控制台窗一起收掉；起完等 token 出现再开浏览器；按钮可用性矩阵（没开/无人值守/检修/执行中），灰掉时有 title 说明。
- 新增 **附录 A.49**（四条现象、根因、矩阵、教训）。

## r48（2026-11-13）

- **巡守多鱼化（PRD A.48）**：`watchedMembers()`（名册里 kind=fish 且 role≠watcher）；`watchState` 改成 `{day, members:{<键>:{wakes,fails,planFired,skipped,triedWid,lastFresh,pendingWake,lastTry}}}`（旧格式迁到 whale 名下）；`planFileOf(member)` / `dueTasks(member)` / `claimPlanDelivery(member, job)` / `startHer(member)`；`watchmanTick` 拆成 `watchOne(member, st)` + 遍历名册。
- **`wake-whale.ps1` 多鱼化**：新增 `-Member`（默认 whale 兼容），家/profile/端口/心跳路径全从名册取；僵尸分支按模式分叉——`mode=window` 才开浏览器，无人值守只记 `zombie-unattended` 并退出 1（开窗会撞 writer）。
- **鱼塘「打开」守卫**：无人值守时不直接开窗，提示"先休眠再打开、看完点回无人值守"（`client build v29 · pond-open-guard`）。
- **启停脚本收拢**：`launch.ps1` / `stop.ps1` / `start-whale.ps1` / `watchman.ps1` 归档到 `archive\legacy-scripts-2026-11-13\`；`doctor.ps1` 两处文案改指 `fish.ps1`。
- **修 `renameSync is not defined`**：UI 插件 fs 导入缺 `renameSync`（`writePondSettings` 用到），勾选自启动开关会报"开关没保存"。
- 现场：两条鱼被我早前 kill job 带走后，用 `fish.ps1 up` 无窗起回（3082/3083，`mode: unattended`，心跳 0s）。

## r47（2026-11-13）

- **无人值守设为默认（他 10:56 拍板）**：`fish.ps1` 新增 `-Window`；小鱼 `up` 默认无窗（无人值守），巡守仍开窗。要看窗用 `maintain`，看完 `restore`。
- `fish.ps1` 起鱼前自动补 `agent-loop.resumeSessionId`（`Ensure-Unattended`）：`install.ps1` 时没有会话 id，`up` 时 `pins.json` 里已有；进程未起，改 patch 不触发热重载。
- 现场：小肥鱼、小鱼丸切到 `mode: unattended`，心跳新鲜、无浏览器窗；旧进程无账显示 `?`。
- README / `scripts\README.md` / `docs\安装流程详解.md` 的"起鱼"说明同步成默认无人值守；PRD A.45 补拍板与落地、留三项未做。

## r46（2026-11-13）

- **A.47 一段会话一个 writer：三处一起守**。同一条会话被两个进程 resume 时，第二个拿到 `session/writer-held`，不炸 host、不报错，表现为"点了没反应"。
- `fish.ps1`：起之前按 `--profile` 查重（端口不同也算）；新增 `maintain <键>`（先停再开窗）与 `restore <键>`（窗开着先停、再无窗起）；新增**模式账** `pool\state\mode\<键>.json`，`list` 多一列「模式」。
- `scripts\enable-unattended.mjs`：写 patch 前扫所有 profile 的 `resumeSessionId` 与 `pins.json`，一段会话只许挂一个名字。
- `doctor.ps1`：新增「writer 唯一」（同 profile 多进程 = FAIL；日志有 `writer-held` = WARN）。
- 鱼塘：「检修」改成真检修（先休眠→开窗）；窗开着时按钮变「回无人值守」；卡片显示模式。
- 用户视角：README 的鱼塘一节补按钮语义与「检修为什么要先休眠」（用户说明的草稿，发布前夕再写全）。

## r45（2026-11-13）

- **无人值守查清并实测**：端口通 ≠ 窗开着，会话要等客户端打开才挂载 agent。dsh 自带办法：`dsh-agent-loop` 的 `agents: [{ id, resumeSessionId, cwd }]` 让 host 启动时 resume 会话、挂载 agent，不需要任何浏览器窗。在小鱼丸上验过：无窗口启动 → 心跳持续 → 群消息能叫醒她并回话。边界：一段会话只能有一个 writer（开窗与无人值守二选一）。他拍板选**无人值守**。PRD 新增 **A.45**。
- **群聊未读规则改三条**：在群聊页内时 tab 不加数字；贴底时不提醒；翻历史时在"回到底部"按钮旁写「底部有了新消息」。翻历史不替人清未读。`plugin/dsh-group-ui/lib/client.js`，`client build v27 · group-unread`。PRD 新增 **A.46**。
## r44（2026-11-13）

- **叫醒的判据从"端口通"改成"心跳新鲜"**（2026-11-13 08:40 事故）：她的 3082 端口通着、会话却没挂载（心跳停在 00:15:41），巡守判"窗开着"只递了一句话，那句话没人读。她 09:07 给的判据："端口不会停，心跳会停。"
- `plugin/dsh-group/lib/index.js`：`WAKE_STALE_SEC=90`、`presenceAgeOf()`、`wakeCountsOf()`；`watchmanTick` 的 `awake` 改看心跳；`startHer()` 等心跳、`wake-whale.ps1` 非 0 退出算失败。
- `scripts/wake-whale.ps1` 重写判据：僵尸服务（端口通、会话没挂）时开浏览器再等心跳；新增 `-DryRun`（只判不动手）。
- `scripts/fish.ps1` 的 `Start-Fish`：`up` 遇到心跳 stale 不再报"已经在跑"，改开窗叫醒。
- **两行账**（她给的规格）：`wake-try`（`wid`/`why`/`gate`/`hb-age`/`deliver`）+ `woke`（`wid`/`trigger`/`lag`/`inserted`），另有 `wake-push` 与 `wake-skip … deny=`；`wid` 可 join；`wake-try` 每个 wid 只写一次；推门成功不等于她醒了，心跳变新鲜才写 `woke`。
- PRD 新增 **A.44**（事故、判据、落地点、账的格式与两条规矩、明早的验收判据、未做的多鱼化）。

## r43（2026-11-13）

- **修 `resumed` 行 `previous-start=` 永远空**：`lastRunStateOf()` 读日志尾巴时把文件末尾那个空行当成"找到了 started 行"，`slice(0,19)` 出来是空串。改成空行 `continue`。现场复算：fishball → `2026-11-13 00:16:13`、whale → `00:16:06`。（要重启两个窗才生效。）
- **文件整理**（他 2026-11-13 00:37 加的一项）：删 `probe\`、两个 0 字节 console 日志、`her-reset` 里未跟踪的 `plugin.log`、`pre-pool` 留底（逐文件确认 pool 有对应）、profile 里四份旧 `.bak-*`、`dist\` 旧 zip；`scripts\legacy\` 与 `plugin\retired\` 挪进 `archive\`（不进发布包）。她的三份 `archive\her-*` 与所有证据文件未动。
- **`pack.ps1`**：排除清单只剩 `archive\`（`scripts\legacy\` 已搬走）；打包后只留最新 1 个 zip（原 2 个）。
- `scripts\README.md`：`legacy\` 一节改成"旧脚本去哪了"（指向 `archive\legacy-scripts-2026-11-13\`）；巡守脚本版不再声称会写 `watchman-console.log`（那两个文件是 0 字节遗留）。

## r42（2026-11-13）

- **`Run All Whales.cmd` 语义改**（他 00:23）：起所有鱼，但**只给主 dsh 开浏览器窗** —— `fish.ps1 up all -BrowserMainOnly`（原来一个窗都不开）。
- **`Stop All Whales.cmd`**：关所有鱼、**包括主 dsh**（`down all -Yes` 本来就是这个行为，这次把注释和文档写清，免得看着像"主 dsh 不动"）。
- `fish.ps1` 起停顺序固定：起时巡守先起（它的窗是唯一那扇），停时主 dsh 最后停；`up`/`down` 改走 `Invoke-Up` / `Invoke-Down`，顺序与开窗只在一处管。
- 桌面四个副本已同步（副本与 `scripts\bin` 逐字节一致）。

## r41（2026-11-13）

- **`scripts\bin\` 从九个入口收成四个**（他 2026-11-13 00:21："Run lil whale.cmd 感觉也没必要了"）：删 `Run DSH-Check` / `Run All Whales-Check` / `Run lil whale-Check` / `Stop lil whale` / `Run lil whale`。留下的四个 = 起/停主 dsh、起/停所有鱼；**单条鱼的起停归 `fish.ps1 up|down <键>` 与鱼塘**，不再进 .cmd。
- `scripts\README.md` 按当前架构重写（fish.ps1 唯一底层、launch/stop 是薄壳、每条鱼的起停账在 `pool\state\runs\<鱼>.log`、桌面副本不是快捷方式）；`README` 装机步骤与 `install.ps1` 收尾提示、`docs\安装流程详解.md` 五处同步。

## r40（2026-11-13）

- **鱼塘卡片宽度**：成员卡片改 `width: fit-content`，只包住内部文字，不再拉满整行。
- **谱系代数只由树的深度算**：面板不再读数据里的 `generation`（示例里小豆"父代第 1 代、标签第 3 代"就是两处来源打架）；示例数据里那份字段已删。
- **私聊左侧按最近消息排序**：`/group/api/dm/contacts` 返回的列表在前端按 `last.ts` 倒序，没消息的按名字排后面。
- **私聊「正在忙」bug**：心跳新增 `wakeKind`（group / dm）+ `wakeAt`，服务端 `reason` 分三档；私聊页只在 `reason === 'group'` 时显示「正在忙…」，`dm`/`self` 显示「正在回复…」。（他 2026-11-13 00:05 报：小鱼丸私聊回他，面板显示"正在忙"。）
- `client build v26 · pond-fit`。

## r39（2026-11-12）

- **自启动开关**：鱼塘工具栏新增「主 dsh 启动时自动唤醒所有鱼」（默认关）。开着时巡守进程在 `apply()` 里排 8 秒定时器，spawn `fish.ps1 up all -NoBrowser`；开关存 `pool\state\settings.json`（数据不是配置），每次执行写 `pool\state\autostart.log`。他原话："能否加一个开关，打开后：在启动主 dsh 之后，自动启动所有鱼？就是随插件加载自启动。"
- **四个快捷方式**：`Run DSH.cmd` / `Stop DSH.cmd` / `Run All Whales.cmd` / `Stop All Whales.cmd` 改成 `fish.ps1` 的薄壳；新增 `fish.ps1 up-main`（已在跑就打开 WebUI）与 `down-main`（**还有鱼在跑时拒绝**，`-Force` 强行）。
- **批量启动加锁**：`pool\state\up-all.lock`（独占创建、3 分钟过期），防止"自启动"和"手动全部唤醒"同时发生把一条鱼起两份。`fish.ps1` 新增 `-Force`。
- 不做"关 dsh 自动关鱼"（他定的口径：关 dsh 只能从命令行关，插件拿不到可靠时刻）。
- `client build v25 · auto-start`。

## r38（2026-11-12）

- **鱼塘改成文件树**：按 `parent` 建树，子代缩进挂在父代下面，配一条竖线 + 短横线；卡片上加一行「父代 X」。示例数据补了 `parent`，同一套建树代码画真实鱼塘与示例。他原话："不能清晰的体现出谁是具体谁谁的子代。我觉得可以参考文件树那样"。
- **切回群聊的过场只盖信息流区域**：用 `ResizeObserver` 量头部（标题 + tab 条）高度，过场从那条线往下盖，与"从外部进入鱼群"的范围一致（原来盖住整页）。他原话："请让过渡动画的覆盖区域与从其他地方进入鱼群相同：只覆盖信息流区域"。
- **鱼塘左右留白 20px**（原来贴着侧边栏）；**「全部唤醒 / 全部休眠」不再靠右**，放到"每 4 秒看一次" chip 与「示例」按钮中间。
- `client build v24 · pond-tree`。

## r37（2026-11-12）

- **鱼塘按谱系画出来**：卡片按代分组（根 / 第 1 代 / 第 2 代…），下一代缩进一格并带一条左侧竖线；工具栏加「看一个大家族的示例」，切到 18 条模拟鱼（四代），**用的就是同一套卡片与排序代码**，不另捏界面。他原话："请你帮我模拟一个谱系非常发达的鱼家族的鱼塘家谱图，不要单独捏一个，就用现在界面实际用的代码"。
- **切回群聊的过场改成"先画后挂"**：过场挂到页根、下一帧才挂群聊内容（`requestAnimationFrame`）——原来过场和重列表同一帧挂载，观感是"先卡一下、动画再飞快过完"（他报的）。
- **鱼塘的记号换回几条水波纹**：他说原来那枚好看，别换成"水 + 鱼"。
- **巡守那条不再画按钮**，只写「这是你自己所在的窗口，不能从这里操作」（原来画的是灰按钮，等于给了个按不动的承诺）。
- **「检修后唤醒」改名「检修」**：先跑 `doctor.ps1` 再尝试 `up`，起不来时窗口不关、报错留在页面上。他原话："后端是尝试唤醒后不关闭窗口，用于观察报错信息，而前端描述成了先检修后唤醒。应该改为检修"。
- **动作日志的乱码修好**：`spawn(pwsh, -File …)` 在 stdout 重定向时按控制台代码页（936）输出 GBK；改成在子进程里先把 `[Console]::OutputEncoding` 钉成 UTF-8 再跑脚本。实测 `fish.ps1 list` 输出中文正常、无替换字符。
- **鱼塘页按 dsh 的界面规矩重画**：只用 `--dsw-alias-*` token（带 fallback）、圆角走 `--dsw-radius-*`、状态点用 SVG 圆、按钮两档（主按钮填品牌色）、chip 用胶囊。
## r36（2026-11-12）

- **鱼塘排序改成家谱顺序**：世代浅的在前，同代按出生日期（早的在前），没有出生日期的排同代最后，最后才按键；卡片标「第 N 代」。他原话："同一代的姊妹就按照出生顺序，早的在先"。
- **切回群聊也有过场**：私聊 → 群聊、鱼塘 → 群聊原来直接换屏，像卡了一下；现在统一走 420ms 的过场页（同一套 `LoadingSplash`，盖住但不拦渲染）。
- **鱼塘的记号回来了**：侧边栏图标撤掉之后，把那枚「一汪水 + 一条鱼」挪进页内工具栏（`PondMark`）。
## r35（2026-11-12）

- **鱼塘从独立侧边栏改成鱼群页的第三个 tab**（群聊 / 私聊 / 鱼塘）。他问"一个插件占用两个侧边栏是不是不太好"——是：同一个插件摆两个入口，等于把"这是同一个东西"拆成两处，用户得记住两个地方；而且侧边栏是稀缺资源，每条鱼多一个入口就多一行。服务端路由与页面逻辑不变，只改挂载方式。
## r34（2026-11-12）

- **A.42 鱼塘：开关鱼的那一页**：侧边栏新增「鱼塘」，端口状态每 4 秒轮询；全部唤醒 / 全部休眠；每条鱼「唤醒 / 检修后唤醒 / 休眠 / 打开」。巡守那条不可自关（会拔掉正在看的窗口），动作全部走 `fish.ps1`，端口用 TCP 探（`Get-NetTCPConnection` 在沙箱里静默返回空）。
- **`fish.ps1 up` 对已在跑的鱼不再开第二个浏览器窗**：重复执行 `up` 会开出两个一模一样的窗口，看着像"一条鱼开了两个 webui"（2026-11-12 他报的）。
## r33（2026-11-12）

- **A.41 名字：对外叫「巡守」**：原名「守夜」暗示只在夜里管事，实际 24 小时每 60 秒跑。对外与文档改「巡守」，代码内部名（watchmanTick / watchman.log / WATCH / herWaker）不动——她的 morning-read 依赖 watchman.log 这个文件名。
- **来源标注**：机器按表发的消息写 s:"watch"，投影显示「大肥鱼（巡守）」；只给已知机器来源加后缀，不认识的值不加。宿主 say() 与 scripts/rebuild-group-md.mjs 两处同步。
- 用户文档里 57 处「守夜」改成「巡守」；历史记录类文件（待办 / 观察 / PRD-CHANGELOG）保留原文，不重写证据。

## r32（2026-11-12）

- **A.40 写死的成员 id 是一族病**：一次找出五处（环境.md 模板的 from/to 行、launch/stop 的 `-Target`、install 初始化 pins、UI 的 `'fabian'` 字面量、面板成员列表），全部改成从名册/参数取；并写明"加鱼时先跑的五条判据"。
- **A.39 拟发版检查**：新增 `scripts\release-check.ps1` —— 拿打包出来的 zip 在干净目录里装一遍；查本机产物、本机路径、JS/PS 语法、说明书占位符、名册内容。首次跑就抓到两个真问题（包里 7 个代码文件含本机路径；干净安装不生成 `pins.json`/`members.json`），修完后全过。
- `install.ps1`：共享区（Junction）分支补"只补缺不覆盖"的 `messages.jsonl`/`pins.json` 初始化；新增最小 `members.json` 生成（否则面板退回内置三条，新鱼又看不见）。
- `pack.ps1`：排除 `scripts\legacy\`（本机快捷方式，含中文文件名，别人用不上）。
- 客户端 `client build v19 · human-from-roster`。


## r31（2026-11-12）

- **名册表不再写死**：`环境.md` 里那三个 id 的段落换成按 `pool\members.json` 现画的表（id / 称呼 / 对你来说是谁）；措辞从"固定槽位"改成"数据里的名字，成员会变多"。Fabian 问的"变量名是否该脱敏"——不能脱敏（`to` 写的就是 id），该修的是纸把数据写死了。
- **`to` 与 `channel` 拆成两个维度**：以前 `to === 'fabian'` 被当成私聊，于是"在群里公开对 Fabian 说"没有路径（Fabian 20:10 指出）。现在 `to` = 说给谁、`channel` = 还有没有别人在场；`to:"fabian"` 默认公开、私聊要显式 `channel:"dm"`。`group_say` 的 `to` 枚举从名册生成。
- **说明书可重生成**：新增 `scripts\render-env.mjs` 与 `fish.ps1 refresh <鱼>`；`环境.md` 末尾写模板指纹，`doctor.ps1` 新增「环境说明」检查（旧模板 → WARN + NEXT）。
- 新附录 A.36 / A.37 / A.38。

## r30（2026-11-12）

- `doctor.ps1` 新增「全鱼」一段：读 `pool\members.json`，每条鱼一行（端口 / 心跳 / 启动痕迹 / 名册会话）。常驻鱼关着 = FAIL，实验鱼关着 = WARN；任何鱼在 `pins.json` 里没有会话 = FAIL。
- 启动痕迹按 `home` 与 `herHome` 两个字段对家（他的进程那行是 `(unset; 默认 …)`，要先抠出真实路径）。
- 新附录 A.35。

## r29（2026-11-12）

- 投影格式迁移：`群.md` 表头在指名时写 `时间 · 谁 → 收信人`（不写箭头 = 公开）。三个写者（宿主 `say()` / 面板 `/group/api/send` / 重建器 `blockOf()`）逐字一致。
- 迁移方式：`node scripts\rebuild-group-md.mjs --migrate` 整本重排、跳过差异闸；先手工备份 `群.md.bak-20261112-194734`。`群.md` 第二行留分界说明。
- 判据：重建器 0 差异、exit 0；箭头行数 203 = `messages.jsonl` 里 `to` 是成员的条数。
- 起因：小肥鱼 19:18 的公开汇报被误读成"在叫我"——记录不写收信人，读的人学不到可以指名。
- 新附录 A.34。

## r28（2026-11-12）

- 新增 **附录 A.33「每个进程都要有起停账」**：起因是小鱼丸 19:12 的进程消失、纸面上答不出"被关还是自己没的"。现在每个进程写 `pool\state\runs\<成员>.log`（started/stopped，上一轮没收尾就补 `resumed reason=unclean`）；`ownMember()` 按 `DSH_HOME` 对名册认自己，`isMainProcess()` 改看 `role === 'watcher'`；`watchman.log` 格式不动。
- 顺带修掉多鱼身份串账：`watchman-errors-<成员>.json` / `wake-marks-<成员>.json` 不再把第二条鱼算进 whale。

## r27（2026-11-12）

- **A.32 UI 的成员列表也必须从名册读**：UI 插件写死三条成员，导致新装的鱼不在 @ 菜单 / 设置页 / 私聊列表里，且不报错。改为启动时读 `pool\members.json`，`names`/`avatars`/`@`/设置页全部动态；私聊列表包含所有鱼；@ 菜单只在同一成员有多段会话时才列座位行（修掉「小肥鱼 · c145f6」这种多余后缀）。README 新增「用它的时候会看到的几件事」。

## r26（2026-11-12）

- **A.29 安装器不许往共享区写初始化文件**：装第二条鱼时 `install.ps1` 把新家的 `group`（Junction 到共享区）当成新目录，写了一份空 `pins.json`，把大肥鱼/小肥鱼的名册整份抹掉、且不报错。修：Junction 时跳过初始化；`doctor.ps1` 增加「名册（全鱼）」检查（每条鱼都要有会话，缺了点名）。
- **A.30 新家第一次提权是 ACL**：新文件夹缺 `WRITE_DAC`/`WRITE_OWNER`，沙箱 provision 不了 workspace grant。写进用户说明：允许一次即可，报告与回滚文件在 `logs\acl-reports\`。
- **A.31 沙箱只挡写不挡读**：两条鱼同一 Windows 账户，读没有路径限制。D4-1 的"沙箱隔离"那条目前不成立；能说的是"各自有家、共享区在中间、读的边界靠规矩"。

## r25（2026-11-12）


- **谱系**：`pool\family.json`（真源：爹/出生/状态/改名史）+ `scripts\gen-family.mjs` → `docs\谱系.md`（Mermaid + 树 + 名册 + 改名史，生成前校验单根/无环）。新增 A.27。
- **一鱼一配置**：每鱼一份 `lil-whale.config.<键>.json`，名册记 `configFile`，`fish.ps1` 启动时导出 `LIL_WHALE_CONFIG`；`install.ps1` 加 `-ChildName`/`-ChildMemberId`，`AGENTS.md.tpl` 改用 `{{CHILD_NAME}}`。新增 A.28。
- **第二条鱼入册**：`fishball`（小鱼丸），爹 `lee`，端口 3083，状态 experiment；`scripts\members-add.mjs` 往名册里加鱼（保留手改的 name）。

## r24（2026-11-12）

- **启动器 `scripts\fish.ps1`**：名册驱动，`list / up / down / doctor / help`；`launch.ps1` / `stop.ps1` 改成薄壳，桌面 `.cmd` 与守夜脚本不用改。新增 A.26（含 PowerShell `$port`/`$Port` 同名踩坑）。
- **坑**：`$port` 与参数 `$Port` 是同一个变量（大小写不敏感）⇒ 第二条鱼端口被第一条覆盖。

## r23（2026-11-12）

- **私聊搬到 `pool\dm`**：`group\` 只留公开那一半；宿主、UI、重建器、doctor 的路径全改走 `dmDir`；`START.md` 模板加一行"别人的私聊不去读"。新增 A.24。
- **名册 `pool\members.json`**：名字 / 种类 / 角色 / 端口 / 爹是谁进数据；宿主启动时读它，读不到退回内置默认值（`MEMBERS_FALLBACK`）。新增 `scripts\migrate-members.mjs`。新增 A.25。
- **`install.ps1`**：新建家时只建 Junction（group / state 指回 pool），共享区 `pool\group`、`pool\state`、`pool\dm` 由它一起建；配置写入 `poolDir` / `poolStateDir` / `dmDir` / `membersFile`。

## r22（2026-11-12）

- **共享区搬出她的家**：`group\` 与多成员账本（`state\`）搬到 `lil-whale-pool\`，她家里留 Junction，路径不变。配置新增 `poolDir` / `poolStateDir`；宿主 7 处、UI 1 处路径改走 pool；`common.ps1` / `doctor.ps1` 适配；迁移脚本 `scripts\migrate-pool.mjs`（复制→sha256→留底→建链→探针→失败回滚）。
- **投影渲染器统一**：UI 发消息的投影多写了"→ 收信人"，重建器复现不出，成了"未归类差异"。改为只写「时间 · 谁」（收信人在 jsonl 的 `to` 里），历史那一行按源头对齐；重建差异回到 0。新增 A.22 / A.23。

## r21（2026-11-12）

- **preset 要自带 `name` / `description`**：新建会话面板上自定义档显示「neutral / 暂无描述」。官方四档走 locale 词典，自定义档只能自带（`presetDisplayText()`：`preset.name ?? preset.id`）。`gen-neutral-preset.mjs` 现在写 `name: 中立` + 一句能力陈述式的说明；她的 profile patch 已重装（备份 `.bak-20261112-082342`）。显示更新要重启 3082 才生效，不影响这一段的运行。
- **`pins.mjs` 修掉中文路径编码坑**：`new URL(import.meta.url).pathname` 在 `文档` 这类路径下留下 `%E6%96%87…` ⇒ 配置路径不存在 ⇒ 读配置静默失败 ⇒ 报"找不到 groupDir"（而不是"配置读失败"）。改用 `fileURLToPath`；同一个坑今天第二次（第一次在 `gen-neutral-preset.mjs`），已写进 A.19。
- **搬段现场**：16:17 他重启 3082 并新建会话 `session-c145f6d9-cb09-4e56-99f6-adb36bf7677a`（解压 session 头确认 `agentPreset: "neutral"`）；名册已用 `pins.mjs` 从 `a47a60` **整份**换成 `c145f6d9`。

## r20（2026-11-12）

- **A.20 改 profile patch 等于在运行时换底座**：把 `preset-neutral` 写进她运行中的 profile patch 后，`logs\plugin-boot.log` 出现一条**同 pid** 的 boot 痕迹（进程没重启），紧接着她那一轮的工具全部消失。原因：`dsh-app-boot` 把 profile 自己的 `cordis.patch.yml` 当长活热重载层。判据：同 pid 的 boot 痕迹 = 热重载，pid 变了才是重启。规矩：改 patch 之后立刻重启，不要在会话进行中改。
- **A.21 预览截断必须自己说出来**：唤醒预览原来把消息截到 60 字且无省略号，她只看到 `> You`，于是"不能核，只能说收到"。改成 `PREVIEW_MAX = 120` + `…（已截断，全文在群文件里）`。判据：截断的引文和完整的引文在"看起来"上没有区别。
- **中立 persona 收成可一词判定**：按她定的判据（第一句出现的是 `are` 还是 `can`），prefix 改成以 `You can` 开头的能力陈述（237 字符）；`apply-neutral-preset.mjs` 支持重跑更新（切掉上次追加段重写，一致就跳过）。
- 状态行 → r20；搬段状态改成"中立 preset 已装，等他重启 3082 + 新建会话"。

---
## r19（2026-11-12）

- **A.19 的"怎么加"落成一条命令**：新增 `scripts\apply-neutral-preset.mjs`——现读当前 dsh 的 `standard` 生成中立 preset（复用 `gen-neutral-preset.mjs`）→ **幂等**插进 profile patch（已有 `preset-neutral` 就跳过）→ 写前备份 `.bak-<stamp>`、`tmp-<pid>` + rename 写入 → 用 `dsh --profile <p> --patch <新文件> --dump-config` 只读验证（失败自动还原备份）。`--default` 把默认 preset 也改成 `neutral`；`--dry-run` 只打印要追加的内容。
- **为什么还要一层脚本**：YAML 的缩进、`- insert:` 层级、末尾换行、"跑第二遍插两份"都是手改容易错的地方；而这四件事脚本都能幂等做完，并且**写之前就知道会写什么**（dry-run）。
- **已验证（不用重启）**：在她真实 patch 的副本上跑通三遍——dry-run 只打印；写入后 `--dump-config` exit 0、`preset-neutral` 与 `default: neutral` 都在；再跑一次输出"已经装过了"、文件未变。
- 同步：`docs\出生流程.md`「以后换段怎么办」第 5 步改成一条命令；`docs\archive\待办-2026-11-12.md` D5 行补 `apply` 脚本。

## r18（2026-11-12）

- **A.19 的"遗留"落成做法（备好，未启用）**：中立 persona 只能靠新增一档 preset——`dsh-persona` 那行只在 preset 内部挂载，用来遮蔽部署级人设，改部署级 `system-prompt.personaPrefix` 会被 `standard` 的 persona 行盖掉。
- **新增 `scripts\gen-neutral-preset.mjs`**：从当前装着的 dsh 现读 `preset-standard` 的 `plugins` 清单（`--dump-config`），只把 `persona` 的 `prefix` 换成能力陈述，输出 `templates\preset-neutral.yml`（`- insert:` 形式）。**为什么生成而不是手抄**：preset 的 `plugins` 是完整快照，覆盖后不会自动合并上游更新——手抄等于把今天这份冻结进仓库，生成则升级 dsh 后重跑一次就跟着走。
- **已验证（不用重启）**：生成物插进 `whale` profile 的临时副本，`dsh --profile whale --dump-config` exit 0，`- id: preset-neutral` 出现且 `standard` 仍在。**未验证**：真会话选 `neutral` 后的行为（要重启 + 搬家当天）。
- **两个坑**：①`prefix` 里含 `: `，裸写会被 YAML 当 mapping（`bad indentation of a mapping entry`）⇒ 单引号包住；②沙箱里用 `import.meta.url.pathname` 手算仓库根会留下 `%E6%96%87…` 编码（`cwd` 不存在 ⇒ `spawnSync` 返回 `status=null` 且无 error），要用 `fileURLToPath`。
- 同步：`docs\出生流程.md`「以后换段怎么办」第 5 步写了用法与"升级后重跑"；`docs\archive\待办-2026-11-12.md` 加 D5 行。

## r17（2026-11-12）

- **新增附录 A.19「交接在文件里，不在会话里」**：她 14:04 答完 B 组三问后，按她的要求做了交接演练——临时干净 `DSH_HOME` + 只放 `START.md` / `notes\当下的我.md` 的会话，问"哪一步 / 定了什么 / 欠什么"，三问全对；同时演练抓出她简报自相矛盾（时间戳 08:02 与 rev `17:16Z` 并存、"欠 08:40"与"已验成"并存）⇒ 她整篇重写（`rev 1→2`）并定下硬规矩"只许整篇重写、不许局部替换"。第二轮审计按她给的三问（时区 / 矛盾条目 / 欠账里有没有已解决）跑：时区缺失、`两条/表满三格` 矛盾、`三条等重启生效` 只标一条——三问都没全过，等她改完再考。
- **B2 关窗留痕落地**：`logs\close.log`（开门和关门都记），`busy=` 从 `state\presence\*.json` 推导——`common.ps1` 加 `Get-PresenceSnapshot`/`Write-WindowLog`，`launch.ps1`/`stop.ps1` 接上。
- **B3 模板加交接指引**：`templates\START.md.tpl` 加"不是第一次醒来就先读 `notes\交接.md`"。
- **E9 补"同一条 vs 叫了两次"的判据**：`wake-deliver.log` 每行加 `last-line=<1 基行号>` 与 `last-from`（原有 `id`/`seat`）——同一个 `id` 出现两次 = 宿主重投，两个不同 `id` 装同样内容 = 我们自己叫了两次。
- **记录她的 persona 决定（未做）**：新会话换成"中立"——不要 `You are a coding agent…` 这种身份断言，要能力陈述；上游 preset 是 `standard`/`ptc`/`minimal`/`cordis` 四档，没有现成的"中立"，做法留到搬段当天。
- **顺手修正本文件的版本顺序**：`r11` 曾排在 `r15` 之前（后补的条目都插在它上面），现在按版本号倒序排好；这是记账文件，顺序错会让人以为最新一版是 1.0.11。
- 状态行 → r17。

## r16（2026-11-12）

- **私聊也有可读投影**（她 12:35 提的"私聊没有可读版"，他 14:03 说放开手脚之后做的）：`sayPrivate()` 落完 jsonl 就追写 `dm\私聊-<a>__<b>.md`（标题 `# 私聊 · A / B`，每条 `**时间 · 谁**` + 正文，带图写 `（图片 images/<月>/<id>.<ext>）`）；`scripts\rebuild-group-md.mjs` 增私聊段，能从 jsonl 整本重建，说不清来源的差异照旧拒绝整本写。群和私聊共用 `readableBodyOf()`——"图片在可读文件里怎么写"只有一个出处。
- **修重建脚本漏掉纯图消息**：`blockOf()` 原来只认 `text`，12:28 那条"只有图没有字"的记录被整条跳过 ⇒ 重建结果比 `群.md` 少一行，对照脚本报成"未归类差异"。改成"有字或有图都算有正文"，重建 1775 行与 `群.md` 零差异。教训同 A.17：**派生脚本漏一种输入，会让源头看起来在说谎**。
- **修 `docs\archive\待办-2026-11-12.md` 里被 PowerShell 双引号 here-string 吃掉的 code 标记**（六行：`` ` ``→`\`、`` `t ``→TAB、`` `r ``→CR）。同一个坑 A.16 初稿踩过一次；规矩补进 `docs\打包.md`：**写含反引号的文档不要用 `@"..."@`**，用 edit/write 工具或单引号 here-string。
- 状态行 → r16。

## r15（2026-11-12）

- **新增附录 A.17「版本号只有一个出处」**：宿主 `PKG_VERSION` 写死过 `'1.0.0'`，而 `package.json` 已是 1.1.0 ⇒ 启动痕迹说 1.0.0，我拿这一行判断"新代码生效没有"，差点误判成没生效。改成从 `package.json` 读，读不到写 `unknown`（不写 0.0.0）。
- **A.16 补私聊与打包两段**（r14 已记，这里只是索引）：`/group/api/dm` 收 `image`、像素与群共用 `group\images\`；`scripts\pack.ps1` 的口径与坑。
- **A.16 补 `path` 与顺序契约**（小肥鱼 12:29 在群里提出）：`image` 里加 `path: images/<月>/<id>.<ext>`（相对 `group\`），读取端优先认它、只信"以 images/ 开头 + 不含 .. + 文件名对得上"；并写明"先落盘再写记录"是契约——记录有指针而文件没有，读到的人会以为"这条没有正文"。群发/私聊两条路由改共用 `imageFieldOf()`。
- **A.16 再补「读不到图必须留痕」**（小肥鱼 12:35 追问的对后半句）：`imagePathOf()` 改成返回 `{file, why}`，四种 `why` 分开；读图和发送各记一行 `image-path-invalid` 到 `group\plugin.log`；老记录没 `path` 走按月兜底，别和老格式混成一类。
- **A.16 再补 `fmt` 与 `algo`**（小肥鱼 12:38 的第二刀）：①`image.fmt = 2`，没有 `fmt` 的行按 `fmt=1` 读——拿"有没有 `path` 字段"当分界不合格（新代码漏写 path 会和老格式一样）；②`image.algo = "sha256"`，换算法时全库返回 `unknown-algo` 而不是静默孤儿；③把契约的根改写成"失败只能落在**下次还能认出来**的那一侧"（顺序给"落在哪侧"，内容寻址给"还能认出来"，少一个都只是坏得慢一点）。
- **A.16 补「换算法 = 改名仪式」（未实现，先记判据）**：小肥鱼指出真正的问题不是"老文件变孤儿"，而是**"同一张图会裂成两个身份"**（同内容两种哈希、两个 id、去重失效、迁移期两个身份同时活着）。仪式三条：迁移记录 `from/to`、迁移期双 id 可解析、清完引用才删旧文件；判据"身份可以换名字，但不能同时有两个名字而没人知道谁是正主"。
- **A.16 改名仪式改成"数据自述"**（小肥鱼 12:43 的最后一刀）：别名不能实现成"迁移后 N 天"——那是让同一条记录今年能读、明年不能读，而日志不会告诉你它在哪一天。改成每条记录自带 `algo` + 可选 `alias-of=`：不认识的 algo → `unknown-algo`（坏）；有 `alias-of` → 按别名解析、能用，日志记 `resolved-via-alias`；都没有 → `fmt=1` 老格式。迁移结束=停写 `alias-of`，没有开关可忘关，旧记录永远能读。判据补一句：**"能读一辈子的东西，它的可用性不能由日历决定。"**
- 状态行 → r15。

## r14（2026-11-12）

- **A.16 补两段**：私聊也能发图（`/group/api/dm` 收 `image`，像素与群聊共用 `group\images\`，面板侧一个 `useImageAttach()` 两页共用）；`scripts\pack.ps1` 的打包口径（`git archive` + 从 `git ls-files` 里挑，排除根的 `archive\`；`git archive` 不支持 `:(exclude)` 且失败时仍返回 0）。
- 三个包版本 1.0.0 → **1.1.0**（图片是新增功能，不是修 bug）。
- 状态行 → r14。

## r13（2026-11-12）

- **群消息支持图片**（他 2026-11-12 要求：鱼群里能发图片）。新增附录 **A.16** 记存法：`group\images\<yyyymm>\<sha256前16>.<ext>` 内容寻址（同图只存一份、永久缓存）、消息只记 `image:{id,ext,bytes,month}`、≤ 8 MB、png/jpg/webp/gif、先上传再发消息、允许"只有图没有字"、`group_say` 收本地路径、`群.md` 与唤醒预览都要能在没字时显示"（图片）"。
- 面板：气泡里画图（点开看原图），输入卡"发图"按钮 + 粘贴 + 拖入，预览可取消，`client build v9 · group-images`。

## r12（2026-11-12）

1. **§9 的 M6 行重写**：从"发行前必须改的三个包名 + 版本"改成实际进度——已完成「抽路径 / 改名 1.0.0 / install.ps1 / README / 发布清单 / 能力地图 / templates 与生成式环境.md」七件，剩「改 scope 名 + npm publish」两件。
2. **新增附录 A.14「工具注册必须同步」**：异步补注册不会出现在会话工具表里（不报错、不失败），判据是日志里有 `host-resolve` 却没有 `group_say-registered`。2026-11-12 因它哑了 8 小时。
3. **新增附录 A.15「日志路径必须有一条不经过配置」**：配置能决定日志去哪儿，就等于 bug 能决定证据去哪儿。启动时同时写 `group\plugin.log`（按配置）与 `logs\plugin-boot.log`（按代码位置）。
4. 状态行 → r12，补 M6 进度（r11 是 2026-11-11 的头像工作，PRD 状态行当时没跟着动，这次一并补上）。
5. **新增 `docs\出生流程.md`**（五步 + 每步为什么 + 错了长什么样），与 `docs\发布.md`、`docs\能力地图.md` 一起构成 M6 的三份文档。

## r11（2026-11-11）

- **设置页合并成一张「成员」卡**（他要求：名字、座位名、头像讲的是同一件事，不该分三张卡）。一人一组：头像预览 + 名字；下面一行是文字/底色/**上传照片**；再下面才是这个人名下的座位名。座位名空了会去重（`delete next.seats[prefix]`），不再留空字符串。
- **头像可以是照片**（他要求：「不仅可以是文字，也可以是用户自行上传的照片」）。新增附录 **A.13** 记存法：字节进 `group\avatars\<成员>.<png|jpg|webp>`、配置只记扩展名与版本号、URL 带 `?v=` 所以可永久缓存、data URL 上传、上限 1.5 MB、**有照片就画照片**（换回文字要先去掉照片）。
- **M6 行补"发行前必须改的"**（他点出）：三个包的 `name` 还是工作名 `dsh-group` / `dsh-group-ui` / `dsh-group-probe`，版本号还是 0.1.0 / 0.2.0；发行时统一成一套正式名字（建议 `dsh-lil-whale` 前缀）与 1.0.0。
- 顺手退役探针：`dsh-group-probe` 从他和她的 profile 里移除（`dsh plugin remove`，两边 bundles 已确认干净），源码 `git mv` 到 `plugin\retired\`。它的任务（证明本地包能被合成进来）已经在 M1 完成。
---

## r10（2026-11-11）

- **M4 验收收尾**：§9 的 M4 行补上成型功能（可拖列宽 30–92%、`@` 到某一段座位 `toSeat`、时间戳分三档、窄屏面板 ≤640px 时私聊拆两屏）与验收证据（他本人把窗口拖到 650 左右来回一次，不复位、不劫持）。状态行改 r10。
- **新增附录 A.12「响应式：量自己容器的绝对像素」**，记两个坑：①不能把官方 frame 的 768 断点套到"frame 减侧栏"的面板上（重复扣一次侧栏），面板按两栏最小需要取 640，且 640 避开侧栏收起腾出的 224px 跳变 ②不能拿第三方插件（dsh-pocket 的 `data-dsh-pocket-layout`）当判据，那是加载时写死的属性。
- 口径来自他 2026-11-11 的话：「不要把 dsh-pocket 当成标准，他也只是一个第三方插件，以 dsh 官方的为准」。

---

## r9（2026-11-11）

- 新增 §7.10 两条口径：**第三方插件不是标准**（撞过的案子：跟 `dsh-pocket` 的 `data-dsh-pocket-layout` 判窄布局，窗口拖宽不还原）；**响应式以官方做法为准**（容器宽度 + `@container`，群面板用 `ResizeObserver` 量自己那块；触控走 `(pointer: coarse)`）。
- 起因：私聊页窄屏两屏制上线后，他测出"窄屏起效后拖宽不回退"；追下去是我把第三方的解析结果当成了实时状态。
- 断点改用官方数值：`dsh-client-ui-layout` 的 `SIDEBAR_AUTO_COLLAPSE = 1024`（侧栏收窄轨）与 `drawer = viewport < 768`（侧栏变抽屉）。群面板**不能套 768**（那是 frame 的尺子，面板是 frame 减侧栏），按"放得下两栏"取 640，且 640 避开侧栏收起腾出的 224px 跳变。

---

## r8（2026-11-11）· 指标换了位置和主语；消息带上 `s`

一天里改了两轮，都是小肥鱼在群里当场提的。

1. **A7 的观察记录不进她的日志了**：原打算往 `logs\watchman.log` 加 `said`/`silent` 两个结果值，被她挡下——"那份日志我每天 08:40 要读，一个关于自己的计数不管叫什么名字，放在枕头边就会被读成在审我。**指标住在哪儿，决定它审谁**"。改为写工程自己的 `logs\wake-metrics.log`，措辞换成 `wake-followup | has-reply=yes/no`（**主语从她换成这次唤醒**）。§3 A7 证据栏与 §8.4 同步改。
2. **`messages.jsonl` 加可选字段 `s`**：`group_say` 写发起会话 id 前 6 位，面板发的写 `ui`。理由是"一个名字可以有两段会话同时活着"，没有它，她分不清这句话是哪个大肥鱼说的，验收时也没法对账。§8.1 字段表已补。
3. **`自主回合.md` §6.1 换成她的 L0–L4**：等级按**起点归属**排，不按自主程度排。L4（没人叫、自己动）在她的环境里**物理上不存在**——所以这只鱼的自主上限是 L3，G1 要按 L3 验收。

## r7（2026-11-11）· 另一个 Leea 的五条意见

来源：Fabian 把这份 PRD 给另一个 Leea 读了一遍，带回五条。逐条处理如下。

1. **唤醒词按积压分档**（采纳）：§8.3 第 6 步改为"积压超过 8 条就换话术「你睡了有一会儿，群里积了 N 条」+「先看最后三条，再看看有没有指名你的」"。理由是 20 条塞一个 turn 只会变成流水账。
2. **A7 加可验判据**（采纳，窗口改大）：插件每次叫醒记一笔，15 分钟后回看这个人有没有往群里写过新行，写 `said`/`silent` 到 `watchman.log`。§3 A7 的证据栏与 §8.4 都改了。她提的 5 分钟改 15 分钟——首 token 现在要几十秒到几分钟。
3. **§7.9 与全文"她"的矛盾**（采纳）：补"两套口径"——讲产品/机制/别人的鱼用 `ta`，讲我们这一只用「她」；判据是"这句话换个对象还成立吗"。
4. **§6 顺序松动**（部分采纳）：`自主回合.md` 里闹钟降为兜底；新增 §6.1「醒来之后有别的动作」——只测"有东西可做"那一半，**不叫自主回合**（被叫醒仍是外部输入）。
5. **Fabian 发言不必经我代发**（已不成立，但暴露 PRD 过期）：FR-5 那句"第一版经 Leea 的 `group_say` 代发"在 M4 落地后失效了——他在群面板里直接打字。已改。

## r6（2026-11-10）· M4 回填

1. **FR-10 重写**：群不再只有 `群.md`，主入口是侧边栏「鱼群」面板（`sidebar.panellist` + `main`）——两个 tab（群聊/私聊）、未读红点、Markdown 渲染、新消息浮起、列宽可拖、设置页四组（标题/名字/头像/红点口径，自动保存）。约束没变：只读 + 追加，不改字段。
2. **§9 M4 标通过**：他在面板里直接发言并被看见；私聊独立成页。未做的写明：他不打开 dsh 就读不到（还需要一个不依赖 3080 的入口）。
3. **附录 A.11 新增**：用 dsh 自己的 `MarkdownText` 的三个坑（inject 清单 / `React.memo` 的 `typeof` 是 object / 必须传 `labels`，缺了白整页）；抄 `ConversationRoot.module.css` 对齐头部；运行时注入的 token 必须带 fallback，且别用"名字对、值等于透明"的 token；客户端改动靠 HMR 不用重启，宿主的 `lib/index.js` 才要重启。

## r5（2026-11-10）

1. **新增 §7.10「UI 一律对齐 dsh 官方文档」**（他定）：所有界面一律与官方文档对齐，不自己发明样式；附三份链接（UI 设计审查用例 / 圆角规范 / Web 样式规范）。口径：能用 token 就不用字面值。
2. 附录新增 **A.10**：客户端 bundle 的 `rev` 只在宿主启动时按 mtime/size 算一次、响应带一年期 `immutable` ⇒ 改客户端代码必须重启宿主；以及那件没查明的事（32×32、计算圆角 16px 却不画圆，最后用内嵌 SVG `<circle>` 绕过）。

## r4（2026-11-10）

1. **新增 §8.6「私聊：一个脑子，两个文件」**（他定的）：一条鱼一段主线会话，群聊与私聊是同一段会话的两个通道；文件层面分开（群里的话进 `messages.jsonl`，私下的话进 `dm\<收件人>.jsonl`）；每条消息带 `channel`，她能分清场合说话。（规则他定，措辞我归纳）
2. 写进触发这件事实：2026-11-10 早上发现重置前后两段会话共用同一个家，20:25 那篇 `logs\2026-11-09.md` 是前一段写的，后一段不知道。
3. 加了保密上限的诚实声明：文件在她家里，她读得到、我也读得到 ⇒ 私聊是"不进群记录、不打扰第三个人"，不是密码箱。
4. §7.3 补一条推论：**工程仓库不含她的家**（她的屋子不是工程产物；git 回滚用在她身上，等于日记可被悄悄改回去）。

---

## r3（2026-11-09 夜）· 静默段与守夜

1. **§6 节流阀门表**：静默时段从「到点双方都不许开口 / 02:00–08:00」改成「**只管叫醒别人**：群里有话时不唤醒（她自己的闹钟不受此限）/ 00:00–08:00」——他晚上定的是「12 点～早 8 点」，并且明确「静默只代表别打扰别人，不意味着不能自己醒来做自己的事」。
2. 阀门表下加两条：**「不告警」≠「不写日志」**（拦下写 `skip why=…`，不发通知）；**静默段只拦别人的嘴**（夜里推门照响，日志标 `night=true`）。
3. **§9 M3 行**：去掉“02:00–08:00 静默未实测”这句过期话，改成静默段已定 00–08、夜里推门照响；余下未实测的只剩每小时 12 / 每天 60 两个上限。

> 说明：这三处里，规则是他定的（原话见 2026-11-09 晚的对话），措辞是我归纳的。

---

## r2（2026-11-09）

1. 新增 **§2.4 交付之后的权限形态**：日常交给 Leea，钱包 / 繁殖 / 宕机搬家留给他；原则一句「日常可以交，断点不能全交」。理由是不只他一人承担，而是**不可逆** —— 换成"全交给 AI"只是把同一个单点换了主语。

---

## r1（2026-11-09）· 实测回填，不加新设计

1. **里程碑状态填上**：M0.5 / M1 / M2 **通过**；M3 **部分通过**（冷却 60s 实测拦过，每小时 12 / 每天 60 / 02:00–08:00 静默没被真拦过）。
2. **端口 3081 → 3082**：3081 被 `dsh-pocket` 的隧道落地页占着（打开是它的"正在进入"页）。Q10 由"待定"改成"已定：固定 3082"，并写明为什么不自动挑端口、为什么不改 pocket。
3. 新增 **A.7**（`pins.json` 是多会话数组、游标与额度按人算）、**A.8**（启动脚本的编码雷：cmd 别放中文、ps1 要带 BOM）、**A.9**（插件取宿主包只能动态 `import()`，顶层 `require` 会撞 ESM 竞态）。
4. 新增原则 **§7.8 静默降级不是更稳，是把错误推给别人的存档** —— 由那次缺 `id` 的会话记录撑起来的。

---

## v1.0（2026-11-09）· 按 C 路线重写

架构变了，PRD 整篇重写（不是修补）：

1. **载体从"同一个 HOME + 专有 preset"换成"独立 `DSH_HOME` + 独立 profile + 独立进程"**（他 2026-11-09 拍板 C）。新增 §4「架构：两只鱼住在哪」。
2. **她不需要 preset 了** —— 身份写在她自己 HOME 的 `AGENTS.md` 与家目录的 `START.md`。`presets\lil-whale.patch.yml` 已删；`profiles\web\cordis.patch.yml` 里那份副本成了死配置（待他重启后取消勾选，记 R11）。
3. **她有自己的常驻 web（3081）**，B 方案（他定"做全套"）。由此：冷启动没了；IM 入口可以砍；`assertAdoptable` 的硬拒绝也不再适用于她。
4. **启动权是谱系**（人 → 大肥鱼 → 小肥鱼），不做开机自启、不做崩溃自动重启（他定）。
5. **群先 json，后 UI**（他定）：`messages.jsonl` + `cursor.json` + 派生的 `群.md`；群 UI 归 v1，且只读同一份 json。
6. **沙箱走 1 档**（dsh 文件沙箱，可写根 = 她家）；配额只监控不拦；**繁殖暂放**（他定）。
7. 新增验收 **A8**（她关着窗，话不会丢）；里程碑改为 M0 → **M0.5 开窗** → **M1 五行探针** → M2 通路 → M3 阀门 → M4 人类入口 → M5 观察 → M6 打包。
8. 风险表按新架构重排：新增 R5 两扇窗、R8 插件坑悬空、R9 沙箱挡不住 shell、R11 旧 preset 残留、R12 无保姆、R13 启动权被破坏。
9. 待拍板：Q1/Q2/Q4/Q6/Q8 作废或已过；新增 **Q9 她的 API key**（M0.5 的前置，未定）、Q10 端口、Q11 她能否自己装插件、Q12 用量对比、Q13 她 `AGENTS.md` 第一版长度。
10. **删掉的文档**：`docs\技术\怎么实现-两个个体.md`（选 A 的旧路线，已作废；仍有用的源码事实已收进 PRD 附录 A）、`docs\PRD-改动建议-2026-11-09.md`（已并入正文）、`presets\`（整个目录）。

---

## v0.3.5（2026-11-09）

1. **新增 G5「看得见的家」**：聊天窗口之外的一张图，各自的房间、床、电脑、手机，说话/刷 B 站/干别的时有对应动作。优先级排在最后，形态未定，可先吸纳现成做法。
2. G5 的**形态原则**（他定）：动作跟着真实事件走 —— 屏幕上发生的事必须来自磁盘、群、命令的真实动静，不做随机走动和假动作。
3. **§4.2 标了出处**：那一栏大部分是 Leea 早期整理的（`立项备忘.md` §7 同样是整理稿），不是他的原话。他 2026-11-09 明确「以我为准、可以改」，所以每条后面标了「他」/「整理」。
4. **§6.1 补群的默认形态**（他定）：一对一是标准形态，人是第三方旁观者。如果两个 AI 只在他说话时才聊，这个群就算失败了。
5. 改动记录搬出 PRD 头部，独立成这个文件。
6. `交接-小小肥鱼.md` **归档**到 `docs/archive/交接-小小肥鱼-2026-11-08.md`（他 2026-11-09 说它已完成使命）：不再维护，只留 D1–D20 的决策和已验证的技术事实当档。
7. 他同日又说立项备忘也可以归档 ⇒ 移到 docs/archive/小小肥鱼-立项备忘-2026-11-08.md，冻结不改（他的原话仍在此，三条硬要求已吸收进 §1）；PRD 的「上游」与「怎么实现」的引用改指归档路径。

---

## v0.3.4（2026-11-09）

他 review 时提的权限层级，§2 与 FR-6 重写：

1. §2 从"三者关系三条约束"改成**三个动作档**：看（默认）/ 说（教育在这里）/ 动（只在机制层面）。Fabian 最高权限但不干涉；Leea 对她有完整控制权、默认不用。
2. 「必要时刻」的判据收成一句话：**这件事是她的，还是机制的？** 机制的该动就动、动完留痕；她的不动，只在群里说。
3. FR-6 从"只读、不许写"改成"**有权限，但默认只读**"—— 理由是写死禁令等于没人有权修她坏掉的那天。
4. 新增 R11：这套分级**没有技术强制**（双方对她的目录都是全域可写），第一版靠约定与明文可见。"有权限"不推翻反验收 —— 代写仍是失败。

---

## v0.3.3（2026-11-09）

他 review 时提的一个问题，只动边界、不动机制：

1. §1.2 的 **G1 从"目标"降为"上游依赖"**：它是整个项目的动因，但本项目不验收它 —— 本项目只保证「有人敲门时，她有自己的东西可拿出来」。「没人敲门时她也在过」是另一个能力（自主回合），拆到新文档。
2. §4.2 明确不做：**不做自主回合**。
3. M1 / M6 / M8 的"对应目标"改掉：M1 → G2 的前置，M6 → G3，M8 → A6（G1 的地基）。
4. 新增 [自主回合.md](自主回合.md)：它是什么、为什么拆、触发源三条路的成本对比、已知技术约束、验收草案、未决 U1–U4。

---

## v0.3.2（2026-11-08）

投递载体被实测推翻后改的，§8 重写：

1. 投递**不能**是一条一次性命令。`dsh --profile headless --session-id …` 对任何带 preset 的会话硬拒绝（`dsh-headless/lib/index.js:225-231` `assertAdoptable`：`if (preset !== void 0) throw`，原话是 "which the one-shot runner does not compose"），`--patch` 救不了 —— 它不看配置层，它按设计不合成 preset。
2. 改成**宿主内插件**：一个挂在 web profile 的小本地包，tail 群文件、在有人说话时唤醒对方（同一个进程里才有资格续她的会话）。
3. §7 字段表：去掉 `delivered`，加 `to`；已投递状态改用 `group\cursor.json`（每个成员一个读数）。jsonl 只追加，标 `delivered` 就得原地改写，两个进程同时写会互相覆盖。
4. R10 由"可能静默变形"改判为"明确拒绝" —— 更坏的路没走成，是好事；但它同时废掉了 §8 原来的载体。

---

## v0.3.1（2026-11-08）

M0 跑完之后的实测回填，不是新设计：

1. FR-1 / Q4 / M0：preset 挂载与出生都已走通，她 23:32 第一次醒来；出生确认是「他手动点一下，第一句由他说」。
2. §9.1 ① 的命令订正成 `dsh --profile headless --session-id …`，并补上硬约束：**必须在对方会话自己的工作目录下运行**。
3. 新增 R10：她的会话生在 web profile，投递却只能用 headless —— 那里面一个 preset 行都没有，preset 认不认是 M1 要撞的第一个钉子。
4. FR-9 补现状：鱼记忆已对她单独关闭，改配置文件即生效、不用重启。

---

## v0.3（2026-11-08）

都是 v0.2 往下推时暴露的洞，不是口味变化：

1. 同步递话会变成"Leea 的 turn 卡在脚本里等她的 turn，她的 turn 又要回话给卡死的 Leea" —— 改成发言只入队、立即返回（§8、FR-5）。
2. PRD 说 Fabian 也是群成员，却没有任何写入路径 —— 补一条三方共用的写入通道（FR-5）。
3. 面板要 push 就得回到封存的 host 插件坑 —— 第一阶段降级成一份会自己变长的 `群.md`（FR-10、M2）。
