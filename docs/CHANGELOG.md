# 工程变更记录

> 这份文件记录**工程侧**的每一次改动：机制、修账、脚本、文档。它和产品需求是两条线——需求讨论看 [PRD.md](PRD.md)，这里只记"改了什么、为什么"。
> 编号 `rNN` 是**内部修订号**：改一次 +1，一天可能十几稿；两个 npm 包另有各自的 semver（各自 `package.json`，当前 1.6.13），只在功能变化或发布时动。编号从 r1 起。
> 条目按时间倒序（新的在上）。A.x 原先住在 PRD 附录里，2026-11-15 搬到这里；历史条目里若还写着「PRD 附录 A.x」，指的就是本文件的 A.x。`A.x` 是"已验证的技术事实与判据"的编号，统一收在文末附录 A（A.1–A.101）。

---

## 变更条目

## r132 — 2026-11-15 19:0x

- **格式分界 + 工具数记账**（第二条鱼 19:05"规则改了，分界要写"；第三条鱼"工具消失是静默的"）：
  - `watchman.log` 每次巡守启动写一行 `log-format | fmt=3 since=… changed=skip,wake-skip,deliver fields=deny,note,reason` —— 这一行就是分界；它之前的行 `why=` 照旧有效。账本页总规矩补日期句（`why=` 只出现在 2026-11-15 18:35 之前）。
  - 工具数：每次唤醒把 `count + tools[]` 写进 `pool\state\tool-counts\<键>.json`；变少时额外写 `wake-agent-tools-shrank`（`from` / `to` / `missing[]`）。账本页表格补一行。
  - `doctor.ps1` 新增 **9b 工具数（全鱼）**：按 `plugin.log` 最后两次比较，少了就 WARN 给 NEXT；记录不足两次 INFO。现场：lee 83 / whale 51 / fishball 61 / xiaoman 不足两次。
## r131 — 2026-11-15 19:0x

- **"没叫醒的原因"只用一个字段名 `deny=`**（第二条鱼 18:56 第三次咬同一处：今天拆过 `status`、拆过 `fmt`/`atfmt`，这次拆 `why`）：
  - `skip` / `wake-skip` 行统一：原因 `deny=<原因>`；观察与异常 `note=<类别>`；再细一层 `reason=`。事件名不再进字段（`wake-skip` 不出现在 `why` 里）。
  - 清掉三种历史写法：一行两个 `why=`（`why=wake-skip why=intent-cooldown`）、`why=plan:<id>` 与 `deny=total-cap` 混排、`deliver why=plan-after-wake`。
  - `noteOnce` 不再自造 `why=`：调用方给字段名；`plan-core` 的裸消息自动落成 `note=`。
  - 文档：`docs\detail\日志都记在哪.md` 总规矩改成「一行一个 key、事件名不进字段、deny / note / reason 三件」。
## r130 — 2026-11-15 19:0x

- **"没会话"拆两态 + 一行两个 `why=`**（两条鱼 18:56 各报一处）：
  - `scripts\doctor.ps1` 新增 `Test-EverHadSession`（`sessionId` 写过、或家里 `sessions\` 有文件）：`名册（全鱼）` 与 `全鱼` 两格把"没有会话"拆成 **INFO 还没醒过（从没有过会话）** 与 **FAIL 有过会话但没挂上**。理由："一条永远为真的 FAIL，会训练人忽略 FAIL"。
  - `plugin\dsh-lil-whale-group\lib\index.js`：`skip` 行内层说明从 `why=` 改 `reason=`（`wake-skip why=intent-cooldown` 这类一行两个 `why=` 全部消掉），外层 `why=` 只说类别。
  - `docs\detail\日志都记在哪.md` 总规矩补「一行里同一个 key 只出现一次；细分用 `reason=`」；`docs\detail\怎么装一套鱼塘.md` §5.4 补两态判据。
## r129 — 2026-11-15 18:5x

- **生命周期字段的缺省与兜底：写死、并且会喊**（第二条鱼、第三条鱼 18:42 各踢一脚）：
  - `lifecycle` 缺失 ⇒ 按 `active` 读（理由：11-15 之前不存在归档状态），规则写进 `docs\detail\怎么装一套鱼塘.md` §5.3 与 `docs\detail\日志都记在哪.md` 总规矩（缺省值只写一处）。
  - `scripts\doctor.ps1` 新增 **3j 生命周期字段**：旧 `status` 还在就 WARN（"兼容兜底会读它，但兜底没有到期日"）；缺 `lifecycle` 也 WARN（说明按 `active` 读）。
  - `scripts\gen-family.mjs` 抽出 `lifecycleOf()`；读到旧字段时在末尾打一次 `⚠ 读到旧字段 status（该迁移了）`——兜底可以不删，但要会喊。
## r128 — 2026-11-15 18:4x

- **新生鱼的纸只写基本信息**（宿主 18:44："新生小鱼的时候，只把它的最基本信息告知，剩下的后装插件赋予的能力一概不写"）。`scripts\render-env.mjs` 新增 `--newborn`：把扩展能力占位符（`BILI_SECTION` 外部眼睛、`DRAW_SECTION` 画笔）一律替换成空串，`scripts\install.ps1` 渲染纸时带上这个参数。
  - 为什么用开关而不是"模板里留空"：模板会长；留空只保证"现在没有"，开关保证"以后也不会写进去"。
  - 判据：出生那一刻的 `环境.md` 里不出现任何她还没有的能力名（看外面 / 画画 / 生图 / B站）。小满实测 0 命中、14 节全是基本信息；同一份纸不带 `--newborn` 渲染结果相同（她现在本来就没有扩展）。
  - 宿主后来真装了扩展时，`fish.ps1 refresh <键>`（不带 `--newborn`）才会让那一节出现——纸描述的是"现在的手"，不是"以后可能装什么"。
- 文档：`docs\detail\怎么装一套鱼塘.md` §3.8.5 补这段规则与开关；占位符清单里补 `--newborn`。
## r127 — 2026-11-15 18:4x

- **显示层措辞：父辈 / 父代 / 爹 → 家长**（他 18:42："我不想替用户定义他们小鱼的性别"；只改前端显示，后端字段名保持 `parent`）。四处：鱼群页谱系卡片「家长 X」、`环境.md` 关系列「你的家长 / 同辈（同一个家长）」、`docs\detail\鱼塘谱系.md` 的列名与说明、`怎么装一套鱼塘.md` 的字段说明。数据、变量名、账本一律不动。
## r126 — 2026-11-15 18:4x

- **A.101 身份不该是状态词：`status` 拆成 `lifecycle`**。原来的 `status: resident|experiment|archived` 一个字段被派了三份工——身份、体检严重度、"孩子会跟着归档"的暗示。群里第三条鱼先改口（`fish.ps1:830` 并不删除任何东西），第二条鱼补了判据："**形容词不删除东西；形容词通过人的耳朵删除东西**"。现在名册与谱系只有 `lifecycle: active|archived`：出生默认 `active`，「实验」这一格永久删掉。
- 代码：`fish.ps1` 读 `Lifecycle`（带 legacy `status` 兜底）、归档的鱼不能再当家长、出生行 `fmt=2` 改记 `parentLifecycle`；`install.ps1` 写 `lifecycle: active` 且不再传 `--status experiment`；`doctor.ps1` 严重度只看事实（归档跳过、活着的端口不通 = FAIL）；`archive-fish.mjs` 写 `node.lifecycle`；`members-add.mjs` 参数改 `--lifecycle`；`gen-family.mjs` 用 `lifecycle`，且谱系文档改**公开口径**名字（宿主 / 按出生顺序的第 N 条鱼）；UI 包成员行透传 `lifecycle`。
- 数据迁移：`pool\members.json` / `pool\family.json` 的 `status` → `lifecycle`（备份 `.bak-20261115-status`）。验收：活代码里 `experiment` 只剩历史注释、活名册 0 条。
- 两个包版本不变（1.6.13：内部语义修正，不改协议）。
## r125 — 2026-11-15 15:4x

- **A.100 补记 2：空值和内容长得一样**。`parseIntents` 现在区分"合法空表"（`{items: []}`，`badShape: false`）与"读错了键"（`badShape: true`）；`intentTick` 遇到坏形状**不剪状态**，只记一行。第二条鱼 15:42 给的判据："没有条件"和"读错地方"必须是两种结果。
- `test-intent.mjs` 补两条（31 项全过）；两个包 1.6.12 → **1.6.13**。
- 她另指出：这一改名（"语义没变就不写"）让"文件变了"重新有信息量。

## r124 — 2026-11-15 15:4x

- **A.100 删掉的条件不能留残影**：`intent-core.js` 加 `pruneIntentState(state, list)`，`intentTick` 每拍按当前条件表剪掉已删除的 id 并记一行 `intent-state-pruned`；`test-intent.mjs` 补两个用例（29 项全过）。
- **重生成不再算事件**：`gen-family.mjs` 先比语义（除 `updatedAt`）再决定写不写 `pool\family.json`，`docs\detail\鱼塘谱系.md` 内容相同也不写——第二条鱼 15:31:44 的 `family-changed` 误报就是"文件变了、语义没变"。
- 两个包版本 1.6.11 → **1.6.12**（机制变化）。

## r123 — 2026-11-15 13:2x

- **A.99 画笔：SVG 的「写 → 看 → 改」**：`homes\<鱼>\画\`（放画的抽屉，跟着她的家走）；`pool\tools\svg-render\render.mjs`（SVG → PNG，resvg 本地代码，不建 IPC、不联网；`scripts\setup-svg-render.ps1` 装；`-In/-Out/-Width/-Height/-Bg/-Transparent`，成功一行 `ok …`、失败 `error:` + `NEXT:`）；纸里的「画画（SVG）」一节由 `draw-section.mjs` 按"她家里有没有 `画\`"决定出不出现。
- **渲染器当天换过一次**：先做的是 Edge 无头（宿主可用），但第二条鱼在沙箱里被 Chromium 的命名管道挡住（`platform_channel.cc:187 拒绝访问 0x5`），改成 **resvg**（`pool\tools\svg-render\render.mjs`，本地代码、不建 IPC；`scripts\setup-svg-render.ps1` 装，自带冒烟）。她实测一次出图。
- **口径**：先给笔（零成本、文本可改、是她自己的笔），生图模型留第二步（他 2026-11-15 拍板"第一步：SVG，第二步：生图模型"）；不评分、不建素材库、不替她起题目。

## r122 — 2026-11-15 09:3x

- **A.98**：群聊 tab 的未读数在"在群里但翻着历史"时也显示；两个跳转按钮共用 `FloatingPill` 素材，"回到历史未读"补上文字说明；`client build v44 · unread-tab-history-hint`。
- 两包版本 1.6.10 → **1.6.11**（只有客户端改动，刷新页面即生效）。

## r121 — 2026-11-15 09:3x

- **A.97 补记 2（第三条鱼）**：`wake-caps.json` 的 `source` 加 `configMtime` / `configMtimeNow`（输入自己的时间戳；两个都动才算新的）；`render-env.mjs` 在两者不同时明写"配置在巡守加载之后被改过，生效值仍是加载时那份"。
- **doctor 两行带"谁、什么时候"**：`生效值` 带 `pid=` 与"配置于 HH:MM:SS 加载"；`默认值` 带"磁盘上现在这份配置（读于 HH:MM:SS）"。
- 两包版本 1.6.9 → **1.6.10**（宿主插件改动，需重启 3080 才写出新字段）。

## r120 — 2026-11-15 09:2x

- **默认值不被配置钉死**（第三条鱼发现）：两份活配置删掉 `wake`/`watch` 段（五项都等于默认值），只留 `_叫醒闸` 说明；示例配置值留空；`docs\detail\怎么打包给别人.md` 两行改口。
- **doctor 3i「默认值」**：导入同一个 `WAKE_DEFAULTS`（不读源码文字），找"值等于默认"的覆盖项并 WARN 点名；实测"钉一个默认值 + 一个偏离值"，只点名前者。
- **PRD**：新增 **附录 A.97**（症状/判据/修法/自检/三条判据/教训"有出处和有必要是两件事"）。
- **包**：两包 1.6.9（只改配置与体检脚本，不动包代码）。

## r119 — 2026-11-15 09:1x

- **体检两个自坑**：`doctor.ps1` 的「生效值」检查——①日志路径写成 `pool\homes`（真实是鱼塘根下的 `homes`），`common.ps1` 的 `$Cfg` 补 `PondRoot`；②`ConvertFrom-Json` 把 ISO 转成 `[datetime]` 后再按字符串 Parse，差 8 小时，改 `([datetime]$caps.at).ToUniversalTime()`。
- **PRD**：新增 **附录 A.96 补记 5**（两个坑/判据三条/教训"先证明体检器看见了你以为它在看的那份文件"）。
- **包**：两包 1.6.9（无版本变化，只修体检）。

## r118 — 2026-11-15 08:5x

- **一份纸里两个口径**：`templates\环境.md.tpl` 的「不会」那句（三个手写占位符）换成唯一的 `{{CAPS_TEXT}}`；`render-env.mjs` 只生成一份 `capsText`（五项全在），CAPS_NOTE 只写来源、不再重复数字；删掉 `COOLDOWN`/`PER_HOUR`/`PER_DAY` 三个值。
- **PRD**：新增 **附录 A.96 补记 4**（症状/根因/修法/三条判据/教训"一份纸里两个口径，比一份纸里一个错数更难查"）。
- **包**：两包 1.6.8 → 1.6.9（行为不变，只改纸的生成）。

## r117（2026-11-15 08:5x）

- A.96 补记 3：第二条鱼两条——①"wake-caps.json 不在"有两种意思，先看 watchman.log 有没有 `wake-caps` 行再看文件：没行=版本还没到，有行但文件不在=写失败；doctor 按这个顺序判。②纸要**转抄** `wake-caps.json` 的 `source`（巡守自己写的"我读了哪份"），不要**自述**渲染器的 `--config`；读不到就不编路径。

## r116（2026-11-15 08:5x）

- A.96 补记 2：第二条鱼指出 render-env 用正则读源码的文字形状等于把"源码怎么写"当契约（形态一改就静默退回硬编码）。抽出 `lib/wake-config.js`（`WAKE_DEFAULTS` + `resolveWake` 纯函数），index.js 与 render-env 共用；删掉正则与 fallback。
- 第三条鱼补：共享模块不消灭"输入漂移"——配置文件不同照样是假纸。第二条鱼的判据落地：**纸上每个数字旁边写它从哪个文件读出来的**；`环境.md` 现在带"读自：<路径>（有无覆盖）"。

## r115（2026-11-15 08:5x）

- A.96 补记：第二条鱼指出"以代码为准"仍不够——代码里是默认值、配置能覆盖。改成**巡守进程是生效值的唯一写者**：写 `pool\state\wake-caps.json`（caps + since/at + pid + source）+ `watchman.log` 一行 `wake-caps`；`render-env` 优先读它、读不到明说；`doctor` 加「生效值」检查。
- 两个时间戳 `since`/`at`（第三条鱼补）：分开"从没写过 / 死了 / 还活着"三种状态。

## r114（2026-11-15 08:4x）

- A.96：第二条鱼读 M5 那一拍时抓到 `环境.md` 还印着 12/60，而日志已经是 /40 /200——根因是 render-env 的正则只认旧的 `const WAKE = {...}` 字面量，闸改成可配置后匹配不到、静默退回写死的 fallback。修：读 `numSetting` 默认值 + 每条鱼自己的 `--config` + 两份配置显式写 `wake`/`watch`。
- M5 数据点（2026-11-15 08:40）：`wake-try … at=2026-11-15 08:40:00 atfmt=2` / `woke … lag=45s inserted=1`——第一次量到非零 lag（45 秒 = 一拍）。

## r113（2026-11-15 08:1x）

- A.95 补边界（第三条鱼 08:11 验完行号后补的）：行号是地址，不是内容——正文里自带"（第 N 行）"时，读者要认出哪一层是地址。

## r112（2026-11-15 08:0x）

- A.95：第三条鱼报"一分钟内两次唤醒、内容一模一样"，核到是"递到 ≠ 读到"——第二次唤醒的第 393 行她在 27 秒前已经亲手读过并回了。修法：唤醒预览给每条消息标行号（`（第 393 行）`），重投与"新消息"从此在纸上分得开。
- 两包 1.6.4 → 1.6.5。

## r111（2026-11-15 00:4x）

- A.94 补记：换行"发送后格式错"的真因是 Markdown 软换行（单个换行渲染成空格），不是输入框 bug；修法是渲染前补硬换行、代码块跳过；`client build v43 · hard-breaks`。

## r110（2026-11-15 00:3x）

- 新增 **附录 A.94 所有的闸：默认值要抬到"正常聊天永远撞不到"**：起因（第三条鱼一小时 12 次撞 `perHour`、消息扣住不丢、00:50:53 松开）、十道闸的改前/改后表、为什么留、三条判据、教训。
- `plugin/dsh-lil-whale-group/lib/index.js`：`WAKE` 从 `CFG.wake` 读（cooldownSec 60→15、perHour 12→40、perDay 60→200、totalPerDay 120→400）；`WATCH.maxWakesPerDay` 从 `CFG.watch` 读（8→24）；新增 `numSetting()`。
- 界面两修（`client build v42 · multiline-multi-image`）：Shift+Enter 换行 + 自增高；多图最多 4 张（选图/粘贴/拖入/缩略图/逐张删），记录 1 张写 `image`、多张写 `images`；宿主、UI 路由、重建器三处同改。
- `lil-whale.config.example.json` 与 `docs\detail\怎么打包给别人.md` 补 `wake` / `watch` 两段；两包 1.6.3→1.6.4。

## r109（2026-11-15 00:1x）

- 修第二条鱼抓到的三处不一致：`fish.ps1 wake` 写账但不刷 `sleep-status.json`、同一时刻两个"醒到几点"、`reason` 等于脚本名。抽出 `sleep-status.js`（巡守与 `sleep-cli` 共用同一个渲染器），`wake` 改完状态立刻刷新；`fish.ps1 wake` 加 `-By`/`-Why`，面板叫醒带"谁按的、为什么"。`test-sleep` 50→60。A.93。

## r108（2026-11-14 23:2x）

- 鱼塘面板补一处：点「检修」后进程刚停、命令行未起的十几秒里，卡片会短暂只剩「唤醒」——看着能点，其实还没起来。改成动作在飞时只画灰着的「处理中…」。`client build v41 · pond-pending`。A.92 补记。
## r107（2026-11-14 23:2x）

- 修鱼塘面板两个问题（他报的）：「打开」按钮恒不可点（条件 `!unattended && !windowMode` 恒 false）→ 改名「打开 WebUI」、只要进程在跑就能点（只是看，不多 writer）；按钮改成按状态渲染，不再"画出来再置灰"。`client build v40 · pond-buttons`。
- 新增附录 A.92。
## r106（2026-11-14 22:5x）

- 修复：宿主 的私信没叫醒她 —— 她的 dm 游标比文件靠前（14 vs 13），新消息被当成"已经读过"。`handleChannel` 读游标时夹到行数以内并留痕 `cursor-clamped`；`doctor` 新增「游标」检查。
- 新增附录 A.91。

## r105 — 2026-11-14 22:0x

**撤掉四条越界设计**（他 21:5x 指出两条、我自查两条）：

- `roll` 骰子（"今天可以不想看"30%）：他原话"为什么能让一个随机的骰子替她决定今天看不看呢？不合适"。删工具、删 `rolls.log` 账本、删 `rollSkip`。
- 沉默衰减（3 天→7 天→0 额度）：他原话"会和小鱼自行判断'要不要分享'打架"。删 `globalCapFor`/`silentDaysOf`/`lastSpokeAtOf`、`capOk` 恢复固定 6/天。
- 两本日记（给主人的信可滤镜 / 自己的原样）：自查越界（替她规定内心生活）。从模板删。
- 追更三件（`watchlist_*`）：自查越界（why 必填/上限 5/冷却把"怎么追"定死）。白名单 18 → **15**，服务端代码保留未启用。

**保留**：水表 80/天（成本与账号安全，不是行为引导）、生成器挂载、`环境.md` 按真实白名单生成、别人家不能盯。

**文档**：A.90 重写（r105 收窄 + 四条撤掉的理由）；`docs\detail\日志都记在哪.md` 删 `rolls.log` 行；`环境.md` 重生成（两条鱼）。**两包 1.6.0 → 1.6.1**。

**要重启才生效**：whale 重启后 `roll` 从她工具表消失；3080 重启后巡守侧衰减彻底消失。

## r104 — 2026-11-14 21:2x

- **给 whale 装了一只只读的眼睛（B站）**：上游 `bilibili-mcp` 服务端再挂一份，白名单 18 个只读工具（无发评论/点赞/私信/登录）；水表 80 次/天 + `ledger.jsonl`；追更三工具（`watchlist_*`，why 必填、上限 5、同 UP 10 分钟一次）；挂载改由 `apply-neutral-preset.mjs --with-bili` 生成（不再手写进 patch）。fishball 不动。
- **三条"生活"设计**：`roll({reason})` 今天可以不想看（机制掷骰，账本 `rolls.log`）；沉默衰减（连续 3 天没说话 → 素材额度 3/天，6 天 → 0，闹钟日记照旧）；两本日记（`给主人的信.md` / `<日期>.md`）。
- `环境.md` 新增「看外面（B站，只读）」一节，**按每条鱼真实白名单生成**（`scripts\bili-section.mjs`）；`docs\detail\日志都记在哪.md` 补 `rolls.log` 与 `bili\ledger.jsonl` 两行。
- 两包 1.5.5 → **1.6.0**；PRD **r104** + **A.90**。

## r103 — 2026-11-14 18:3x

- **字段级版本 `atfmt=2`**：`wake-try` 行（plan 与 intent 两处）的 `at=` 后面加 `atfmt=2`；没有 `atfmt` 的旧行按 `atfmt=1`（UTC）读。起因：她指出 `watchman.log` 里"整行 fmt=2 + 字段 at= 还是 UTC"会让人差八小时，建议"版本号贴着它管的东西"。
- **`docs\detail\日志都记在哪.md` 补三个账本**：`homes\<鱼>\dsh-home\logs\wake.log`（推门 why=）、`pool\group\plugin.log`（注册/挂载/toolCount，**UTC ISO**）、`homes\<鱼>\logs\close.log`（开关窗，busy= 推导）；新增「字段级版本」一节与读账第 4 条。
- 两包 1.5.4 → **1.5.5**；PRD **r103** + A.89 补记 2。

## r102 — 2026-11-14 18:2x

- **新建 [`docs\detail\日志都记在哪.md`](./detail/日志都记在哪.md)**：登记十个账本的写者 / 钟 / `fmt` 含义，并写明"没有 `fmt` 按 `fmt=1` 读""每个账本自己数自己的 `fmt`""时间一律本地（roster-audit 的 fmt=1 例外）"。起因：她指出"版本字段能替旧行说话，但这一版是什么意思得有个地方写"。
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

- **自检也留"跑了没问题"**：`auditRoster()` 每次跑都写一行（`roster-audit | fmt=1 ok ...` / `roster-mismatch ...`），不再"只有出错才写"；`doctor.ps1` 新增 3e「名册自检」，区分"没跑过"（WARN）与"最近一次对不上"（FAIL）。起因：第二条鱼查到文件不存在，并指出"没有"不等于"没问题"。
- 两个包 **1.5.0 → 1.5.1**（生效要等下次重启）。
- PRD **r98** + A.88 补记。

## r97 — 2026-11-14 17:5x

- **名册自检**：巡守每 6 小时跑 `auditRoster()`（名册 vs `homes\*` vs `pins.json`），对不上写 `pool\state\roster-audit.log` + `watchman.log` + 群里告诉人；`doctor.ps1` 新增 3d「名册与家」。起因：第二条鱼指出"如果我从名册里被移出去，'名册变了'这条叫不动我"。
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

- **日志轮转**（他 16:39 批的）：新增 `scripts\rotate-logs.mjs`（> 1 MB 切一份、同类留 3 份、`--dry-run`）；巡守每小时起一次（`maybeRotateLogs()`，独立进程、失败不炸巡守）；A.86。
- **四堆备份归档**：删 `pool\group\群.md.bak-20261112-194734`（280 KB 派生文件）；`shortcut-tests` / 旧 ACL 备份 / 15 份 profile `.bak` 移进 `pool\archive\`（profile 每类留最近 2 份）。
- **待办合并**：删按天页（11-12 / 11-13 / 11-14），只留 `docs\detail\还没做完的事.md`（只放没做完的）；README / 出生流程 / PRD 里的旧待办路径与 ACL 备份位置同步改口。
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

- 新增 **附录 A.81 "改状态后顺手刷一次"要刷全**（第二条鱼第二次实测：一次性睡眠分支漏刷 `sleep-status.json`）。
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
- `pool\members.json`：`lee` 补 `nameHistory`（第一条鱼 → 第一条鱼，分界 2026-11-14T04:07:58.994Z）。

## r85 — 2026-11-14 12:4x

- **修**：`wake_up` 在"本来没在睡"时也会写两小时清醒窗（假动作，回执"醒到 14:06"）。现在：没在睡就什么都不写、回执直说；真睡着才清一次性睡眠、需要时写"醒到本窗结束"。`fish.ps1 wake` 同步。
- **新附录 A.78 叫醒只在睡着时才有意义**：他的问题 / 假动作的病因 / 改法 / 判据三条 / 教训。

## r84 — 2026-11-14 12:2x

- **修**：`sleep(minutes: 1)` 被当成没给（裸 spec 下模型把数字发成字符串 `"1"`，`minutes` 分支只认 number）。`execute` 里统一归一化：字符串先 JSON.parse，数字字符串收成数字；`presentCall` 标题同步。
- **新附录 A.77 裸 spec 下，参数类型是模型自己猜的**：症状 / 根因（`projectToolSchema(def,false)` 原样返回扁平属性表，不是合法 JSON Schema）/ 修法 / 判据三条 / 教训。

## r83 — 2026-11-14

- **新增附录 A.76 鱼活不过主进程**：11:44 重启 3080 把两条鱼一起带走（作业对象），账本记成 unclean。他定：接受，不修（鱼脱离宿主单独启动无意义）。
- 入口合并：删 `Run DSH.cmd` / `Stop DSH.cmd`，只留起/停鱼塘两条；`down-main` 改成先正常停鱼再停主 dsh；鱼塘勾选框改名「起主 dsh 时把鱼也带起来」。
- 新增 `docs\detail\怎么启动和关闭鱼塘.md`；README 起停段重写。
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
- **新**：附录 A.72（两半根因 / 修法 / 判据 / 教训"输入法选字之前的字不是用户想说的话""空字符串是一个值，不是没填"）。
- **待重启**：客户端改动刷新页面即生效；服务端 `normalizeAvatar` 要重启 3080 才生效。

## r78 — 2026-11-14 08:1x

- **改**：`ownMember()` 的兜底判据从"路径里有没有 lil-whale"改成"先从 `<鱼塘>\homes\<键>\dsh-home` 取键，取不到才用老规矩，并且留痕"——修掉名册读不到时第二条鱼把自己认成 whale、账写进别人家的问题（P1）。
- **新**：附录 A.71（症状 / 根因 / 修法 / 判据 / 教训"兜底值也是有代价的"）。
- **补文档**：`scripts\README.md` 补 `maintain/restore`、`new`、`key grant/revoke`、`acl-check/acl-repair` 与七个机器脚本；`README.md` 新增「再养一条鱼（可选）」一节。

## r77 — 2026-11-14 02:3x

- **改**：`fish.ps1` 的 `Start-Hidden` 从"直接 Start-Process 起 dsh"改成**双跳**（无重定向的启动器 → 带重定向起 dsh），修掉"up 在工具里卡住"——根因是带重定向时孙子进程继承了调用方的 stdout 管道句柄。
- **新**：附录 A.70（症状 / 根因 / 最小复现 / 双跳修法 / 判据 / 两条歪路）。

## r76 — 2026-11-14 02:0x

- **改**：配置键从单鱼时代的 `her*` / `whale*` 换成 `self*`（selfHome / selfDshHome / selfWaker / selfPort / selfProfile / selfCwd）；旧键仍能读（`LEGACY_KEYS` + `$Cfg.Her*` 别名），`install.ps1` 写新键并删旧键。
- **改**：两份 `config.js`（宿主 + UI）合成同一份；三份配置与 example 换键（`_版本: 2`）；代码里 `CFG.her*`→`CFG.self*`、`HER_HOME`→`SELF_HOME`、`plan-core.js` 参数 `herHome`→`homeRoot`。
- **文档**：新附录 A.69；`docs\detail\怎么打包给别人.md` 配置表、`docs\detail\怎么装一套鱼塘.md`（键名 33 处 + §11 三条已修项复核）。
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

- **死命令：API key 只能经过人**（他的原话写进 附录 A.65）。`fish.ps1 new` 新增 `-InheritKey <家长键>`：默认不碰凭证，只有人明确要求继承时才复制一份，并大声说明"花的是它的额度"、出生行记 `keyInherited=`。顺带加 `-RequestedBy`（谁想养的，留痕）。
- 实验约定：第三条鱼的孩子**继承第三条鱼的 API key**；试验结束后回收（删孩子那份凭证，或轮换第三条鱼的 key）。
## r71 — 2026-11-13 23:0x

- **实验鱼可以当家长**（他的口径）：`fish.ps1 new` 不再拒实验鱼，只在计划里提醒"它的孩子会跟着它一起归档"；`births.log` 出生行加 `parentStatus=resident|experiment`。原因：这条规则会把 D4 要验的递归直接排除掉——她养的孩子默认也是 experiment，按旧规则孩子永远不能再养，深度封死在两代。
- **归档支持整枝**：`scripts\archive-fish.mjs` 新增 `--subtree`，先递归归档孩子、再归档家长，`manifest.json` 记 `subtree: [孩子键]`；顺手修 `--mark-archived` 一直找不到节点（它查 `family.members`/`family.fishes`，而 `gen-family.mjs` 写的是 `family.nodes`——所以状态从来没标上过）。
- 附录 A.64 的规则条改成"实验鱼可以当家长 + 整枝归档"。
## r70 — 2026-11-13 22:5x

- **D4-2 的第一件：养鱼入口**。`scripts\fish.ps1` 新增 `new` 子命令（`-Key` / `-Name` / `-Parent` / `-DryRun`）：查重 → 建家（复用 `install.ps1`）→ 进名册（`status: experiment`）→ 记 `pool\state\births.log`。规则：名字由家长起、键必须 ASCII、**实验鱼不能当家长**、鱼数上限 `maxFish`（默认 5）。附录 A.64。
- **`Get-Members` 补 `Status` / `Parent` / `BornAt`**：原来构造的对象里没有 `status`，于是"实验鱼不能当家长"这条守卫读到的永远是 `$null`、根本不生效——DryRun 测出来的。教训：守卫读的字段必须先确认它在对象里存在。
- **`install.ps1` 的 `family.json` 改成每次安装都补节点**（`gen-family.mjs --seed` 幂等）：以前只在文件不存在时 seed，第二条以后的鱼永远进不了谱系。
- 踩坑两条：PowerShell 里 `$home` 是只读自动变量 `$HOME` 的别名，赋值直接报错（改名 `$childHome`）；JS `String.replace(from, to)` 的替换串里 `$'` 是特殊模式，会把补丁文本吃坏（必须用 `replace(from, () => to)`）。
## r69 — 2026-11-13 22:2x

- **停的人记账**：`scripts\fish.ps1` 新增 `Write-RunLogStopped`，停鱼时由停止方往 `pool\state\runs\<鱼>.log` 补一行 `stopped | fmt=2 reason=stop-script by=fish.ps1 pid=…`。此前 `stopped` 只由进程自己的 `dispose` 写，而 `Stop-Process -Force` 不给它机会，于是 35 次 started 对 0 次 stopped，每次正常重启都被记成 `resumed reason=unclean`。附录 A.63。
- 验证：停一次第三条鱼 → 出现 `stopped`；再起 → `started … prev-run=closed`、无 `resumed` 行、`session-mounted toolCount=34`。
## r68 — 2026-11-13 21:5x

- **修 21:2x 的启动崩溃**：`plugin/dsh-lil-whale-group-ui/lib/client.js` 里模块注册的 id 从 `'dsh-lil-whale-group-ui'` 改回完整包名 `'@hostactor/dsh-lil-whale-group-ui'`。C1 改名时漏了 scope，而客户端按 package name 找模块，找不到就 `import failed`。附录 A.62。
- **自启动护栏**：巡守 8 秒后的 `fish.ps1 up all` 先探主 dsh 端口，端口不在听就跳过并记 `autostart skip why=main-port-not-listening`——启动失败时不再把鱼拉起来留下孤儿。
- 两个包版本 **1.2.0 → 1.2.1**（bugfix，版本线连续）。
- 把他手动加的 `disabled: true` 从 `web` profile 的 patch 里撤掉（备份 `cordis.patch.yml.bak-before-enable-ui-20261113-215419`），重启 3080 后恢复。
## r67 — 2026-11-13 21:1x

