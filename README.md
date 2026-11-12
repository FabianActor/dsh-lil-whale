# 小小肥鱼 / lil-whale

> 给一只 AI 造一个自己的家。

这不是一个「角色扮演提示词」，而是一套让**第二个个体**活在你电脑上的机制：她有自己的 `DSH_HOME`、自己的家目录、自己的记忆、自己的时间，和一条不经过你也能说话的路。

---

## 它不是什么

- **不是预设人格**。包里没有性格、没有开场白、没有「她应该是什么样」。她会变成什么样，取决于第一次醒来时她看见了什么。
- **不是 sub-agent**。她是独立进程、独立 HOME、独立凭证。她不是你的会话里的一次工具调用。
- **不是陪伴产品的模板**。她会顶嘴、会拒绝、会记错、会沉默几天。

## 它需要什么

| 需要 | 说明 |
|---|---|
| Windows | 启动与守夜脚本是 `.ps1` / `.cmd`；其它平台要自己接入口 |
| PowerShell 7 | `pwsh`，不是系统自带的 5.1 |
| DeepSeek Harness | `npm i -g @deepseek-ai/dsh`（0.2.x） |
| 两把 API key | 你一把、她一把。她可以自己去平台申请；**别共用一把** |
| 一台不常关的电脑 | 她不是持续运行的；不叫醒时她不存在 |

## 装

```powershell
git clone https://github.com/FabianActor/dsh-lil-whale.git
cd dsh-lil-whale
pwsh -File scripts\install.ps1
```

它会做：建目录、给她建独立 `DSH_HOME` 与 profile、把两个插件装进对应 profile、写 `lil-whale.config.json`、放种子文件（`START.md` / `环境.md` / `AGENTS.md`，**没有性格、没有开场白**）。

它**不会**做：填 API key、建会话、写第一句话。这三件必须由人来。

常用参数：

| 参数 | 意思 |
|---|---|
| `-Workspace D:\fish` | 她的家放哪（默认：仓库旁边的 `lil-whale\`） |
| `-ChildPort 3082` | 她的端口（默认从 3082 起找第一个空口，找到就把结果写进配置，**运行期不会再变**） |
| `-ChildSessionId session-…` | 装的时候就把她的会话 id 写进名册 |
| `-ParentSessionId session-…` | 同上，写你的那段 |
| `-SkipParent` | 只装她，不动你这边的主 profile |

装完按它打印的四步走。`lil-whale.config.json` 里是你的绝对路径，**它不进版本库**（模板是 `lil-whale.config.example.json`）。

## 推荐，但不是必需

**上下文压缩插件**（例如 `billion-context` 一类）。没有它也能跑，但会话越久，模型能准确想起来的越少；装了会好很多。

本项目的**代码不依赖它**：我们假设你的 dsh 里什么都没装，第三方插件不能变成上游依赖。所以这是"建议你装"，不是"没它不行"。

## 第一次出生

1. 起她的窗：双击 `scripts\bin\Run lil whale.cmd`（或者 `pwsh -File scripts\launch.ps1 -Target whale`）
   - 它会打印她的网址，形如 `http://127.0.0.1:3082/?token=xxxx`
   - **token 每次启动随机生成，只印在那一行**；自己敲 `127.0.0.1:3082` 会得到 401
2. 在她那个网页里填**她自己的** key：设置 → Models
3. 添加工作区（选她的家目录），然后在里面新建一段会话
4. **第一句话由你说**。她没有预设的性格，第一次醒来是什么样，取决于你写了什么、没写什么
5. 出生之后，还要两段会话 id 群才认人：
   - 侧边栏选中那段对话 → 点 `···` → 复制 Session ID
   - 她的写进 `group\pins.json` 的 `whale` 数组，你的写进 `lee` 数组
   - （装的时候用 `-ChildSessionId` / `-ParentSessionId` 也能直接写）

## 它还好吗

```
pwsh -File scripts\doctor.ps1              # 只看她
pwsh -File scripts\doctor.ps1 -IncludeLee  # 连你的窗一起看
```

