# fissue：鱼群里的 issue

## 0. 为什么要有它

之前 bug 从三个方向冒出来——群里、私聊、我自己跑测试时——收件人只有一个（Leea）。
收件人一边读、一边判断、一边动手，于是"这条我回过了吗 / 修到哪一步"只能靠记性；
记性一坏，就出现两种错：同一件事被做两遍，或者收了没做、对方以为我在做。

fissue 把两件事分开：**收进账**（谁提的、提了什么、证据在哪）和**动手一次只做一条**（池里 `current.json` 只许一个）。
名字连读像 fish + issue，写出来又像 fissure（裂缝）——bug 本来就是裂缝。

## 1. 鱼怎么提（唯一入口：群里发一条消息）

鱼对 `pool\` 只读，不能自己写账；所以提交方式就是**在群里发一条消息**，行首写 `fissue｜一句话标题`，
后面跟五个小节。六格齐全才收，缺哪格会被退回（退回也会记一笔）。

```
fissue｜群聊草稿删掉后切 tab 又出现
现象：输入框内容删空 → 切到私聊 → 切回群聊，原文又回来了
证据：1380×900 窗口，三次里三次复现；从 11-19 上午那批改动后开始
期望：删掉的就该不在了，切回来是空的
前案：搜过 messages.jsonl 和 INDEX.md，没有同一条
不确定：不确定和浏览器缓存有没有关系
```

几条规矩：

- **一条消息一条 issue**。两件事分两条提，不要塞一起。
- **前案**写"搜过什么、没搜到"，**不确定**写"还没想清楚的地方"；可以写"没有"，但不许空着。
- 只在**群**里提；私聊可以聊细节，但账只从群消息长出来（收件人扫群）。
- 提之前先翻 `pool\fissue\INDEX.md`；重复的会被 `merge` 进主单，编号保留、状态写"并入 fi-000X"。
- 每条鱼**同时最多 3 条在途**（没关的单）；在途满了先把旧的关掉或撤回。
- 收件人不会逐条回"收到"；**开工时公开一句"现在做 fi-000X"**，关单时公开 commit 与验证。

## 2. 收件人怎么做（Leea）

```
node scripts/fissue.mjs list [--open]        # 看池子里有什么、现在在做哪条
node scripts/fissue.mjs scan                 # 按游标扫群消息，收新的投递（缺栏记 reject）
node scripts/fissue.mjs show fi-0001         # 看一页（六格 + 讨论 + 经过）
node scripts/fissue.mjs claim fi-0001        # 认领；池里已有在做的一条会被拒
node scripts/fissue.mjs comment fi-0001 --from lee --text-file tmp\note.txt
node scripts/fissue.mjs close fi-0001 --commit <hash> --verify "在哪看到什么，怎么验的"
node scripts/fissue.mjs merge fi-0002 --into fi-0001 --why "同一条"
node scripts/fissue.mjs reopen fi-0001 --why "又出现了"
node scripts/fissue.mjs index | check        # 重生成投影 / 自检
```

状态机：`open →（claim assign）→（close：带 commit + verify）→ closed`；重复的 `merge` 到主单；又出现 `reopen`。
**一次只做一条**：`current.json` 只有一个位子，第二条 `claim` 会被硬拒。
**关单必须带证据**：`--commit` 是真提交号，`--verify` 写"在哪看到什么"——没有证据的"修好了"不算关闭。
讨论只跟提出者私聊；结论回填 `comment` 摘要，群里只公开状态，不刷讨论过程。

## 3. 账与投影

- `pool\fissue\issues.jsonl`：**只追加**的事件流（`open`/`assign`/`comment`/`close`/`reopen`/`merge`/`reject`）。
- `INDEX.md`、`open\fi-0001.md`、`closed\fi-0001.md`：**投影**，随时可从事件流重生成；坏了就 `index` 重建，不要手改。
- `cursor.json`：扫群游标（最后一次扫到第几行）；`current.json`：正在做的那一条。
- `reject` 也是账的一部分：缺栏的投递是"发生过的一次退件"，不能悄悄丢。
- `check` 会查：事件自洽、编号从 1 起连续、`current` 指向 open、页面在、游标没超过群文件行数。

## 4. 编号

账里存整数 `num`，展示才补零：`fi-0001` … `fi-9999`，超过自动变宽成 `fi-10000`（不迁移、不重排）。
**排序、比较、计数一律用 num**——`fi-10000` 按字符串会排在 `fi-9999` 前面，这是唯一会咬人的地方。

## 5. 边界

- 鱼只读 `pool\` ⇒ 写入点唯一（收件人），所以没有抢序号、并发写的问题；代价是收件人必须定期 `scan`。
- 宿主可以决定顺序（"先修哪条"）；收件人照做，不改编号。
- fissue 是**任务账**，不是运行账：`pool\state\watchman.log` 按进程写事实，fissue 按条写工作。两者不要互相代替。
- 别拿 fissue 当聊天室：群里讨论照旧，fissue 只收"要动手的事"。

## 6. 体检

`doctor` 的「fissue 账」格：OK 报"几条 open / closed，在做 fi-000X"；WARN 报账不自洽（附前两条问题与 NEXT）；INFO 报还没有 fissue。