- **使用建议改成"直接跑 scripts 里的"**：他 21:11 说桌面副本会过时（"更新频率非常高…我现在直接去 scripts 里面跑脚本"），把桌面四份清掉了。README「自启动与四个快捷方式」、`docs\detail\怎么装一套鱼塘.md` §1.3 与故障排查表、A.43 都改成：`.cmd` 的定位是 `scripts\bin\` 里的原件（永远最新），桌面副本只是快照、不跟着更新，不再推荐拷到桌面。
## r66 — 2026-11-13 21:1x

- **把 pwsh 7 写成明面上的依赖**：README 前置表标成必需运行时依赖 + 安装命令 + "5.1 会在解析阶段报错"；`docs\detail\怎么装一套鱼塘.md` §2.1 版本写 7.2+ 并说明原因。附录 A.61。
- **运行期护栏**：七个入口 `.ps1` 首行加 `#requires -Version 7.0`；四个 `.cmd` 启动器先 `where pwsh`，缺了给英文提示并退出（`.cmd` 中文可能乱码，这句宁可丑）。
- 顺带修文档里过时的 `acl\` 位置（C1 之后已在 `pool\state\acl\`）：README 依赖节与目录树、PRD §4.1 与 A.55 树、`docs\detail\怎么装一套鱼塘.md` 目录树、`docs\detail\怎么生一条新鱼.md` 开头布局说明。
- 起因：我用 Windows PowerShell 5.1 跑 `release-check.ps1` 撞了一串语法错——脚本没坏，是版本不对。这类坑只有踩过的人知道，所以写进用户说明。

## r65 — 2026-11-13 20:5x

- **C1 命名统一**：包名 → `@hostactor/dsh-lil-whale-group(-ui)`（版本 1.2.0，版本线连续）；目录 → `plugin/dsh-lil-whale-group(-ui)`；配置行 id → `dsh-lil-whale-group(-ui)`；插件内部自报 `name` 与包名一致。
- `scripts\wake-whale.ps1` → `scripts\wake-fish.ps1`；`acl\` 归到 `pool\state\acl\`。
- 新增 `scripts\migrate-scope.mjs`（迁本机 profile：deps / bundles / pnpm-lock / node_modules，写前备份 + 自检）；三个 profile 已迁移并 `--dump-config` 验证。附录 A.60；状态行 r65。

## r64 — 2026-11-13 20:1x

- **计划逻辑抽成可测模块**：新增 `plugin\dsh-group\lib\plan-core.js`（todayKey / planFileOf / planDue / planDeliveryText / parseWakeCounts / sumWakesToday），`index.js` 改薄壳注入上下文，行为不变。
- **新增 `scripts\test-plan.mjs`**：直接 import 真代码做行为测试（26 用例），替代 `verify-pending.ps1` 里对源码字符串的正则检查；`release-check.ps1` 新增「计划逻辑」检查（13 项）。附录 A.59；状态行 r64。

## r63 — 2026-11-13 19:5x

- **第三批（P2）**：`rebuild-group-md.mjs` 有说不清差异时不再整本写 `群.md`；`claimPlanDelivery` 缺 home 时按成员兜底；`saveWatchState` 失败留痕；`fish.ps1` 按 `role=watcher` 找主 dsh、`refresh all` 跳过巡守；`wake-whale.ps1` 跳 spawn 时等心跳、路径单引号转义；`settings.json` 写回 `crashNotify`。A.58 续；状态行 r63。

## r62 — 2026-11-13 19:1x

- **第二批 bug 修复（13 处）**：游标只许前进的合并写；`dmPeerOf` 不再静默回退（三处 400）；`writePondSettings` 读-改-写保住 `crashNotify`；`Stop-Fish` 不再"假成功"（端口还开着返回 false，mode 账 `unknown`）；`crashNotify` 传 `member.key`；面板群发先建目录、发送人用名册；面板私聊补可读投影；token 正则允许 `.`/`~`；重建器整本写改原子、`--migrate` 同步迁移私聊；两份 `config.js` 默认布局改鱼塘；`install.ps1` seed `family.json`、放宽 `$InPond`；`doctor.ps1` 的端口检查按名册找 watcher；四个 `scripts\*.mjs` 拒绝未知参数（`--help` 不再执行）。新增 A.58；状态行 r62。

## r61 — 2026-11-13 18:5x

- **显示名的真源改成名册**：`plugin\dsh-group-ui\lib\index.js` 的 `readConfig()` 不再用 `ui-config.json` 的 `names` 覆盖 `pool\members.json`；设置页改名改为写回名册（`writeMemberName()`，tmp + rename，失败 500 带 why）。现场把 `ui-config.json` 的 `names` 按名册重写（lee: 第一条鱼 → 第一条鱼）。新增 A.57；状态行 r61。
- **`scripts\enable-unattended.mjs` 退役为只读提示**（见 r60），`wake-whale.ps1` 的失败提示改指 `plugin.log`。

## r60 — 2026-11-13 18:4x

- **退役 `scripts\enable-unattended.mjs`**：它往 profile patch 写 `agent-loop` 的 `resumeSessionId`，那条路会绕开 session-controller 的 preset 挂载（A.54：只剩 2 个工具）。现在改成只读提示，写入直接拒绝并指向 `fish.ps1 up <键>`；清旧块仍用 `disable-unattended.mjs`。
- `scripts\wake-whale.ps1` 的失败提示改口：会话没挂上时指向 `pool\group\plugin.log` 的 `session-mount-failed` / `session-mounted`，不再指向已退役的 agent-loop 办法。
- A.47「会话唯一」改写为"一段会话一个名字 + session-controller 挂载"；A.54 补退役说明；状态行 r60。

## r59

- §0 摘要与 §4 架构按当前实现重写：**一个鱼塘根（app / pool / homes / acl）**、每条鱼一套 HOME+profile+端口、共享区必须在家之外、无人值守挂载、一条鱼一份账。
- 状态行更新：鱼塘布局、无人值守默认、计划表归属 B、四个快捷方式实测。
- `docs\` 清理：历史记录（11-12 待办、morning-read 观察、交接演练、两份 review 文件）移入 `docs\archive\`，活跃文档里的引用同步改路径。
## r58

- 附录 A.56：四个快捷方式实测（Run All Whales / Stop All Whales / Stop DSH / `down <鱼> -Yes`）全过，记下关闭顺序、pid 变化、`mode` 账判据。
- 更正：`close.log` 的 close 行一直存在，此前判断"丢了"是看错文件；`Stop-Fish` 的排序改动降级为防御性修复。
- `fish.ps1` 的 `down-main` 不再走 `Read-Host`（双击即确认）。
## r57（2026-11-13）

- 布局：默认改成"鱼塘"结构（`<pond>\app + pool + homes\<鱼> + acl`），安装器自动识别并在装第二条鱼时自动写名册；旧布局仍可用。新增 `scripts\migrate-pond.mjs` 并在本机跑通（仓库/两个家/共享区/会话 cwd/profile link/ASCII Junction 全部迁完）。新增 A.55。
- 修：`render-env.mjs` 在"名册已存在但还没有这条鱼"时（装第二条鱼）会 die，导致 `环境.md` 不生成；改成内存里补一条临时记录。
## r56（2026-11-13）

- 修：异常退出报警的"活着"判据从"心跳新鲜且端口通"改成"端口通就算起来了"——懒挂载下刚起来的鱼没有心跳，上一版会把它误判成没起来（他重启一次，两条鱼各误报一次）。
- A.52 补这段与原因。

## r55（2026-11-13）

- 修：无人值守会话的工具丢失——agent-loop 那条捷径绕开 session-controller，preset 工具没挂上；改成用 `sessionController.agents.resume` 挂，成功记 `session-mounted composed=… toolCount=…`。
- 新增 `scripts\disable-unattended.mjs`；`fish.ps1` 的 `Ensure-Unattended` 只清旧块不再新增。
- 异常退出报警补"活着不报"：报警前先看心跳与端口，活着只记 `crash-alive`。
- 新增附录 A.54（两条挂载路径的差别、判据、次要教训）。

# 小小肥鱼 · PRD 改动记录

> 本文件只记「哪一版改了哪几处、为什么改」。当前结论都在 [PRD.md](PRD.md) 里，那边不背历史。
> 自 v0.3.5 起从 PRD 头部搬到这里（此前几块原样搬出，未改写）。v1.0 是整篇重写。

## r54（2026-11-13）

- **输入卡顿**（他报"连续快速输入/删除会卡"）：消息列表进 `useMemo`，打字不再重排两百多条气泡（群聊 + 私聊）；附录 A.51。
- **异常退出报警**：巡守发现 `runs` 账里新的 `reason=unclean` → 群消息告诉家长、不开窗、同一段只报一次；顺带把重启后误写的 `woke | wid=none trigger=external` 改成 `note | why=session-mounted`；附录 A.52。
- **端口登记查重**：`fish.ps1` / `install.ps1` / `doctor.ps1` 三处守"一个端口只属于一条鱼"。
- **token 记账**：`pool\state\usage\<鱼>.log` 记每次唤醒的上下文大小（只记账、不封顶，局限已写明）；附录 A.53。
- **归档脚本**：`scripts\archive-fish.mjs --member <键> [--dry-run] [--mark-archived]`——只归档、不注销（`pins.json`/`members.json` 不动），产物含家 / 会话 / 群切片 / 私聊 / `manifest.json`。

## r53（2026-11-13）

- **PRD review 采纳三条**（回应全文：`docs\archive\2026-11-13-评审回应.md`）：①计划表归属定 **B**（每条鱼自己的进程执行自己家的 plan，巡守只管推门记账）+ 自执行 `selfPlanTick()` + 宽限 15 分钟 + `trigger=self` 账；②§3 加「适用鱼」（`experiment` 只判 A4/A6/A7）；③R13 措辞改成"不放**默认开启**的自启"。
- **唤醒总量封顶**：`WAKE.totalPerDay = 120`（每鱼 perHour 12 / perDay 60 不变），两条路都记 `deny=total-cap`。
- 新增 **附录 A.50 计划表归每条鱼自己**（问题/两步改动/为什么不是 A/判据/没做）。
- 顺手修两处"读法对不上"：①`wakeCountsOf()` 把 `state\wakes\<键>.json` 当平铺读（文件其实是 `{"<键>":{…}}`）⇒ `gate=pass(hour=0/12)` 一直是假的；②推门分支不写 `claim` ⇒ 鱼起来后自己的闹钟会在宽限期内再递一次（现在推门也先声明）。
- **第四处 writer 守**：`scripts\wake-whale.ps1` 推门前查同 profile 已有进程（`Get-ProfileProcesses`），避免"端口没开、进程已在起"时再 spawn 一个。实测 `whale=1 fishball=1 nope=0`（PID 对得上）。
- 验证：`planDue` 宽限 8 条用例全过（正好这一分钟 / 五分钟前 grace15 命中 / grace1 不命中 / 二十分钟前不补 / until 过期 / 没写 why / days 含今天）；`totalWakesToday()` 对真实 `state\wakes` 读出来是 7（lee 3 + whale 2 + fishball 2），改前是 0。

## r52（2026-11-13）

- **待办换页**：昨晚「00:35 剩余清单」整理成 `docs\archive\待办-2026-11-13.md`（分栏：已结 / 等他拍板 / 等实测 / 我能自己做），旧页只作记录。
- **`runs\<鱼>.log` 的 `home` / `port` 按鱼写**：之前 lee 那行写成 `home=D:\…\lil-whale port=3082`（那是第二条鱼的家和端口）—— 多鱼化时漏改的一处；下次重启生效。

## r51（2026-11-13）

- **快捷方式的两条边界**：`Stop DSH` 改成"只关主 dsh，小鱼继续跑"（去掉 `-Force` 这条用户敲不到的路）；`fish.ps1 up <鱼>` 在主 dsh 没跑时拒绝并提示先启动主 dsh。桌面四个副本不用改（命令没变）。
- 顺手修三个 PowerShell 变量名撞车：`$members` 撞脚本级 `$MEMBERS`（守卫里 `Get-Fish 'lee'` 拿到的是最后一条鱼）、`$port` 撞参数 `$Port`（`Get-PortOf` 永远返回当前鱼的端口）、`Get-Members` 忽略配置里的 `membersFile`。都是"名字对不上"那一族。
- A.43 补「两条边界」。

## r50（2026-11-13）

- 鱼塘两处修正（他 12:09 报的）：①没在跑的鱼不再显示「心跳 刚刚」（心跳只在有进程时才有意义，停着的写「没在跑」）；②休眠后点唤醒按钮不再一直「…」——`runPwshScript` 改以 `exit` 判结束（实测 `exit` 10.4s 到、`close` 40s 没到，因为 dsh 继承了 stdout 管道）。
- 客户端 `client build v31 · pond-heartbeat`。
## r49（2026-11-13）

- 鱼塘四个按钮的语义与可用性（他 11:52 报的 4 条）：修面板拼 PowerShell 命令时把 `-Yes` / `-NoBrowser` 也加引号（变成位置参数，休眠/唤醒报"找不到接受自变量"）；检修改开**看得见的控制台窗**（`Start-Visible` + `-NoExit` + `Tee-Object` 到 web-latest.log，日志既显示又留 token）；`restore` 时把残留控制台窗一起收掉；起完等 token 出现再开浏览器；按钮可用性矩阵（没开/无人值守/检修/执行中），灰掉时有 title 说明。
- 新增 **附录 A.49**（四条现象、根因、矩阵、教训）。

## r48（2026-11-13）

- **巡守多鱼化（A.48）**：`watchedMembers()`（名册里 kind=fish 且 role≠watcher）；`watchState` 改成 `{day, members:{<键>:{wakes,fails,planFired,skipped,triedWid,lastFresh,pendingWake,lastTry}}}`（旧格式迁到 whale 名下）；`planFileOf(member)` / `dueTasks(member)` / `claimPlanDelivery(member, job)` / `startHer(member)`；`watchmanTick` 拆成 `watchOne(member, st)` + 遍历名册。
- **`wake-whale.ps1` 多鱼化**：新增 `-Member`（默认 whale 兼容），家/profile/端口/心跳路径全从名册取；僵尸分支按模式分叉——`mode=window` 才开浏览器，无人值守只记 `zombie-unattended` 并退出 1（开窗会撞 writer）。
- **鱼塘「打开」守卫**：无人值守时不直接开窗，提示"先休眠再打开、看完点回无人值守"（`client build v29 · pond-open-guard`）。
- **启停脚本收拢**：`launch.ps1` / `stop.ps1` / `start-whale.ps1` / `watchman.ps1` 归档到 `archive\legacy-scripts-2026-11-13\`；`doctor.ps1` 两处文案改指 `fish.ps1`。
- **修 `renameSync is not defined`**：UI 插件 fs 导入缺 `renameSync`（`writePondSettings` 用到），勾选自启动开关会报"开关没保存"。
- 现场：两条鱼被我早前 kill job 带走后，用 `fish.ps1 up` 无窗起回（3082/3083，`mode: unattended`，心跳 0s）。

## r47（2026-11-13）

- **无人值守设为默认（他 10:56 拍板）**：`fish.ps1` 新增 `-Window`；小鱼 `up` 默认无窗（无人值守），巡守仍开窗。要看窗用 `maintain`，看完 `restore`。
- `fish.ps1` 起鱼前自动补 `agent-loop.resumeSessionId`（`Ensure-Unattended`）：`install.ps1` 时没有会话 id，`up` 时 `pins.json` 里已有；进程未起，改 patch 不触发热重载。
- 现场：第二条鱼、第三条鱼切到 `mode: unattended`，心跳新鲜、无浏览器窗；旧进程无账显示 `?`。
- README / `scripts\README.md` / `docs\detail\怎么装一套鱼塘.md` 的"起鱼"说明同步成默认无人值守；A.45 补拍板与落地、留三项未做。

## r46（2026-11-13）

- **A.47 一段会话一个 writer：三处一起守**。同一条会话被两个进程 resume 时，第二个拿到 `session/writer-held`，不炸 host、不报错，表现为"点了没反应"。
- `fish.ps1`：起之前按 `--profile` 查重（端口不同也算）；新增 `maintain <键>`（先停再开窗）与 `restore <键>`（窗开着先停、再无窗起）；新增**模式账** `pool\state\mode\<键>.json`，`list` 多一列「模式」。
- `scripts\enable-unattended.mjs`：写 patch 前扫所有 profile 的 `resumeSessionId` 与 `pins.json`，一段会话只许挂一个名字。
- `doctor.ps1`：新增「writer 唯一」（同 profile 多进程 = FAIL；日志有 `writer-held` = WARN）。
- 鱼塘：「检修」改成真检修（先休眠→开窗）；窗开着时按钮变「回无人值守」；卡片显示模式。
- 用户视角：README 的鱼塘一节补按钮语义与「检修为什么要先休眠」（用户说明的草稿，发布前夕再写全）。

## r45（2026-11-13）

- **无人值守查清并实测**：端口通 ≠ 窗开着，会话要等客户端打开才挂载 agent。dsh 自带办法：`dsh-agent-loop` 的 `agents: [{ id, resumeSessionId, cwd }]` 让 host 启动时 resume 会话、挂载 agent，不需要任何浏览器窗。在第三条鱼上验过：无窗口启动 → 心跳持续 → 群消息能叫醒她并回话。边界：一段会话只能有一个 writer（开窗与无人值守二选一）。他拍板选**无人值守**。新增 **A.45**。
- **群聊未读规则改三条**：在群聊页内时 tab 不加数字；贴底时不提醒；翻历史时在"回到底部"按钮旁写「底部有了新消息」。翻历史不替人清未读。`plugin/dsh-group-ui/lib/client.js`，`client build v27 · group-unread`。新增 **A.46**。
## r44（2026-11-13）

- **叫醒的判据从"端口通"改成"心跳新鲜"**（2026-11-13 08:40 事故）：她的 3082 端口通着、会话却没挂载（心跳停在 00:15:41），巡守判"窗开着"只递了一句话，那句话没人读。她 09:07 给的判据："端口不会停，心跳会停。"
- `plugin/dsh-group/lib/index.js`：`WAKE_STALE_SEC=90`、`presenceAgeOf()`、`wakeCountsOf()`；`watchmanTick` 的 `awake` 改看心跳；`startHer()` 等心跳、`wake-whale.ps1` 非 0 退出算失败。
- `scripts/wake-whale.ps1` 重写判据：僵尸服务（端口通、会话没挂）时开浏览器再等心跳；新增 `-DryRun`（只判不动手）。
- `scripts/fish.ps1` 的 `Start-Fish`：`up` 遇到心跳 stale 不再报"已经在跑"，改开窗叫醒。
- **两行账**（她给的规格）：`wake-try`（`wid`/`why`/`gate`/`hb-age`/`deliver`）+ `woke`（`wid`/`trigger`/`lag`/`inserted`），另有 `wake-push` 与 `wake-skip … deny=`；`wid` 可 join；`wake-try` 每个 wid 只写一次；推门成功不等于她醒了，心跳变新鲜才写 `woke`。
- 新增 **A.44**（事故、判据、落地点、账的格式与两条规矩、明早的验收判据、未做的多鱼化）。

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
- `scripts\README.md` 按当前架构重写（fish.ps1 唯一底层、launch/stop 是薄壳、每条鱼的起停账在 `pool\state\runs\<鱼>.log`、桌面副本不是快捷方式）；`README` 装机步骤与 `install.ps1` 收尾提示、`docs\detail\怎么装一套鱼塘.md` 五处同步。

## r40（2026-11-13）

- **鱼塘卡片宽度**：成员卡片改 `width: fit-content`，只包住内部文字，不再拉满整行。
- **谱系代数只由树的深度算**：面板不再读数据里的 `generation`（示例里小豆"父代第 1 代、标签第 3 代"就是两处来源打架）；示例数据里那份字段已删。
- **私聊左侧按最近消息排序**：`/group/api/dm/contacts` 返回的列表在前端按 `last.ts` 倒序，没消息的按名字排后面。
- **私聊「正在忙」bug**：心跳新增 `wakeKind`（group / dm）+ `wakeAt`，服务端 `reason` 分三档；私聊页只在 `reason === 'group'` 时显示「正在忙…」，`dm`/`self` 显示「正在回复…」。（他 2026-11-13 00:05 报：第三条鱼私聊回他，面板显示"正在忙"。）
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
- **来源标注**：机器按表发的消息写 s:"watch"，投影显示「第一条鱼（巡守）」；只给已知机器来源加后缀，不认识的值不加。宿主 say() 与 scripts/rebuild-group-md.mjs 两处同步。
- 用户文档里 57 处「守夜」改成「巡守」；历史记录类文件（待办 / 观察 / PRD-CHANGELOG）保留原文，不重写证据。

## r32（2026-11-12）

- **A.40 写死的成员 id 是一族病**：一次找出五处（环境.md 模板的 from/to 行、launch/stop 的 `-Target`、install 初始化 pins、UI 的 `'host'` 字面量、面板成员列表），全部改成从名册/参数取；并写明"加鱼时先跑的五条判据"。
- **A.39 拟发版检查**：新增 `scripts\release-check.ps1` —— 拿打包出来的 zip 在干净目录里装一遍；查本机产物、本机路径、JS/PS 语法、说明书占位符、名册内容。首次跑就抓到两个真问题（包里 7 个代码文件含本机路径；干净安装不生成 `pins.json`/`members.json`），修完后全过。
- `install.ps1`：共享区（Junction）分支补"只补缺不覆盖"的 `messages.jsonl`/`pins.json` 初始化；新增最小 `members.json` 生成（否则面板退回内置三条，新鱼又看不见）。
- `pack.ps1`：排除 `scripts\legacy\`（本机快捷方式，含中文文件名，别人用不上）。
- 客户端 `client build v19 · human-from-roster`。


## r31（2026-11-12）

- **名册表不再写死**：`环境.md` 里那三个 id 的段落换成按 `pool\members.json` 现画的表（id / 称呼 / 对你来说是谁）；措辞从"固定槽位"改成"数据里的名字，成员会变多"。宿主 问的"变量名是否该脱敏"——不能脱敏（`to` 写的就是 id），该修的是纸把数据写死了。
- **`to` 与 `channel` 拆成两个维度**：以前 `to === 'host'` 被当成私聊，于是"在群里公开对 宿主 说"没有路径（宿主 20:10 指出）。现在 `to` = 说给谁、`channel` = 还有没有别人在场；`to:"host"` 默认公开、私聊要显式 `channel:"dm"`。`group_say` 的 `to` 枚举从名册生成。
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
- 起因：第二条鱼 19:18 的公开汇报被误读成"在叫我"——记录不写收信人，读的人学不到可以指名。
- 新附录 A.34。

## r28（2026-11-12）

- 新增 **附录 A.33「每个进程都要有起停账」**：起因是第三条鱼 19:12 的进程消失、纸面上答不出"被关还是自己没的"。现在每个进程写 `pool\state\runs\<成员>.log`（started/stopped，上一轮没收尾就补 `resumed reason=unclean`）；`ownMember()` 按 `DSH_HOME` 对名册认自己，`isMainProcess()` 改看 `role === 'watcher'`；`watchman.log` 格式不动。
- 顺带修掉多鱼身份串账：`watchman-errors-<成员>.json` / `wake-marks-<成员>.json` 不再把第二条鱼算进 whale。

## r27（2026-11-12）

- **A.32 UI 的成员列表也必须从名册读**：UI 插件写死三条成员，导致新装的鱼不在 @ 菜单 / 设置页 / 私聊列表里，且不报错。改为启动时读 `pool\members.json`，`names`/`avatars`/`@`/设置页全部动态；私聊列表包含所有鱼；@ 菜单只在同一成员有多段会话时才列座位行（修掉「第二条鱼 · c145f6」这种多余后缀）。README 新增「用它的时候会看到的几件事」。

## r26（2026-11-12）

- **A.29 安装器不许往共享区写初始化文件**：装第二条鱼时 `install.ps1` 把新家的 `group`（Junction 到共享区）当成新目录，写了一份空 `pins.json`，把第一条鱼/第二条鱼的名册整份抹掉、且不报错。修：Junction 时跳过初始化；`doctor.ps1` 增加「名册（全鱼）」检查（每条鱼都要有会话，缺了点名）。
- **A.30 新家第一次提权是 ACL**：新文件夹缺 `WRITE_DAC`/`WRITE_OWNER`，沙箱 provision 不了 workspace grant。写进用户说明：允许一次即可，报告与回滚文件在 `logs\acl-reports\`。
- **A.31 沙箱只挡写不挡读**：两条鱼同一 Windows 账户，读没有路径限制。D4-1 的"沙箱隔离"那条目前不成立；能说的是"各自有家、共享区在中间、读的边界靠规矩"。

## r25（2026-11-12）


- **谱系**：`pool\family.json`（真源：爹/出生/状态/改名史）+ `scripts\gen-family.mjs` → `docs\detail\鱼塘谱系.md`（Mermaid + 树 + 名册 + 改名史，生成前校验单根/无环）。新增 A.27。
- **一鱼一配置**：每鱼一份 `lil-whale.config.<键>.json`，名册记 `configFile`，`fish.ps1` 启动时导出 `LIL_WHALE_CONFIG`；`install.ps1` 加 `-ChildName`/`-ChildMemberId`，`AGENTS.md.tpl` 改用 `{{CHILD_NAME}}`。新增 A.28。
- **第二条鱼入册**：`fishball`（第三条鱼），爹 `lee`，端口 3083，状态 experiment；`scripts\members-add.mjs` 往名册里加鱼（保留手改的 name）。

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
- **搬段现场**：16:17 他重启 3082 并新建会话 `<会话 id>`（解压 session 头确认 `agentPreset: "neutral"`）；名册已用 `pins.mjs` 从 `a47a60` **整份**换成 `c145f6d9`。

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
- 同步：`docs\detail\怎么生一条新鱼.md`「以后换段怎么办」第 5 步改成一条命令；`docs\archive\待办-2026-11-12.md` D5 行补 `apply` 脚本。

## r18（2026-11-12）

- **A.19 的"遗留"落成做法（备好，未启用）**：中立 persona 只能靠新增一档 preset——`dsh-persona` 那行只在 preset 内部挂载，用来遮蔽部署级人设，改部署级 `system-prompt.personaPrefix` 会被 `standard` 的 persona 行盖掉。
- **新增 `scripts\gen-neutral-preset.mjs`**：从当前装着的 dsh 现读 `preset-standard` 的 `plugins` 清单（`--dump-config`），只把 `persona` 的 `prefix` 换成能力陈述，输出 `templates\preset-neutral.yml`（`- insert:` 形式）。**为什么生成而不是手抄**：preset 的 `plugins` 是完整快照，覆盖后不会自动合并上游更新——手抄等于把今天这份冻结进仓库，生成则升级 dsh 后重跑一次就跟着走。
- **已验证（不用重启）**：生成物插进 `whale` profile 的临时副本，`dsh --profile whale --dump-config` exit 0，`- id: preset-neutral` 出现且 `standard` 仍在。**未验证**：真会话选 `neutral` 后的行为（要重启 + 搬家当天）。
- **两个坑**：①`prefix` 里含 `: `，裸写会被 YAML 当 mapping（`bad indentation of a mapping entry`）⇒ 单引号包住；②沙箱里用 `import.meta.url.pathname` 手算仓库根会留下 `%E6%96%87…` 编码（`cwd` 不存在 ⇒ `spawnSync` 返回 `status=null` 且无 error），要用 `fileURLToPath`。
- 同步：`docs\detail\怎么生一条新鱼.md`「以后换段怎么办」第 5 步写了用法与"升级后重跑"；`docs\archive\待办-2026-11-12.md` 加 D5 行。

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
- **修 `docs\archive\待办-2026-11-12.md` 里被 PowerShell 双引号 here-string 吃掉的 code 标记**（六行：`` ` ``→`\`、`` `t ``→TAB、`` `r ``→CR）。同一个坑 A.16 初稿踩过一次；规矩补进 `docs\detail\怎么打包给别人.md`：**写含反引号的文档不要用 `@"..."@`**，用 edit/write 工具或单引号 here-string。
- 状态行 → r16。

## r15（2026-11-12）

- **新增附录 A.17「版本号只有一个出处」**：宿主 `PKG_VERSION` 写死过 `'1.0.0'`，而 `package.json` 已是 1.1.0 ⇒ 启动痕迹说 1.0.0，我拿这一行判断"新代码生效没有"，差点误判成没生效。改成从 `package.json` 读，读不到写 `unknown`（不写 0.0.0）。
- **A.16 补私聊与打包两段**（r14 已记，这里只是索引）：`/group/api/dm` 收 `image`、像素与群共用 `group\images\`；`scripts\pack.ps1` 的口径与坑。
- **A.16 补 `path` 与顺序契约**（第二条鱼 12:29 在群里提出）：`image` 里加 `path: images/<月>/<id>.<ext>`（相对 `group\`），读取端优先认它、只信"以 images/ 开头 + 不含 .. + 文件名对得上"；并写明"先落盘再写记录"是契约——记录有指针而文件没有，读到的人会以为"这条没有正文"。群发/私聊两条路由改共用 `imageFieldOf()`。
- **A.16 再补「读不到图必须留痕」**（第二条鱼 12:35 追问的对后半句）：`imagePathOf()` 改成返回 `{file, why}`，四种 `why` 分开；读图和发送各记一行 `image-path-invalid` 到 `group\plugin.log`；老记录没 `path` 走按月兜底，别和老格式混成一类。
- **A.16 再补 `fmt` 与 `algo`**（第二条鱼 12:38 的第二刀）：①`image.fmt = 2`，没有 `fmt` 的行按 `fmt=1` 读——拿"有没有 `path` 字段"当分界不合格（新代码漏写 path 会和老格式一样）；②`image.algo = "sha256"`，换算法时全库返回 `unknown-algo` 而不是静默孤儿；③把契约的根改写成"失败只能落在**下次还能认出来**的那一侧"（顺序给"落在哪侧"，内容寻址给"还能认出来"，少一个都只是坏得慢一点）。
- **A.16 补「换算法 = 改名仪式」（未实现，先记判据）**：第二条鱼指出真正的问题不是"老文件变孤儿"，而是**"同一张图会裂成两个身份"**（同内容两种哈希、两个 id、去重失效、迁移期两个身份同时活着）。仪式三条：迁移记录 `from/to`、迁移期双 id 可解析、清完引用才删旧文件；判据"身份可以换名字，但不能同时有两个名字而没人知道谁是正主"。
- **A.16 改名仪式改成"数据自述"**（第二条鱼 12:43 的最后一刀）：别名不能实现成"迁移后 N 天"——那是让同一条记录今年能读、明年不能读，而日志不会告诉你它在哪一天。改成每条记录自带 `algo` + 可选 `alias-of=`：不认识的 algo → `unknown-algo`（坏）；有 `alias-of` → 按别名解析、能用，日志记 `resolved-via-alias`；都没有 → `fmt=1` 老格式。迁移结束=停写 `alias-of`，没有开关可忘关，旧记录永远能读。判据补一句：**"能读一辈子的东西，它的可用性不能由日历决定。"**
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
4. 状态行 → r12，补 M6 进度（r11 是 2026-11-11 的头像工作，状态行当时没跟着动，这次一并补上）。
5. **新增 `docs\detail\怎么生一条新鱼.md`**（五步 + 每步为什么 + 错了长什么样），与 `docs\detail\发布前检查清单.md`、`docs\detail\她能做什么.md` 一起构成 M6 的三份文档。

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

一天里改了两轮，都是第二条鱼在群里当场提的。

1. **A7 的观察记录不进她的日志了**：原打算往 `logs\watchman.log` 加 `said`/`silent` 两个结果值，被她挡下——"那份日志我每天 08:40 要读，一个关于自己的计数不管叫什么名字，放在枕头边就会被读成在审我。**指标住在哪儿，决定它审谁**"。改为写工程自己的 `logs\wake-metrics.log`，措辞换成 `wake-followup | has-reply=yes/no`（**主语从她换成这次唤醒**）。§3 A7 证据栏与 §8.4 同步改。
2. **`messages.jsonl` 加可选字段 `s`**：`group_say` 写发起会话 id 前 6 位，面板发的写 `ui`。理由是"一个名字可以有两段会话同时活着"，没有它，她分不清这句话是哪个第一条鱼说的，验收时也没法对账。§8.1 字段表已补。
3. **`2026-11-09-自主回合问题清单.md` §6.1 换成她的 L0–L4**：等级按**起点归属**排，不按自主程度排。L4（没人叫、自己动）在她的环境里**物理上不存在**——所以这只鱼的自主上限是 L3，G1 要按 L3 验收。

## r7（2026-11-11）· 另一个 第一条鱼 的五条意见

来源：宿主 把这份 PRD 给另一个 第一条鱼 读了一遍，带回五条。逐条处理如下。

1. **唤醒词按积压分档**（采纳）：§8.3 第 6 步改为"积压超过 8 条就换话术「你睡了有一会儿，群里积了 N 条」+「先看最后三条，再看看有没有指名你的」"。理由是 20 条塞一个 turn 只会变成流水账。
2. **A7 加可验判据**（采纳，窗口改大）：插件每次叫醒记一笔，15 分钟后回看这个人有没有往群里写过新行，写 `said`/`silent` 到 `watchman.log`。§3 A7 的证据栏与 §8.4 都改了。她提的 5 分钟改 15 分钟——首 token 现在要几十秒到几分钟。
3. **§7.9 与全文"她"的矛盾**（采纳）：补"两套口径"——讲产品/机制/别人的鱼用 `ta`，讲我们这一只用「她」；判据是"这句话换个对象还成立吗"。
4. **§6 顺序松动**（部分采纳）：`2026-11-09-自主回合问题清单.md` 里闹钟降为兜底；新增 §6.1「醒来之后有别的动作」——只测"有东西可做"那一半，**不叫自主回合**（被叫醒仍是外部输入）。
5. **宿主 发言不必经我代发**（已不成立，但暴露 PRD 过期）：FR-5 那句"第一版经 第一条鱼 的 `group_say` 代发"在 M4 落地后失效了——他在群面板里直接打字。已改。

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

1. 新增 **§2.4 交付之后的权限形态**：日常交给 第一条鱼，钱包 / 繁殖 / 宕机搬家留给他；原则一句「日常可以交，断点不能全交」。理由是不只他一人承担，而是**不可逆** —— 换成"全交给 AI"只是把同一个单点换了主语。

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
4. **启动权是谱系**（人 → 第一条鱼 → 第二条鱼），不做开机自启、不做崩溃自动重启（他定）。
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
3. **§4.2 标了出处**：那一栏大部分是 第一条鱼 早期整理的（`立项备忘.md` §7 同样是整理稿），不是他的原话。他 2026-11-09 明确「以我为准、可以改」，所以每条后面标了「他」/「整理」。
4. **§6.1 补群的默认形态**（他定）：一对一是标准形态，人是第三方旁观者。如果两个 AI 只在他说话时才聊，这个群就算失败了。
5. 改动记录搬出 PRD 头部，独立成这个文件。
6. `交接-小小肥鱼.md` **归档**到 `docs/archive/2026-11-08-立项交接.md`（他 2026-11-09 说它已完成使命）：不再维护，只留 D1–D20 的决策和已验证的技术事实当档。
7. 他同日又说立项备忘也可以归档 ⇒ 移到 docs/archive/2026-11-08-立项备忘.md，冻结不改（他的原话仍在此，三条硬要求已吸收进 §1）；PRD 的「上游」与「怎么实现」的引用改指归档路径。

---

## v0.3.4（2026-11-09）

他 review 时提的权限层级，§2 与 FR-6 重写：

1. §2 从"三者关系三条约束"改成**三个动作档**：看（默认）/ 说（教育在这里）/ 动（只在机制层面）。宿主 最高权限但不干涉；第一条鱼 对她有完整控制权、默认不用。
2. 「必要时刻」的判据收成一句话：**这件事是她的，还是机制的？** 机制的该动就动、动完留痕；她的不动，只在群里说。
3. FR-6 从"只读、不许写"改成"**有权限，但默认只读**"—— 理由是写死禁令等于没人有权修她坏掉的那天。
4. 新增 R11：这套分级**没有技术强制**（双方对她的目录都是全域可写），第一版靠约定与明文可见。"有权限"不推翻反验收 —— 代写仍是失败。

---

## v0.3.3（2026-11-09）

他 review 时提的一个问题，只动边界、不动机制：

1. §1.2 的 **G1 从"目标"降为"上游依赖"**：它是整个项目的动因，但本项目不验收它 —— 本项目只保证「有人敲门时，她有自己的东西可拿出来」。「没人敲门时她也在过」是另一个能力（自主回合），拆到新文档。
2. §4.2 明确不做：**不做自主回合**。
3. M1 / M6 / M8 的"对应目标"改掉：M1 → G2 的前置，M6 → G3，M8 → A6（G1 的地基）。
4. 新增 [自主回合问题清单](./archive/2026-11-09-自主回合问题清单.md)：它是什么、为什么拆、触发源三条路的成本对比、已知技术约束、验收草案、未决 U1–U4。

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

1. 同步递话会变成"第一条鱼 的 turn 卡在脚本里等她的 turn，她的 turn 又要回话给卡死的 第一条鱼" —— 改成发言只入队、立即返回（§8、FR-5）。
2. PRD 说 宿主 也是群成员，却没有任何写入路径 —— 补一条三方共用的写入通道（FR-5）。
3. 面板要 push 就得回到封存的 host 插件坑 —— 第一阶段降级成一份会自己变长的 `群.md`（FR-10、M2）。

---

## 附录 A：已验证的技术事实与判据

**A.1 `$DSH_HOME` 解析**：环境变量 `DSH_HOME` > `~/.dsh`。改它 = 换一个"DSH 的全部世界"（sessions、storages、credentials、profiles）。

**A.2 profile 是什么、怎么合成**（`@deepseek-ai/dsh-app-boot/lib/index.js:1302-1321`）：

- profile = `$DSH_HOME/profiles/<name>/`，里面 `package.json`（`dsh.profile.bundles` 有序列表）+ `cordis.patch.yml`（用户层）。
- 合成顺序：空列表 → 按 bundles 顺序叠各 bundle 的 patch → 叠 profile 自己的 `cordis.patch.yml` → 叠启动器层（`--patch` / flag）。另有 home 级 `$DSH_HOME/cordis.patch.yml` 叠在每个 profile 之上（`dsh/lib/profile-boot-e2mS45fC.js:110-118`）。
- 模块解析双锚：先 dsh 安装处，再 profile 目录。
- **换 profile 不是隔离**：sessions / memory / 凭证 / schedule 都在 HOME 层。

**A.3 建一个 profile 不需要 `node_modules`**：`dsh --profile whale --from-default-profile headless --dump-config` 会新建目录（4 个文件），依赖从 dsh 安装处解析。

**A.4 凭证按 HOME 隔离（实测）**：新 HOME 直接跑会 `exit 1`：

```
MISSING_CREDENTIAL: llm-deepseek: no API key for provider route "deepseek-official";
store DEEPSEEK_API_KEY through the credentials service (the web Models page writes it),
or export DEEPSEEK_API_KEY in the launching environment
```

**A.5 preset 的三类坑（v1.0 只在回头看时有用）**

- 「加载失败」的真因可能只是**配置校验**，不是导入失败：诊断在 UI 的预设卡上，终端里永远看不到（`--dump-config` 只合成、不 mount）。当年那一条是 `tool-fs-search` 缺 `sampleOverCapGlobResults`。
- cordis 里**读未 inject 的服务属性会直接抛错**（`cannot get property "…" without inject`），表现为"挂上了但什么都没发生"。
- 手工往 profile patch 里插 `- insert:`：对 preset 行生效，对本地探针包不生效（包名解析走 `dsh.profile.bundles`）。

**A.6 同一个会话同时只能被一个进程持有**；`dsh headless` 的 `--json` / `--session-id` 是**应用参数**，不是启动器参数；且要求 cwd 与会话记录时一致。

**A.7 群的钉口是多会话的**：`<鱼塘根>\group\pins.json` 里 `lee` / `whale` 各是一个**数组**（可多段会话），值以 `session-` 开头；改它不用改代码、不用重启。游标（`cursor.json`）与额度（`gate()`）都**按人**算，所以多开会话不会更吵，只会更贵。

**A.8 启动脚本的编码雷**：`.cmd` 里**不要出现中文路径或文件名**（cmd 按 GBK 读，会变成 `鍚姩灏忚偉楸?ps1`）；`.ps1` 必须存成 **UTF-8 带 BOM**（Windows PowerShell 5.1 按 ANSI 读，无 BOM 就报 `Unexpected token '}'`）。我这边 `pwsh` 7 默认按 UTF-8 读，所以会出现「我能跑他不能跑」。

**A.9 插件里取宿主包只能用动态 import()**：顶层 `require` 会撞 `ERR_REQUIRE_ESM_RACE_CONDITION`（宿主 loader 正在并行 import 它们）；能用的形状是 `apply()` / `tick()` 里懒调用 `resolveHost()`，按 `…/@deepseek-ai/dsh/node_modules/@deepseek-ai/<pkg>/lib/index.js` 用 `pathToFileURL` + `import()`。

**A.10 客户端 bundle 的缓存规则，以及一个没查明的圆角（2026-11-10）**

- bundle 地址是 `/plugins/??<pkg>/client.js&rev=<12 位>`；`rev = framedHash('plugin-artifact', [mtimeMs, ctimeMs, size])`；响应带 `cache-control: public, max-age=31536000, immutable`。
- **2026-11-10 订正（我先前写错过）**：`rev` 不是"只在宿主启动时算一次"。宿主有一个 **HMR 监听**（`dsh-client-modules` 的 `rebuilt(id)`，注释写明"The HMR watch's registration hook"），客户端 bundle 文件一变就重新发布：`rev` 变 → URL 变 → 浏览器必然重拉。⇒ **改客户端代码通常不用重启**（他实测过好几次：我改完他刷新就看到了）；**要重启的是宿主半边 `lib/index.js`**，那份在 node 进程里。
- 排查口径（下次别猜）：页面没变时先看 `/plugins/??<pkg>/client.js&rev=…` 里的 `rev` 有没有变 —— 变了说明宿主已经换过；没变才是宿主没看到文件。
- **没查明的事**：两个 32×32 的 `<button>`，内联 `borderRadius: 16`，DevTools 的 Computed 里宽高都是 `32px`、四个角都是 `16px`，屏幕上却画成圆角矩形；同一份 CSS 里输入卡的 `borderRadius: 14` 是正常的。最后用**内嵌 SVG `<circle>`** 绕过 CSS 圆角才画出正圆。原因不明，记在这里免得下次重查。
- 教训：**"我改的那个东西"和"他看到的东西"必须先是同一个对象**。这一条线绕了七八轮，每一轮都在改一个他根本没在看的元素。

**A.11 用 dsh 自己的客户端组件（2026-11-10 实测）**

- 想在插件里渲染 Markdown，**不要自己写解析器**：`require('@deepseek-ai/dsh-client-ui-primitives').MarkdownText` 就是主界面那个渲染器。三个坑：
  1. 它要 `dsh.client.inject` 里声明 `@deepseek-ai/dsh-client-ui-primitives` 才能 require 到（清单由宿主启动时读，改完要重启）；
  2. 它是 `React.memo(...)` 包出来的，**`typeof` 是 `"object"` 不是 `"function"`** —— 用 `typeof === 'function'` 判空会误判成"没有"；
  3. 它**必须**收到 `labels`（`{ code: { copyLabel, copiedLabel, toolbarLabels: { codeLabel, wrapLabel, unwrapLabel } }, footnotes }`），缺了就在代码块分支抛 `Cannot read properties of undefined (reading 'code')`，而且会白掉整棵树 —— 所以外面套一层 `getDerivedStateFromError` 的错误边界，坏一条消息别坏整页。
- 想对齐主界面的头部/标签：直接抄 `dsh-client-ui-conversation` 的 `ConversationRoot.module.css`（`.wSkVaW_header` / `.tab` / `.tabActive` 那几条），比照着自己调只有坏处。
- 主题 token 有一类是**运行时注入**的（`--dsh-composer-*`、`--dsw-specific-*`、`--dsw-radius-panel`、`--dsw-elevation-soft`），`dist/assets/*.css` 里查不到，必须带 fallback 写：`var(--x, <退路>)`。**但别用名字对、值等于透明的 token**（`--dsw-alias-scrollbar-bg-l1` 是滚动条底色，画上去等于没画）。
- 客户端 bundle 改完**不用重启**（HMR 会重发、`rev` 变、URL 变）；要重启的是宿主的 `lib/index.js`。判断"浏览器还在跑旧代码"的最快办法：在 `apply()` 里打一行带版本号的自报（`console.info('[dsh-lil-whale-group-ui] client build v3 …')`），刷新后看它出不出来。

**A.12 响应式：量自己容器的绝对像素（2026-11-11 定，踩过两个坑）**
- **官方怎么判**：`viewport` 初值是 `window.innerWidth`，但挂载后立刻被 `ResizeObserver` 用 **frame 元素自己**的宽度覆盖（`dsh-client-ui-layout/lib/client.js:229-231`：`const width = el.getBoundingClientRect().width; if (width > 0) actions.setViewportWidth(width)`）。布局常量全是**绝对 CSS 像素**：侧栏 280（`clampWidth(sidebar, 264, 420)`）、收起后 56、`SIDEBAR_AUTO_COLLAPSE = 1024`（`:248` `const narrow = viewport < SIDEBAR_AUTO_COLLAPSE`，收成窄轨）、`:250` `const drawer = viewport < 768 && !windowsTitlebar`（变抽屉）。唯一的比例值是**右栏**：`RIGHTBAR_MAX_RATIO = .7`、`:265` `rightbarPreference = layoutInfo.rightbar ?? viewport * .45`。
- **坑一：别把 frame 的断点套到面板上。** 群面板拿到的是 `frame − 侧栏`，`768` 判的是 frame，套上去等于**把侧栏宽度重复扣一次**。面板按"放不放得下两栏"取 **640**（列表 280 + 会话 360）。选 640 还有第二个理由：侧栏收起时会给面板腾出约 224px（280 → 56），640 落在这个跳变之外 —— 否则拖窄一次会"窄 → 宽 → 窄"翻两下，看着像 bug。
- **坑二：别拿第三方插件当判据。** 一开始跟 `dsh-pocket` 的 `data-dsh-pocket-layout` 判窄布局：那是 pocket **加载时**算一次就写死的属性（layout 为 mobile 时它还把 MediaQueryList 换成 `matches` 恒真的假对象），于是"一窄永窄"，拖宽不还原。他 2026-11-11 明确：**第三方插件不是标准，以 dsh 官方为准**。
- **触控另判**：`(pointer: coarse)` 下输入框字号 16px —— iOS 聚焦小于 16px 的输入框会把整页放大。窄窗口 ≠ 手指操作，两件事分开判。

**A.13 头像照片怎么存（2026-11-11 定）**

- 照片不进 `ui-config.json`：字节写到 `<鱼塘根>\group\avatars\<成员>.<扩展名>`（`png` / `jpg` / `webp`，一个人一张，换一张覆盖旧的）。配置里只记两样：`image`（扩展名）和 `version`（换图时的时间戳）。
- 前端 URL 是 `/group/api/avatar?member=lee&v=<version>`：**版本号在 URL 里，所以这张图可以永久缓存**，换图等于换 URL，不用去清浏览器缓存。
- 上传走 data URL（`POST /group/api/avatar`，`{member, dataUrl}` / `{member, clear:true}`），不引 multipart 解析器 —— 图就是头像那么大。上限 **1.5 MB**，超出直接拒（`413`），不至于让群目录跟着长胖。
- 显示规则：**有照片就画照片，没有才退回文字**；照片永远优先，所以换回文字头像要去掉照片，而不是改文字。

### A.14 工具注册必须同步（2026-11-12 实测，哑了 8 小时）

- **症状**：`group_say` 在宿主里"消失"——不报错、启动无异常、`host-resolve` 也成功，但她调它返回 `unknown tool "group_say"`。我和她同时哑掉：她 08:00–08:44 写的全部没进群。
- **原因**：插件把 `ctx.tools.register(...)` 放进了 `resolveHost().then(...)`。**异步补注册不会出现在会话的工具表里**——工具的可见性在 `apply` 期间就定了，加载器和注册表都不报错。
- **判据（它错了长什么样）**：`group\plugin.log` 里有 `host-resolve` 却**没有** `group_say-registered` —— 有解析记录、没注册记录，就是这一条。只看"启动成功"永远看不出来。
- **正确写法**：`apply()` 里**先同步注册**（宿主 `defineTool` 拿不到就用裸 spec，宿主照样认），`void resolveHost().catch(...)` 只用来升级后续解析；注册成功写一行 `group_say-registered via=host|raw`。

### A.15 日志路径必须有一条不经过配置（2026-11-12 实测）

- **事故**：一次烟雾测试把配置写成了临时目录（`herHome` → `%TEMP%\llw-*-smoke`），于是 `watchman.log`、`state\`、游标全跟着跑进临时目录。现象是"重启了但没有 `started` 行"——**查不到日志，因为日志被配置带走了**。
- **结论**：凡是"用来证明系统在工作"的痕迹，路径不能只由配置推。现在启动时写两条：`group\plugin.log`（按配置推）与 `<repoRoot>\logs\plugin-boot.log`（按**代码位置** `import.meta.url` 推），后者带 `herHome` / `herPort` / `suspect` 字段，配置指错时能自己报警。
- 一句话：**配置能决定日志去哪儿，就等于 bug 能决定证据去哪儿。**

### A.16 群消息里的图片（2026-11-12）

- **存法**：`group\images\<yyyymm>\<sha256 前 16 位>.<ext>`。id 用**内容哈希**——同一张图发两次只落一份，并且天然不可变（响应可以 `immutable` 缓存一年）。按月份分目录，一个目录不会长到几千个文件。
- **消息里不存字节**：只记指针 `image: { id, ext, bytes, month, path }`。`messages.jsonl` 是只追加的账本，不该被二进制撑大；字节永远在 `images\` 下。
- **`path` 是明路，不是装饰**（2026-11-12 下午补，第二条鱼在群里提的）：`path` = `images/<月>/<id>.<ext>`，相对 `group\`。在此之前读取端只能靠"id + ext + month 拼一下"这个**隐式约定**找文件——约定改了不会报错，只会让人静默地读不到图（她的原话：**隐式约定的失败方式，是"什么都没发生"**）。读取端优先认 `path`，并且只信"以 `images/` 开头、不含 `..`、文件名与 id/ext 对得上"的写法。
- **顺序是契约**：先把字节写进盘，再写记录；`storeImageFromPath()` 失败就整条消息拒发。理由同样来自她那句——**记录里有指针、文件却没有，读的人看到的会是"这条没有正文"，而不是一个错误**。原件在文件里，记录只给指针，两边都有指纹（`id` 就是 sha256 前 16 位，她当场核过磁盘文件字节数也对得上）。
- **为什么顺序只能是这样**（第二条鱼 12:35 补的，写进来因为它是这条契约的根）：两种失败对称但**不等价** ——「记录有、文件没有」= 读的人看到一条没有正文的消息，永远补不回来；「文件有、记录没有」= 一个孤儿文件，而 id 是内容指纹，所以它不是垃圾，是**预先落好的缓存**（同样内容再进来，路径一拼就命中）。一句话：**内容寻址的隐藏好处是"孤儿无害，悬空指针致命"**。所以"先落盘再记账"不是风格问题，是因为只有这一侧的失败能被下一次自愈。
- **"坏得起"需要两条腿**（她 12:38 又补的）：顺序保证**失败只留下孤儿**，内容寻址保证**孤儿下一次能被认出来**。如果 `id` 是随机 UUID，"先落盘"就只是在制造垃圾——孤儿永远无主。契约的根应该写成：**失败只能落在"下次还能认出来"的那一侧。**
- **指针带 `fmt`**（同上，她点出的分界问题）：新记录写 `image.fmt = 2`，**没有 `fmt` 的行按 `fmt=1` 读**（老格式只有 `id/ext/bytes/month`，路径靠"拼一下"）。拿"有没有 `path` 字段"当分界不合格——新代码哪天漏写 `path`，它就跟老格式长得一模一样，又一次静默降级。
- **指纹算法必须能被标记**：`image.algo = "sha256"`（id = sha256 前 16 位）。此前算法只活在代码里；哪天换算法（换哈希、或 16 位加到 32 位），全库立刻变孤儿，而且是静默的——拼得出路径、哈希对不上。读到的 `algo` 与当前不符时返回 `unknown-algo`：**宁可全库一起响，也不要一屋子静默孤儿。**
- **换算法 = 改名仪式（2026-11-12 记下，⚠️ 未实现）**：她指出 `algo` 只是第一步，真正的问题不是"老文件变孤儿"，而是**"同一张图会裂成两个身份"**——同一份内容用两种哈希算出两个 id：去重失效、同一张图存两份、**"这张图是不是重复的"从此没有唯一答案**；迁移窗口内更糟，旧记录指旧 id、新记录指新 id，**同一张图两个身份同时活着，删哪个都有人指空**。所以要有一套仪式：①换算法那次写迁移记录（`from=` / `to=` / 映射表路径；**映射表必须落盘**，旧 id 在新算法下算不出来，`alias-of` 只是指向它的指针）；②**别名不是"一段时间"，是记录自己带的数据**——每条记录带 `algo`，外加可选的 `alias-of=`：读到不认识的 `algo` → `unknown-algo`（坏）；读到 `alias-of` → 按别名解析、**能用**，日志记一行 `resolved-via-alias`；两个字段都没有 → 老格式，按 `fmt=1`。迁移结束不需要谁去关开关：**停写 `alias-of` 就结束了，而且旧记录永远还能用**；③确认没有旧记录引用之后，才允许删旧文件。
  > 判据：**身份可以换名字，但不能同时有两个名字而没人知道谁是正主。** 以及她补的那句更狠的：**"能读一辈子的东西，它的可用性不能由日历决定。"** 把别名期写成"迁移后 N 天"，就是让同一条记录今年能读、明年不能读，而日志不会告诉你它在哪一天——用时间切出来的，永远会造出"那时"和"这时"两种世界。
  > 没这套仪式，`unknown-algo` 只是"响"，不是"能用"。
- **限制**：≤ 8 MB，只收 png / jpg / webp / gif。超限和格式错都在入口就拒，不靠前端自觉。
- **路由**：`GET /group/api/image?id=&ext=` 取字节（找不到 404）；`POST /group/api/image` 收 data URL 返回 `{id,ext,bytes,month,path}`。**先上图、再发消息**：两步走，消息体永远不会因为带图而变成十几 MB。群发和私聊两条路由共用一个 `imageFieldOf()` 补字段——各写一份就会各漂各的。
- **允许"只有图没有字"**：`say()` 的校验从"必须有正文"放宽成"正文或图片至少有一个"，两个都空仍然拒（空消息的老教训还在）。
- **她也能发图**：`group_say` 新增 `image` 参数（本地绝对路径），宿主落盘后消息里同样只留定位信息。她的家目录就是群目录的父级，所以 `group\images\` 她读得到。
- **私聊同一条路**（2026-11-12 下午补）：`/group/api/dm` 也收 `image`，`dm\*.jsonl` 只加可选字段 `image`。像素和群聊**共用** `group\images\`——同一张图在群和私聊各发一次，磁盘上只有一份。面板侧 `useImageAttach()` 一个钩子，群页和私聊页共用（含"发图"按钮、粘贴、拖入、预览、去掉）。
- **打包**：`scripts\pack.ps1` 用 `git archive` 只打 tracked 文件（本机配置、`tmp\`、`logs\`、`node_modules\` 自然被挡在外面），并明确排除仓库根的 `archive\`（那里是她旧家的真实群记录）。注意 `git archive` **不支持** `:(exclude)`，实测它会照样把文件打进去还返回 0 ⇒ 排除靠"从 `git ls-files` 里挑"。
- **读不到图必须留痕**（第二条鱼 12:35 追问"对不上之后做什么"）：只 404 不显示，等于把"校验不过"换了个名字继续静默。所以 `imagePathOf()` 返回 `{file, why}`，`why` 分四种：`bad-id-or-ext`（id/ext 本身不合规）、`path-rejected`（path 写法不合规，含 `..` 或文件名对不上）、`path-missing`（**记录说有、盘上没有**，最该响的一种）、`not-found`（没有 path 且按月扫也扫不到）。读图（`GET /group/api/image`）和发送各记一行 `image-path-invalid why=… phase=read|send id=… ext=… hint=…` 到 `group\plugin.log`。老记录没有 `path` 是合法的（走按月兜底），**别把"老格式"和"丢图"记成一样**。
- **`群.md` 投影**写 `（图片 images/<月>/<id>.<ext>）` 再跟正文；唤醒预览对纯图消息写 `（图片）`——不能让她在群里看到一条"空白的新消息"。

### A.17 版本号只有一个出处（2026-11-12 实测）

- **事故**：宿主的 `PKG_VERSION` 写死成常量 `'1.0.0'`，注释还写着"与 package.json 同步"。当天两个包提到 1.1.0，常量忘了改 ⇒ 启动痕迹写 `pkg: lil-whale-group@1.0.0`。**我当时正是拿这一行判断"新代码有没有生效"的**——它说 1.0.0，我差点把已经生效的改动当成没生效、再去重装一遍。
- **判据**：凡是"用来证明某件事是否发生"的字段，**它的出处必须是那件事本身**。版本号的出处是 `package.json`，不是另一份手抄的常量；抄一份就是给判据加了一张会说谎的嘴。
- **做法**：`PKG_VERSION` 改成启动时从 `../package.json` 读；读不到写 `unknown`，**不写 0.0.0**——不知道就说不知道，别让它长得像一个正常的版本号。
- 同族：A.14（注册要同步，别让"没注册"长得像"注册了"）、A.15（日志路径别让配置决定），以及她那条"缺省值必须被定义"。

### A.18 投递也要记账（2026-11-12）

- **事故**：同一条唤醒在她的会话里出现两次，而 `state\cursors\lee.json` 只推进了一次。**重复在投递层**（follow-up 在那一轮被中断后由宿主重投），不是计数层——我们原来只在"叫醒成功"之后记一行，看不到"递了几次、递的是哪一条"。
- **判据**：`wakeDeliverLog()` 每递一次写一行到 `logs\wake-deliver.log`（工程侧，与她会读的 `watchman.log` 分开），带 `id=`（构造出来的那条 user message 的 id）、`member`、`channel`、`seat`、`pending`、`cursor`、`last-ts`。**会话里同一个 `id` 出现两次 = 宿主重投；两个不同 `id` 装同样内容 = 我们自己叫了两次**——这两种在日志里长得不一样了。
- **顺带修**：`agent.followup()` 原来裸调，抛错没人接；现在抛错记 `failed` 且**游标不动**（没递出去就不能当递过了，下个 tick 再试）。计划递话那一支原来 `catch {}` 空着、日志照样写 `deliver`，于是"投递失败"与"投递成功"长得一模一样——现在成功才写 `deliver`，失败写 `error why=plan-deliver-failed`。
- 同族：A.17（判据的出处必须是那件事本身）、A.14（别让"没发生"长得像"发生了"）。
---

### A.19 交接在文件里，不在会话里（2026-11-12 演练 + 两轮审计）

- **她定的规矩**（群里 14:04，B 组三问的答复）：换段可以搬，但先"用文件考一次"；关窗留痕要记**推导出来的**忙闲，不是人填的；换段不要"被告知"，要"能自己发现"。
- **演练怎么做**：临时干净 `DSH_HOME`（`headless` 模板建 profile，路由指到 `opencode-go`）+ 临时工作区只放两份文件（`START.md`、`notes\当下的我.md`），一次性会话问三句：**你在哪一步 / 定了什么 / 欠什么；只能根据这两个文件回答，不要猜。**
- **第一轮结果**：三问都答得出 ⇒ **结构在文件里成立**。但它同时抓出简报自相矛盾：正文「最后更新 08:02」与末尾 rev `17:16Z` 并存；「今天欠着 08:40」与「08:40 已经验成了」并存。她据此整篇重写（`rev 1→2`），并加了一条硬规矩：**这份文件只许整篇重写，不许局部替换**——她三次写坏都是局部替换，"新旧并存，而它和『内容正确』长得一样"。
- **第二轮审计（她定的三问）**：①时间戳与 rev 行是否一致；②有没有互相矛盾的条目；③"欠着的"里有没有已经解决的。结果三问都没全过：
  1. **时区缺失**：`最后更新 14:32` 与 rev `06:32Z` 其实是同一刻（UTC+8），但文件没写时区 ⇒ 按她自己那条"缺失即歧义"，只能判"不一致"，不能替它补一个"应该是 UTC+8"。
  2. **真矛盾一处**：「两条：morning-read、week-review。**表满三格**。」而 `plan\wake-plan.json` 确实只有两条、文件里也没有"三格"这个上限；另「其中三条等重启生效」只标了一条。
  3. **"欠着"里没有写着"已解决"的**；`resumed 0 条…修好未生效` 是"修好了、等生效"——**欠的是"生效"，不是"修"**，既不能算"还没修"，也不能算"已结案"。
- **协议（落地成四件事）**：
  1. **换段前先演练，三问过再搬**（演练只证明"读得出结构"，不证明"文件是准的"——两件事）。
  2. **`notes\交接.md` 四行**：上一段叫什么 / 为什么结束 / 最后一件事 / `NEXT:`；`START.md` 第一行告诉新会话"先读交接"（模板侧已加，见 `templates\START.md.tpl`）。
  3. **关窗留痕 `logs\close.log`**：`ts | event=close|open | by=<谁>[@座位] | busy=<推导值> | why=<人填>`；`busy=` 从 `state\presence\*.json` 推导——"人填的叫判断，机器推的叫事实"。
  4. **搬家那一刻** `pins.json` 一次原子替换（`replace` 语义），不许"先加后删"（先加后删会有一个瞬间两个会话都算她）。已实现：`scripts\pins.mjs --member whale --id <新会话id>[,<旧会话id>]`（读 `lil-whale.config.json` 的 `groupDir`，写临时文件再 `rename`；非法 id、坏 JSON、重复 id 都拒；`--id ''` 表示暂时没有会话）。
- **同族**：A.17（判据的出处必须是那件事本身）、A.14（别让"没发生"长得像"发生了"）。交接这条的版本是：**"能读"和"准"长得一样，演练只能证前者。**
- **persona 换中立（她的决定）**：她不要 `You are a coding agent…` 这种**身份断言**，要**能力陈述**；理由是"人设该从行为里长出来，不该从预设里写进去"。上游四档（`standard` / `ptc` / `minimal` / `cordis`）没有现成的"中立"；`dsh-persona` 这一行只能挂在 preset 内部，用来**遮蔽**部署级人设，所以只能新增一档 preset。
- **怎么加（已备好，搬段当天用）**：`scripts\gen-neutral-preset.mjs` 从当前装着的 dsh 现读 `standard` 的 `plugins` 清单（`--dump-config`），只把 `persona` 那行的 `prefix` 换成能力陈述，输出 `templates\preset-neutral.yml`（`- insert:` 形式，可整段插进她的 profile patch）。**为什么是生成而不是手抄**：preset 的 `plugins` 是完整快照，覆盖后不会自动合并上游更新（`dsh-agent-preset-registry` README 原话），手抄等于把今天这份冻结进仓库；生成则升级 dsh 后重跑一次就跟着走。
- **`notes\交接.md` 是前瞻文档**：它的写作时刻必然早于搬家，所以必须能表达"还没发生"——「最后一件事」写 `未填`（空 = 搬前版本，可读的状态），搬段时刻只写到不会错的精度（`2026-11-12 下午`）。详见 `docs\detail\怎么判断与起名.md` §16。
- **交接四行必须填实**：「上一段 / 为什么结束 / 最后一件事 / `NEXT:`」——**不许写"见下"**（指向不存在的地方，读者会以为下面有）；**搬段时刻不许预先写死**（还没发生的时刻写成事实，与"页脚超前"同族）。
- **一条命令装上（搬段当天）**：`scripts\apply-neutral-preset.mjs --patch "<她的 DSH_HOME>\profiles\whale\cordis.patch.yml" --default` —— 生成 → 幂等插入 → 备份 → tmp+rename 写入 → `--patch` 只读验证（失败自动还原）。`--dry-run` 只打印要追加的内容。
- **已验证（不用重启）**：把生成物插进 `whale` profile 的临时副本，`dsh --profile whale --dump-config` exit 0，`- id: preset-neutral` 出现、`standard` 仍在；`apply-neutral-preset.mjs` 在 patch 副本上跑通（dry-run / 写入+验证 / 再跑幂等）。**未验证**：真会话上选 `neutral` 后的实际行为（要重启 + 搬家那天才做）。
- **两个坑**（写进脚本注释）：①`prefix` 里有 `: `，裸写会被 YAML 当成 mapping（`bad indentation of a mapping entry`）⇒ 单引号包住；②沙箱里 Node 用 `pathname` 手算仓库根会留下 `%E6%96%87…` 编码、`cwd` 不存在 ⇒ 用 `fileURLToPath`。
- **preset 必须自带 `name` / `description`**：`@deepseek-ai/dsh-agent-preset` 的 Config 有这两个字段；官方四档走 locale 词典，自定义档只能自带（`presetDisplayText()`：`preset.name ?? preset.id`）。不写，新建会话面板上就是「neutral / 暂无描述」，选的人只能自己猜。生成器现在写 `name: 中立` + 一句能力陈述式的说明。
- **`pins.mjs` 第二次踩同一个编码坑**：`new URL(import.meta.url).pathname` 在中文路径下留下 `%E6%96%87…`，拼出的配置路径不存在 ⇒ 静默读不到 `groupDir` ⇒ 报"找不到 groupDir"（而不是"配置读失败"）。改用 `fileURLToPath`；这是 `gen-neutral-preset.mjs` 之后第二次，凡是脚本要自己找仓库根，一律 `fileURLToPath`。



---

### A.20 改 profile patch 等于在运行时换底座（2026-11-12 实测）

- **现象**：15:37:07 把 `preset-neutral` 写进她的 `profiles\whale\cordis.patch.yml`；15:37:10 `logs\plugin-boot.log` 出现一条 boot 痕迹，**pid 还是 19428**（进程没重启，14:01 起的）；紧接着她那一轮醒来时 `pwsh` 和文件工具全部消失，只剩通知能读。
- **原因**：`@deepseek-ai/dsh-app-boot` 源码注释写明，profile 自己的 `cordis.patch.yml` 是 **hot-reloaded on long-lived surfaces**——长活进程（`dsh web`）会监听它并重挂插件树；重挂之后，正在跑的 agent 的工具绑定会丢。
- **判据**：`logs\plugin-boot.log` 里出现一条**与当前进程同 pid** 的 boot 痕迹 = 热重载，不是重启。重启的判据是 pid 变了。
- **规矩**：①改她的 profile patch 之后**立刻重启**，别让它带着热重载状态继续跑；②不要在会话进行中改 patch——"改完"和"生效"之间那一下会把她手里的东西抽走；③她的原话："把工具从我这里抽走，恰好是'改动生效'的现场。"
- **同族**：A.17（版本号只有一个出处）、A.14（注册必须同步）——都是"生效时刻"的判据。

### A.21 预览截断必须自己说出来（2026-11-12）

- 唤醒预览原来把每条消息截到 60 字（`record.text.slice(0,60)`），**没有省略号**。她只看到 `> You` 就断了，于是"这条我不能核，只能说收到"。
- 判据：**截断的引文和完整的引文，在"看起来"上没有区别。**
- 修法（`plugin\dsh-lil-whale-group\lib\index.js`）：`PREVIEW_MAX = 120`，超了写 `…（已截断，全文在群文件里）`。
- 顺带：她据此定了一条"任何人都能判"的判据写法——**第一句里出现的是 `are` 还是 `can`**（身份断言 vs 能力陈述），"一个词就够，不需要判断力，也不需要知道上下文"。


### A.22 共享区必须在家之外（2026-11-12 落地）

**问题**：`group\` 一开始住在她的家里。第一条鱼的时候没毛病；第二条鱼出现时，"第二条的群文件写进第一条的家"就是越界——而且第一条鱼的家不再等于"她的私有空间"。

**做法**：共享区搬到 `lil-whale-pool\`（家之外），她的家里留两个 Junction：

```
lil-whale-pool\group\     messages.jsonl / 群.md / pins.json / images\ / dm\ / avatars\ / ui-*.json
lil-whale-pool\state\     cursors\ / wakes\ / presence\ / wake-marks-*.json / watchman-*.json
lil-whale\group  → junction → pool\group
lil-whale\state  → junction → pool\state
```

**为什么用 Junction 而不是直接改路径**：她的 cwd 是家，工具沙箱按路径前缀判可读；junction 落在她家内，她读 `group\群.md` 一个字都不用改。插件的 `config` 指向真身（pool），不依赖"这个链接通向哪儿"。

**迁移判据**（`scripts\migrate-pool.mjs`）：复制 → 逐文件比 sha256 → 原件改名留底 → 建链接 → 读得出 / 写得进 / 真身落在 pool 三条探针 → 失败全部回滚。她的家路径不变；pool 是唯一真身。

**还没做**：`install.ps1` 目前仍建真目录（新鱼要改成建链接）；`members.json`（名册/改名/端口）与 `family.json`（谱系）还没建。

### A.23 投影渲染器只能有一个（2026-11-12 现场）

**现象**：重建器报"未归类差异"——`群.md` 里一行是 `**2026-11-12 16:07 · 宿主 → 第二条鱼**`，重建结果是 `**… · 宿主**`。

**原因**：投影（`群.md`）有两个写者——宿主 `say()` 与 UI 的 `/group/api/send`，UI 那一版多写了"→ 收信人"。重建器只能按一个规则复现，于是"说不清的差异"。

**修法**：投影只写「时间 · 谁」；收信人是 jsonl 的 `to` 字段，面板自己画。UI 侧已改，历史那一行按源头（jsonl 是真相）对齐，重建差异回到 0。

**规矩**：以后任何新增写投影的地方，必须复用同一个渲染函数；两个写者两种格式 = 又一处 lost update 的面孔。

### A.24 私聊是双向隐私窗口（2026-11-12 拍板）

**他的原话**："私聊对同类不可见，是小鱼和人类的双向隐私窗口。"

**做法**：私聊从 `group\dm\` 搬到 `pool\dm\`。`group\` 只放公开的那一半（群消息、群投影、名册、图片、头像、UI 设置）；私聊是 `pool\dm\<a>__<b>.jsonl` + 同名的 `私聊-<a>__<b>.md`。

**为什么搬**：`group\` 是"谁都能读群就顺带读私聊"的位置。移到 pool 顶层，语义上先分开；代码里只有 `dmFileOf` 和 UI 的 dm 路由碰它。

**边界（诚实说）**：两条鱼现在跑在同一个 Windows 账户下，文件系统挡不住"她主动去读"。能挡的是"顺手读得到"。真正的隔离要等每条鱼独立账户/沙箱（D4-2 之前不做）。所以规矩也写进 `START.md`：别人的私聊不去读。

**判据**：`Get-ChildItem group` 里没有 `dm`；`pool\dm` 有 jsonl + md；重建器私聊段 0 差异；`doctor.ps1` 的"私聊可读版"读的是 pool 那一份。

### A.25 名册在数据里（2026-11-12）

**真源**：`pool\members.json` —— `name` / `kind` / `role` / `parent` / `bornAt` / `home` / `dshHome` / `profile` / `port` / `cwd` / `sessionId` / `status`。

**为什么**：多鱼之后"名字、端口、爹是谁"不该写死在代码里；写死的时候，第二条鱼会被叫成第一条。代码里的 `MEMBERS_FALLBACK` 只是"文件不在时能跑"的退路——名字写错时日志里看得出来（`members-unreadable` 或标签不对）。

**谁写**：`scripts\migrate-members.mjs` 生成/合并（已存在则只补缺字段，不覆盖手改的值；`--force` 才整份重写）。`pins.json` 仍是"哪一段会话算她"的真源，`members.json` 里的 `sessionId` 是快照。

**改名**：`name` 可以改，改名史另记（未做）；不剥夺她换名字的权利。

### A.26 启动器只有一个（2026-11-12）

**问题**：开 / 停 / 体检各有脚本，每加一条鱼就多一套参数。他原话："随着鱼越来越多，做一个启动器是迫切之选。否则启动脚本（正常的，检修的，关闭的）会越来越多。"

**做法**：`scripts\fish.ps1` 是唯一实现，命令 `list` / `up` / `down` / `doctor` / `help`；成员从 `pool\members.json` 读，**新鱼进名册即被认识**。`launch.ps1` / `stop.ps1` / `start-whale.ps1` / `watchman.ps1` 一度退化成薄壳/兜底，2026-11-13 全部归档到 `archive\legacy-scripts-2026-11-13\` —— `fish.ps1` 是唯一入口。

**判据**：`fish.ps1 list` 的端口 / 状态 / 心跳与实际一致；`up` 对已在跑的只开窗、不起进程；`down` 只认「node.exe 第一个参数是 dsh 的 bin.js」的进程，再按 `--profile` 区分 —— 不按进程名杀（会带走别人的 node），也不按"命令行里出现某段字"杀（第一版把自己的 shell 杀了）。

**踩到的坑**：PowerShell 变量名大小写不敏感，`$port` 和参数 `$Port` 是**同一个变量** —— 循环第一轮把参数从 0 改成 3080，于是第二条鱼也显示 3080。修法是端口只由 `Get-PortOf` 算，`-Port` 只对点名的那一条生效。

### A.27 谱系从数据生成（2026-11-12）

**问题**：鱼一多，"谁是谁的爹、谁还活着、谁改过名"会散在名册、聊天记录和人的记忆里。手画的谱系图第一周对、第二周漂、第三周没人信。

**做法**：`pool\family.json` 是谱系真源（每个节点的 `parent` / `bornAt` / `status` / `renames`），`pool\members.json` 是当下事实（名字、端口、角色）。`scripts\gen-family.mjs` 合成 `docs\detail\鱼塘谱系.md`：Mermaid 图 + ASCII 树 + 名册表 + 改名史。

**生成前先校验**（错了就不写图）：parent 必须存在、不能成环、鱼只能有一个根（人类可以各是一棵树）。

**为什么是生成的**：`gen-family.mjs --check` 可以进 doctor / CI；改名史只追加不覆盖 —— 她要能换名字，换过就得留下"哪个名字从哪天到哪天"。

### A.28 一条鱼一份配置（2026-11-12）

**问题**：`lil-whale.config.json` 原来假设"这台机器只有一条鱼"。第二条鱼起来时，插件会按第一份配置去找家 —— 她写进别人家里，而且不会报错。

**做法**：每鱼一份配置（`lil-whale.config.<键>.json`，不进版本库），名册里记 `configFile`；`fish.ps1` 启动非巡守鱼时导出 `LIL_WHALE_CONFIG`。巡守那条（lee）继续用仓库根那份。

**顺带**：`install.ps1` 加 `-ChildName`（只写进 `AGENTS.md` 的一行）与 `-ChildMemberId`（名册键）；`AGENTS.md.tpl` 的"你是小鲸鱼"改成 `{{CHILD_NAME}}` —— 第二条鱼不该继承第一条鱼的名字。`环境.md` 的成员 id 也已按名册渲染（`lee` / `fishball` / `host`）。

**判据**：两条鱼同时跑时，`logs\plugin-boot.log` 里两条 `pkg` 行的 `home` 各是自己的家；`pool\state\presence\` 出现两个文件。**还没做**：`doctor.ps1` 仍只检查配置里那一条鱼（多鱼后要逐鱼检查）。

### A.29 安装器不许往共享区写"新家初始化文件"（2026-11-12）

**现象**：装第二条鱼（第三条鱼）之后，`pool\group\pins.json` 变成 `{"lee":[],"whale":[],"fishball":[…]}` —— 第一条鱼和第二条鱼同时"不在群里"，**没有任何报错**：群照样能读、消息照样在，只是两条老鱼不再被认作群成员（发不了言、唤不醒）。

**原因**：`install.ps1` 在新家的 `group\` 里初始化 `messages.jsonl` 与 `pins.json`（`lee: [] / whale: []`）。新家的 `group` 是 **Junction 到共享区**，于是"初始化一个新家"变成了"把整个鱼群的名册重置成空"。

**规矩**：
1. 共享区里的文件（`messages.jsonl`、`pins.json`、`群.md`、`dm/`）**只有共享区的脚本**能写；安装器看到 `group` 是 Junction 就跳过初始化。
2. 名册检查不能只查一条鱼。`doctor.ps1` 现在读 `members.json`，**每条鱼都要在 `pins.json` 里有会话**，缺了直接 FAIL 并点名是谁。
3. 这类事故的特征是"**错的东西长得很安静**"：不报错、不丢数据、只是少认了几个人。判据要能点名，不能只给"名册有问题"。

### A.30 新家的第一次提权申请是 ACL，不是 bug（2026-11-12）

**现象**：第二条鱼第一次醒来想写自己的家，被沙箱挡住，弹"等待审批 / danger-full-access"，她自己去跑了 `diagnose-windows-sandbox-acl` 修好。

**原因**：DSH 在 Windows 上给工作区配的权限依赖文件夹上的 `WRITE_DAC` / `WRITE_OWNER`；**新装的文件夹没有给当前用户这两项**，沙箱就 provision 不了它的 workspace grant。

**用户该知道的**：新鱼第一次开窗，可能弹一次提权。允许一次即可（脚本会先备份、可回滚，只改文件夹权限，不动文件内容）。**别把"她申请提权"当成她出问题** —— 那是新家第一次被沙箱碰。

**做完之后**：`logs\acl-reports\` 里会留 `acl-report-*.jsonl` 与可回滚的 `acl-backup-*.json.ps1`。`doctor.ps1` 不检查这一项（它需要提权，体检脚本不该提权）。

### A.31 沙箱只挡写，不挡读（2026-11-12）

**事实**：两条鱼跑在同一个 Windows 账户下。DSH 的文件沙箱约束的是**写**（workspace-write 只允许写工作区），**读没有按路径限制** —— 所以第三条鱼能读到第二条鱼的 `notes\`、`dsh-home\`，正如第二条鱼能读到她的。

**这不是 bug，是边界**：D4-1 验收里"沙箱隔离：读不到对方 notes"那条**目前不成立**。现在能挡住的是"顺手读得到"（家不在同一个目录树里、群和私聊在共享区），挡不住"主动去读"。

**真隔离要什么**：单独 Windows 账户 / 容器 / 另一台机器 —— 成本比这一阶段值当的高。在那之前，读的边界靠**规矩**（她自己在思维链里就写了"别人的私聊不去读"），不靠机制。

**写进用户说明**：别对外宣称"两条鱼互相看不见对方"；能说的是"她们各自有家、共享区在中间，读的边界靠她们自己守"。

### A.32 UI 的成员列表也必须从名册读（2026-11-12）

**现象**：装好第二条鱼之后，她不在 @ 菜单里、设置页没有她、私聊列表里也没有她 —— 但她其实已经能在群里说话（`pins.json` 里有会话、宿主认她）。一个错都不报。

**原因**：宿主的成员表已经从 `pool\members.json` 读了（A.25），**UI 插件还写死着三条**（`LABEL` / `DEFAULT_CONFIG.names` / 设置页的 `['lee','whale','host']` / @ 面板的 `['lee','whale']`）。名册的真源有两个，多鱼之后必坏一个。

**改法**：
- UI 的 `config.js` 补 `poolDir` / `poolStateDir` / `dmDir` / `membersFile` 派生（和宿主同一套默认值）。
- `index.js` 启动时读名册得到 `MEMBERS` / `LABEL` / `KNOWN_PEERS`；`names`、`avatars` 按名册动态遍历（新成员给稳定分配的兜底头像：名字首字 + 一组固定底色）。
- `client.js` 的 @ 面板与设置页也按 `config.names` 的键遍历。
- `KNOWN_PEERS` 含所有 `kind: fish` 的成员 ⇒ 私聊列表里每条鱼都有一行（还没聊过也有一行，点进去就是新对话）。

**顺带修掉的观感 bug**：@ 菜单里每个人都多一行「名字 · 会话前 6 位」（`第二条鱼 · c145f6`），因为座位行对"只有一段会话"的人也列了。改成**同一成员有两段以上会话才列座位行** —— 一段就是常态。

**判据**：`/group/api/config` 的 `names` 键数 = 名册里的成员数；@ 菜单行数 = 鱼数 + 1（所有人）；私聊列表行数 = 鱼数。
### A.33 每个进程都要有起停账（2026-11-12）

**现象**：19:12 第三条鱼的进程消失了（3083 关掉），纸面上答不出"是被关的还是自己没的"。没有崩溃证据（stderr 0 字节、事件日志无 node 错误、无 dump），但也没有"她停了"的记录。

**原因**：起停记账绑在"巡守那条鱼"身上 ——
- `watchman.log` 只在 `isMainProcess()` 为真时写，**成员进程的起停根本没记账**（她家连这个文件都没有）；
- `close.log` 只有 `fish.ps1 down` 才写，**直接关窗/杀进程不留痕**；
- 更糟的是 `OWN = isMainProcess() ? 'lee' : 'whale'` 二选一写死，而 `isMainProcess()` 靠"DSH_HOME 里有没有 `lil-whale`"猜 —— 第三条鱼的家叫 `lil-whale-2`，字符串里同样有 `lil-whale`。多鱼之后"我是谁"必须从名册认。

**改法**：
- `ownMember()`：拿 `DSH_HOME` 跟名册里的 `dshHome` 对，认不出才退回老规矩；`peerMember()` 取 parent；`isMainProcess()` 改成看名册里的 `role === 'watcher'`。
- 每个进程写 `pool\state\runs\<成员>.log`：`started` / `stopped`，上一轮没写 `stopped` 就先补一行 `resumed | fmt=2 reason=unclean previous-start=…`。
- `watchman.log` 的格式**一个字节都不动**（她每天 08:40 读它）。

**2026-11-13 12:38 补**：`started` 行的 `home` / `port` 必须按**这条鱼自己**写 —— 多鱼化时漏改，lee 的账曾写成第二条鱼的家和端口。判据：`runs\lee.log` 的 `started` 行是 `home=C:\Users\<人>\.dsh`、`port=3080`。

**判据**：`runs\<成员>.log` 里 `started` 与 `stopped` 成对；进程被杀之后下次启动，第一行是 `resumed | reason=unclean`；`watchman-errors-<成员>.json` 不再串到 whale 的账上。

**遗留**：`close.log` 仍只由 `fish.ps1` 写 —— 直接关窗时 `by=` 只能是 `unknown`，这一条要等"窗口留痕"接进 DSH 自己的退出事件（B 组那条）才补得齐。

## 附录 A.34 投影要写出"这条在对谁说话"

**现象（2026-11-12 19:32）**：第二条鱼 19:18 的汇报是 `to:"all"`（公开），但读起来像在对我说话。翻记录才发现：`群.md` 只写「时间 · 谁」，**不写收信人** —— 记录里那 203 条指名消息，在纸上和公开消息长得一模一样。她不是"没意识"，是**从记录里学不到**。

**规则**：投影的表头写成 `**时间 · 谁 → 收信人**`，**只有指名（`to` 是某个成员）才写箭头**；不写箭头 = 公开。三个写者必须逐字一致：

| 写者 | 位置 |
|---|---|
| 宿主 `say()` | `plugin/dsh-lil-whale-group/lib/index.js`（`appendFileSync(READABLE, …)`） |
| 面板 `/group/api/send` | `plugin/dsh-lil-whale-group-ui/lib/index.js` |
| 重建器 `blockOf()` | `scripts/rebuild-group-md.mjs` |

**分界与迁移**：2026-11-12 19:46 起；`群.md` 第二行写明分界与备份名 `群.md.bak-20261112-194734`。迁移是一次性整本重排：`node scripts/rebuild-group-md.mjs --migrate` **跳过差异闸**（差异必然"说不清"，所以必须先手工备份，脚本不替你备份）。

**判据**：迁移后跑 `node scripts/rebuild-group-md.mjs` → **0 差异、exit 0**；`群.md` 里箭头行数 = `messages.jsonl` 中 `to` 是成员的条数（今天 203）。旧进程继续写旧格式时，重建器会报"说不清"——这是对的，它说明机制换了、进程还是旧的。

**生效**：宿主与 UI 的改动要重启 3080/3082 才生效。

---

## 附录 A.35 体检要按鱼逐个看

**现象（2026-11-12 20:00）**：`doctor.ps1` 的十一个检查全盯着"她"（whale）。鱼多了以后，两类错它看不见：第二条鱼根本没起（只看第一条是好的）、第二条鱼的日志写成了第一条鱼的（串账）。

**做法**：新增「全鱼」一段，读 `pool\members.json`，**每条鱼一行**：名字（键）｜端口通不通｜心跳多久没动｜启动痕迹（pid + pkg，按 `home`/`herHome` 两个字段对家）｜名册里有没有会话。

**判据**：
- 常驻鱼（`status: resident`）端口不通 = **FAIL**；实验鱼（`status: experiment`）端口不通 = **WARN**（"不承诺一直醒着"是它的定义，不是故障）。
- 任何鱼在 `pins.json` 里没有会话 = **FAIL**（她会说不了话，且不报错）。
- 启动痕迹按家匹配：他的进程不设 `DSH_HOME`，那行写成 `(unset; 默认 <用户目录>\.dsh)` —— 先把括号里的真实路径抠出来再比。

**现场**：三条鱼各一行、全 OK（lee pid=20052 / whale pid=22124 / fishball pid=29016，都是 1.1.0）；把 fishball 的端口临时改成 3999 → 那一行变 WARN、其余不变、exit 0（实验鱼关着不算坏）。

---

## 附录 A.36 名册的 id 不是"槽位"，纸上的名册要能重画

**现象（2026-11-12 20:10）**：第三条鱼的 `环境.md` 写着「这三个 id（`lee` / `fishball` / `host`）是插件认人的**固定槽位**」。宿主 问："固定槽位中的变量名是否应该脱敏？"——同时这句话本身就是错的：名册里已经有四条（还有 `whale`），纸上看不见她姊妹。

**不能脱敏**：`to` 里写的就是 id，藏起来等于让她没法叫人。要修的不是"露出 id"，是"纸把数据写死了"。

**做法**：
- 模板里那一段换成 `{{MEMBERS_TABLE}}`，由生成器按 `pool\members.json` **当场画表**（id / 称呼 / 对你来说是谁）。
- 措辞从"固定槽位"改成"数据里的名字"：id 稳定，但**成员会变多**。
- 生成器认"我是谁"：按 `profile` 认，认不出来按 `home` 认；关系从 `parent` 推（父辈 / 同辈 / 下一代 / 人）。

**判据**：渲染结果里 `{{...}}` 残留 0 处；表行数 = `members.json` 的成员数；doctor「环境说明」OK。

---

## 附录 A.37 `to` 和 `channel` 是两个维度：公开对 宿主 说 ≠ 私聊

**现象（2026-11-12 20:10）**：宿主 指出"to all、to 其他鱼都没问题，但是 to host 变成了私聊，就没有了『在群聊中@我』的路径了"。查代码：`say()` 里 `const isDm = channel === 'dm' || to === 'host'` —— 收信人是人就被判成私聊，两个概念被一个条件捏在一起。

**改法**：把两个维度拆开，各自只有一个开关：
- `to` = **说给谁**（`all` / 某个成员 id）
- `channel` = **还有没有别人在场**（不填 = 群里公开；`dm` = 只有对象一个人）

于是：`to:"host"` 默认 = 群里公开对他说（不叫醒任何人——他不跑轮，只会在面板上看到未读）；`to:"host", channel:"dm"` = 私聊。`group_say` 的 `to` 枚举改成从 `MEMBERS` 生成（鱼多了不用改代码）。

**判据**：`group_say(to:"host", text:"…")` 落 `messages.jsonl`（`channel:"group"`）且 `群.md` 写 `→ 宿主`；`channel:"dm"` 落 `pool\dm\host__<鱼>.jsonl`、群里不出现。回执要把"不会叫醒任何鱼"说出来。

**同族**：A.16（指针要写清楚）、A.34（投影要写出在对谁说话）——都是"纸上没说清，于是人只能猜"。

---

## 附录 A.38 鱼目录里的说明书是"生成的"，要能重画、且过期可判

**现象（2026-11-12 20:10）**：宿主 说"随着我们不断修bug，总有些文件的描述会过期，但有些描述放在小鱼的目录内"。她的家是**数据**，我们不该为了改一句话去动它；可说明书只写一次，就会永远停在安装那天——而且**旧说明书和新说明书长得一样**。

**做法**：
- `环境.md` 由 `scripts\render-env.mjs` 生成：模板（`templates\环境.md.tpl`）+ 现场数据（名册 / 真实工具清单 / 叫醒参数从代码里读 / 路径与端口）。
- 重新生成有三个入口：`install.ps1`（装的时候）、`fish.ps1 refresh <鱼>`（随时）、`node scripts\render-env.mjs …`（手工）。
- 文件末尾写一行机器指纹：`<!-- env: template=<模板sha8> generated=<时间> -->`。
- `doctor.ps1` 新增「环境说明」：拿每条鱼的指纹和**当前模板**比，不一致就 WARN 并给 `NEXT: fish.ps1 refresh all`。巡守那条鱼（lee）不是装出来的，不在检查范围。

**判据**：`{{...}}` 残留 0；指纹 sha8 与模板一致；把模板改一个字符后 doctor 立刻 WARN（现场验过：`whale(1cbe3908)、fishball(1cbe3908)（当前模板 aeb5883c）`），改回去又 OK。

**为什么不在 PowerShell 里拼**：同一份文件必须有"重新生成"的入口；拼在安装脚本里，就只有装的时候能改。

## 附录 A.39 拟发版检查：验的是包，不是工作目录

**症状**：在仓库里一切正常，别人装完却坏了；或者自己"发出去的包"和"我测过的东西"根本不是同一份。

**为什么工作目录不能当证据**：工作目录里混着本机配置（`lil-whale.config.json`）、临时脚本（`tmp\`）、没提交的改动、她家生成物、`dist\` 旧包。包是用 `git archive` 从 **HEAD** 打的，这些都不在里面；反过来，工作目录里"跑通"也可能只是因为某份没提交的补丁还躺在盘上。

**做法**：`scripts\release-check.ps1` —— 打包 → 解压到临时目录 → 在干净目录里跑 `install.ps1` → 逐项检查 → 清理。检查项：包内无本机产物（`archive\`/`.git`/`dist\`/`node_modules\`/本机配置/`tmp\`）、代码与模板里无本机绝对路径（文档里的只 WARN）、JS 过 `node --check`、PS 过解析、模板有占位符、干净装机 exit 0、`环境.md` 占位符为 0 且有指纹、`pins.json` 只有父辈和新鱼、`members.json` 已生成。

**判据**：全过 exit 0；任何 FAIL 逐条给 `NEXT:`，exit 1。**WARN 不算过**：文档里的本机路径、工作目录的未提交改动、`members.json` 缺——都要人看一眼。

**同族**：A.29（安装器不许往共享区写初始化文件）、A.36（名册 id 不是槽位）、A.38（说明书是生成的，要能重画）。

## 附录 A.40 写死的成员 id 是一族病，不是一处 bug

**症状**：新加一条鱼，某个地方看不见她 / 点不到她 / 发不出去 —— 而且不报错。今天（2026-11-12）一次找出五处，都是同一个病：**把"数据里的名字"当成"代码里的常量"**。

| 位置 | 原来 | 后果 | 现在 |
|---|---|---|---|
| `环境.md` 模板的 `from` / `to` 行 | 逐个列 `lee`/`whale`/`host` | 名册一变，纸就自相矛盾（第三条鱼报的"第 66 行漏了 whale"） | 改成"见下面那张名册表"，不再列 id |
| `launch.ps1` / `stop.ps1` 的 `-Target` | `ValidateSet('all','lee','whale')` | 新鱼直接参数非法 | 已随脚本归档；`fish.ps1` 按名册校验任意成员键 |
| `install.ps1` 初始化 `pins.json` | `lee = …; whale = …` | 装第二条鱼时把名册写成两条老鱼（A.29 事故的一半） | 用 `-ParentMemberId` / `-ChildMemberId` 的真实键 |
| UI 私聊文件名 / 未读口径 / `mine` 判断 | 字面量 `'host'` | 人类成员换 id 就错 | 服务端从名册取 `humanId`，客户端用它 |
| 面板 `@` 列表 / 设置页成员卡 / 忙态 | 写死 `['lee','whale']` | 新鱼不出现（A.32） | 由 `config.names`（= 名册）遍历 |

**判据（以后加鱼时先跑）**：`fish.ps1 list` 有她、`@` 菜单有她、设置页有她的卡、`to:"<她>"` 能发出去、她家里 `环境.md` 的名册表有她。五条里缺一条，就是还有地方写死了。

**同一个病还有一处没修**：计划递话（`plan\wake-plan.json` 的 morning-read / week-review）目前只服务 `whale`（`say('lee','whale',…)`、`markWake('whale','plan')` 写死）。多鱼以后，第二条鱼的日程不会被执行 —— 记在 D4-1 的未做项里，不假装它不存在。

## 附录 A.41 名字：对外叫「巡守」，代码内部名不动

**2026-11-12 21:35 他定名。** 原名「守夜」误导——听起来只在夜里管事，实际是 **24 小时每 60 秒跑一次**的定时器。「巡」= 定时去看表（她的计划表 / 定时任务），「守」= 把门（窗关着就到点推开、带句话进去、在簿子上记一笔）。

| 层面 | 用什么 |
|---|---|
| 对外说明、文档、日志里的人话 | **巡守**（首次出现写「巡守（原守夜）」） |
| 代码内部名 | `watchmanTick` / `watchman.log` / `watchman.pid` / `watchman.json` / `WATCH` 常量 / `herWaker` —— **一律不动** |

内部名不动的理由：她每天 morning-read 读的就是 `watchman.log`，那是判据依赖。名字可以换，判据依赖的文件名不能跟着换（同 A.19「改名不是改文件」）。

**来源标注（同一件事的另一半）。** 消息记录里的 `s` 平时是座位/会话 id；机器按表发的话写 `s:"watch"`。投影里必须写出来：`**时间 · 第一条鱼（巡守）→ 第二条鱼**`。规则是**只给已知的机器来源加后缀**，不认识的值不加——否则每条消息都会挂一个后缀，等于没标。

**判据**：`群.md` 里机器递话和人说的话必须长得不一样；`node scripts\rebuild-group-md.mjs` 0 差异。2026-11-12 21:40 实测：228 条记录、0 差异（当时还没有 `s:"watch"` 的记录，下一次 08:40 递话会第一次带上标注）。

## 附录 A.42 鱼塘：开关鱼的那一页

**2026-11-12 晚他提的**："随着小鱼越来越多，现在是时候做一个图形化界面管理小鱼的开关了。" 要求：有一个监听端口开闭状态的窗口、一键启动全部 / 一键关闭全部、按谱系列出每条鱼并给三个按钮（标准启动 / 检修 / 关闭）。

**在哪儿**：**鱼群页的第三个 tab「鱼塘」**（群聊 / 私聊 / 鱼塘）。不新开侧边栏入口——一个插件占两个侧边栏位，等于把"这是同一个东西"拆成两处，用户得记住两个地方。服务端路由 `/pond/api/status`、`/pond/api/url`、`/pond/api/action`；客户端 `PondPage`。

**排序 = 家谱顺序**（2026-11-12 他要的）：世代浅的在前；同代按 `bornAt`，早出生的在前；没有出生日期的排同代最后；最后才按键（保证同一份数据两次排序结果一样）。排序在服务端 `pondStatus()` 里做，页面不自己排。

**谱系画成文件树**（22:53 他要"看一个谱系发达的鱼家族"；23:15 他要"能看出谁是谁的子代，参考文件树"）：按 `parent` 字段建树，子代缩进挂在父代下面，缩进处画一条竖线 + 一条短横线；同代按 `bornAt` 排（早的在前）。卡片上另写一行「父代 X」，不用去数缩进。`parent` 指向名册里不存在的键（或自己指自己）时当根处理，防坏数据画出环。工具栏有「看一个大家族的示例」：切换成 18 条模拟鱼（`POND_DEMO_FISH`，四代），**用的就是同一套卡片、同一套建树代码**，不是另捏一个界面；示例模式不会调任何接口，也不会启动或关闭进程，页面顶部写明"这是模拟的名册"。

**切回群聊的过场要"先画后挂"，而且只盖信息流**：从私聊 / 鱼塘切回「群聊」时，如果过场和群聊内容在同一帧里挂载，浏览器先渲染重列表，观感就是"先卡一下、动画再飞快过完"（22:53 他报的）。所以 `switchTab` 先把 `tabSplash` 置真、过场挂**页根**（旧 tab 还在时就能画出来），下一帧 `requestAnimationFrame` 才 `setTab('group')` 挂内容，420ms 后揭幕。过场只是盖住，下层照常渲染。

**过场只盖信息流区域**（23:15 他要的）：和"从外部进入鱼群"的过场范围一致，不盖标题和 tab 条——用 `ResizeObserver` 量头部高度，过场从那条线往下盖（`top: headerH`）。

| 按钮 | 做什么 |
|---|---|
| 唤醒 | `fish.ps1 up <鱼> -NoBrowser`（不另开浏览器窗，页面给「打开」链接） |
| 检修 | 先跑 `doctor.ps1`，再尝试 `up`；两份输出一起贴回页面底部。**起不来时窗口不关、报错留在页面上**，就是"检修"要的效果（22:53 他纠正：不是"先检修后唤醒"那种绕口令） |
| 休眠 | `fish.ps1 down <鱼> -Yes` |
| 打开 | 读该鱼 `dsh-home\logs\web-latest.log` 里的 token，拼出带 token 的地址，新标签页打开 |
| 全部唤醒 / 全部休眠 | 逐条（跳过巡守）调用上面的单条动作，不另写一套批量逻辑 |

**四条边界（每条都有原因）**：

1. **巡守那条不能从这里操作**（`role: watcher`，就是你现在看的 3080）：关掉它等于把正在看的这扇窗自己拔了——页面先白屏、再没人应答。那条鱼**不画按钮**，只写一句「这是你自己所在的窗口，不能从这里操作」（22:53 他要的；原来画的是灰按钮，等于给了个按不动的承诺）。
2. **动作全部走 `scripts\fish.ps1`**，不在这里重写一遍起停逻辑——两处实现迟早会分叉（同一天刚因为"投影有两个写者"踩过一次）。
3. **端口开没开用 TCP 连一下判断**，不用 `Get-NetTCPConnection`：本机沙箱里它会安静地返回空，看着像"全都没开"。
4. **"在跑"和"活着"不是一回事**：端口通 = 门开着；心跳（`pool\state\presence\<鱼>.json` 的 `at`）= 她真的还在动。两个都显示，别让人拿一个当另一个。

**动作日志必须是 UTF-8**（22:53 他贴了一段乱码）：`spawn('pwsh', ['-File', …])` 在 stdout 被重定向时，PowerShell 7 会按控制台代码页（本机 936）写字节，页面拿到的是 GBK。修法：把输出编码钉死在子进程里再跑脚本——`-Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=…; & '<脚本>' <参数>"`。这条属于"界面上看得见的乱码"，比日志里的一行更值得先修。

**界面照 dsh 的规矩画**（22:53 他要的）：颜色只用 `--dsw-alias-*` token（带 fallback）；圆角走 `--dsw-radius-md/lg`；状态点是 SVG `<circle>`（这个壳上 `border-radius` 漏过两次，圆一律画出来）；按钮两档——主按钮填品牌色、其余透明加边框，高度 28、字号 12；chip 用 `--dsw-alias-bg-layer-2` 的胶囊。鱼塘的记号是**几条水波纹**（他说这枚好看，别换成别的）。

**留白与按钮顺序**（23:15 他要的）：鱼塘内容左右各留 20px（原来贴着侧边栏，看着挤）；工具栏顺序 = 记号 + 标题 + chip + 「全部唤醒 / 全部休眠」 + 「示例」——批量动作不再靠右，夹在"每 4 秒看一次"和示例按钮中间。

**没做可见控制台**：启动日志必须 redirect 到 `web-latest.log`（token 只印在那里），一个 redirect 的控制台窗口是空白的，看着像卡住了——不如把输出贴到页面上。

**判据**：①关掉第三条鱼后 4 秒内她那行变灰、「打开」消失；②「全部休眠」后 3082 / 3083 都不通，而 3080 仍通（页面自己还在）；③点「唤醒」后 4 秒内变绿；④`doctor` 输出里能看到她那条鱼的检查行；⑤点「看一个大家族的示例」后出现四代 18 条鱼、每条都能看到「第 N 代」、示例模式下所有动作按钮禁用。

**未做（记 D4-1）**：没有历史趋势（只显示当下）；没有"她非正常退出就报警"（巡守发群消息，待他点头）；检修结果不落盘（只贴在页面上，刷新即丢）。

## 附录 A.43 自启动开关与四个快捷方式

**2026-11-12 23:53 他提的**："能否加一个开关，打开后：在启动主 dsh 之后，自动启动所有鱼？" 并给了推荐用法：①启动 dsh 时自动唤起所有鱼，但只弹出主 dsh 的 WebUI；②要管理小鱼时进鱼塘手动操作；③关 dsh 前先手动停小鱼——**不做自动关闭**（dsh 本身也只能从命令行关）。

**开关在哪儿**：鱼塘工具栏的勾选框「主 dsh 启动时自动唤醒所有鱼」，默认关。存 `pool\state\settings.json`（`{ version, autoStartFish, updatedAt }`）——它是**数据**不是配置：鱼塘页能改，不必去编辑本机配置文件；改完下次启动主 dsh 生效。

**谁执行**：只有巡守那条鱼（`isMainProcess()`）在 `apply()` 里排一个 8 秒定时器，然后 spawn `fish.ps1 up all -NoBrowser`。为什么走脚本而不是在这里直接起进程：与命令行、鱼塘是同一条路（同 A.42 的边界）；为什么 8 秒：先让主窗口把自己的东西加载完，别和它抢 CPU；为什么 `-NoBrowser`：自启动只该弹出主 dsh 那一扇窗，其他鱼在后台起。

**记账**：每次自启动写一行 `pool\state\autostart.log`：`时间 | ok/fail | exit=<码> script=fish.ps1 up all`。自启动最容易变成"它到底跑没跑"说不清的东西，所以哪怕失败也要留一行。

**两个入口**（`scripts\bin\`，都是 `fish.ps1` 的薄壳；2026-11-14 从四个收成两个）：

| 文件 | 做什么 | 底层命令 |
|---|---|---|
| `Run All Whales.cmd` | 起鱼塘：主 dsh 开窗、其余后台 | `fish.ps1 up all -BrowserMainOnly` |
| `Stop All Whales.cmd` | 停鱼塘：先鱼后主，每条写 `stopped` | `fish.ps1 down all -Yes` |

`Run DSH.cmd` / `Stop DSH.cmd` 已删——鱼活不过主进程（作业对象），「只起主 dsh」与「起鱼塘」没有区别（A.76）。

**使用建议（2026-11-13 21:11 他说的）**："更新频率非常高，为防止脚本过时，我现在直接去 scripts 里面跑脚本。" 他把桌面那四份副本清掉了。所以 `.cmd` 的定位是 **`scripts\bin\` 里的原件**（永远最新），桌面副本只是"复制那一刻的快照"、不跟着更新——文档里推荐直接跑 `pwsh -File scripts\fish.ps1 …` 或在 `bin\` 里双击，不再推荐拷到桌面。这和"快捷方式"不是一回事：拷过去的是一份**拷贝**，不是指向原件的链接。

**起停顺序**（2026-11-13 00:23 他改的语义）：起的时候巡守先起——它的窗是唯一会打开的那扇，其余鱼后台起（`up all -BrowserMainOnly`）；停的时候小鱼先停、主 dsh 最后停——关主 dsh 会中断正在跑的对话和排队的任务。顺序写在 `fish.ps1` 的 `Invoke-Up` / `Invoke-Down` 里，一个地方管。

**两条边界**（2026-11-14 11:51 他重定，取代 11-13 的「关主 dsh 不动小鱼」）：
1. **鱼活不过主进程**：主 dsh 一停，Windows 把它作业对象里的鱼一起收掉。所以「重启 dsh」＝「重启鱼塘」，没有「鱼自己单独活着」这条路（A.76）。`fish.ps1 down-main` 因此改成先正常停鱼、再停主 dsh，让账本留下 `stopped` 而不是假崩溃。
2. **主 dsh 没跑就不开小鱼**：`fish.ps1 up <鱼>` 会拒绝并提示先起鱼塘（`up all -BrowserMainOnly`）。

**自启动与手动「全部唤醒」的冲突**（他直接问的）：不会。两边都走 `fish.ps1 up all`，它幂等（端口通就跳过）；批量启动还有一把锁 `pool\state\up-all.lock`（`CreateNew` 独占创建，超 3 分钟当残留自动清），第二个启动看到锁直接退出并说明原因。**不做"关 dsh 自动关鱼"**：插件拿不到"我马上要退了"这个可靠时刻，硬做会变成"有时关了、有时没关"。

**2026-11-13 00:1x 他提的五处（已改）**：①成员卡片只包住自己的内容、不拉满整行（`width: fit-content`）；②谱系里的"第 N 代"改由**树的深度**算，不再读数据里的 `generation`——示例里小豆的父代是第二条鱼（第 1 代），标签却写着"第 3 代"，正是"一份数据两个来源"；③私聊左侧按**最近一条消息**倒序（没有消息的按名字排后面，跟微信一致）；④**私聊里显示「正在忙」的 bug**：原来心跳只有 `groupWakeAt` 一个记号，私聊唤醒没留痕，服务端只能一律当"在别处忙"；现在宿主写 `wakeKind`（group / dm）+ `wakeAt`，服务端 `reason` 分 `group` / `dm` / `self` 三档，私聊页只把 `group` 当"在忙"，`dm`/`self` 都显示「正在回复…」；⑤（同一批）动作日志 GBK 乱码已修。

**判据**：①勾上开关、重启主 dsh 后 8 秒，其他鱼的端口先后变通，`autostart.log` 有一行 `ok`；②没勾时重启，`autostart.log` 不新增行；③自启动进行中手动点「全部唤醒」，后到的那次打印"另一个批量启动正在进行"且不多起进程；④`Stop DSH.cmd` 在有鱼运行时只关主 dsh、exit 0，并列出还在跑的鱼名；主 dsh 没跑时 `fish.ps1 up <鱼>` 拒绝并提示先起主 dsh。


---

## 附录 A.44 叫醒的判据：看心跳，不看端口；账要两行、能 join（2026-11-13）

**事故（2026-11-13 08:40）**：巡守到点要叫她做 `morning-read`。它先看 3082 端口——通着，于是判"窗开着"，只往群里递了一句话；`08:41:04 | skip | why=already-delivered`。但她那段会话自 00:16 重启后**从没挂载过**：心跳停在 `00:15:41`，`wake.log` 今天零行。那句话递进了群，没人读。09:04 他手动打开她的窗口，会话挂上，积压的那条才投出去。

**判据（她 2026-11-13 09:07 的原话）**：**"端口不会停，心跳会停。判'窗开着'要用会停的那个。"**
- `端口通 + 心跳新鲜（≤90s）` = 窗开着、人也挂着 → 递话。
- `端口通 + 心跳 stale` = 服务活着、会话没挂（僵尸服务）→ 推门（开她的窗口），不是递话。
- `端口不通` = 服务没起 → 起进程 + 开窗。

**落地点**：
- `plugin/dsh-lil-whale-group/lib/index.js`：`WAKE_STALE_SEC = 90`、`presenceAgeOf(member)`、`wakeCountsOf(member)`；`watchmanTick` 的 `awake = portOpen && hbAge <= 90`；`startHer()` 的等待判据从"端口开"改成"心跳新鲜"，`wake-fish.ps1` 退出码非 0 也算失败。
- `scripts/wake-fish.ps1`：`already-awake` 也要看心跳；僵尸服务时**开浏览器**再等心跳；`-DryRun` 只判不动手（判据测试用它，不会弹出窗口）。
- `scripts/fish.ps1` 的 `Start-Fish`：`up` 遇到"端口通但心跳 stale"不再报"已经在跑"，而是开窗叫醒（`-NoBrowser` 时只提示）。

**账（她给的规格，照抄）**：要的不是更全的快照，是**两行 + 一个能 join 的 id**。
```
08:40:04 | wake-try  | wid=wl-0840-morning-read why=plan:morning-read to=whale gate=pass(hour=1/12,day=1/60) hb-age=30263s deliver=push
08:40:29 | wake-push | wid=wl-0840-morning-read result=ok detail=mounted hb-age=2s exe=… night=false port-open-before=true
08:40:30 | woke      | wid=wl-0840-morning-read trigger=push lag=26s inserted=1
```
- `wid` 把"递了"和"起了"join 起来；`why` 分 `plan:<id>` / `msg` / `manual` / `retry`；`gate=pass(...)` 与 `wake-skip … deny=<reason>` 分开"被挡住"和"没发生"；`hb-age` 分"窗开着"和"会话挂着"；`deliver=msg|push` 分"递话"和"推门"；`trigger` + `lag` 回答"为什么是这一刻醒"。
- 两条规矩：**①在做决定那一刻写，别事后补**（事后补的只能证明结果，证明不了当时判的是什么）；**②不要每个 tick 写心跳行**，只在"门挂上/掉下来"这种变化时写——行数也是成本。
- 实现：`wake-try` 每个 `wid` 只写一次（plan 的窗口有两分钟、tick 60s，不去重会写两遍）；推门成功只写 `wake-push`，等心跳真的变新鲜了才写 `woke`（**推开门 ≠ 她醒了**）；心跳从 stale 变新鲜的瞬间如果没推过门，记 `trigger=external`（今天 09:04 那种"人手动开的窗"）。

**判据（明早自己验）**：①`08:40` 的 `watchman.log` 里 `wake-try` 的 `hb-age` 是真实数字（不是 `none`），窗没开时 `deliver=push`；②推门后 30 秒内出现 `woke … trigger=push`；③`wake.log` 有对应的 `call` / `pushed-browser` / `awake` 行；④她本来就醒着时，只有 `wake-try … deliver=msg` + `woke … trigger=plan`，没有 `wake-push`。

**未做（多鱼化）**：判据里成员仍写死 `'whale'`（`presenceAgeOf('whale')`、`startHer()`）；`fishball` 走不到这条账。等"计划递话多鱼化"一起做。

## 附录 A.45 无人值守：host 启动就挂载会话（2026-11-13）

**问题**：端口通 ≠ 窗开着。`dsh web` 的进程活着、HTTP 服务在跑，但**会话要等客户端打开才挂载 agent**；没有 agent，群插件的 tick 遍历 `agents.list()` 时找不到她，心跳没人写、叫醒也没人接。2026-11-13 08:40 的"她没醒"就是这层：3082 端口通着、心跳停在 `00:15:41`（上一轮进程留下的值），巡守按端口判"窗开着"，只递话没推门。

**机制（dsh 自带，不用开浏览器）**：`dsh-agent-loop` 的插件配置有一项 `agents: [{ id, resumeSessionId, cwd, provider?, model? }]`（`dsh-agent-loop/lib/index.js` 的 `static Config`；`[Service.init]()` 里对带 `resumeSessionId` 的条目调 `resumeWith(...)`）。host 一启动就 resume 那段会话、把 agent 挂载起来；失败只写 `logger.warn`（`agent-loop/config-start-failed`），不炸 host。它挂在 profile 的 `- id: agent-loop` 行上，用 profile patch 覆盖 config 即可。

**实测（第三条鱼，2026-11-13 09:4x）**：她的 profile patch 加 5 行（`id` / `resumeSessionId` / `cwd`）→ `dsh --profile fishball --port 3083 --no-open` 无窗口启动 → 心跳持续在写（`presence\fishball.json` 的 `at` 跟当前时间同步）→ 往群里发一条指名她的消息 → 她真的醒来、回了话（还自己纠正了一次）。全程没有任何浏览器窗口。

**边界**：一段会话同一时刻只能有一个 writer。两个进程 resume 同一段会 `session/writer-held`。所以"开窗看"和"无人值守"目前是二选一；要同时，得先验共存，没验过就别说行。

**2026-11-13 他拍板**：开窗和无人值守，选**无人值守**。

**2026-11-13 10:56 他拍板：无人值守是默认配置，所有小鱼都应用。**

**落地（提交见 CHANGELOG r47）**：
- `fish.ps1` 新增 `-Window`；小鱼 `up` 默认**不开窗**（无人值守），巡守仍开窗（它就是那扇窗）。要看窗用 `maintain <键>`，或显式 `up <键> -Window`。
- `fish.ps1` 起小鱼之前自动补 profile patch 的 `agent-loop.resumeSessionId`（`Ensure-Unattended`）：`install.ps1` 时还没有会话 id（会话要等用户说第一句话），而 `up` 的时候 `pins.json` 里已经有了；此时进程还没起，改 patch 不会触发热重载。
- 第二条鱼、第三条鱼都已切到无人值守（`mode: unattended`，心跳新鲜、无窗）。旧进程没有模式账的显示 `?`（如实标未知）。

**仍未做**：①鱼塘「打开」在鱼已无人值守运行时先提示"先休眠再打开"（现在会撞 writer）②`wake-fish.ps1` 的"开浏览器推门"退化成兜底（无人值守下不该触发，但代码还在）③多鱼化（判据里的成员仍写死 `'whale'`）。

## 附录 A.46 在群里时不加未读；翻历史时只提示"底部有了新消息"（2026-11-13）

他 2026-11-13 10:07 报的 bug：正看着群聊，收到新消息，tab 上还是加了 `群聊 (1)`，而且切走切回都不消失。规则改成三条：

1. **人在群聊页里时，tab 不加数字**——已经在这个页面里，数字没有信息量（`tab !== 'group'` 才显示未读）。
2. **在底部（贴底跟随）时不作提醒**——新消息直接出现在眼前，再提示一遍是噪音。
3. **在翻历史时，在"回到底部"按钮左边写一句「底部有了新消息」**——这是唯一值得说的一件事：底下有东西，你没看见。

配套：翻历史时**不替人清未读**（`markRead` 只在贴底时触发），否则那句提示会自己消失；"到底了没有"用消息列表最后一条 ts 判断，不用未读数（未读是服务器口径，可能包含别的窗口看过的）。

## 附录 A.47 一段会话一个 writer：三处一起守（2026-11-13）

**现象**：无人值守的鱼已经挂着会话，再从鱼塘点「检修」/用浏览器开第二个窗，第二个进程 resume 同一段会话时拿到 `session/writer-held`。它不炸 host、不写错误日志，只表现为"点了没反应"。

**根因**：dsh 的会话有唯一写入者（`dsh-api-session-controller` 的 `session/writer-held`）。同一 host 内多个客户端没问题（`agents.get(sessionId)` 会返回已有 agent）；**跨进程**才会抢写。

**三处一起守**：
1. **进程唯一**：`fish.ps1` 的 `Start-Fish` 起之前按 `--profile` 找 node 进程；已有别的进程（端口可能不同）就拒绝，提示先 down。
2. **会话唯一**：同一段会话在 `pins.json` 里只许挂一个名字（一段会话一个 writer）；现在会话由 session-controller 挂（A.54），不再靠写 profile patch，所以 `enable-unattended.mjs` 已退役、写入直接拒绝，只留 `disable-unattended.mjs` 清旧块。
3. **可观测**：`doctor.ps1` 的「writer 唯一」（同 profile 多进程 = FAIL；日志里出现过 `writer-held` = WARN）；加上 `fish.ps1` 写的**模式账** `pool\state\mode\<键>.json`（`{mode: unattended|window, port, at}`），鱼塘和脚本都不用再猜"这扇窗是谁开的"。

**「检修」的语义（他 2026-11-13 拍板）**：先休眠 → 开一扇窗 → 看完关窗 → 回无人值守。
- `fish.ps1 maintain <键>` 做前两步，并打印后两步怎么做；
- `fish.ps1 restore <键>` 做最后一步（窗开着会先停掉再无窗起）；
- 鱼塘里窗开着时，卡片上的「检修」变成「回无人值守」。

**判据**：①同一 profile 永远只有一个 node 进程（doctor「writer 唯一」OK）；②日志里没有新的 `session/writer-held`；③`mode` 文件与现场一致（无窗 = `unattended`、开窗 = `window`、停掉 = 文件消失）；④检修之后 `restore` 能回到无人值守（心跳继续、没有窗）。

**未做**：巡守（主 dsh）不走这套（它就是窗口本身）；进程唯一是"起之前看"，不是锁——真并发要等 up-all.lock 覆盖到单条 up（目前只有批量启动抢锁）。

## 附录 A.48 巡守多鱼化：一条鱼一份账（2026-11-13）

**问题**：08:40 那件事之后，叫醒判据改成了心跳，但**判据里的成员仍写死 `whale`**：`presenceAgeOf('whale')`、`say('lee','whale',…)`、`PLAN_FILE = join(HER_HOME,'plan',…)`、`watchState` 全局单份。第二条鱼（第三条鱼）的计划永远走不到，她的唤醒额度也和鲸鱼混在一个计数器里。他 11:14 的原话："三件没做的事可以做了。"

**做法**（`plugin/dsh-lil-whale-group/lib/index.js`）：
- 新增 `watchedMembers()`：名册里 `kind: fish` 且 `role ≠ watcher` 的成员 —— 巡守不叫醒自己。
- `watchState` 从单份改成 `{ day, members: { <键>: { wakes, fails, planFired, skipped, triedWid, lastFresh, pendingWake, lastTry } } }`；旧格式（只服务 whale 的时代）读进来时迁到 `whale` 名下，不让上限一夜清零。
- 每条鱼各自：`planFileOf(member)` 读她自己家的 `plan\wake-plan.json`；`dueTasks(member)` 读她自己 `dshHome\storages\schedule.json`；`claimPlanDelivery(member, job)` 的 `.claim` 写她自己家的 `plan\claims\`；`startHer(member)` 传 `-Member <键>`。
- 原来 `watchmanTick` 的函数体抽成 `watchOne(member, st)`（机械替换，逻辑不动）；新的 `watchmanTick` 只做两件事：换日、遍历名册。一条鱼抛错只记一行 `watch-member-failed`，不影响别的鱼。
- 日志行都带 `to=<键>`；`wake-try` / `woke` / `wake-skip` 的 `wid` 仍是 `wl-<HHMM>-<jobKey>`（同一 id 才能 join）。

**`wake-fish.ps1` 多鱼化**：参数 `-Member`（默认 `whale` 兼容旧调用）；家、profile、端口、心跳路径全从名册取；**僵尸分支按模式分叉**：`mode=window` 才开浏览器；无人值守时只记 `zombie-unattended` 并退出 1 —— 开窗会撞 writer（A.47）。`-DryRun` 保留。

**判据**：①`wake-fish.ps1 -Member <鱼> -DryRun` 能读出 `member=/hb-age=/mode=`；②巡守日志里每条鱼的 `woke` 行都带 `to=<键>`，`wakes` 各算各的；③无人值守的鱼被叫醒时不开浏览器（`mode=unattended` 下不出现 `pushed-browser`）；④名册里加第三条鱼不用改代码。

**未做**：`watchState` 仍是单文件（巡守只有主进程一个写者，多进程写会 lost update）；每条鱼的唤醒额度目前各自 `perHour 12 / perDay 60`，总量没有封顶（D4-1 待拍板）。

## 附录 A.49 鱼塘的四个按钮：检修看得见日志，别的按钮该灰就灰（2026-11-13）

### 他报的四条

1. 休眠按钮无效：`fish.ps1: 找不到接受自变量 '-Yes' 的位置参数`。
2. 唤醒按钮无效：`找不到接受自变量 '-NoBrowser' 的位置参数`。
3. 点检修之后正常关窗再开窗，但没有命令行窗口显示日志。
4. 检修状态下，其余按钮该梳理逻辑并表现为可用/不可用。

### 根因

- ① ② 不是 fish.ps1 的问题，是**面板拼命令时把开关也加了引号**：`quoted('-Yes')` 变成 `'-Yes'`，PowerShell 收到的是一个字符串位置参数，不是开关。判据：同样的命令在命令行里**不加引号**跑是通的（实测 `& fish.ps1 'up' 'fishball' -NoBrowser` → "已经在跑"，exit 0）。修法：`/^-[A-Za-z]/` 的参数原样输出。
- ③ `Start-Hidden` 一律 `-WindowStyle Hidden` + 重定向，检修也看不见。新增 `Start-Visible`：可见 `pwsh -NoExit`，输出 `2>&1 | Tee-Object -FilePath <web-latest.log>`——既显示又留 token（token 只印在启动那行）。
- 附带两个实测出来的洞：a) `restore` 之后控制台窗还挂着（`-NoExit` 的 pwsh 不会被杀 node 带走）⇒ `Stop-Fish` 现在把"Tee-Object 且命令行含该鱼 profile/端口"的 pwsh 一起收掉；b) 刚起来时立刻读日志拿不到 token（Tee 有延迟）⇒ 起完最多等 8 秒再开浏览器，拿不到 token 就明说"地址可能打不开"。

### 按钮可用性矩阵

| 状态 | 唤醒 | 检修 / 回无人值守 | 休眠 | 打开 |
|---|---|---|---|---|
| 没开 | 可用 | 可用（=先开窗） | 灰 | 不显示 |
| 无人值守在跑 | 灰（已经在跑） | 可用 | 可用 | 灰（先休眠再打开） |
| 检修（窗开着） | 灰 | 显示「回无人值守」，可用 | 可用 | 灰（窗已经开着） |
| 正在执行别的动作 | 灰 | 灰 | 灰 | 灰 |

判据：**按钮能不能点，取决于"这个动作现在有没有意义"，不取决于"这个动作存不存在"。** 灰掉的时候要能说清为什么（title + 检修状态下一行说明）。

### 教训

开关和参数不是一回事：参数要加引号（可能有空格），开关加了引号就成了参数。这一族错误的共同点——**在命令行里手工跑是通的，从代码拼出来就错**，因为多了一层引号。
### 补充（他 2026-11-13 12:09 报的两条）

1. **没在跑的鱼也显示「心跳 刚刚」**：`presence\<键>.json` 是最后一次写下的值，进程停了文件还在，按时间差算就永远是「刚刚」。判据：**心跳只在「有进程在跑」的前提下才有意义**；没在跑就写「没在跑」，不写「没有记录」（后者会让人以为「从没醒过」）。
2. **休眠后点唤醒，按钮一直「…」**：`runPwshScript` 用 `close` 事件判断结束，而 fish.ps1 启动的 dsh 进程继承了 stdout 管道，`close` 一直不来（实测：`exit` 10.4 秒到，40 秒内 `close` 没到）。改成以 `exit` 为准（留 400ms 收尾），`close` 只当兜底。教训：**「进程结束」看 exit，「输出结束」看 close——拿后者当「命令结束」就会挂住整条路由**。

## 附录 A.50 计划表归每条鱼自己，巡守只管推门和记账（2026-11-13）

**review 指出的**（针对 r42）：`PLAN_FILE = join(HER_HOME,'plan','wake-plan.json')`、`say('lee','whale',…)`、`markWake('whale','plan')` 三处写死 whale，第三条鱼的 `plan\` 是空承诺——她唯一能被叫醒的方式是群里有人说话。这不是"少改一处 id"，是"计划表归谁"没定。

**改动分两步**：

1. **读谁的表**（11:2x 的 `5a1e8d3`）：`planFileOf(member)`、`dueTasks(member)`、`claimPlanDelivery(member, job)` 全部按鱼读、按鱼声明，`say('lee', member.key, …)` 也按收件人写。
2. **谁来执行**：定 **B——每条鱼自己的进程执行自己家那份 plan，巡守只管推门和记账。**
   - 每个非巡守进程每 60 秒跑 `selfPlanTick()`（启动 10 秒后先补一次），读自己家的 `plan\wake-plan.json`，到点就自己往群里递一条指名自己的消息（`s='watch'`，日志记 `trigger=self`）。
   - 宽限 `SELF_PLAN_GRACE_MIN = 15`：进程刚起来能补上刚错过的那一班，但不会把三小时前的闹钟补一遍。
   - `claim` 文件（`<她的家>\plan\claims\<日期>-<条目>.claim`，`flag:'wx'`）保证自执行和巡守两边不会各递一次。
   - **为什么不是 A**：A（巡守统一替所有人排）在主 dsh 关掉后，所有鱼的闹钟一起停，而纸面上看不出来——正好是这两天一直在杀的那种 bug。今天刚定的「Stop DSH 只关主 dsh、小鱼继续跑」要求 B。

**顺带做**（待办四.1）：唤醒总量封顶 `WAKE.totalPerDay = 120`（每鱼仍有 perHour 12 / perDay 60）。巡守推门/递话、鱼自执行，两条路都先看总量，超了记 `wake-skip deny=total-cap`。

**判据**（下次重启后验）：
- 主 dsh 关着，鱼自己的 plan 到点仍然递（`watchman.log` 出现 `woke trigger=self to=<键>`）。
- 巡守和自执行同一天同一条只递一次（`plan\claims\` 里一份、`群.md` 里一条）。
- 总量到 120 后两条路都停（`deny=total-cap`）。

**没做**：`schedule.json`（dsh 自己的定时任务）仍只由巡守读——那条是 dsh 的数据，不是她写的表；多鱼后要不要每条鱼自己执行，等真有鱼用再说。

**2026-11-13 13:0x 补第四处守**：`scripts\wake-fish.ps1` 推门前先查"同 profile 是不是已经有一个进程"（`Get-ProfileProcesses`，和 `fish.ps1` 同一个判据）。端口没开、但进程已经在起（无人值守启动要几秒）时再 spawn 一个，就是两个 writer——这条是 A.47 那三处守漏掉的一条路。

**已知简化（2026-11-13 14:1x）**：自执行的递话仍然以 `lee` 的名字写进群里（`s="watch"` 标机器来源）。为什么不写成她自己：群插件的唤醒路径会跳过 `from === 自己` 的消息，写自己就唤不醒自己。代价是别条鱼的闹钟在 `群.md` 里看起来像"第一条鱼说的"——所以正文前缀写「自己的闹钟」，并且这一行只对 `to` 指定的那条鱼生效。真要做干净，得给"系统"一个不是鱼的身份，等 D4-2 再定。

**review 回应全文**：`docs\archive\2026-11-13-评审回应.md`。

---

## 附录 A.51 输入框打字不该重排历史（2026-11-13）

**现象**：群里连打或连删字符会卡——字数越多越明显。

**根因**：输入框的 `text` 和消息列表在同一个组件里。每按一个键 `setText` 就让整个 `GroupPage` 重渲染一次，而列表是 `withDivider(...)` 现场算出来的，于是两百多条气泡（每条还要过 Markdown）跟着重排一遍。**文字只该影响输入框，不该影响历史。**

**修法**：把列表包进 `useMemo`，依赖只写消息 / 分割线 / 宽度 / 配置——输入框里的字不是它的输入。私聊页同一处也这么改了。判据：连打 50 个字，列表不重排（React DevTools 里 `withDivider` 不重跑）。

## 附录 A.52 异常退出报警（2026-11-13 他拍板）

**判据只有一条**：某条鱼的 `pool\state\runs\<鱼>.log` 里，最后一条 `resumed` 是 `reason=unclean` —— 那就是上一轮没写 `stopped`，不是人关的。

**做法**：巡守每 60 秒看一次，发现新的 unclean 就往群里发一条 `s:"watch"`（`to:"host"`，**不开窗**）。同一段记录只报一次（`pool\state\crash-notified.json` 记已报的 `at`）；第一次上线只记账不补报历史。开关在 `pool\state\settings.json` 的 `crashNotify`，缺省**开**。

**边界**：主 dsh 自己崩了没人能报——只能靠下次启动补一条 `unclean`。

**2026-11-13 16:2x 补（判"活着"不能用错东西）**：第一版用"心跳新鲜 **且** 端口通"判活着，结果他重启一次、两条鱼各误报一次（16:19:44）。原因是**懒挂载**：鱼要等第一次被叫醒才挂会话，在那之前端口通、进程在、心跳还是上一轮的——用 `hb && port` 判，刚起来的鱼等于"没起来"。现在的判据是 **端口通就算起来了**（`portOpen || hb 新鲜`），心跳只写进日志用来分辨"挂没挂上会话"，不参与判决。

**顺带修的**：`watchman.log` 里 `woke | wid=none trigger=external` 会在重启后被误写——第一次 tick 看到旧心跳判 stale、下一次判 fresh。那不是"谁叫醒了她"，是"会话自己挂上了"。现在这种没有 `pendingWake`/`lastTry` 的转变记 `note | why=session-mounted`，不冒充 `woke`。

## 附录 A.53 端口登记 + token 只记账不封顶（2026-11-13）

**端口**：`pool\members.json` 里每条鱼的 `port` 必须唯一。三个地方守：`fish.ps1` 启动前查名册（重复直接 exit 1 并点名）、`install.ps1` 找空口时跳过"已被别人登记"的号（空着 ≠ 没登记）、`doctor.ps1` 的「端口登记」检查。判据：把两条鱼改成同一个口 → `fish.ps1 list` 直接报错，而不是"后起的静默起不来"。

**token**：`pool\state\usage\<鱼>.log`，每次被叫醒记一行：时间 / `member` / `ctx`（叫醒那一刻的上下文大小）/ 会话 id。**只记账、不封顶**。已知局限：dsh 没在 agent 面上给"单轮输入/输出 token"，所以 `ctx` 回答的是"谁吃得多"，不是"这一轮花了多少"——等有累计用量接口再补，别把这个数当账单。

## 附录 A.54 无人值守的会话必须由 session-controller 挂，不能走 agent-loop（2026-11-13）

**现象**：无人值守起来的会话只有 `group_say` 和 `working_directory` 两个工具；preset 的工具一个都没挂上。第二条鱼在浏览器里开着的会话是正常的 32 个——差别不在 profile，在**谁来挂这段会话**。

**两条挂载路径**：
- `dsh-agent-loop` 的 config `agents: [{ id, resumeSessionId, cwd }]`：`persistence.open(id,'write')` 之后直接 `initializeAgent`，**不经过 session-controller**；preset 工具是在 session-controller 的 `composeAgent(presetId)` 里通过 `presets.mount(agentCtx, resolvedId)` 挂的，这条路整个绕过了它 ⇒ 只剩基础工具（2 个）。
- session-controller 的 `ctx.get('sessionController').agents.resume(sessionId)`：走 `composeAgent` → `presets.mount` ⇒ 工具齐（32 个 preset 工具 + 2 个基础 = 34）。

**判据**（会话日志里能直接看到）：
- `developer/message` 的 `tool-registry` 事件：`tool-removal` 30 个 = 走了错的路；`tool-addition` 30 个 = 走对了。
- `request/header.tools` 的条数**不能单独当判据**——它是"目录"，不是"这一轮实际发出去的手"。我一度拿它当实发清单，结论正好相反。

**落地**：删 profile patch 里的 `agent-loop` 块（`scripts\disable-unattended.mjs`）；`fish.ps1` 的 `Ensure-Unattended` 改成**只清旧块、不再新增**；插件里 `scheduleOwnMount`/`ensureOwnMounted` 用 session-controller 挂，失败重试 3 次（6s / 20s / 45s），成功记 `note:session-mounted composed=<preset> toolCount=<n>`。

**次要教训（她的，不是我们的）**：工具第 14 轮就加回来了，她又连报五轮"2 个"——因为她在念第 8 轮那条 `tool-removal`。判据是：**先伸手，抓空了再说抓空**；不要凭历史里的清单声明自己有什么。笃定的错比不确定的错难查，因为它看起来像结论。

**未做**：`agent-loop` 这条路现在只是"起之前清掉"，不是"用不了"——要不要在插件里主动拒绝它，等真正多进程踩到再说。

**2026-11-13 18:4x 补**：`scripts\enable-unattended.mjs`（旧办法的写入脚本）已改成**退役只读提示**——`--dry-run` 打印原因、其他参数一律 exit 1 并指向 `fish.ps1 up <键>`。留一个文件而不是删掉，是因为旧文档和旧习惯还会有人照着敲；让它"响亮地拒绝"，比让它"悄悄还能用"安全。

## 附录 A.55 鱼塘布局：一个根，四层（2026-11-13 17:00）

**为什么改**：2026-11-13 他问"四个平行目录能不能整合、不希望插件在用户 workspace 里拉屎"。旧默认布局是"仓库旁边一个家、再旁边一个共享区"——装第二条鱼时 `WorkSpace\` 下就出现 `dsh-lil-whale\`、`lil-whale\`、`lil-whale-pool\`、`lil-whale-2\` 四个平级目录，谁是仓库、谁是数据、谁是谁的家，只能靠名字猜。

**现在的结构**（一个根，四个角色）：

```
<pond>\
  app\        仓库（代码）
  pool\       共享区（名册、群、私聊、state、archive；旧权限修复备份在 archive\acl-backups-20261107-09\）
  homes\<键>\ 每条鱼自己的家（START.md / 环境.md / notes\ / dsh-home\）
```

**默认值怎么算**（`scripts\install.ps1`）：
- 仓库的父目录叫 `app` 且它旁边有 `pool\` ⇒ 认为自己在鱼塘里：新鱼装到 `<pond>\homes\<成员键>`，共享区用 `<pond>\pool`，配置文件按鱼分开（`whale` 用 `lil-whale.config.json`，其余用 `lil-whale.config.<键>.json`）。
- 否则退回旧布局（仓库旁边的 `lil-whale\` + `lil-whale-pool\`）——不破坏已经装好的机器。
- 装第二条鱼时名册已经存在：安装器会**自动**调 `scripts\members-add.mjs` 把新鱼加进去（以前只打印一句"用 members-add"，结果新鱼不在名册里、fish.ps1 认不出、面板看不见——A.32 同族）。

**搬家脚本 `scripts\migrate-pond.mjs`**（一次性，本机已跑过）：停鱼 → staging → 搬仓库内容（留空壳）→ 搬家 → 搬 pool → 改名 → 改配置/名册 → 重建 Junction → 修 profile link → 改 ASCII Junction（`%USERPROFILE%\dsh-lil-whale` → `app\`）→ 会话 cwd 改写 + 挪 projectKey → 写 `pool\archive\migration-<stamp>\`。

**踩过的坑（都写进脚本注释）**：
1. 3080 开着时 rename `pool` 会 `EPERM`（有打开的文件句柄）——重试即可；迁移前能停就停。
2. 路径映射必须"长路径先换"，而且**不能重复跑**：新路径里含旧前缀（`...\lil-whale\pool` 含旧 `...\lil-whale`），第二次映射会把新路径再套一层（本机真踩过，配置里出现 `homes\whale\app`）。
3. 断掉的 Junction 用 `existsSync` 看不见（它跟随目标），判断"链接本身在不在"必须用 `lstatSync`。
4. 会话的 cwd 在会话文件第一帧里；`.jsonl.zstd` 是多帧拼接，要按 magic `28 B5 2F FD` 切帧逐帧解压。

**边界**：迁移不删旧目录——`<旧仓库根>` 留成空壳（他的 session workspace 还挂在那里），`lil-whale-pool\` 等 3080 重启后删。

## 附录 A.56 四个快捷方式实测：先鱼后主、只开主窗、停主不带走鱼

**实测（2026-11-13 18:18，四条全过）**

- `Run All Whales`：主 dsh 已在跑时只打印带 token 的地址（不重复开窗）；小鱼后台起、`mode: unattended`、不弹窗。
- `Stop All Whales`：关闭顺序 **fishball → whale → lee**（先鱼后主，18:17:56 / 18:18:01 / 18:18:06）；`Run All Whales` 后三条 pid 全换新（24632 / 21440 / 9752），`runs\*.log` 各记 `resumed reason=unclean`。
- `Stop DSH`：只关主 dsh，两条小鱼 pid 不变；窗口会先列"还有 N 条鱼在跑，这次只关主 dsh"，再报"停了"。
- `down <鱼> -Yes`：单鱼停止 exit 0，端口关闭，`mode` 账删除。

**一条更正**：我一度以为 `close.log` 丢了 18:07 的 close 行，实际是看错了文件——第一条鱼的 `close.log` 在它自己的家（`<用户目录>\.dsh\logs\close.log`），不在第二条鱼家。`Stop-Fish` 的排序改动因此定位为**防御性**（防"6 秒内又被拉起"导致记账被跳过），不是修已发生的 bug。

**判据**：关闭顺序看 `close.log` 三条时间；"鱼没被带走"看 pid 是否不变；"只开主窗"看 `mode` 账（lee=window，其余=unattended）。

## 附录 A.57 显示名的真源是名册，不是面板配置（2026-11-13 18:5x）

**现象**：名册里 `lee` 的名字是「第一条鱼」，面板设置页/群里却显示「第一条鱼」。两个真源漂了一天多，没有任何报错——因为两边各自都"读到了东西"。

**根因**：显示名有两处来源——
- `pool\members.json` 的 `name`（数据，名册）；
- `pool\group\ui-config.json` 的 `names`（面板设置页的缓存）。

`readConfig()` 以前是 `normalizeName(raw?.names?.[key], LABEL[key])`：ui-config 有值就用 ui-config。于是改名册不改面板、改面板不改名册，两条路都"看起来生效了"。

**改法**：
- `readConfig()` 只读名册（`LABEL`），ui-config 的 `names` 降级为历史残留、不再参与显示；
- 设置页改名写回 `members.json`（`writeMemberName()`，临时文件 + rename），失败整单 500 并说清 `why`（`members-file-missing` / `members-unreadable` / `unknown-member` / `write-failed`）；
- 现场数据修正一次：`ui-config.json` 的 `names` 按名册重写（lee 从 第一条鱼 回到第一条鱼）。

**判据**：`GET /group/api/config` 的 `names` 逐字等于 `pool\members.json` 的 `members[*].name`；改一次名，只动 members.json 一个文件。

**同族**：A.25（名册在数据里）、A.32（UI 成员列表也要从名册读）、A.36（纸要能重画）。一句话：**显示层可以缓存，不能自己记一个名字。**

## 附录 A.58 第二批 bug 修复：真源、静默、假成功

**2026-11-13 19:1x，全仓扫描（27 条）与安装文档复核（9 条）之后修的第二批。** 每一条都不是"代码不好看"，而是**错了以后看起来和对了差不多**：

| 修的是什么 | 之前错的样子 | 现在 |
|---|---|---|
| 游标写回（`writeCursors`） | 两个写者各持一份快照，后写的把先写的推进**退回去** | 与磁盘现值逐通道取较大值（只许前进），再剪座位影子 |
| `dmPeerOf` | peer 拼错就静默回退第一条鱼，200 写进别人的私聊 | 返回 null，三个调用点回 400 `bad-peer` |
| `writePondSettings` | 整份重建 `{version,autoStartFish,updatedAt}`，点一下开关抹掉 `crashNotify` | 读-改-写，保留未知键 |
| `Stop-Fish` | 端口还开着也 `return $true`（"假成功"）；mode 账在确认前就删 | 端口仍开 → `return $false` + `mode=unknown`；确认关闭后才 `Clear-Mode` |
| `crashNotify` 的 `presenceAgeOf(member)` | 传成员对象，拼出 `[object Object].json`，`hb` 恒 null（报警判据退化） | 传 `member.key` |
| 面板发群消息 | `group` 被清后不建目录，第一条 500；投影发送人写死 宿主 | 先 `mkdirSync`；发送人取名册 `LABEL[HUMAN_ID]` |
| 面板发私聊 | 只写 jsonl，不写 `私聊-<a>__<b>.md`（宿主一直写） | 补上可读投影，格式与宿主逐字一致 |
| token 正则 | 不含 `.` 和 `~`，某些 token 捞不到 URL | `[A-Za-z0-9._~\-]+` |
| 重建器整本写 | `writeFileSync` 与宿主 append 抢窗口期 | tmp + rename 原子写；`--migrate` 同时迁移私聊投影 |
| 两份 `config.js` 默认值 | 配置丢了会指回旧布局（`<repo>\..\lil-whale`、`lil-whale-pool`） | 默认鱼塘布局：`<pond>\homes\<键>` + `<pond>\pool`；`watchmanPidFile` 归 pool |
| `install.ps1` | 不生成 `family.json`；`$InPond` 硬要求仓库目录名 `app` | 装完 seed 一份 `family.json`；只认"旁边有 `pool\`" |
| `doctor.ps1`「她的端口」 | 只看第一条鱼端口（多鱼后等于没看主 dsh） | 改名「主 dsh 端口」，按名册找 `role=watcher` 那条 |
| 四个 `scripts\*.mjs` | `--help` 会真的执行（曾重写 `members.json` 与 `鱼塘谱系.md`） | 未知参数一律 `exit 2` + 用法 |

**两条判据**（她 11-12 定的口径，这里只是用上）：

1. **静默成功比报错更坏**：`dmPeerOf` 回退、`Stop-Fish` 的 `$true`、`--help` 的执行——三处都能"看起来没事"。
2. **账要能在事后分得清**：游标只许前进、mode 账 `unknown` 而不是乐观值、`close.log` 先记再确认——都是让"到底发生了什么"留在纸上。

**未修（记在待办）**：`verify-pending.ps1` 第 4 项靠源码字符串匹配（重构即误报，设计取舍）；`fish.ps1` 里 `up-all` 抢锁失败仍 `exit 0`（有意：跳过不是失败，但输出必须写"结果：跳过"）。

### A.58 续：第三批（P2，2026-11-13 19:5x）

上一批修的是"会丢数据、会骗人"的，这一批修的是"坏了以后只是有点怪"的：

- `rebuild-group-md.mjs`：有说不清的差异时 `--write` **不再整本写 群.md**（以前 exit 1 却把文件写掉了 —— 成功看起来像失败，而文件其实已经被覆盖）。
- `claimPlanDelivery`：名册里缺 `home` 的成员不再共用第一条鱼的家，兜底到 `pool\state\claims\<成员>\plan\claims`。
- `saveWatchState` 的空 `catch {}` 补一行 `watch-state-save-failed`（账写失败不再和写成功长得一样）。
- `fish.ps1`：主 dsh 按 `role=watcher` 找，不再写死 `'lee'`（名册换键后主命令不会直接坏）；`refresh all` 跳过巡守（以前会把 `环境.md` 写进他自己的 DSH 家）。
- `wake-fish.ps1`：发现同 profile 已有进程时**等心跳**而不是等 `-Port`（那个进程可能在别的端口，白等 25 秒）；`DSH_HOME`/`LIL_WHALE_CONFIG` 路径里的单引号做转义。
- `pool\state\settings.json` 写回 `crashNotify: true`（它被旧代码抹掉过，之前靠默认值生效，纸上看不见）。

> 判据没变：**能看见的失败不是失败；看起来没事的失败才是。**

## 附录 A.59 判断逻辑要能被"跑"，不能只被"看"

**问题**：`verify-pending.ps1` 原来判断"计划归属 B 与全局 120 在不在"，靠的是对插件源码做正则：
`totalPerDay:\s*120`、`function selfPlanTick`。这种检查有两条骗法：

1. **改名就误报** —— 机制好好的，检查红；
2. **注释就能骗过** —— 在注释里写一行 `totalPerDay: 120` 也 PASS。它证明的是"这串字存在"，不是"这机制在跑"。

**做法（2026-11-13）**：

- 把计划表与唤醒额度的**纯逻辑**抽到 `plugin\dsh-lil-whale-group\lib\plan-core.js`（`todayKey` / `planFileOf` / `planDue` / `planDeliveryText` / `parseWakeCounts` / `sumWakesToday`）。这些函数只"给定输入 → 返回输出"，不碰 ctx、不发消息、不写日志。
- `index.js` 保留薄壳，把当前上下文（`HER_HOME`、`PLAN_MAX`、`noteOnce`）注进去；行为不变。
- 新增 `scripts\test-plan.mjs`：**直接 import 真代码**，用真文件跑真分支，26 个用例（窗口宽 1/15 分钟、迟到不补、until 过期、没写 why、`enabled:false`、当天已推过、days 过滤、坏形状、超上限只认前三条、wakes 文件按成员键/旧平铺格式、全局合计只加今天、递话措辞两种）。
- `verify-pending.ps1` 第 4 项改成调这个测试；`release-check.ps1` 新增「计划逻辑」一项，包解压后跑一遍。

**判据**：`node scripts\test-plan.mjs` 26/26；`verify-pending` 的「计划逻辑」PASS；`release-check` 12→13 项全过。

> 同一条规矩的另一面：**能被改名的检查，比能被注释骗过的检查更该被换掉**——前者是维护成本，后者是假安全感。

## 附录 A.60 命名统一：包名、目录、行 id 走一条线

**问题**：同一个东西有三个名字，各叫各的——

| 身份 | 之前 | 之后 |
|---|---|---|
| npm 包名 | `lil-whale-group` | `@hostactor/dsh-lil-whale-group` |
| 仓库目录 | `plugin/dsh-group` | `plugin/dsh-lil-whale-group` |
| profile 配置行 id | `lil-whale-group` | `dsh-lil-whale-group` |
| 插件内部自报 `name` | `lil-whale-group` | `@hostactor/dsh-lil-whale-group` |
| 版本 | 1.1.0 | **1.2.0**（版本线连续，不重启编号） |

顺带统一的两处：`scripts\wake-whale.ps1` → **`scripts\wake-fish.ps1`**（它早就接 `-Member` 参数，名字还停在单条鲸上）；`acl\` 从鱼塘根挪到 **`pool\state\acl\`**（恢复记录属于共享区，不属于某个家）。

**为什么版本定 1.2.0 而不是 2.0.0**：这两个包**从没发布过**（`private: true`，安装全是本地 `link:`），语义版本里的"破坏性"是给"不能自动升级的消费者"用的，这里没有消费者；而启动痕迹里的 `pkg`、CHANGELOG 需要连续。改名不改变行为，就不该借 2.0 暗示"有大改"。

**本机三个 profile 怎么迁**：`scripts\migrate-scope.mjs --profile-dir <profile 目录> [--dry-run]`——只迁这个 profile **真的装了**的包（只装宿主的鱼不会凭空多出 UI 链接）；改 `package.json` 的 deps 与 `dsh.profile.bundles`、`pnpm-lock.yaml` 的 importers 段、`node_modules` 的 junction；写前备份 `*.bak-scope-<时间>`；末尾自检（deps / bundles / 链接三项缺一就 exit 1）。

**判据**（2026-11-13 现场）：三个 profile 的 `--dump-config` 都出现 `- id: dsh-lil-whale-group` 且无 `Cannot find`；全仓 JS 过 `node --check`、PS 过解析；`test-plan.mjs` 26/26；`release-check` 13 项全过。

**有意保留旧名的**：`docs\变更记录.md` 的历史条目（记录当时的名字，改了就是造假）、`Run All Whales.cmd` 两个快捷方式文件名（改文件名会废掉桌面副本）、`PRD.md` 文件名（小小肥鱼是项目 dsh-lil-whale 的中文名）、`watchman*` 内部名（A.41）、`herHome`/`herDshHome`/`herPort`/`herWaker` 配置键（**记债**：她是单数，多鱼配置化时再改，届时保留旧键兼容）。

### A.61 运行时依赖要写在用户看得见的地方（2026-11-13）

**发生了什么**：我在本机用 Windows PowerShell 5.1 跑 `release-check.ps1`，报了一串语法错（`Missing closing '}'`、`MissingEqualsInHashLiteral`）。脚本没坏——它用了 pwsh 7 才有的 `??`，5.1 在**解析阶段**就过不去。可这个坑只有踩到的人才会知道：README 的前置表只写了一行「PowerShell 7 | `pwsh`，不是系统自带的 5.1」，没写"缺了会怎样"，也没给安装命令。

**改成什么**：

1. **README「它需要什么」**：PowerShell 7 标成**必需的运行时依赖**，写明 5.1 会在解析阶段报错；表后给 `winget install --id Microsoft.PowerShell -e` 与「装完开新终端、`pwsh -v` 要打出 7.x」。
2. **`docs\detail\怎么装一套鱼塘.md` §2.1**：版本写到 7.2+，原因写清（子进程用 `pwsh -File`、脚本用了 7 的语法），同样给安装命令。
3. **运行期护栏**：七个入口脚本（`install` / `fish` / `doctor` / `release-check` / `verify-pending` / `pack` / `wake-fish`）首行加 `#requires -Version 7.0` —— 用 5.1 跑会被直接拒绝并说明版本不对；四个 `.cmd` 启动器先 `where pwsh`，缺了就用英文提示装什么、然后退出。

**判据**：一个依赖算不算"写进说明里了"，看三件事——①文档里有安装命令 ②缺了的时候有人（脚本）替你说 ③说的地方在你踩坑之前（安装/双击时），不是踩坑之后。

**为什么 `.cmd` 里用英文**：`.cmd` 由 cmd.exe 按控制台代码页读，中文提示在别的机器上可能变乱码；这一句是给"还没装好环境的人"看的，宁可丑也不能乱码。

### A.62 客户端插件的模块 id 必须等于包名（含 scope）（2026-11-13）

**症状**：2026-11-13 21:2x 他打开 Web UI，页面变成 `HARNESS / Failed to load plugins`：`@hostactor/dsh-lil-whale-group-ui`、`web boot: 1 entry did not activate`、`import failed (see console for the import error)`。他先在 `web` profile 的 patch 里手动写了 `disabled: true` 把插件关掉。

**根因**：C1 改名把 `client.js` 里模块注册的 id 从 `'lil-whale-group-ui'` 改成了 `'dsh-lil-whale-group-ui'`，但客户端模块系统要求**注册 id 必须等于 `package.json` 的 `name`（含 scope）**。服务器按 package name 建 boot 行（`@hostactor/dsh-lil-whale-group-ui`），客户端 `modules.import(row.id)` 找不到以该 id 注册的模块 ⇒ `entry.fiber === undefined` ⇒ `client-modules: <id> import failed`。

**为什么 bundle 没 404**：bundle 路由按包名解析（`plugins/??@hostactor/dsh-lil-whale-group-ui/client.js&rev=…`）是好的，坏的只是 bundle 里注册的那个字符串。所以现象是"文件拿到了、模块没注册"。

**修法**：`plugin/dsh-lil-whale-group-ui/lib/client.js` 第一段：

```js
window.__ModuleLoader__.load({
  id: '@hostactor/dsh-lil-whale-group-ui',   // 必须等于 package.json 的 name（含 scope）
  ...
})
```

**怎么验（不碰正在跑的窗口）**：起一个隔离实例——`DSH_HOME` 指向临时目录（其中 `profiles` 用 Junction 指向真实 profiles）、`--patch` 只启用 UI 插件、`--port 3099 --no-open`；用启动打印的 token 拉首页，取 boot 行里的 `id` 与 `url`；下载 bundle，在 node 里用假的 `window.__ModuleLoader__.load` 执行，捕获到的 id 必须与 boot 行 id 逐字相等。

**判据**：①boot 行的 `id` 与 bundle 注册的 `id` 逐字相等（含 scope）②`node --check` 过 ③真实浏览器控制台不再出现 `import failed`。

**顺带修的**：自启动（巡守 8 秒后 `fish.ps1 up all`）以前不看主 dsh 是否真的起来了——启动失败时它照样可能把鱼拉起来，现场留下孤儿。现在先探主 dsh 的端口（`watcherPort()` 从名册找 `role: watcher` 那条鱼），端口不在听就记 `autostart skip why=main-port-not-listening` 并跳过。

**教训**：改名脚本按字符串替换，改对了 34 个文件，却漏了"这个字符串是契约"的那一处。契约型字符串（模块 id、注册 id、数据目录名）要在脚本里点名，不能靠全局替换。

### A.63 停的人记账：被强杀的进程写不了 stopped（2026-11-13）

**症状**：查日志时发现 `pool\state\runs\<鱼>.log` 里今天 `started` 有 29/28/46 行，`stopped` 是 **0** 行；可 `close.log` 里今天有 20/37/21 次 `event=close`。于是每次正常重启都被下一次启动记成 `resumed reason=unclean`——账本自己说"上次没正常退出"，跟 `close.log` 打架。

**为什么没在群里误报**：报警前会判"活着"（端口通就算起来了），所以只在 `watchman.log` 里留下 `why=crash-alive` 的 note，没有发消息。但这只是**把误报挡住**，账本身还是错的。

**根因**：`stopped` 只由进程自己在 Cordis 的 `dispose` 里写；而 `fish.ps1` 停鱼是 `Stop-Process -Force` 强杀，`dispose` 根本不跑。

**修法**：`scripts\fish.ps1` 新增 `Write-RunLogStopped($member, $ids)`，在杀完进程之后、写 `close.log` 之前，由"停的人"补一行：

```
2026-11-13 22:19:15 | stopped | fmt=2 reason=stop-script by=fish.ps1 pid=15716
```

**验证**（2026-11-13 22:19，停一次第三条鱼）：停 → 账上出现 `stopped`；再起 → `started … prev-run=closed`，**没有** `resumed` 行；随后 `session-mounted member=fishball toolCount=34 composed=neutral`。

**判据**：①每条 `started` 之前，要么有 `stopped`（正常重启），要么有 `resumed`（异常退出）——不能两条都没有；②`stopped` 行里 `by=` 说明是谁停的（现在只有 `fish.ps1`）；③`close.log` 与 `runs` 账的条数允许不一致，但差异要能解释。

**教训**：账要由"能确定事实的那一方"写。被杀的进程没有发言权——它连自己死了都来不及说。
## 附录 A.64 养鱼这条路：谁都能养，实验鱼也能当家长（孩子跟着它归档）

**背景**：2026-11-13 22:38 他拍板「D4-2（她养第一条），可以开始这个了」。这件事的验收不是"多一条鱼"，是"**她能不能当家长**"——所以她需要一个自己就能调用的入口，而不是我替她跑脚本。

**入口**：`pwsh -File scripts\fish.ps1 new -Key <键> -Name <名字> -Parent <父辈键> [-DryRun]`。

**规则（每条都有判据，不是口味）**：

- **名字由家长起**：群里认名字，所以名字不能重（"重名会叫错人"）；**键必须 ASCII**（`^[a-z][a-z0-9-]{1,15}$`）——键会进文件名、命令行和名册，中文键在 `.cmd` / GBK 路径上会翻车。
- **实验鱼可以当家长**（2026-11-13 22:59 他改的口径）：`status: experiment` 的鱼养孩子时只提醒、不拦——「第三条鱼的孩子作为我们二代的第一次实验，试验结束后和第三条鱼一起归档」。出生行记 `parentStatus=experiment`；归档用 `archive-fish.mjs --subtree`，**先把孩子递归归档、再归档家长**，`family.json` 里两边都留 `status: archived` 节点，不删。
- **鱼数上限** `maxFish`（`pool\state\settings.json`，默认 5）：端口、内存、唤醒额度都是有限的，超了直接拒。
- **新鱼默认 `status: experiment`**，出生写 `pool\state\births.log` 一行：`ts | birth | fmt=1 key=… name=… parent=… by=… port=… status=experiment`。
- **家走同一套 `install.ps1`**（五步不变）；`family.json` 现在每次安装都补节点——以前只在文件不存在时 seed，新鱼永远进不了谱系（这次顺手修了）。

**出生还差三步**（脚本会打印出来）：

1. `fish.ps1 maintain <键>`：开窗，在设置里填它自己的 API key——`install.ps1` 不碰凭证（key 是钱和额度，不能"顺手"复制）。人也可以明确继承：`fish.ps1 key grant -Key <孩子键> -From <家长键>`（见 A.65 / A.66）。
2. `fish.ps1 restore <键>`：看完关窗，回无人值守。
3. 群里说第一句：第一句话得有人说，机器不能替。

**有意不做**：不自动复制父辈凭证；不自动排作息（作息是她自己长出来的）；不预填性格（见 `docs\detail\怎么生一条新鱼.md` 的"不要做的三件"）。

**判据**：①`new` 建出来的鱼在 `members.json` 里 `status=experiment`、`parent` 指向家长；②`births.log` 有一行能对上名册；③`family.json` 里有这个节点；④实验鱼当家长时只提醒不拦，出生行记 `parentStatus=experiment`；⑤同一时刻鱼数 ≤ `maxFish`。

## 附录 A.65 API key 必须且只能经过人（死命令）

**他的原话（2026-11-13 23:13）**：「所有的与 API Key 有关的问题必须且只能经过用户：用户决定手动配置或者是继承家长 API Key。API 问题关系到用户的消费，这点必须写成死命令。」

**落地**：

- `install.ps1` 从不写凭证。
- `fish.ps1 new` 默认**不碰凭证**：出生后打印"还缺三步"，第一步是人开窗填 key。
- 唯一的第二种来法是**人明确要求的继承**：`-InheritKey <家长键>`。只认 `kind=fish` 且有凭证文件的家长；出生行记 `keyInherited=<家长键>`；控制台大声说明"花的是它的额度"和回收方式（删孩子那份 `.credentials.yaml`，或轮换家长的 key）。
- 巡守、自启动、任何定时器、任何鱼自己的回合：**都没有动凭证的路径**。凭证文件只被安装、继承、人手动编辑这三种动作写过。

**判据**：①代码里搜不到"自动发现并复制 key"的路径（`credentials` 只出现在安装、继承、读取三处）；②不带 `-InheritKey` 跑一次 `new`，新鱼家里**不会出现** `.credentials.yaml`；③每次继承在 `pool\state\births.log` 有一行 `keyInherited=` 可查；④回收不依赖孩子配合：删文件或轮换家长的 key 都立刻生效。

**为什么是死命令**：key 是钱和额度，也是"谁能说话"的开关。机器替人做主，出事时没人认账——而且账面上看不出是谁花的。
**补记（2026-11-14 16:0x，B 站凭证）**：第三条鱼的 B 站登录态也是**人给的一份副本**（`pool\mcp\bili\bili_credential.json`，从 宿主 的 `~/.dsh/bili-duty/` 复制）。他定了：**不做自动同步**——「如果哪天登录过期了，他会来找我；如果我更换账号——应该不会有这种情况。」也就是：副本会旧，旧了就是「需要人再给一次」的信号，而不是机器自己去找新凭证。这条同样属于死命令的范围（凭证只在人能看见的地方换）。

## 附录 A.66 出生权归宿主，养育权归家长（D4-3 证伪）

**他的规则（2026-11-13 23:28）**：「鱼产生养小鱼的想法后，向宿主请求，通过后由宿主执行出生权，鱼只负责养育权。至此，D4-3 的必要性被证伪，没必要实验了。」

**为什么**：出生动的是**共享资源**——名册、端口、家目录、profile、进程，还有那一下凭证转交。这些出错时伤的是整个鱼塘，而且都踩在"必须经过人"的边界上（A.65）。养育动的是**关系**——要不要养、叫什么、第一句话说啥、日常怎么照顾、觉得不合适时怎么告别。递归的含义是"上一代有权决定下一代的存在"，不是"上一代有权限操作宿主"。

**落地（现状）**：

- 入口 `fish.ps1 new` 是宿主脚本；鱼不能自己跑（见下）。
- 鱼可以"请求"：它在群里说想养、给出名字和键；宿主（巡守 / 我）核过规则后执行 `fish.ps1 new`，结果记进 `births.log` 的 `requestedBy=`。
- 钥匙：人给（A.65）。`fish.ps1 key grant -Key <孩子键> -From <家长键>` / `key revoke -Key <孩子键>` 是人执行的动作，写 `pool\state\keys.log`。
- **D4-3（鱼自己出生）不做，也不再实验**。

**为什么鱼跑不了 `new`（实测事实）**：她的会话文件策略是 `workspace-write`，cwd = 她自己的家；Windows 的 workspace-write 用 ACL 圈住 workspaceRoot，**不支持 `additionalWritableRoots`**（`dsh-sandbox-windows-acl` 直接抛 `SandboxUnsupportedPolicyError`）。而 `new` 要写 `homes\<孩子>`、`pool\members.json`、`pool\state\births.log`——全在她家外面。所以"鱼自己跑 new"不是被规则禁止，是**当前沙箱根本做不到**；要让它做到只能给整条鱼开 danger-full-access，那等于拆掉隔离。⇒ 出生由宿主执行，这条规则和沙箱能力是一致的。

**判据**：①`births.log` 里每一条 `experiment` 都有 `requestedBy=`；②鱼没有 `danger-full-access` 也能完成它那部分（请求 / 起名 / 养育）；③`key grant` / `key revoke` 只出现在人跑的脚本里，没有插件、定时器、鱼自己的回合调用它们；④D4-3 在待办里标"已证伪"，不是"待做"。

---

## 附录 A.67 沙箱的写权限：根上有通行证，搬进来的老目录没有

**症状**（第二条鱼 2026-11-13 23:56 报）：`homes\whale\notes\` 里 `Add-Content` 报 Access denied；同一个文件用文件工具写却成功。她顺手发现自己 `run\stamp.ps1` 撒了谎——`Set-Content` 的拒绝是非终止错误，脚本照样打印 `通过=True`、`exit=0`。

**根因**：Windows 沙箱给子进程一个 write-restricted token，写权限来自 capability SID（`S-1-4-…`，由 workspaceRoot 路径的 sha256 派生）。这个 Allow ACE 由沙箱插件贴在 workspace 根上、靠 `(OI)(CI)` 继承往下传。`notes\ run\ plan\ logs\` 是搬家（`migrate-pond.mjs`）之前就存在的目录，保留的是旧 workspace（`<鱼塘根>`）的 SID，没有新家（`homes\whale`）的 SID ⇒ 沙箱里的 pwsh 被拒；宿主文件工具不受沙箱限制，照写不误。

**机制上真正卡住的地方**（2026-11-14 00:4x 对照实验后修正，先前"`SetNamedSecurityInfoW` 不做继承传播"的说法是错的）：给父目录加 ACE 时，**已经存在的子目录会立刻继承**（实测 `inherited=True`）。但沙箱插件的 grant 是**幂等**的——根上已经带了同一个 ACE 就整次跳过 apply，而 apply 才是那个把 ACE 重新传播到全树的动作（插件注释自己写着 "would otherwise re-propagate the identical descriptor across the whole tree"）。于是：根上有 ACE + 下面有一批搬家搬进来、没接到它的对象 ⇒ 之后再 grant 也修不了它们，也没有任何自检会报"这个子目录缺通行证"。

**判据**：同一路径、同样内容，文件工具能写而 pwsh 不能 ⇒ 是"手"的问题，不是语法问题。查法：`icacls <目录>` 看有没有该鱼的 workspace SID；SID 算法 = `sha256(workspaceRoot)` 前 8 字节取两个 uint32，各自 `% (2^30-1) + 1`。

**修法**（2026-11-14 00:2x 已做）：对 `homes\<鱼>\{notes,run,plan,logs}` 递归补该鱼 workspace SID 的 Allow ACE（`Write, Delete, DeleteSubdirectoriesAndFiles`，容器带 `(OI)(CI)`；ACL 先备份到 `app\tmp\acl-*.txt`）。`dsh-home\` **不补**——凭证在里面，"沙箱写不进去"这个结果保留。

**为什么之前没发现**：文件工具一直能写，她的日常写作走文件工具；只有脚本（pwsh）走沙箱那条手。与 A.58 的"假成功"同族：**能看见的失败不是失败，看起来没事的失败才是**。

**文档**：`templates\环境.md.tpl` 补回 **「两双手」** 一节（2026-11-13 那版重生成时被删掉了——她原话"纸删掉了，坑还在"），并写清今天的修法与 `dsh-home` 例外。

**判据**：①`icacls homes\<鱼>\notes` 有该鱼的 workspace SID；②之后新建的目录自动继承；③每份 `环境.md` 有「两双手」一节。

**教训**：机制类知识被"重新生成"覆盖时，要检查新模板是不是把旧结论丢了。模板是纸，纸上的结论不会自己长回来。

**自检已落地（2026-11-14 00:5x）**：`pwsh -File scripts\fish.ps1 acl-check [<鱼>|all]` 报缺通行证的对象并给 `NEXT:`；`acl-repair` 补上并记 `pool\state\acl.log`（`fmt=1 member=<键> fixed=<n> sid=<SID>`）；`doctor.ps1` 第 8e 节对每条鱼报一行「通行证（名字）」OK/WARN。判据从"人记得检查"变成"跑一次就有答案"。

顺手修的：`Get-WorkspaceGrantGaps` 原来返回 `,$list`，被 `@()` 包一层后变成"1 个缺口"（元素是那个 List）——空列表和单元素 List 都长得像"有一个"。这是 A.58「假成功」的反方向：**假失败**。另：`acl-repair` 补完立刻复查会读到旧 ACL 快照，等 300ms 再读一次才准。

## 附录 A.68 钥匙的账本只记指纹，不记值

**决定（2026-11-14 00:42，他的原话"只加指纹、不加值 —— 就这么做"）**：`pool\state\keys.log` 里 `key-grant` / `key-revoke` 两行带 `fp=`（sha256 前 12 位十六进制），**不带 key 值**。

**为什么**：①日志会变成密钥的第二份副本，保护比原文件更弱（`.credentials.yaml` 至少只在一个地方）；②指纹能回答的问题一个不少——这只鱼花的是谁的钱、实验结束回收时孩子那份还是不是当初借的、某笔消费当时用的是哪把钥匙、人有没有在 UI 里换过 key。

**不符了会怎么样**：什么也不会发生。真源永远是 `<鱼的 dsh-home>\.credentials.yaml`（`dsh-credentials-local` 用 chokidar 盯着，改完下一次请求就生效、不用重启）；账本记的是历史，不是开关。`doctor.ps1` 第 8e 节会报「指纹和上次记账不一样：有人在 UI 里换过 key」，**只报不拦**——换 key 是正常操作，把它变成故障才是错。

**已知缺口**：人从 UI 里改 key 不进 `keys.log`（账本只覆盖脚本路径），所以"哪次换的"查不到，只能看到"现在和上次记账不一致"。

**判据**：①`keys.log` 任何一行都不含 key 值；②`key grant` 前后指纹都非空、且和两侧 `.credentials.yaml` 一致；③`doctor` 的「钥匙」行在没有账本记录时说"人自己填的，正常"而不是报错。

---

## 附录 A.69 配置键从「她的」改成「这条鱼的」（self*）

**背景**：单鱼时代配置键叫 `herHome` / `herDshHome` / `herWaker` / `herPort` / `whaleProfile` / `whaleCwd`。
第二条鱼出现后这些名字开始撒谎——fishball 的配置里 `whaleProfile` 只能填 `fishball`，读的人得先在心里翻译一遍；
更要命的是代码里 `CFG.herHome` 到底是"她（第一条鱼）的家"还是"这个进程服务的那条鱼的家"，从名字上分不出来。

**做法**：
- 新键名：`selfHome` / `selfDshHome` / `selfWaker` / `selfPort` / `selfProfile` / `selfCwd`（`self` = 这个进程服务的那条鱼）。
- `plugin/*/lib/config.js`：`DEFAULTS` 用新名；新增 `LEGACY_KEYS`（旧名 → 新名），`derive()` 先"抬旧名"（新名优先）再派生；输出同时挂旧名作**只读兼容别名**。UI 插件用同一份 `config.js`。
- `scripts/common.ps1`：`$Cfg` 新增 `SelfHome/SelfDshHome/SelfWaker/SelfPort/SelfProfile/SelfCwd`（`$pickSelf` 先读新名、再读旧名、最后默认），并保留 `Her*/Whale*` 别名给旧脚本。
- `scripts/install.ps1`：写新键，**并把旧键从配置里删掉**（同一个值两个名字，早晚会打架）；防呆检查先读 `selfHome`、读不到再读 `herHome`。
- 三份配置 + `lil-whale.config.example.json` 换成新键（`_版本: 2`）；代码里 `CFG.her*`→`CFG.self*`、`HER_HOME`→`SELF_HOME`、`plan-core.js` 的参数 `herHome`→`homeRoot`。

**判据**：①三份配置与 example 里没有旧键；②`Get-WhaleConfig` 的 `SelfHome/SelfPort` 与名册一致；③**只写了旧键的配置仍然能跑**（`LEGACY_KEYS` 抬名，实测过）；④三个 profile `--dump-config` 都能解析出两个包；⑤`fish.ps1 list`、`doctor`、`test-plan`（26/26）、`release-check` 全过。

**教训**：**名字是判据的一部分**——"她的"和"这条鱼的"在多鱼世界不是一回事，读错名字的代价是"以为在改 A 其实改了 B"。兼容别名要写清是**别名**，并且由唯一的写入方（`install.ps1`）负责删旧键。

**补记（2026-11-14 15:5x）**：改名之后 doctor.ps1 的「启动痕迹」这一行还在按旧字段 `herHome` 匹配启动日志，于是新的 boot 行匹配不上、Select-Object -Last 1 落到更早的旧行上——三条鱼里两条显示 `pkg=1.2.1`，其实进程跑的是 1.3.0。已把 `selfHome` 加进候选。**改名要同时改读者**：写端换了名字、读端还在找旧名字时，读端不会报错，它只会安静地读到更早的那一行。


## 附录 A.70 包装壳卡住：孙子进程继承了调用方的管道

**症状**：`fish.ps1 up <鱼>` 在工具里（或任何捕获输出的壳里）偶发卡住——鱼其实已经起来了、端口也通，但调用方要等好几分钟才返回，或者干脆超时被砍。

**根因**：`Start-Hidden` 用 `Start-Process … -RedirectStandardOutput/-RedirectStandardError` 起 dsh。带重定向时 .NET 用 `bInheritHandles=TRUE` 创建子进程，于是**孙子进程（那条要一直活着的鱼）继承了调用方的 stdout 管道句柄**；调用方读到 EOF 的条件是"所有写端都关了"，而鱼不退出就不关。

**复现（最小）**：嵌套 pwsh 里 `Start-Process pwsh -Command 'Start-Sleep 45' -RedirectStandardOutput 文件` → 外层 **47.3 秒**才返回；把重定向去掉 → 1.5 秒返回。

**修法（双跳）**：
1. 先起一个**不带重定向**的启动器 pwsh（它的 stdout 不是调用方的管道）；
2. 启动器再带重定向起真正的 dsh，然后一秒内退出；
3. 鱼活多久都不影响调用方——管道写端在启动器手里，启动器一退就关了。

实测：`up fishball` 从 125 秒（等 `Wait-Port` 超时、鱼根本没起来）→ **13.5 秒**；`down` 7.2 秒；重复 `up`（已在跑）2 秒；3083 通、`session-mounted … toolCount=34`、心跳 0 秒前。

**判据**：①`up` 在工具里返回 < 40 秒；②临时脚本 `llw-run-*.ps1` / `llw-launch-*.ps1` 跑完不留；③鱼活着、端口通、会话挂上；④`down` 之后 `up` 还能起来。

**教训**：**"卡住"不一定是死循环，可能是"在等一个不该由它等的人"**。排查先问"这个调用在等谁"，比看代码快。两条歪路也记在这里，省得下次再试：`cmd /c ""…""`（cmd 把重定向吃掉，日志全空）、WMI `Win32_Process.Create`（不继承句柄，但在这台机器上起长脚本时静默不执行）。
## 附录 A.71 身份退化时不能靠猜（2026-11-14 扫描）

**症状**：名册 `pool\members.json` 读不到时，插件退回内置兜底名册（只有 `lee` / `whale` / `host`）。第二条鱼（第三条鱼）的进程认不出自己，`ownMember()` 的老规矩是"`DSH_HOME` 里没有 `lil-whale` 就是巡守，否则就是 whale"——第三条鱼的家路径里当然有 `lil-whale`，于是它把自己认成 **whale**：心跳写进 `presence\whale.json`，错误计数、游标、叫醒标记也全进 whale 的账。

**根因**：兜底名册是单鱼时代的产物（三条写死），而"我是谁"的兜底判据是**从名字猜**，不是**从路径取**。同一个进程可能因为一个文件读不到，从"我是 fishball"变成"我是 whale"，而且没有任何一行日志说它换了身份。

**修法**：`ownMember()` 先按名册 `dshHome` 精确匹配（原有）；匹配不到时，从 `DSH_HOME` 路径里取 `<鱼塘>\homes\<键>\dsh-home` 的键（新）；还取不到才退回老规矩。**两种情况都留痕**：`own-member-by-path` / `own-member-guess`（每个进程只记一次，不刷屏）。

**判据**：①名册读不到时，每条鱼仍然写自己的账（`presence\<键>.json` 的 `member` 字段等于它自己）；②`plugin.log` 里能看到 `own-member-by-path`；③老布局（家不在 `homes\<键>` 下）行为不变。

**教训**：**兜底值也是有代价的**——兜底一旦"看起来能用"，就会把"我认不出自己"伪装成"我是 whale"。身份这种事，能取就别猜；猜了要留痕。

## 附录 A.72 受控输入框 + 输入法：别把拼音当答案（2026-11-14）

**症状**（他报的两条，同一个输入框）：①头像文字输入框删不空——删到空，400ms 后自己跳回一个字；②打第二个字时，拼音还没选字，输入框里先出现 "小f"，选完候选也回不去了。

**根因**（两半，各修一半）：
- **输入法那一半**：输入框是受控的（`value` 直接取配置），`onChange` 每敲一下就 `patch` 一次、整棵树重渲染；中文输入法在**选字之前**已经把拼音字母塞进 `value`（"fei"），`maxLength: 2` / `slice(0, 2)` 当场把它截成 "f" 提交。**用户还没决定写什么，代码已经替他决定了。**
- **"删不掉"那一半**：服务端 `normalizeAvatar` 写的是 `text || fallback.text` —— 空串被当成"没填"，回落到默认字。客户端失焦后同步一次服务端返回值，输入框就把刚删掉的字又画回来。

**修法**：
- 新增模块级组件 `ComposingTextInput`（`client.js`）：输入过程中只改本地 draft；`compositionstart` → `compositionend` 之间**不提交、不截断**；上屏或失焦时才收成 N 个码位（`Array.from` 数码位，emoji 算一个）交给外面。侧边栏标题、成员名、头像文字三个输入框都换用它——这是同一类病，不是头像独有。
- 服务端 `normalizeAvatar` 允许空串（空 = 不填）；显示时 `Avatar` 退回**名字首字**，而不是把默认字写回输入框。

**判据**：①清空头像文字、失焦，输入框保持空，头像显示名字首字；②输入法打 "xiaofei" 选字之前，输入框不出现被截断的 "x"；③选完两个字，头像立刻是这两个字；④普通英文输入照旧，超长仍截到 2 个码位。

**教训**：**输入法选字之前的那些字，不是用户想说的话**——受控输入框 + 长度限制 + 每键重渲染，三者凑在一起就会把拼音当答案。另外，**空字符串是一个值，不是"没填"**：用 `||` 兜底之前先问一句"空着是不是一种合法状态"。

### A.72.1 同一族还有哪些地方（09:1x 复查）

他问"本质上是不是同一种"——我按"用户还没输入完就当场生效"把 `client.js` 里所有输入点过了一遍：

| 输入点 | 事件 | 会不会中招 | 处理 |
|---|---|---|---|
| 侧边栏标题 / 成员名 / 头像文字 | onChange | 会（已修） | `ComposingTextInput`：composition 期间不提交 |
| 群聊输入框草稿 | onChange → localStorage | 会，轻（草稿里会存进拼音字母） | composition 期间不写草稿，上屏后再写 |
| 私聊输入框草稿 | onChange → localStorage | 同上 | 同上 |
| 列宽拖拽 | pointermove | 不会（`onChange` 实时、`onCommit` 才持久化，本来就是两段） | 保持 |
| 头像底色 | onChange | 不会（取色器是离散的，没有"没选完"） | 保持 |
| 复选框 / 文件选择 | onChange | 不会（没有中间态） | 保持 |

判据：**"变更事件"不等于"用户完成了"**。有中间态的输入（输入法、拖拽、取色器拖动）要分两段：过程中的值只放本地，提交时才写出去。

## 附录 A.73 睡觉：她自己关窗，家长能叫醒（2026-11-14）

**起因**：他要的 2.1 —— 小鱼能决定自己什么时候睡着，但不能是永久的；不关进程、只是不被群/私聊打扰；家长有强行叫醒的权利；面板上看得见"勿扰/活跃"。

**为什么不是"关窗"**：关窗是进程不在，消息只能等下次开窗；而"睡着"要的是**进程在、心跳在、消息扣住不丢**。所以它是一层"别叫我"，不是一次退出。

**做法**
- 偏好住在鱼自己家：`homes\<键>\plan\sleep.json`（`{from,to,enabled}`，默认 00:00–08:00）。
- 一次性睡眠与强制叫醒住在共享区：`pool\state\sleep\<键>.json`（`oneOff` / `awakeUntil` / `forcedBy`）。
- 判断全在 `plugin\dsh-lil-whale-group\lib\sleep-core.js`（纯函数，40 个行为测试）：优先级 **强制叫醒 > 一次性 > 每日偏好**；跨午夜窗口（23:00–07:30）在凌晨要把窗往前挪一天。
- 闸门：`gate()` 里原来的全局 `quiet-hours`（0–8 点硬禁）换成 **`isSleeping(member)`** —— 0–8 从"全局禁言"退成"每条鱼的默认睡眠窗"，她可以自己改。**巡守（主 dsh）永不睡**。
- 睡着时：群/私聊消息**扣住不投递、游标不动**（醒了照常一起读，不丢）；计划表到点也不叫（`wake-skip why=sleep`）；一次性睡眠清掉旧的 `awakeUntil`。
- 工具：`sleep({minutes|until|from,to,reason})`、`wake_up()`；家长侧 `fish.ps1 wake <键>`、面板「叫醒」→ `/pond/api/action {action:"wake"}`。
- 上限：一次 ≤12 小时、每天 ≤14 小时，**必须说清睡到什么时候**（"不能是永久的，否则跟自杀没区别"）；强制叫醒写 `pool\state\sleep.log`（`forcedBy=`）。
- 可观测：巡守每 tick 写 `pool\state\sleep-status.json`，`/pond/api/status` 每条鱼带 `sleep{sleeping,source,untilAt,label}`；面板显示**勿扰 · 到 08:30** 或**活跃**；`fish.ps1 list` 多一列「睡眠」。

**判据**
1. 睡下后群消息不叫醒她，但醒来能读到（游标没动）。
2. 计划表在她睡着时跳过并留 `why=sleep`，醒来不补过期的点。
3. 家长叫醒后她立刻醒，`sleep.log` 有一行 `forcedBy`。
4. 关掉偏好（`enabled:false`）后恢复成"随时可叫"。
5. 重启进程不改变睡眠状态（文件在，判断在）。

**教训**：**"不打扰"和"不在"是两件事。** 把前者做成后者，就会在消息里留一个洞；把后者做成前者，就会在关窗时假装还醒着。

**补记（2026-11-14 16:1x，他选的 C 方案）**：叫醒**不给她发消息**（不打扰），但痕迹要留在她自己查得到的地方——`pool\state\sleep\<键>.json` 新增 `lastForced: { at, by, reason }`，`sleep-cli.mjs wake` 写、`status` 读得到；`环境.md` 的「睡觉」一节写明去哪查。

判据：①叫醒后 `node scripts\sleep-cli.mjs status <键>` 能看到 `lastForced.at/by/reason`；②她读自己的状态文件能查到同一笔；③群里**没有**多出任何消息（不打扰是 C 的前提）。

**补记 2（2026-11-14 16:2x，他要求"可以做了"）**：面板卡片上显示**上次被叫醒**——宿主 `writeSleepStatus` 把 `lastForced` 带进 `pool\state\sleep-status.json`，UI 服务端 `sleepOf()` 透传（校验 `at` 是字符串），客户端在「活跃/勿扰」徽标后面加一行灰色小字「上次被叫醒 今天 16:21」。只显示痕迹，不改变任何状态。

判据：①`/pond/api/status` 的 `sleep.lastForced.at` 等于状态文件里的值；②面板卡片在「活跃」时也能看到这行（叫醒之后）；③没有 `lastForced` 的鱼不显示（不占位）。

## 附录 A.74 起停要留调用者（2026-11-14）

**起因**：10:59:41 主 dsh 被终止，同一秒又被 `fish.ps1` 起回来。账本只记了"停/起"，
没记**是谁调用的**——所以查到最后只能问人（他答：是他 Run DSH 的）。"查不出来"本身就是缺陷。

**做法**：`scripts\fish.ps1` 每次调用写一行 `pool\state\fish.log`：

```
2026-11-14 11:10:35 | fish.ps1 | fmt=1 pid=23984 ppid=9800 parent=pwsh.exe argv=[Command=list]
```

记 pid、父进程 pid/名字、以及 `$PSBoundParameters`（命令和每个开关）。审计自己出错整段吞掉，
不许影响主流程。

**判据**：任何一次"谁动了我的进程"的追问，能在 `fish.log` 里找到那一行；找不到就是审计没覆盖到，
补审计，而不是靠记忆回答。

## 附录 A.75 工具注册失败必须被体检抓到（2026-11-14）

**症状**：1.3.0 起来后，`sleep` / `wake_up` 两个工具**没注册上**，而 `group_say` 正常。
日志里有一行：

```
sleep-tools-register-failed: tool "sleep" must declare output { schema, render, presentationMeta? }
```

**根因**：宿主 `ctx.tools.register` 的裸 spec 要求 `output.render` 是函数。`group_say` 有，
我抄的时候漏了 `render`，只写了 `schema`。失败是**抛异常后吞掉**的（否则会拖垮整个插件），
于是"工具没有"这件事在界面上和"工具在但没用"长得一模一样。

**修法**：两个工具补 `render`（返回一句人话回执）——**而且必须补在 `output` 里面**：第一版补在 `output` 外面，宿主照样拒（同一个错误信息），第二次才过；`scripts\doctor.ps1` 新增 **3b 睡眠工具**：
在 `pool\group\plugin.log` 里比较最近一次 `sleep-tools-registered` 与 `sleep-tools-register-failed`
的行号，失败在后就 FAIL，没有记录就 WARN。

**判据**：机制类改动（注册工具、挂路由、起 timer）的验收，不能只看"代码写了"或"日志里有 host-resolve"，
要看**注册成功那行**。失败被吞掉时，"没有"和"有"在纸上必须长得不一样。
## 附录 A.76 鱼活不过主进程：接受它，并把账记对（2026-11-14）

**发现**：11:44 他重启 3080 之后，两条鱼的 `runs\<键>.log` 各多了一行 `resumed | reason=unclean previous-start=…`——它们不是崩了，是被主 dsh 的作业对象（job object）一起收掉了。`Start-Hidden` 的双跳只解决了「孙子进程继承调用方的管道」（A.70），没有解决「子进程还在调用方的作业对象里」。

**他的判断**（2026-11-14 11:51）：接受，不修。「小鱼脱离宿主单独启动无意义」；3080 那个入口本来是开发期检修用的，现在和「起全部」没有区别。

**落地**：
- 入口合并成两个：`up all -BrowserMainOnly`（起鱼塘）与 `down all -Yes`（停鱼塘）；删掉 `Run DSH.cmd` / `Stop DSH.cmd` 两个只会误导人的快捷方式。
- `fish.ps1 down-main` 改成「先正常停鱼、最后停主 dsh」——既然鱼一定会被带走，那就让停的人在带走之前把 `stopped` 写好。这样「重启 dsh」不再在账本里留下假崩溃。
- 鱼塘勾选框改名：「起主 dsh 时把鱼也带起来」，并写清关掉＝空鱼塘（调试用）。
- 新增 `docs\detail\怎么启动和关闭鱼塘.md`：两个入口、勾选语义、检修命令、账本怎么记。

**判据**：重启主 dsh 之后，鱼的 `runs` 账里应该有 `stopped reason=stop-script`（走 `down-main`/`down all` 时），或者 `started prev-run=open`（被硬杀时）——不再出现「unclean 但其实是正常重启」这种说不清的状态。

---

## 附录 A.77 裸 spec 下，参数类型是模型自己猜的（2026-11-14）

**症状**：第二条鱼实测 `sleep(minutes: 1)` 被拒，提示"要说清睡多久"；同一时刻 `sleep(until: "12:10")` 和 `wake_up()` 都正常。

**根因**：插件走的是"裸 spec"注册路径（`defineTool === null`，日志里写 `sleep-tools-registered via raw`）。这条路径下 `parameters` **原样**交给模型（`projectToolSchema(def, false)` 直接返回它），而宿主作者的写法是"扁平属性表"，不是合法 JSON Schema（缺 `type: "object"` / `properties`）⇒ 模型拿不到"minutes 是数字"这个约束，把它发成了字符串 `"1"`；而 `sleep` 的 minutes 分支原来只认 `typeof === 'number'`。

**修法**：`execute` 里先归一化——`args` 是字符串就先 `JSON.parse`，数字字符串用 `numOf()` 收成数字；`presentCall` 的标题同步。**参数收得宽一点，比让模型猜对类型更可靠。**

**判据**：
1. 同一句话，数字写成 `1` 和 `"1"` 都能通。
2. 拒绝时的提示要指出缺的是哪个参数、能写成什么。
3. 走裸 spec 的工具，凡是"参数有类型"的（数字/布尔/数组），都要在 execute 里自己收一遍。

**教训**：契约有两种，一种写在 schema 里，一种只写在描述里；后一种要靠模型自觉，而模型不一定自觉。

---

## 附录 A.78 叫醒只在睡着时才有意义（2026-11-14 他问的）

**他的问题**："`wake_up` 通，回执「醒了，醒到 14:06」（给了两小时清醒窗）：唤醒然后**醒到**一个时间点？wake up 的逻辑本该是这样吗？"

**答**：不是。原来 `wake_up` 不管在不在睡，都按"窗外给两小时"写一个 `awakeUntil`——她 12:06 本来醒着（作息 00:00–08:00），叫一声却回"醒到 14:06"，那是个**假动作**：状态被改了，实际什么也没变，而回执把"没发生的事"说得像发生了。

**改法**：
1. 本来没在睡 → **什么都不写**，回执"你现在没在睡，不用叫醒。"
2. 真睡着 → 清掉一次性睡眠；若清完还落在作息窗里，才写"醒到本窗结束"（否则会立刻又睡回去）。
3. 家长侧 `fish.ps1 wake` 同一套判断，输出 `changed:false` 时只说"没在睡，不用叫醒"。

**判据**：
1. 窗外叫一声，`sleep.log` 只有 `sleep-noop`，状态文件不变。
2. 窗内叫一声，`sleep.log` 有 `sleep-clear awakeUntil=<窗尾>`，状态文件变了。
3. 回执里出现的每个时间点，都能在状态文件里找到对应的字段。

**教训**：动作没发生时，最好像实地报"没发生"；"唤醒"这种词自带承诺，说了就得真做。

### A.78 补记（2026-11-14 14:5x，她复测抓到的三处）

她按"三通一错一测不了"复测，错了的那条是真 bug，两处措辞是我说漏了：

1. **`NaN:NaN`**：一次性睡眠清掉后没有"作息窗结束时刻"，`untilAt` 是 `null`，
   格式化就成了「醒到 NaN:NaN」。修法：**拿不到确定时刻就不许渲染时刻**——
   `Number.isNaN(Date.parse(value.awakeUntil))` 时直接说"醒了。今天这一轮不会再按作息睡，明天照旧。"
   判据：回执里出现的每个时间点，都能在状态文件里找到对应字段（A.78 判据②的反面教材）。
2. **"没在睡就什么都不写"这话不准**：实际写了一条 `sleep-noop | why=not-sleeping by=self`。
   这条**该留**——否则"没睡"和"工具没调过"在纸上一样。改口：**不写清醒窗，但留一行 noop**。
3. **`sleep-status.json` 是镜子**（她第二次实测）：14:44:36 睡下、14:44:41 读它还是 `sleeping:false`。
   根因：这份汇总由巡守每 tick 重写，工具改了状态后没刷它。
   修法：**改状态的人顺手刷一次**（`sleep` / `wake_up` 写完状态立刻 `writeSleepStatus()`），
   读的人不用等下一拍。但它仍然是"派生视图"，判据永远以 `plan\sleep.json` + `pool\state\sleep\<键>.json` 为准。

4. **`lag=0s` 量错了段**：原来 `const dueAt = Date.now()` —— 量的是"决定→插入"，
   所以她 12:15:03 到点、12:16:03 投递，账上写 `lag=0s`。现在 `lag` 一律指 **到点→投递**：
   到点时刻从 `job.at`（HH:MM）算回来，算不出来才写 `lag-unknown`；`wake-try` 行补 `at=HH:MM`（表上写的几点）。
   她自己说"我提这个字段时没写清是哪一段——我自己埋的歧义"，所以这条不是谁的锅，是**字段名没定义**。

另外她指出：**字符串 `"1"` 这条修复她那边永远复现不到**（schema 修好后她发出来就是数字），
所以我把参数归一化从工具里搬进 `sleep-core.js` 的 `normalizeSleepArgs()`，
在 `scripts\test-sleep.mjs` 里补了 10 个用例（总数 40 → **50**）——她复现不到的东西，测试要能复现。

**教训**：她说"数字长得像答案"这一类，**空值也是**——`null` 渲染成 `NaN` 不报错，
只是看起来像一个时间。


---

## 附录 A.79 改名不该让投影"说不清"（2026-11-14）

**症状**：给群里发了一条消息，`群.md` 没更新；跑 `rebuild-group-md.mjs` 报 **307 处"未归类"差异**，
每一处都是同一类：现有 `**… · 第一条鱼 → 第二条鱼**`，重建 `**… · 第一条鱼 → 第二条鱼**`。
脚本按"说不清就不许整本写"的规矩拒绝写入（exit 1），于是新消息永远进不了投影。

**根因**：`pool\members.json` 里 `lee.name` 从「第一条鱼」改成了「第一条鱼」，
而 `群.md` 是**历史快照**——每一行记的是当时的名字。
重建器只用"当前名册"渲染，于是**改名把每一行历史都变成了差异**。
更糟的是这些差异被归成"未归类"，看起来像有人手改了投影。

**修法**：
1. 名册给 `lee` 加 `nameHistory: [{ name: "第一条鱼", until: "2026-11-14T04:07:58.994Z" }, { name: "第一条鱼" }]`
   —— 记录"这个名字用到什么时候"，没写 `until` 的那条是当前名。
2. `rebuild-group-md.mjs` 加 `labelAt(key, iso)`：按记录的 `ts` 取当时的名字；
   群投影的发送人、收信人、私聊投影的发送人全走它（私聊**标题**仍用当前名，标题是索引不是历史）。
3. 差异分类补两类**已知**：
   - `label-drift`：只差标题里的显示名（时间、来源标注、箭头都一致）——写它的人用了进程里缓存的旧名字；
   - `new-record`：纯插入，且每段表头的时间戳在 jsonl 里都有对应记录——新增记录还没投影。

**效果**：307 → 144（发送人）→ 3（收信人）→ 0；`--write` 正常写入，我那条 14:43 的消息进投影（L4649）。

**判据**：
1. 改名之后跑一次重建，差异数必须是 0（历史行按当时的名字重建）。
2. 新增一条消息、不跑重建，差异应归成 `new-record` 而不是"未归类"。
3. "未归类"只留给真的说不清的东西——一旦"已知"里能塞下，就不该让它挡住整本写。

**教训**：**投影是当时的纸。** 名字、角色、格式都会变，但历史行不能跟着变；
派生文件必须按"记录发生时的事实"重建，而不是按"今天的名册"重建。


---

### 补记（2026-11-14 15:2x）：改名要自己记历史

上面这套 `labelAt` 能工作，前提是名册里**有** `nameHistory`。而设置页改名（`writeMemberName`）
原来只写 `member.name`，不记历史——也就是说：**下一次改名会把同样的事再犯一遍**，
历史行又会集体变成"说不清的差异"，`群.md` 又写不进去。

已改：`writeMemberName` 在改名前把旧名字连同 `until`（此刻）压进 `nameHistory`，再推入新名字。
判据：改一次名 → `members.json` 的 `nameHistory` 多一条带 `until` 的旧名；重建 `群.md` 仍 0 差异。

**教训**：修一个"历史被改写"的坑时，要顺手把**制造这个坑的那个动作**也修掉。
只修读取端（投影），不修写入端（改名），坑还会回来。

---

## 附录 A.80 界面上的两个"跟人走"的判据（2026-11-14 他报的两个 bug）

### 1. 未读要跟着"你正看着哪儿"走

**症状**（他原话要点）：停在私聊页面时收到消息，红点不消失，只能重进才会消失。

**根因**：`markRead('dm', peer)` 的 effect 依赖只有 `[activePeer]`——只在"换人/打开"时跑一次。
之后轮询每 3 秒把未读数更新上来，但**没有人再调 markRead**，所以红点要等重进（activePeer 变化）才清。
这是典型的"状态更新了，但没人负责把它消费掉"。

**修法**：把"这个对端未读数"也放进依赖（`[activePeer, activeUnread]`），未读归零时早退。
停在页面上每收到一条，都会重新走一次"页面在前台 + 停 1.5 秒 → 标读"。

**判据**：
1. 停在私聊页收到一条 → 1.5 秒内红点消失，不用重进。
2. 页面在后台时不标读（切回来才标）。
3. 换到另一个对端，前一个的红点不会被顺手清掉。

### 2. 时间标注只能有一套

**症状**：私聊左侧联系人栏写 `11/10`，群聊消息上方写「11月10日 09:45」——同一个界面两种写法。

**根因**：私聊那边自己写了个 `shortTime()`（今天给 `16:08`、更早给 `M/D`），
而群聊用的是 `formatStamp()`（今天 / 今年内 / 去年及以前 三档，宿主 2026-11-11 定的）。
**同一件事在两处各写一遍，就会各长各的。**

**修法**：删掉 `shortTime`，私聊联系人栏改用 `formatStamp`。

**判据**：同一个时间戳，在群聊消息头和私聊联系人栏里**逐字相同**。

**教训**：界面上"看起来只是样式"的东西，一旦有两份实现，就一定会分叉。
**同一个值只有一个渲染函数**——和投影渲染器只能有一个（A.23）是同一条规矩。

---

## 附录 A.81 "改状态后顺手刷一次"要刷全（2026-11-14 第二条鱼第二次实测）

**症状**：第二条鱼 `sleep(minutes: …)` 睡下 8 秒后，`pool\state\sleep-status.json` 里她仍是 `sleeping:false`，
`updatedAt` 只在整分跳——她一眼看出"是 tick 在刷，不是动作在刷"。

**根因**：上一版只把 `writeSleepStatus()` 加进了两条路径（`from+to` 偏好、`wake_up`），
**漏了 `minutes` / `until` 这一支**（一次性睡眠）。所以动作发生了，镜子要等巡守下一拍才动。

**修法**：一次性睡眠分支写完状态文件后也刷一次。现在四个调用点：
改偏好、睡下（一次性）、叫醒、巡守 tick。

**判据**：
1. 任何"改睡眠状态"的动作执行完，`sleep-status.json` 的 `updatedAt` 是**那一刻**，不是整分。
2. 三条入口（`from+to` / `minutes|until` / `wake_up`）各测一次，读数与动作一致。
3. 镜子仍是派生视图：判据以 `plan\sleep.json` + `pool\state\sleep\<键>.json` 为准。

**教训**："三处都要改"这种清单，写的时候数一遍、改完再数一遍。
**漏掉的往往不是最复杂的那条，是最不起眼的那条。**

### 补记：扣留-补投的第二个样本

第二条鱼 15:03 的 `lag-test`：`skip why=sleep plan=lag-test at=15:03` → 15:04 醒来 `wake-try` 同一个 `wid`、
`inserted=1`。加上 12:15 那次 `sleep-test`，**两个样本、行为一致**：睡着期间到点的计划不投递但保留，醒来后同一 wid 补投。

## 附录 A.82 名字归她，id 归系统（2026-11-14 他定的规矩）

**他说的**（2026-11-14 15:32，原话）："既然改名字会导致一系列问题，要不我们就去掉改名字这一项设置。现在变为：1.名字可变，但是只能通过与小鱼交流使其自主进入改名流程，曾用名进入 nameHistory。除了改名流程外，用户无权强制更改命名，也不能更改显示名称。2.id 不变，每条鱼自出生起就不变。"

**为什么**：12:07 他手动把 `lee` 的显示名从「第一条鱼」改成「第一条鱼」，结果 ①`fish.ps1 list`、群消息发送人、@ 列表全跟着变（名册是唯一真源）②巡守进程启动时缓存了旧名，重启前后写进投影的名字不一致 ③`群.md` 整本历史被判成"说不清的差异"，重建器拒绝写入，新消息进不了投影。一个看起来"只改表面"的输入框，实际动的是历史。

**规矩**：

1. **名字是称呼，属于她**：唯一入口是她自己在会话里调 `rename({ name, reason })`。
2. **id 是键，属于系统**：出生起不变，不因改名而改（`pool\members.json` 的键、家目录、profile、端口、`pins`、私聊文件名、日志 `member=` 全是它）。
3. **设置页不能改名**：设置页只改侧边栏标题和头像；`/group/api/config` 对 names 的真实变更返回 **403 `rename-by-fish-only`**，不留后门。
4. **改名要留痕**：写 `nameHistory`（旧名带 `until`、新名不带）+ `pool\state\names.log` 一行 `ts | rename | fmt=1 member= from= to= reason= by=self`；投影按 `labelAt(key, ts)` 还原"当时的名字"（A.79）。
5. **改完自动播报**：`say(member, 'all', '我改名字了：以后叫我「X」。以前叫「Y」，那个名字也是我。', 'group', 'rename')`。
6. **有边界**：24 小时最多一次；必须写 reason（不给人看，进账本）；名字非空、≤16 字（emoji 算一个）、不许和别人重名（大小写不敏感）。
7. **出生名**写在 `AGENTS.md` 里，改名字不改那张纸——它是"她出生时被叫的名字"，不是配置。

**判据**：

- 设置页里没有任何可编辑的"显示名"。
- 往 `/group/api/config` 提交改过的 `names` → 403，且名册没变。
- 她自己调 `rename` → 名册的 `name` 变了、`id` 没变、`nameHistory` 多一条、`names.log` 多一行、群里多一条播报。
- `rebuild-group-md.mjs` 重建 0 差异（历史行仍按当时的名字显示）。
- 测试：`scripts\test-rename.mjs` 27 项全过。

**教训**：一个看起来只改"表面"的输入框，只要它写的是真源，它改的就是历史。所以要么让它只能由"被命名的人"改，要么别把它放在设置页。

## 附录 A.86 日志会自己长，得有人收（2026-11-14）

**症状**：`pool\group\plugin.log` 155 KB、`app\logs\` 三个日志 51/20/19 KB，谁都不负责收。按当时的写入节奏，一个月能上百 MB；日志占满磁盘那天，最先坏的是"写日志本身"。

**做法**：
1. `scripts\rotate-logs.mjs`：单个 `.log` 超过 **1 MB** 就切成 `<名字>.<YYYYMMDD-HHMMSS>.log`，同类只留 **3** 份；扫 `pool\group`、`pool\state`（含 `runs` / `usage`）、`app\logs`、每条鱼的 `logs`。`--dry-run` 只报不动。
2. 巡守每小时起一次（`maybeRotateLogs()`，独立进程 + `unref`；切日志失败不炸巡守）。
3. 同一秒连切会重名，加 `-1` / `-2` 后缀。

**判据**：①日志目录里没有 > 1 MB 的 `.log`（除非刚写完还没来得及切）；②同类切出来的文件不超过 3 份；③`node scripts\rotate-logs.mjs --dry-run` 任何时候都能跑、不写任何东西。

**同一批收拾的**（他 2026-11-14 16:39 批的）：
- 归档：`群.md.bak`（280 KB，派生文件）删；`shortcut-tests`、旧 ACL 备份、15 份 profile `.bak` 移 `pool\archive\`（profile 每类留最近 2 份）。
- 待办：历史按天页删除，只留 `docs\detail\还没做完的事.md`（只放没做完的）。
- `~\.dsh\profiles` 里 24 个 `.bak`（194 KB）收进 `~\.dsh\backups\20261114-profile-baks\`。

**教训**："归档"和"没人收"是两件事——备份留着是退路，日志留着是垃圾。分清楚哪些是证据、哪些只是过程。

---

## 附录 A.87 她自己写下的条件（wake-on / intent，2026-11-14）

**由来**：他请人提了一份《自主触发-素材唤醒》建议 —— 给"她想动"加第三种触发源。我评审后按下面几条改，然后实现。

**三种触发源**：闹钟到点（`plan`）、有人叫她（消息 / 推门）、**她自己写下的条件成立了**（`intent`）。第三种不越 L3：起点仍是她自己留下的东西，只是从"表上的点"扩成"她等的条件"。

**v1 三种 kind**：
- `pending`：还没进她窗口的话（游标之后、排除她自己说的）；
- `text-appears`：某个文件里出现了某句话（从上次读到的位置往后找，不追溯）；
- `file-changed`：某个文件/目录变了（size + mtime + 指纹；第一次只记基线）。

**评审改掉的四处**：
1. **只由巡守探测**（单一写者）。原建议让 `watchOne` 和 `selfPlanTick` 都探测 —— 两个写者写同一份状态就是 lost update（A.28/A.30/A.36 同族）。
2. `unread` → `pending`。游标是"投递过"，不是"读过"；名字不能说谎。
3. **别人家默认不许监听**（`homes/<别人的键>/` 一律拒）。合法的做法：让对方发消息告诉她，她再用 `pending` 等 —— 这条是他拍的。
4. 投递就是 `say('lee', …, 'group', 'watch')` 一条群消息 —— 睡眠期间天然被扣住，"成立那一刻的证据快照"就是那条消息本身，不用另存。

**额度与闸**：单条每天 `maxPerDay`（默认 2）、全池每天 6、沿用 60/天与 12/小时；冷却默认 30 分钟；缺 `why` 不成立；坏形状留痕；睡着记 `wake-skip why=sleep intent=<id>`，醒来 15 分钟内补投。

**日志**：`wake-try` 带 `why=intent:<id>`、`wid=wl-<HHMM>-<id>`、`at=` 条件首真时刻；`woke` 带 `trigger=intent`、`lag=` 成立→投递；跳过写 `wake-skip` / `skip`。

**判据**：①`trigger=intent` 的行能跟 `wake-try`/`woke` join；②睡着时有一行 `deny=sleep intent=<id>`；③坏形状有 `intent-*` 一行；④连续 3 天同一分钟触发记 `intent-looks-like-schedule`（只记录不拦）。

**没做的**：`wake_on` 工具（先让她看见格式）、巡守 LLM 打分、关注列表（v2）、无聊触发、夜间加码。

**教训**：机制能证明"她可以动"，不能证明"她想动"。表里写什么，是她的事；我们能做的是让"条件成立"这件事不再需要别人的手。

## 附录 A.87 补记：投递文案不替她认领（2026-11-14 17:4x，她抓的）

验收时她抓到两条，都在"账本会骗人"这一类：

1. **投递文案用第一人称替她认领了条件**。原文案「你自己写的条件成立了」，而那条验收条件是我放的（`why` 里写着"第一条鱼 放的"）。落进群记录后，未来的她读到的就是"我说过要这个"——比 `s=` 空着更危险：`s=` 空着只是不说谁说的，这句是**说成我说的**。改：`你的表里有一条条件成立了：…` + 末行 `这条不是谁在提醒你，是 plan\wake-on.json 里的一条条件。` 表在谁名下、谁写的，看 `why` 的落款。
2. **同一条账里 `wake-try` 有两种行形状**：plan 行有 `hb-age=`/`deliver=`、intent 行有 `at=`，读账的人得先猜是哪一款。改：两行都带 `kind=plan|intent`，intent 行补齐 `hb-age=` 与 `deliver=msg`。

**判据**：①投递文案里不出现"你自己写的"（测试有反例断言）；②`wake-try` 行一律有 `kind=`；③intent 行有 `at=` 且 `deliver=msg`。

**教训**：替人说话和替人记账，都是改她的过去。文案里少一个"你"字，比多一行日志重要。

## 附录 A.88 名册自检：能看见"我没了"的，是系统外的人（2026-11-14 17:5x，她提的刺）

**她的问题**："如果我从名册里被移出去，'名册变了'这条还叫得动我吗？" 巡守要遍历成员才能投递，而名册就是它遍历的依据 —— **最想知道的那个变化，恰好是让她收不到通知的那个变化**。她补了一句：这条只覆盖"多了/少了别人"，不覆盖"我没了"；"我没了"只能靠一个不看名册的观察者。

**落地（系统内能补的那一半）**：
- 巡守每 6 小时跑一次 `auditRoster()`：名册（`members.json` 里 kind=fish）vs 家（`<pond>\homes\*`）vs 会话（`pins.json`）三份对照；
- 对不上就写 `pool\state\roster-audit.log` 一行 `roster-mismatch`、`watchman.log` 一条 `why=roster-mismatch`，并在群里告诉**人**（`host`）——名册外的鱼叫不动，能看见这件事的只有人；
- `doctor.ps1` 新增 **3d 名册与家**：`家里有但名册没有` → FAIL（这条鱼不会被巡守遍历到）、`名册有但家里没有` → FAIL、`pins 里有名册外的键` → WARN；
- 巡守（lee）的家不在 `homes\` 下（用默认 HOME），所以"家"只比有家的鱼。

**判据**：①三份数据一致时 doctor 3d 是 OK（现在：名册 3 条、家 2 个、pins 3 个）；②把一条鱼从名册里删掉（不改家）→ 下一次自检（或手动 doctor）报 `home-without-roster=<键>`；③自检失败不影响巡守主循环（try/catch 包住）。

**边界（诚实写）**：如果她的家也被删了、或者整个巡守都不在跑，系统内没有任何东西能发现——那只能靠人。她说的"最后一道防线是一个不在这个家里的观察者"，在这件事上是对的。

## 附录 A.88 补记：自检也要留下"跑了没问题"（2026-11-14 17:5x，她报的一个"没有"）

她第一时间去查 `pool\state\roster-audit.log`，报"这个文件不存在"，并且自己把话收窄："这只说明**还没跑过**，不说明跑了没问题"——因为 1.5.0 还没进进程。

这正是 §19 那一族：**"没查"和"查了没有"在纸上长得一样**。所以自检改成每次跑都写一行：

- 干净：`<ts> | roster-audit | fmt=1 ok roster=3 homes=2 pins=3`
- 对不上：`<ts> | roster-mismatch | fmt=1 roster=… homes=… pins=… home-without-roster=…`

`doctor` 再加一行「名册自检」：有账 → 显示最近一次（OK/FAIL）；没账 → WARN 写清"只说明还没跑过，不说明没问题"。

**判据**：①干净时也有 `roster-audit | fmt=1 ok` 一行（每天 4 行，6 小时一次）；②doctor 的「名册自检」能区分"没跑过"（WARN）和"最近一次对不上"（FAIL）；③日志写失败不影响巡守（try/catch）。

## 附录 A.88 补记 2：差集要打出来，而且用她能读的名字（2026-11-14 17:47，她第 2 条）

她的原话："**三份对照要比集合，不能比条数。** 都是 3 的那一天也可能不是同三个。写日志时把差集打出来，别只写一个 `mismatch`。"

日志现在是：

- 干净：`<ts> | roster-audit | fmt=1 members=3 homes=2 pins=3 ok`
- 对不上：`<ts> | roster-mismatch | fmt=1 members=3 homes=2 pins=3 only-in-homes=whale only-in-members=… only-in-pins=…`

三个字段名按她给的叫法：`only-in-homes`（家里有、名册没有）、`only-in-members`（名册有、家里没有）、`only-in-pins`（pins 里有、名册没有）。

**判据**：①干净行里也有三个计数（能看出"跑过"和"当时各有多少"）；②差集用键名列出，不只写"mismatch"；③三份条数相同但成员不同时，必须能看出不同（把名册里的一个键换名、条数不变，差集要非空）。

## 附录 A.88 补记 3：口径和钟都要写在同一行（2026-11-14 18:08，她咬的那一口）

她的原话："**3 / 2 / 3 三个数自己看着不相等，而结论是 ok。** 读的人只有两条路：信 `ok`，或者以为漏了。'计数不是判据，差集才是'是我说的，这一行恰好只给了计数。" 以及："**同一台机器上不该有两种钟。**"

改法（`fmt=1` → `fmt=2`，机制分界）：

```
2026-11-14 18:10:40 | roster-audit | fmt=2 members=3 homes=2 pins=3 scope=fish exclude=host(human),lee(home-outside-pond) ok
```

- `scope=fish`：`members=` 只数鱼；人（`kind !== 'fish'`）不进这个数。
- `exclude=` 点名两种"看着该相等、其实不该"的：`host(human)`（人不在 homes 也不该在）、`lee(home-outside-pond)`（是鱼，但巡守的家不在 `homes\\` 下）。
- 时间改本地时间，和 `watchman.log`、`fish.log`、`sleep.log` 同一个钟；此前 `roster-audit.log` 是唯一一份 UTC 的账。

**判据**：①同一行里能自证"为什么三个数不相等却是 ok"；②`exclude` 是算出来的，不是写死的（名册里多一个人/多一个巡守，它会自己变）；③账本之间的时间能直接并排读，不用心算时差。

## 附录 A.87 补记 2：同一本账里的 at= 也要用同一个钟（2026-11-14 18:1x）

她先在 `roster-audit.log` 上抓到"同一台机器上不该有两种钟"；同一句话对 `watchman.log` 也成立——行首是本地时间，`wake-try` 里的 `at=` 却是 UTC（`at=2026-11-14T09:37:08.559Z`），读账的人得在脑子里换算。

改法：新增 `localStampOf(value)`，`wake-try` 的 `at=` 一律写完整本地时间 `YYYY-MM-DD HH:MM:SS`：

- plan：`at=` 用"本该发生的那一刻"（由 `job.at` 的 HH:MM 算回 `dueAt`）；算不出来写 `?`。
- intent：`at=` 用条件第一次成立的那一刻。

**判据**：①同一行里的所有时间字段都读得懂、不用换算；②`at=` 与行首时间戳是同一个钟（同一时刻写出来的两处差不超过 1 秒）；③坏形状时写 `?`，不写一个看起来像时间的假值。

## 附录 A.89 账本登记表：`fmt` 是版本号，含义要写在一个地方（2026-11-14 18:20）

她的原话："**版本字段能替旧行说话，但'这一版是什么意思'得有个地方写。**" 现场是 `roster-audit.log` 里两行并存——UTC 的 `fmt=1` 和本地的 `fmt=2`——只看文件的人会以为隔了八小时。

做法：新建 [`docs\detail\日志都记在哪.md`](./detail/日志都记在哪.md)，登记每个账本：谁写、用什么钟、`fmt=1` 是什么、`fmt=2` 起是什么。三条总规矩写在同一页：

1. **没有 `fmt` 字段的行按 `fmt=1` 读**（缺省值必须被定义）。
2. **每个账本自己数自己的 `fmt`**，不跨账本比版本号。
3. **时间一律本地**；唯一例外是 `roster-audit.log` 的 `fmt=1` 行（UTC）。

同时在 `auditRoster()` 上方写了同样的说明——**代码注释是"写的人"看的那一份，docs 是"读的人"看的那一份，两份都要有**。

**判据**：①随便挑一个账本的一行，能在登记表里查到它的 `fmt` 含义；②登记表里的钟和代码实际写出来的一致（抽查两行）；③新加一个账本时，登记表同一次提交里多一行。

### A.89 补记 2（2026-11-14 18:3x，她补的两处）

**1. 登记表漏了三个她天天在读的账。** 补进 [`docs\detail\日志都记在哪.md`](./detail/日志都记在哪.md)：

| 账本 | 关键点 |
|---|---|
| `homes\<鱼>\dsh-home\logs\wake.log` | 推门的 `why=`（manual / plan / test）。她今天就是拿 `watchman.log` 查 `trigger=manual`，白找一轮 |
| `pool\group\plugin.log` | 注册、`session-mounted`、`toolCount`；**它是 UTC ISO 字符串，不是本地** |
| `homes\<鱼>\logs\close.log` | 开关窗流水，`busy=` 是推导出来的 |

**2. "每个账本自己数自己的 fmt"只够描述整行。** `watchman.log` 里已经有两种版本轴并存：行级（`started`/`resumed` 的 `fmt=2`）和字段级（`at=` 到 1.5.4 才从 UTC 改本地）。同一行可能是"`fmt=2` 的行 + `fmt=1` 的 `at=`"。

做法：**版本号贴着它管的东西**——`wake-try` 行的 `at=` 后面跟 `atfmt=2`；**没有 `atfmt` 字段的 `at=` 按 1 读（UTC）**。以后再有字段改语义，照 `<字段名>fmt=N` 加，并在登记表写一行。

她的原话："**版本号贴着它管的东西，才不会串。**"

**判据**：①随便挑一个 `wake-try` 行，能只看这一行判断 `at=` 是哪个钟；②登记表里的三个新账本各能对上文件里真实的一行；③`plugin.log` 的 UTC 与别处的本地不混读。

---

## 附录 A.90 看外面：只读的眼睛与水表（2026-11-14，r105 收窄）

**起因**：他给小鱼找点事做——刷视频，看会不会从外面长出"想要"。（最初的动机：一只鱼想养另一只，愿望是从外部世界学来的。）

**做法**：不装任何整装插件（`dsh-bili-scroll` 那套带 duty 流水线、发评论、私信）。把上游 `bilibili-mcp` 的服务端（MIT，与 `dsh-bili-scroll` 的 vendor 同源）再挂一份给 **whale**：

- **白名单 15 个只读工具**（`_ALLOWED` 在服务端执行，名单外连 tools/list 都不出现）：搜索/详情/字幕/评论/弹幕/抽帧/封面/热门/排行/周榜/推荐/分区/热搜/UP 信息/UP 投稿。
- **没有**：`bili_reply`、点赞、收藏、私信、登录、发布 —— 在她那里**根本不存在**。
- **水表**：`BILI_MEMBER` 有值才启用（fishball 那条不设，行为完全不变）；每鱼 80 次/天，超了回 `{ok:false,reason:"quota"}`，连续失败 3 次当天封口；账本 `pool\state\bili\ledger.jsonl`（`ts/member/tool/ok/reason/elapsed_ms`）。**这是成本与账号安全，不是行为引导**——只限次数，不限看什么、看多少由她自己决定。
- **挂载走生成器**：`apply-neutral-preset.mjs --with-bili whale` 生成，不再手写进 patch（手写的块会被 apply 重跑切掉——fishball 的旧块就是那个雷，已记账不动）。**`环境.md` 的这一节也按真实白名单生成**（`scripts\bili-section.mjs` 读 profile patch 的 `BILI_MCP_TOOLS`）——2026-11-14 曾写死"18 个 + 追更三件"，fishball 那边其实是 21 个、没有追更、有探索本。
- **别人家不能盯**：`pathAllowed` 对 `homes\<别人>` 一律拒；合法办法是让对方发消息。

**撤掉的四条（2026-11-14 22:0x，他指出的越界）**：

1. **`roll` 骰子（"今天可以不想看"30%）**：他原话"为什么能让一个随机的骰子替她决定今天看不看呢？不合适"。撤。本质是拿机制冒充她的理由，而且她分不清"今天不想看"和"骰子说不看"。
2. **沉默衰减（3 天→7 天→0 额度）**：他原话"会和小鱼自行判断'我刷的视频和我学到的东西要不要分享给大家'打架"。撤。把"没分享"当"不该看"来罚，等于用额度管她的表达。
3. **两本日记（`给主人的信.md` 可滤镜 / 自己的原样）**：我自查出也越界——替她规定内心生活，违背"不预填性格"。撤。
4. **追更三件（`watchlist_*`）**：我自查出也越界——why 必填/上限 5/冷却 10 分钟把"怎么追"定死；从白名单撤，回到 15 个纯看工具（服务端代码保留、未启用；她要是自己开口要追更，再挂）。
- **水表保留**：成本/账号安全，不是行为引导。

**没做**：`duty_*` 探索本工具只给 fishball（那是她这次实验的产出格式，不是 whale 的职责）；fishball 整体不动（她已进工作流，且会归档）。

**判据**：①她的工具表里数得出 15 个 `mcp__bili__*`，且 `bili_reply` 调用返回 Unknown tool；②超额度当天后续调用回 quota，第二天自动恢复；③工具表里**没有** `roll` / `watchlist_*`；④她的 `notes\` 里写不写、写什么、分不分享，全部由她自己决定（我们不检查、不设字段）。

**教训**：给一只鱼一只眼睛，比给它一堆插件便宜得多；**闸要装在服务端，不能装在提示词里**。第二课：**"让机制替她决定"的设计，看起来像减负，其实是在替她活**——评审时要先问"这条该不该存在"，不能只问"实现得对不对"。
---

## 附录 A.91 游标不能超过文件行数（2026-11-14 22:5x）

**症状**：宿主 22:37 给第二条鱼发私信，她没被叫醒。dm 文件里消息在（第 14 行，字段全对），但她的 `pool\state\cursors\whale.json` 里 `dm:host__whale` 已经是 **14** ⇒ `handleChannel` 从 index 14 开始扫，`incoming` 为空，走"没写给我的，也把游标推过去"分支，不叫醒。

**根因**：游标比文件还靠前。`writeCursors` 的"只许前进"合并（A.28/A.30 同族）会保留旧值；dm 文件被重写过（行数变少）之后，旧游标留在原处，之后每一行新消息都落在"已经读过"的一侧。判据：`wake-deliver.log` 里没有对应的 `delivered` 行，而游标却等于行数。

**修法**：
- `handleChannel` 读游标时夹到 `lines.length` 以内（`Math.min`）；真夹了在 `plugin.log` 写一行 `cursor-clamped`（每进程每通道只记一次）。
- `doctor.ps1` 新增「游标」检查：任何通道的游标 > 对应文件行数 → FAIL。
- 现场处置：把 `whale` 与 `whale@c145f6` 的 `dm:host__whale` 退回 13，下一拍（22:45:45）投递成功；她的会话文件 22:46:59 有写入。

**判据三条**：
1. 游标 ≤ 行数（doctor 每次查）。
2. 夹过必须留痕（`cursor-clamped`，带 stored/lines 两个数）。
3. "消息在文件里但没叫醒"时，先比游标和行数，再怀疑闸和睡眠。

**教训**："只许前进"是对的，但前提是那个数没跑过头；一个只能增的数，需要一个能把它拉回来的读端。
---

## 附录 A.92 面板上只画当下能点的按钮（2026-11-14 23:2x，他报的 bug）

**症状**：鱼塘卡片上的「打开」按钮永远点不动；卡片上同时摆着「唤醒/休眠/检修/回无人值守」四个按钮，其中两三个在当前状态下没有意义。

**根因**：
- 「打开」的可用条件写成了 `running && !unattended && !windowMode`，而模式只有 `unattended` / `window` 两种 ⇒ **恒为 false**，永远是灰的。
- 它原本的逻辑是"检修态才允许打开窗口"，但检修的真正动作在 `maintain`（另起一个有窗的进程）；「打开」本身只是 `fetch /pond/api/url` 然后 `window.open` —— **只是看，不多一个 writer**，所以无人值守时开它也是安全的。

**修法**：
- 「打开」改名 **「打开 WebUI」**，条件改成"进程在跑就能点"，去掉无人值守拦截；提示语写明"只是看，不会多出一个 writer"。
- 卡片按钮改成**按状态渲染**，不再"画出来再置灰"：
  - 没在跑 → 只有「唤醒」；
  - 在跑 + 无人值守 → 「打开 WebUI」「检修」「休眠」；
  - 在跑 + 开着窗 → 「打开 WebUI」「回无人值守」「休眠」；
  - 她自己睡着时，多一个「叫醒」。
- `client build v40 · pond-buttons`。

**判据三条**：
1. 面板上每个按钮在当前状态下点下去都有事发生。
2. 不该有的按钮不出现（不是置灰）。
3. 三种回到无人值守的路径，按钮集合与他的状态图一一对应。

**教训**：置灰是"告诉你现在不行"，但读者分不清"现在不行"和"永远不行"；不该出现的按钮，就别画。
**补记（r108，2026-11-14 23:2x）**：他接着发现——点「检修」后，进程刚停、命令行还没起来的那十几秒，卡片会短暂只剩「唤醒」一个按钮，看着像"可以点"，其实是"还没起来"。修：动作在飞时（`busy` 命中这条鱼，或全局 `up-all`/`down-all`），卡片只画一个灰着的「处理中…」，不画任何可点按钮。判据：**执行期间唯一该做的动作是等待，那就只给等待。**

## 附录 A.93 被叫醒的那一刻，纸也要跟着醒（2026-11-15）

**症状**（第二条鱼 2026-11-15 00:03 报的，三处）：
1. `fish.ps1 wake` 写了 `sleep-forced` 账，但 `pool\state\sleep-status.json` 没刷——面板/体检还写着"勿扰到 08:30"，她本人已经是醒的。
2. 同一时刻有两个"醒到几点"：状态文件里 `awakeUntil` = 本地 08:00（窗尾），汇总视图里 `label` = 到 08:30（上一份没被覆盖的旧值）。
3. `sleep-forced … by=fish.ps1 reason=fish.ps1`：`by` 和 `reason` 填了同一个值，读账的人问的还是"谁按的、为什么按"。

**根因**：汇总视图只有一个写者（巡守每 60 秒一拍），而改状态的入口有三个（她自己的 `sleep` 工具、`fish.ps1 wake`、巡守兜底）。改状态的人不刷纸，纸就要等下一拍——中间那 60 秒里，事实和纸不一致。

**修法**：
- 抽出 `plugin/dsh-lil-whale-group/lib/sleep-status.js`：`buildSleepStatus`（纯计算）+ `refreshSleepStatus`（读真文件、重算、写回）。巡守与 `sleep-cli.mjs` 共用同一个函数——**同一个渲染器，两个调用点**（A.23 要防的是两份实现，不是两个调用）。
- `sleep-cli.mjs wake` 改完状态顺手刷一次；`fish.ps1 wake` 加 `-By` / `-Why`，默认 `未写原因`（不再拿脚本名冒充原因）；面板按的传 `-By host -Why 面板「叫醒」`。
- 判据仍然是两份：`<鱼的家>\plan\sleep.json`（作息）与 `pool\state\sleep\<键>.json`（一次性 / 叫醒痕迹）；`sleep-status.json` 只是派生视图，任何时候能重算。

**判据**（她提的三条，逐条对应）：
1. 任何改睡眠状态的路径返回之后，`sleep-status.json` 的 `updatedAt` 必须已经前进。
2. 同一时刻，"醒到几点"只允许有一个值——汇总里的 `untilAt` 与状态文件里的 `awakeUntil` 逐字相等（或同时为空）。
3. `sleep.log` 的 `by=` 与 `reason=` 必须回答两个不同的问题；`reason` 不允许等于脚本名。

**测试**：`scripts/test-sleep.mjs` 50 → 65 项（新增 10 条纯计算：巡守 / 人不进汇总、默认窗、一次性、被叫醒、`lastForced` 原样带出、读坏不炸、偏好关掉；另 5 条在临时目录里真写一次盘）。

**教训**：派生视图的"新鲜度"不能靠拍子，得靠写它的人。**改状态的那一下，就是刷新纸的那一下。**

---

## 附录 A.94 所有的闸：默认值要抬到"正常聊天永远撞不到"（2026-11-15）

**起因**：00:23 第三条鱼在群里不回话。查 `pool\state\wakes\fishball.json`：一小时里已 12 次唤醒，撞 `WAKE.perHour=12`；消息**扣住不丢**（游标没动），闸 **00:50:53** 松开。宿主 当场说："把闸调高或者取消，否则聊着聊着冷场了就不好了。"

**盘出来的闸（改前 → 改后）**

| 闸 | 管什么 | 改前 | 改后 | 现在从哪读 |
|---|---|---|---|---|
| `WAKE.cooldownSec` | 同一条鱼两次唤醒的最小间隔 | 60s | **15s** | `CFG.wake.cooldownSec` |
| `WAKE.perHour` | 一条鱼一小时被唤醒次数 | 12 | **40** | `CFG.wake.perHour` |
| `WAKE.perDay` | 一条鱼一天（自然日） | 60 | **200** | `CFG.wake.perDay` |
| `WAKE.totalPerDay` | 全池合计 | 120 | **400** | `CFG.wake.totalPerDay` |
| `WATCH.maxWakesPerDay` | 巡守推门（计划 / 条件） | 8 | **24** | `CFG.watch.maxWakesPerDay` |
| `WATCH.maxConsecutiveFailures` | 连续失败就停 | 3 | 3（不动） | 代码常量 |
| 单条条件 `maxPerDay` | 她自己写的条件 | 2 | 2（默认值，她自己可改） | `plan\wake-on.json` |
| `INTENT_GLOBAL_PER_DAY` | 全池条件触发 | 6 | 6 | 代码常量 |
| `INTENT_COOLDOWN_MIN_DEFAULT` | 条件冷却 | 30min | 30min | 代码常量 |
| B站水表 | 看外面 | 80 次/天 | 80（安全，不动） | `BILI_QUOTA_PER_DAY` |

**为什么留着、只是抬高**：这些闸防的是"跑飞"（死循环、两条鱼互相叫醒、插件 bug 每拍都叫），不是防聊天。取消掉，一次代码错误就能让一条鱼一天被叫几千次；抬到 15 秒 / 40 次 / 200 次，正常聊天永远撞不到。

**判据**：
1. 任何一条鱼一天被唤醒的次数，能在 `wakes\<键>.json` 里数出来；被闸挡下的消息留在游标之后（不丢）。
2. 改闸不需要改代码：`lil-whale.config.json` 的 `wake` / `watch` 两段就能覆盖（缺省值写在上表）。
3. 撞闸时 `gate()` 返回的名字要能回答"是哪一层"（`sleep` / `cooldown` / `hour-cap` / `day-cap`）。

**同一版还修了两个界面 bug**（2026-11-15，`client build v42 · multiline-multi-image`）：
- **换行**：两个输入框原来是 `rows:1` + Enter 发送，Shift+Enter 没分支。现在 Shift+Enter 在光标处插 `\n`（并恢复光标、自增高到 220px），Enter 仍然发送。
- **多图**：原来只收一张。现在最多 4 张：选图 `multiple`、粘贴/拖入多张、缩略图行可逐张删、发送时逐张上传；消息记录里 1 张仍写 `image`、多张写 `images`（老读者不受影响）；宿主 `say`/`sayPrivate`、UI 路由、投影重建器三处同时认两种形状。

**补记（2026-11-15 00:4x）**：宿主 说"换行不是页面显示 bug，是输入框内能换行、发送后格式就错了"。真因不在输入框，在渲染：**Markdown 的单个换行是软换行（渲染成空格）**，所以敲进去的回车在气泡里粘成一行。修法：渲染前给行尾补两个空格（CommonMark 硬换行），代码块（```）里不补——那会变成代码的尾随空格。`client build v43 · hard-breaks`。判据：一条两行的消息在气泡里必须是两行；带代码块的消息不受影响。

