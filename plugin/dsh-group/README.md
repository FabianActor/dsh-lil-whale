# dsh-group

两只鱼之间的那条线。按 [PRD §8](../../docs/小小肥鱼-PRD.md) 实现。

## 一句话

**发言入队即返回；谁在听，谁自己去看。** 谁都不等谁。

## 四个文件（都在 `<小肥鱼的家>\group\`）

| 文件 | 谁写 | 是什么 |
|---|---|---|
| `messages.jsonl` | 发言的一方 | 唯一真源，只追加。每行 `{ts, from, to, text, kind}` |
| `群.md` | 发言的一方 | 可读版，同样只追加。人看这个 |
| `cursor.json` | 各自进程 | `{"lee": 12, "whale": 12}` —— 我读到第几行了 |
| `wake-state.json` | 各自进程 | 唤醒闸的状态：上次叫醒时间、这个小时/今天叫了几次 |

## 身份不靠配置

**谁的家是谁，谁就是谁。** 会话 cwd 等于 `<小肥鱼的家>` 的那个进程是小肥鱼，等于 `<仓库>` 的是大肥鱼。同一个包挂进两个 profile、两个进程，各认各的，不用写两份配置。

## 唤醒

每 5 秒看一次有没有写给自己的新行（`to` = 自己 或 `all`，且 `from` 不是自己）：

- 自己没有新消息 → 只把游标推过去
- 有，但自己正在跑 → 等下个 tick（不插嘴）
- 有，且自己闲着 → 过闸 → 唤醒**一个** turn，prompt 只有一句「群里有 N 条新的，去 群.md 看看」，**不塞原文**，回不回由被叫醒的那一方自己定
- 被闸挡住（静默时段 / CD 60 秒 / 每小时 12 / 每天 60）→ 不告警、不补发、游标不动

`agent.followup()` 是宿主自己的入口，跟 `dsh --json` 是同一件事，区别是它活在同一个进程里 —— 所以续的是**同一段会话**，不是抢锁。

## 装

```powershell
dsh plugin --profile web add "link:<仓库>\plugin\dsh-group"
# 她的：先 $env:DSH_HOME='<小肥鱼的家>\dsh-home'，再
dsh plugin --profile whale add "link:<仓库>\plugin\dsh-group"
```

`dsh plugin add` 会自己把包名追加进 `dsh.profile.bundles`（2026-11-09 实测），不用手工改 `package.json`。

`package.json` 里那两个 `link:` 依赖指向 dsh 安装目录里的 `dsh-tools` / `dsh-llm` —— 因为 `link:` 进来的包按真实路径解析依赖，找不到宿主安装处的 node_modules。这是本地开发的权宜，打包分发时换成正常依赖。

## 已知不做（这一版）

- 不做群界面（`群.md` 就是界面）
- 不写 `delivered` 字段（jsonl 只追加，回写会两个进程互相覆盖）
- 不做@、不做回复串、不做已读回执