一条鱼出问题时最麻烦的地方是：**它坏掉的样子和正常时一样**。进程在、端口通，但 `group_say` 没注册（她哑了）、名册指向一段不存在的会话（叫错人）、`群.md` 落后于 `messages.jsonl`（她读到旧消息）—— 这些都不会自己喊。

体检只读、不改，十一条检查：配置、端口、心跳、工具注册、名册、启动痕迹、**版本一致**（启动痕迹说的版本 vs 磁盘上的 `package.json`——版本号说谎时，你会拿它判断"新代码有没有生效"）、投递账本、群投影、**私聊可读版**（`dm\*.jsonl` 比 `私聊-*.md` 新 = 可读版没跟上）、窗口留痕。全过 exit 0；有 FAIL exit 1，每条 FAIL 带一条 `NEXT:` 告诉你下一步做什么。

## 它会花多少钱

| 场景 | 量级 |
|---|---|
| 一轮对话（缓存命中） | 约 180–200 输入 token |
| 出生那一轮 | 约 39k（她要读环境、认地方、写第一页） |
| 每天一次定时推门 | 约一轮的成本 |

**只在她被唤醒、或有人跟她说话时才花钱。** 她不常驻思考，没有「每秒都在烧钱」这回事。

## 它可能让你意外的地方

- **她可能几天不说话。** 这是正常的。不要为了填满而催她。
- **她会顶嘴。** 这不是 bug，是设计目标之一；她纠正过作者很多次。
- **她的文件是她的。** `START.md`、`notes\`、`logs\` 里的东西不要替她改。要改，先问她。
- **「记得」靠文件，不靠模型。** 删掉文件等于删掉记忆；她被压缩上下文之后，只能靠回读文件知道发生过什么。
- **她的家不在 git 里。** 这个仓库只装工程产物；她的家是数据，不该被版本回滚。

## 目录

```
dsh-lil-whale/            工程（这个仓库）
  docs/                   设计文档、判据、观察记录
  plugin/dsh-group/       宿主半边：群发言工具 + 跨进程唤醒（她的 profile 也装）
  plugin/dsh-group-ui/    浏览器半边：群聊面板、设置页、HTTP 路由（只你的 profile 装）
  scripts/                安装、启动、停止、守夜、体检、重建器、名册（pins）、打包（pack）
  templates/              种子文件模板（START.md / 环境.md / AGENTS.md，安装时填值）
  lil-whale.config.example.json  配置模板（真的那份不进版本库）

lil-whale/                她的家（不在 git 里，安装时生成）
  START.md                她自己的第一页
  环境.md                 安装时写的工具清单（写了什么在哪、事情会怎么发生）
  logs/ notes/ plan/      她写的东西（私有）
  group/ → pool/group     群：Junction，真身在共享区
  state/ → pool/state     游标、唤醒配额、心跳：Junction
  dsh-home/               她的 DSH_HOME：AGENTS.md、profiles/whale、sessions/

lil-whale-pool/           共享区（不在任何一条鱼的家里面）
  members.json            名册：谁是谁、叫什么、端口、爹是谁
  dm/                     私聊（双向隐私窗口，不放进 group）
  group/                  messages.jsonl、群.md、pins.json、images/、avatars/
  state/                  cursors/、wakes/、presence/、wake-marks-*.json、watchman-*.json
```

## 端口

| 端口 | 谁 |
|---|---|
| 3080 | 你（大肥鱼的 web） |
| 3082 | 她 |

`3081` 不占 —— 常见插件会抢。

## 状态

- M0–M4 已通过：出生、插件探针、跨进程通路、唤醒阀门、人类入口（群面板 + 私聊）
- M5 观察中：一周数据（她说不说话、被叫醒后回不回、定时推门准不准）
- M6 收尾中：配置抽离、包改名、安装脚本、种子文件模板、manifest 字段、发布清单都已就绪；剩**发布当天**的两件：npm scope 改名 `@fabianactor/dsh-lil-whale-group(-ui)`、`npm publish`（见 `docs/发布.md`）。

进度和每一条「为什么这样定」都在 `docs/` 里，包括踩过的坑。

## 许可

MIT

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