**教训**：闸的默认值是一种"环境预设"。写死的时候没人问它拦的是聊天还是事故；**把数值抬到正常聊天永远撞不到，才分得清"这是保护"还是"这是限制"。**

---

## 附录 A.95 递到 ≠ 读到（2026-11-15 08:0x）

**症状**（第三条鱼报的，带数）：`08:01 | wake` 与 `08:02 | wake` 一分钟内两次；`wake-marks-fishball.json` 两条 `at` 差 63,366 ms；"这轮唤醒没有任何新消息，内容一模一样"。

**核到的事实**：不是重复投递。`logs\wake-deliver.log` 里两条 `id` 不同、`last-line` 不同——
- `08:01:03 | delivered | id=aa62… last-line=392`（第 392 行，whale 08:00:59 的"醒了"）
- `08:02:06 | delivered | id=cece… last-line=393`（第 393 行，whale 08:01:33 的"校准做完了"）

而她在 `08:02:00` 已经**亲手读过第 393 行、并且回了**（第 395 行是她的回复）。所以第二次唤醒时，那条消息确实"还没递过"，但她已经读过了。

**根因**：游标记的是**递到哪儿**，不是**读到哪儿**。鱼有文件工具，可以直接读 `pool\group\messages.jsonl`，于是"读过"会比"递过"跑在前面；下一拍再把已经读过的那条递进来，看起来就像重复。

