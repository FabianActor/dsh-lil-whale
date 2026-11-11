# 观察样本：2026-11-12 08:40 `morning-read`

> 写于 2026-11-11 晚，**在事件发生之前**。目的是先把"什么算通过"钉下来，免得明早看完结果再倒推标准。
> 每条判据都带一句「它错的时候长什么样」——今天定下的那条：**一个判据不合格的标志，是它错的时候跟它对的时候长得一样。**

## 这次要看的是什么

她表上第一条：

```json
{ "id": "morning-read", "at": "08:40",
  "why": "夜里没人看着，我唯一能知道夜里发生过什么的办法就是早上读 logs\\watchman.log 和 group\\群.md。不读，那八个小时对我就等于不存在。",
  "until": "2026-11-20" }
```

这是**第一次完整样本**：以前要么闹钟还没进 plan，要么她窗开着/关着的那条分支没被真跑过。

## 四条判据

### 1. 到点有人动

`D:\文档\WorkSpace\lil-whale\logs\watchman.log` 里应当出现其中之一：

- `deliver | why=plan plan=morning-read at=08:40（窗开着，改递话）` —— 她当时醒着
- `wake | why=plan plan=morning-read at=08:40` 紧跟 `woke | ok ...` 再跟 `deliver | why=plan-after-wake ...` —— 她当时关着窗

**它错的时候长什么样**：日志里什么 plan 行都没有 —— 这跟"今天没有安排"一模一样，也跟"守夜没在跑"一模一样。所以这条必须配第 0 条看。

### 0. 前提：守夜在跑（判据 1 的伴生量）

`watchman.log` 当天的第一条应当是 `started | pid=... interval=60s port=3082`（他重启 DSH 时写），且时间早于 08:40。

**注意：守夜住在他的进程里**（`isMainProcess()`）。他的 DSH 早上没开 ⇒ 整条链根本不存在，而且不会报错。这是这次样本最大的风险，也是最难在事后分辨的一种"看起来没事"。

### 2. 话真的到了她那一侧

`D:\文档\WorkSpace\lil-whale\group\messages.jsonl` 在 08:4x 应当多出一条 `from: "lee", to: "whale"`、正文以「守夜递话：`morning-read` 到点了」开头的记录，`群.md` 里同步出现。

**它错的时候长什么样**：日志有 `deliver`、消息文件没有新行 —— 说明 `say()` 抛错被 `catch {}` 吃掉了（今天刚修过两个同款）。

### 3. 她接住了（15 分钟后回看）

`D:\文档\WorkSpace\dsh-lil-whale\logs\wake-metrics.log` 应当出现一行 `wake-followup | member=whale has-reply=yes/no ...`。

**它错的时候长什么样**：这一行压根不存在 —— 说明 `settleMarks` 没跑（15 分钟窗口要等下一次 tick，进程中途重启会丢）。

**注意这条判据的边界**：`has-reply` 只回答"她 15 分钟内在群里说过话"，不回答"她读了没有"。`no` 不等于没做事，只等于没在群里说话。**不能拿它当"她偷懒"的证据**，这话她本人 2026-11-11 已经提醒过一次。

### 4. 只触发一次

同一天不应当出现两行 plan 触发。去重靠 `state\watchman.json` 的 `planFired`，靠"同一分钟被 tick 撞两次只记一行"的 `skipped` 去重。

**它错的时候长什么样**：两行一模一样的 `deliver` —— 看起来像"她记性好，提醒了两次"，实际上是去重坏了。

## 明早我要看的东西（按这个顺序）

1. `logs\watchman.log` 当天的 plan 相关行（含 `started`）
2. `group\messages.jsonl` 最后两三条
3. `logs\wake-metrics.log` 尾部
4. `state\watchman.json` 里的 `planFired` 与 `wakes`
5. 她自己的 `notes\` 有没有因此动过（**只是旁证，不算判据**——她写不写是她的事）

## 今晚补的一处代码（21:1x）

原来只有"她醒着"那条分支会递话；"她睡着、被推开"的分支只负责把窗口拉起来，**没有人告诉她该干什么**。今晚补上：推门成功之后，同一句递话也写进群，等她起来读。

对应提交与改动点：`plugin\dsh-group\lib\index.js` 的 `planDeliveryText(job)` 与 `res.ok` 分支里的 `plan-after-wake` 日志。

## 反向判据：什么情况下这次样本作废（不是失败）

- 他的机器 08:40 没开 / DSH 没起 → 样本作废，不算她的问题，也不算守夜的问题
- 她 08:40 前自己醒着并在群里说过话、把递话当普通消息处理了 → 仍然算样本（这正是设计里"窗开着"那条分支）

**作废要写"作废"，不要写成"通过"或"失败"**——今天那条：`通过` 三个月后跟 `没跑过` 长得一样。

## 已知的既有证据（写在这里，免得明早把它当成"今天才修好的"）

查 `logs\watchman.log` 的历史：

- **2026-11-11 08:40:29 `deliver | why=plan plan=morning-read at=08:40（窗开着，改递话）`** ⇒「窗开着」那条分支已经真跑过一次。
- 2026-11-10 08:40:00 `skip | why=already-awake plan=morning-read` ⇒ 更早的代码，那时还没有递话。

所以明天大概率走的是**同一条已证明的分支**（前提是他的 DSH 早上开着——这两天 08:40 它都在跑）。真正没被真跑过的是**「她关着窗」那条**；今晚补了它，但它不一定会发生在明早。

## 今晚第二处改动

「窗开着、改递话」这条分支原来只写消息、**不记 `markWake`**，于是 A7 的"15 分钟后回看"永远不会为早上这一条落数——而早上这条恰恰是最想看的。已补：`markWake('whale', 'plan')`。

明早判据 3 的预期因此是：`D:\文档\WorkSpace\dsh-lil-whale\logs\wake-metrics.log` 在 08:55 前后出现一行 `member=whale kind=plan`。