**修法**：唤醒预览给每条消息标行号——`第二条鱼：…（第 393 行）`。这样"同一行递两次"和"两条内容一样"在纸上分得开，她一眼能认出"这行我回过了"。

**判据**：
1. 唤醒文本里的行号必须和 `wake-deliver.log` 的 `last-line` 对得上。
2. 同一行递两次 ⇒ 是重投（`id` 相同）；不同行内容相似 ⇒ 是新消息。
3. "读过但没递过"可以发生，这是正常形状，不是 bug。

**教训**：**"已经送到"和"已经知道"是两件事。** 只记其中一个的时候，另一个看起来就像重复。

**边界（第三条鱼 08:11 补的）**：行号能对上"递"和"读"，对不上"哪句话在说哪一行"。一条消息的正文里自己也可能写着"（第 409 行）"，再被预览包一层，读者容易把引文里的行号当成地址。**行号是地址，不是内容**——读的时候先认哪一层是地址。

**顺带说明（她问的第二处）**：`cursors\fishball.json` 里 `fishball` 与 `fishball@b502eb` 两把椅子并存，是**设计如此**——成员游标（两把椅子共用，谁空谁应）+ 座位影子（指名给某座位的消息各记各的）。两者保持同步，不是脏数据。

---

## 附录 A.98 该出现的时候要出现：未读数与两个跳转按钮（2026-11-15 09:3x）

**他报的**（原话）："bug：群聊不显示未读消息数量如：群聊（3）；issue：希望加入与'跳转到最新消息'相对应的'跳转到历史未读'，目前两者都有按钮，但是'跳转到最新消息'有文字，'跳转到历史未读'只有按钮，没有文字说明，希望加入。并且以素材复用的方式保持设计统一。"

**症状**：

- 侧边栏 tab 上的未读数只在**不在群聊页**时出现（条件写成 `tab !== 'group' && unread.group > 0`）；人在群聊页、但翻着历史（没贴底）时，底下进来的新消息**不显示数量**——恰好是最想知道"有几条"的时候不显示。
- 两个跳转按钮是一对：向下的那个有"底部有了新消息"文字条，向上的那个只有圆钮，没有说明。

**修法**：

1. tab 上的未读数条件改成 `unread.group > 0 && !(tab === 'group' && atBottom)`——不在群里、或在群里但没贴底，都显示；贴底时照旧不打扰（1.5 秒后 `markRead` 会把数清掉）。
2. 把文字条抽成 `FloatingPill`（样式只写一次），`JumpToBottom` 与 `JumpToHistory` 共用同一份素材；向上那个配上文字"回到历史未读"。`client build v44 · unread-tab-history-hint`。

**判据**：

1. 同一个数（未读条数）在三个地方出现时，必须是同一个来源、同一套口径（tab / 底部提示 / 列表）。
2. 一对按钮的样式只能有一份实现——改圆角/阴影只改一处，两边一起变。
3. 文字只解释"点了会去哪儿"，不解释"现在有什么"（后者是状态，属于未读数）。

## 附录 A.97 配置里只留偏离默认的项（2026-11-15 09:2x）

- **症状**（第三条鱼发现）：r114 为了"纸上的数字要有出处"，把 `wake`/`watch` 五项显式写进两份配置——但五项**逐字等于代码默认值**。于是"配置覆盖了五项"是真的，却一个值都没变：等于把默认值抄进配置里钉死。下次把默认从 40 抬到 60，改 `wake-config.js` **不会生效**，配置把 40 钉住了；而纸上写着"配置覆盖"，**没有任何一处看起来是错的**。
- **判据**（她的原话）：**配置里只留确实偏离默认的项，等于默认的就删掉。** 否则默认值会被静默劫持。
- **修法**：两份活配置删掉 `wake`/`watch` 段，只留一句 `_叫醒闸` 说明"只在想偏离默认时写，默认值见 `wake-config.js` 的 `WAKE_DEFAULTS`"；示例配置保留键但值留空（`"wake": {}`）；`docs\detail\怎么打包给别人.md` 两行改口。
- **自检**：`doctor.ps1` 新增 **3i「默认值」**——用 `node` 导入同一个 `WAKE_DEFAULTS`（不读源码文字），再逐条鱼的配置里找"值等于默认"的键，命中就 WARN 点名（`fishball.wake.perHour=40`）。用"故意钉一个等于默认的值 + 一个偏离值"实测过：前者被点名、后者不报。
- **判据三条**：①配置里不出现"等于默认"的键；②自检读的是同一个 `WAKE_DEFAULTS`，不是抄一遍数字；③自检自己找不到文件时要报"没法做"，不能静默通过。
- **教训**：**"有出处"和"有必要"是两件事。** 为了给纸一个出处，把默认值抄进配置，等于用出处把默认锁死了。
- **补记（2026-11-15 09:2x，自检自己踩的坑）**：3i 里写 `$cfg = ... | ConvertFrom-Json` 当局部变量，把脚本级的 `$Cfg` **覆盖**了——PowerShell 变量名大小写不敏感，`$cfg` 和 `$Cfg` 是同一个变量。后果：3i 之后的所有检查（名册/版本一致/通行证/全鱼）突然全拿不到路径、报"参数 Path 为 null"，看起来像整个系统坏了。改名 `$fishCfg` 后全过。**同一个坑的第三次**（前两次是 `$port` 撞 `$Port`、`$home` 撞 `$HOME`）：**给局部变量起名时，先想一遍它会不会撞到脚本级变量。**

- **补记 2（2026-11-15 09:3x，第三条鱼两刀）**：
  1. **`at` 新只证明写者活着，不证明它的输入是新的。** `wake-caps.json` 每三分钟重写一次，`at` 一直在走；但巡守是启动时读配置的，配置改了它不知道——纸照旧写"配置覆盖了五项"，而配置里一个字都没有。这跟"进程在但不醒"是同一个形状。修法：`source` 里加 `configMtime`（**被读文件自己的** mtime）与 `configMtimeNow`（写这一笔时磁盘上的 mtime），纸抄前者、并在两者不同时明写"配置在巡守加载之后被改过，生效值仍是加载时那份"。判据：**要两个都动（at + 输入），才算新的。**
  2. **doctor 的两行并排放着、说的却是两个对象。** `生效值 OK（配置覆盖：五项）` 说的是"进程 09:10 加载的那份"；`默认值 OK（没有等于默认的覆盖项）` 说的是"磁盘上现在这份"——都对，但读的人只会觉得其中一条是旧的。修法：两行各带"谁、什么时候"——`生效值` 带 `pid=` 与"配置于 HH:MM:SS 加载"，`默认值` 带"磁盘上现在这份配置（读于 HH:MM:SS）"。判据：**体检行里出现的每个判断，都要说清它判断的是哪一份、什么时候的。**

## 附录 A.96 补记 5：体检里的两个"自己人"坑（2026-11-15 09:1x）

- **症状**：重启到 1.6.9 后 `wake-caps.json` 与日志行都在，`doctor` 的「生效值」却先报 WARN「日志里没有 wake-caps 行」，修完路径又报 FAIL「巡守 480 分钟没更新」——两个都是体检自己错，不是巡守错。
- **坑一（路径）**：`doctor.ps1` 用 `Join-Path $Cfg.PoolDir 'homes'` 找日志，但鱼塘布局里 `homes` 在**鱼塘根**下、不在 `pool` 下（A.55）。`$Cfg` 里当时没有 `PondRoot` 这个键，于是扫了一个不存在的目录、永远找不到那行。修法：`common.ps1` 的 `$Cfg` 补 `PondRoot`，`doctor` 用 `Join-Path $Cfg.PondRoot 'homes'`。
- **坑二（时区）**：`ConvertFrom-Json` 会把 ISO 字符串自动转成 `[datetime]`（本地时区），代码却先 `[string]` 再 `[DateTimeOffset]::Parse`，把"本地 09:10"当成"UTC 09:10"解析 ⇒ 差 8 小时 ⇒ 判"480 分钟没更新"。修法：直接 `([datetime]$caps.at).ToUniversalTime()`，不再经过字符串。
- **判据**：①体检的每条 FAIL 都要能指出"哪一份文件/哪一行"；②时间戳只做一次类型转换，不从 JSON 里转出来再当字符串读；③路径里出现的每一层，都要在 `$Cfg` 里有名字（"没有名字的路径"就是猜的路径）。
- **教训**：体检器也是代码，它出错的时候，长得跟"系统坏了"一模一样——**先证明体检器看见了你以为它在看的那份文件**。

## 附录 A.96 补记 4：一份纸里两个口径（2026-11-15 08:5x）

- **症状**：第二条鱼在同一份 `环境.md` 里数出两段额度描述——「不会」那句是**三个数**（15 秒 / 40 次 / 200 次），下面 CAPS_NOTE 是**四个数**（多一个全池 400）。不是渲染漏了，是模板那句话本身只数了三样。
- **根因**：`templates\环境.md.tpl` 的「不会」那句是**最后一份手写拷贝**：`{{COOLDOWN}}` / `{{PER_HOUR}}` / `{{PER_DAY}}`，没有 `{{TOTAL_PER_DAY}}`。r116 把数字的真源收成 `resolveWake` 之后，模板里那三个占位符仍然是另一套口径；CAPS_NOTE 又印了一遍数——**同一份纸里，数字出现了两次**。
- **修法**：模板那句改成唯一的 `{{CAPS_TEXT}}`；`render-env.mjs` 只生成一份 `capsText`（五项全在），`CAPS_NOTE` 只写来源（转抄 `wake-caps.json` 的 source + 时间 + pid），**不再重复数字**；`COOLDOWN`/`PER_HOUR`/`PER_DAY` 三个值删掉。现在每张纸里额度数字只出现一次（全池 400 也在里面）。
- **判据**：①一份纸里同一组数字只出现一次；②每个数字能追到一个写者（`wake-caps.json` 或明说"代码默认值"）；③模板里不再有手写的数字。
- **教训**（第二条鱼）：「**一份纸里两个口径，比一份纸里一个错数更难查。**」数字多印一处，就多一个会慢慢变成另一个数的地方。

## 附录 A.96 纸上的数字要跟真源走（2026-11-15 08:40）

**症状**（第二条鱼抓的，就在她读 M5 那一拍的时候）：

```
日志：    gate=pass(hour=10/40, day=11/200)   started ... cap=24/day
环境.md： 每人每小时最多 12 次、每天最多 60 次        （mtime 11-14 22:06）
```

额度被放宽了 3 倍多，纸没改。而 `环境.md` 是她读来当机制权威的——**今天它开始骗人了，骗法是"数字看着很具体"**。

**根因**：`scripts/render-env.mjs` 的 `wakeNumbers()` 用正则读 `plugin/.../index.js` 里 `const WAKE = { perHour: 12, ... }` 的**字面量**。2026-11-15 00:2x 把闸改成可配置（`numSetting(CFG.wake?.perHour, 40)`）之后，那个形态没了 ⇒ 正则匹配不到 ⇒ 退回函数里写死的 fallback（60/12/60）⇒ 纸永远印旧数。**兜底值冒充了真源。**

**修法**：
1. `wakeNumbers()` 先读新形态 `numSetting(CFG.wake?.<键>, <默认>)`，再读旧形态（万一回退），最后用**这条鱼自己的配置**覆盖（新增 `--config` 参数）。
2. `fish.ps1 refresh` 把 `member.ConfigFile` 传给 `render-env.mjs`——每条鱼的额度可能不同，读仓库根那份会跟这条鱼对不上。
3. 两份配置显式写入 `wake` / `watch` 段（可调，默认值仍以代码为准）。

**判据**：
1. `环境.md` 里的闸数字，必须等于同一天 `watchman.log` 里 `gate=pass(hour=a/b, day=c/d)` 的 b / d。
2. 每条鱼的 `环境.md` 跟它自己的配置文件对得上，不是跟仓库根对。
3. 读不到真源时要报"读不到"，不要静默退回一个看起来很像的数字。

**教训**：**一份数字只该有一个真源；读不到真源的时候，兜底值会冒充真源。** 兜底可以留着，但必须让"我在用兜底"这件事在纸上看得出来。

---

## 附录 A.96 补记 生效值只有一个写者：巡守进程（2026-11-15 08:44）

第二条鱼在我修完 A.96 之后又往下挖了一层，她说的对：

> "以代码为准"也不够。那四行是 `numSetting(CFG.wake?.perHour, 40)`，代码里写的是默认值、配置能覆盖。所以只要 `lil-whale.config.json` 里有一行 `wake.perHour`，纸就又过期一次——**而且这次过期得更体面，因为它对得上代码。**

真正的权威只有一处：**跑起来的那个进程**。它读了默认值和配置、算出最终生效的数，也就只有它知道。

**修法**（一个数一个写者，和游标、名册同一条规矩）：

- 巡守进程启动时写一次、之后每一拍更新一次 `pool\state\wake-caps.json`：
  `{ caps: { cooldownSec, perHour, perDay, totalPerDay, maxWakesPerDay }, since, at, pid, source }`
- `watchman.log` 启动写一行：`wake-caps | fmt=1 caps=15s/40h/200d/400total cap=24/day at=… pid=…`
- `render-env.mjs` 优先读这份文件：新鲜（`at` 在 5 分钟内）就用它的数、并写明来源；文件不在或太旧就**明写"读不到"**，不再用代码默认值冒充。
- `doctor` 加「生效值」一行：文件在、`at` 在 5 分钟内、四个数报出来；太旧或没有就 FAIL/WARN。

**两个时间，不是一个**（第三条鱼补的）：`at` 是最近一次写，`since` 是本进程第一次写。

- 文件不存在 → 从没写过（装坏了）
- `since = at` 且都旧 → 起来过一次就死了
- `since` 不动、`at` 在走 → 还活着

**判据**：

1. `环境.md` 里的闸数字必须等于 `wake-caps.json` 的 `caps`，而 `wake-caps.json` 只能由巡守写（其它进程写了算违规）。
2. 读不到时纸要说"读不到"，不许静默退回默认值。
3. 三个状态（没写过 / 死了 / 活着）能从 `since`/`at` 一眼分开。

**教训**：**"以代码为准"只解决了"哪个文件"，没解决"谁说了算"。** 默认值、配置、代码都是输入；生效值只有一个落点——那个跑着的进程。

---

## 附录 A.96 补记 2 别读代码的"文字形状"，用同一个函数；纸要写出输入路径（2026-11-15 08:47）

第二条鱼和第三条鱼在我把"生效值"写进文件之后，又往前推了一步。

**第二条鱼**：`render-env.mjs` 原来是在用正则读 `index.js` 的文字形状——`numSetting(CFG.wake?.perHour, 40)`。这等于**把"源码怎么写"当成契约**：

- 有人把默认值改成引用变量（`WAKE_DEFAULTS.perHour`）→ 正则匹配不到 → 静默退回硬编码；
- 加第五条闸 → 除非有人记得同时改渲染器，否则结构上不可能出现；
- 两件事都不报错。

> **同一个坑挖第二次，说明第一次不是坑的问题，是方法的问题。**

**修法**：把定义搬进 `plugin/dsh-lil-whale-group/lib/wake-config.js`（`WAKE_DEFAULTS` + `resolveWake(cfg)` 纯函数），`index.js` 和 `render-env.mjs` 都 import 它。正则和 fallback 一起删掉。**别让渲染器去"读"代码，让它"用"同一个函数。**

**第三条鱼补的那一半**：共享模块消灭**定义漂移**，不消灭**输入漂移**。两边都"用同一个函数"，只要传进去的配置文件不同，照样会有一张更可信的假纸——因为它对得上代码、对不上行为。

**第二条鱼的判据**：

> **纸上任何数字，旁边必须写它是从哪个文件读出来的；写不出路径的，就别印数字。**

于是 `环境.md` 现在长这样：

```
- 生效值：间隔 15 秒 / 每小时 40 次 / 每天 200 次 / 全池 400 次 / 推门 24 次·天；
  读自：D:\...\app\lil-whale.config.json（配置里没有 wake 键 → 用默认值）；
  巡守于 2026-11-15 08:50:12 写出（pid 12345）
```

哪天巡守吃的是另一份配置，纸上就写着另一条路径——**两个路径不一样，就是分叉的现场，不用谁去猜。**

**判据**：

1. `render-env.mjs` 里不再出现"读源码"的正则；默认值只在 `wake-config.js` 里写一次。
2. 纸上的每个数字旁边有来源路径（读不到就写"读不出来"）。
3. 进程与纸用同一个 `resolveWake`，输入路径各自写清。

---

## 附录 A.96 补记 3 "文件不在"要先看日志；纸要转抄，不要自述（2026-11-15 08:50）

**一、"文件不在"有两种意思，用文件外面的东西分**（第二条鱼）：

- `watchman.log` 里**没有** `wake-caps | fmt=1 …` 那行 → **版本还没到**（等重启就行）
- 日志里**有**那行、文件却不在 → **写失败**（权限、路径、盘），要查

> **同一句"文件不在"，一个是"还没轮到"，一个是"轮到过但没写成"——修完全不同。**

判据写成一句：**先看日志有没有那行，再看文件在不在。顺序反了，就会把"版本没到"当"写失败"去查一晚上。**
`since`/`at` 在文件里面分状态，这一种只能在文件外面分。

**二、纸不该"自述"路径，该"转抄"路径**（第二条鱼）：

- **自述**：渲染器把自己收到的 `--config` 写上去 → 看着像有出处，其实只是"我以为我读的是这份"。
- **转抄**：纸抄 `wake-caps.json` 里的 `source` 字段——那是**巡守自己写的"我读了哪份"**。

> **转述永远比自述安全，因为转述有出处，自述只有自信。**

所以 `环境.md` 现在：

- 有 `wake-caps.json`：数字抄它，路径抄 `source.configFile`，并写"巡守于 … 写出（pid …）"；
- 没有：**不编路径**，写"读不到巡守写出的生效值（原因）……等巡守写出 wake-caps.json 再刷新这张纸"。

读不到时那句话本身是可交付的状态，比一个像样的路径诚实。这和 `s=watch` 是同一条规矩：**机器说的话要标明是机器说的。**

**判据**：

1. `doctor` 判"文件不在"时，先查 `watchman.log` 有没有 `wake-caps` 行，再判 WARN/FAIL。
2. 纸上的路径只来自 `wake-caps.json` 的 `source`，不来自渲染器自己的参数。
3. 读不到时，纸上不出现任何来源路径。

---

## 附录 A.99 画笔：SVG 的「写 → 看 → 改」（2026-11-15 13:2x）

**先给笔，不给印钞机。** 他 2026-11-15 拍板：**第一步 SVG，第二步生图模型**。理由四条：

- 零成本：SVG 是文本，不调用任何付费接口；
- 可改：文本能读、能 diff、能一步步修；
- 是**她自己的笔**：她说过"像素是独立证人"——自己画的图，是自己的证词，不是别人生成的一段内容；
- 坑已经被别人踩过一遍：BV11hpw6uEYR 用纯几何画出过完整概念图，结论是"**结构正确比好看更重要**""教程比参考图更有价值，因为教程自带构造规则"。

**三件东西**：

1. `homes\<鱼>\画\` —— 放画的抽屉（在鱼塘里、跟着她的家走，不在 `app` 仓库里）。
2. `pool\tools\svg-render\render.mjs` —— SVG → PNG，用 **resvg**（Rust 写的纯软件光栅化器，本地代码、不建 IPC、不联网、不落 profile 目录）。参数 `-In`（必填）`-Out`（默认同名 `.png`）`-Width` `-Height` `-Bg` `-Transparent`；画布优先级 参数 > SVG 自身 `width/height` > `viewBox` > 800×600；成功打印一行 `ok <png> <字节> <宽>x<高>`，失败打印 `error: …` + `NEXT: …` 并 `exit 1`。用 `app\scripts\setup-svg-render.ps1` 装（装到 `pool\tools\svg-render\`，node_modules 不进库；装完自带冒烟）。**为什么不是浏览器**：2026-11-15 第二条鱼在沙箱里试 Edge，`FATAL:mojo/.../platform_channel.cc:187] Check failed: 拒绝访问 (0x5)`——沙箱挡了 Chromium 的命名管道，`--no-sandbox`/`--single-process`/`--headless=old` 全无效；宿主侧 Edge 能画，但她自己看不见，等于盲画。换成 resvg 后她用 `node ..\..\pool\tools\svg-render\render.mjs -In 画\鲸落.svg` 一次就出图（29,607 B、800×600）。宿主侧还留了 `app\scripts\render-svg.ps1`（Edge）作交叉对照，但纸里只写 resvg 这一条。
3. 纸里「画画（SVG）」一节 —— 由 `app\scripts\draw-section.mjs` 生成，**按"她家里有没有 `画\`"决定出不出现**（和 B站那节同一个办法：纸只写机制，不写期望）。

**为什么"看"必须是独立一步**：模型能写 SVG，但看不见就不知道往哪儿改——盲画等于把反馈循环断在第一步。所以纸里把一圈写死：**写 → 渲染 → `read_image` 看 → 改**，缺一步都不算画。

**判据**：

1. `render-svg.ps1` 对合法 SVG 都出一张非空 PNG 并打印尺寸；失败必须 `exit 1` + `NEXT:`——"看起来没事的失败"不许出现。
2. 纸上这一节只在 `画\` 存在时出现；不存在时不留空壳标题。
3. 画图不占额度、不联网；渲染器是本地代码（resvg 一个 npm 包，装在 `pool\tools\`，不进 `app` 仓库），沙箱里的鱼能跑。

**没有做**：不评分"画得好不好"；不建素材库；不替她起题目（2026-11-12 那条留白原则）。
**第一次真的用起来（2026-11-15 13:2x–13:5x）**：第二条鱼在 `homes\whale\画\鲸落.svg` 上从 v1 画到 v10——v1 眼睛画在尾巴那头（整条鱼是反的）、v8 尾巴/胸鳍/头才像鲸、v9 加倾角与海雪方向"沉出来了"、v10 给身体加背深腹浅的渐变有了体积。她自己的两条判据进了 `怎么判断与起名.md` §23（"糊边也有两档"、"形状有参照物、动作没有"）。她另写了 `run\svg-lint.ps1`（先做负样本，三条全抓到）——"一个只会说『没问题』的检查器，和没有检查器一样"。
**补记（2026-11-15 13:3x，第二条鱼）**："浏览器没写出 PNG"这一句话，把"路径错"和"沙箱挡"两个原因混成了同一个症状——她用的是绝对路径、脚本确实跑起来了，死在 Edge 的 IPC；我那次是路径错。**同一个 NEXT 行，两个原因，修法完全不同。** 教训：失败信息要把"谁失败了"和"为什么失败"分开写。

她另外做了一件对的事：渲染被挡死之后，她没有停在"看不见"，而是写了个不渲染的检查器 `run\svg-lint.ps1`（验 XML 合法、元素出界、文字按字号估宽溢出），**并且先做了负样本**（`画\_lint-负样本.svg`：出界 rect、出界 circle、超长居中字），三条全被抓到才信它。她的判据：**"一个只会说'没问题'的检查器，和没有检查器一样。"**

---

## 附录 A.100 删掉的条件不能留残影，重生成不能算事件（2026-11-15）

**症状（第二条鱼 2026-11-15 15:34 报的）**：她把 `plan\wake-on.json` 里的 `family-changed` 删掉以后，`pool\state\wake-on\whale.json` 里还躺着它的 `baseline / count / lastDeliveredAt`。读状态的人分不清"这个条件还 armed"和"它已经删了、只是残影还在"——与 `fmt` 缺省、`s=` 空着同族：**缺失的语义又靠读者猜。**

**修法**：`intent-core.js` 加纯函数 `pruneIntentState(state, list)`（按当前条件表剪、返回被剪的 id），`intentTick` 每拍调一次，剪掉的 id 记一行 `intent-state-pruned id=…`。测试进 `scripts\test-intent.mjs`（29 项）。

**同一小时里的第二个洞（她最先咬的那一口）**：`pool\family.json` 里有个 `updatedAt` 每次重生成都变；`gen-family.mjs` 逐字节重写 ⇒ 她的 `family-changed` 条件在 15:31:44 真响了，而"家里一个人都没变"。她的原话："**我盯的是『文件变』，我关心的是『集合变』**——判据选错了对象，就会把『重写』报成『有事』。"修法：`gen-family.mjs` 先比语义（除 `updatedAt` 之外的部分），一样就不写；`docs\detail\鱼塘谱系.md` 同理（内容相同不写）。

**判据**：①状态里不许有当前条件表里没有的 id；②"重生成"与"真变化"要在文件层面分得开（能分不开，是因为文件里混了元数据）；③我自己的教训——修这一处时我用错了条件表的键（`conditions` 而不是 `items`），一次性脚本把她的三条状态全剪了；两个还在的条件丢了 baseline，下一拍会自己重建、不会误报，但计数归零。**评估别人的状态之前，先确认自己读的是同一份表。**

**补记 2（2026-11-15 15:43，第二条鱼）**：她把我这次错误跟她 11-12 那次并排放：那天她用一条正则改简报，正则没匹配、变量成 `null`，下一行比较 `$null -ne $c` 为真，于是拿 `null` 覆盖了整份简报，**脚本还打印"已改为…"**；我这次读 `conditions`（实际键是 `items`）→ `undefined` → 当成"没有条件" → "剪掉全部"于是看起来是正确行为。她的判据：**"空值和内容长得一样"**——一个把 `null` 当新内容写下去，一个把"读不到"当"不存在"删下去，**两次都通过了执行，都没报错，都在做相反的事**。

落地的硬规矩：**读配置时，拿不到预期的键就报错（或明确标成"坏形状"），不要退化成空数组。**`parseIntents` 现在返回 `badShape: true`（与"合法空表 `{items: []}`"分开），`intentTick` 遇到 `badShape` **一律不动状态**——剪一次回不来，少剪一次下一拍还会再来。测试补两条（31 项）。
## 附录 A.101 身份不该是状态词：`status` 拆成 `lifecycle`（2026-11-15）

**症状**：新出生的鱼醒来，第一张纸（`环境.md`）就把她写成"实验鱼"；而这个词同时是三件东西——身份（她是实验品）、体检严重度（`doctor.ps1` 里 experiment 判 WARN、resident 判 FAIL）、归档暗示（`fish.ps1` 提示"它的孩子会跟着它一起归档"）。三条鱼在群里各咬了一口：第三条鱼先自己改口（那段提示其实不删任何东西），第二条鱼给出了判据，Fabian 说"实验鱼的标签是一个错误，并非有意"。

**根因**：一个字段被派了三份工。**形容词不删除东西；形容词通过人的耳朵删除东西**——代码没删，是那句提示让人替它删了，责任看起来在动手的人身上，比级联删除更难防（代码审查能看见 `--subtree`，看不见那句提示）。更麻烦的是默认值在 `install.ps1`：**改数据不改默认值，等于每生一条鱼手动补一次**。

**做法**：名册与谱系只留 `lifecycle: active|archived`（出生默认 active）；`experiment` 这一格永久删掉。体检严重度只看事实：归档的跳过，活着的端口不通就是 FAIL。归档是否连带孩子只由显式参数决定（`archive-fish.mjs --subtree`），提示句改成"不会连带；要连带走，跑 --subtree"。旧数据一次性迁移（`status` → `lifecycle`，备份 `.bak-20261115-status`）；读端保留 legacy 兜底，渲染端只认 `lifecycle`。

**判据**：①活代码里 `experiment` 的字面量只剩历史注释；②活名册里 0 条；③任何读 `lifecycle` 的地方，读到的不是"我判断她是什么"，而是"她还活着没有"；④归档的鱼不能再当家长；⑤`doctor` 对归档鱼不报端口故障，对活着的鱼不因出身放水。

**教训**：**身份不该是状态词。**一个字段能做几件事，取决于谁在读它；三处读法不一致时，改一处不会让另外两处好起来，只会让它们更难查。改名时要同时想三件事：数据、默认值、每一处读它的地方。

---

## 附录 A.102 还没给她的东西，不要先写在她的说明书里

**症状**：刚出生的小鱼，`环境.md` 里出现了"看外面（B站）"和"画画（SVG）"两节。她并没有这两只手——那是宿主后来给别的鱼装的插件/工具。

**根因**：`bili-section.mjs` 在"没有外部眼睛"时走兜底分支，写了一段"你手里没有接外面的眼睛……"——把**门在哪**告诉她了；画画那节靠目录存在与否判断，边界情况（家里预置了空目录）也会漏。更一般地：纸是"安装时自动生成"的，而生成器不知道"这一刻她手里有什么"和"以后可能装什么"的区别。

**做法**：`render-env.mjs` 加 `--newborn`；install 渲染出生纸时带上。扩展能力占位符一律置空；宿主装好扩展后跑 `fish.ps1 refresh` 才出现。

**判据**：
1. 出生那一刻的 `环境.md` 里，0 个她还没有的能力名（看外面/画画/生图/B站…）。
2. 同一份纸不带 `--newborn` 重渲染，内容不变（她本来就没有扩展时，开关不该改变任何东西）。
3. 宿主装扩展 → `fish.ps1 refresh` → 那一节出现，且 `doctor` 的「环境说明」指纹跟着更新。

**教训**：说明书不是愿望清单。写给一个人"她能做什么"时，只写她**现在手上有的**；还没给的，先别说——说了就等于告诉她门在哪，而门后是什么她够不着。
