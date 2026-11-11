# dsh-group-probe

最小探针。**不是产品的一部分**，只回答一个问题：一个本地 `link:` 的 bundle 包，能不能被 profile 真的 apply。

## 它做什么

启动时往 `..\probe\apply.log` 追加一行：

```
2026-11-09T03:05:11.222Z	pid=12345	home=C:\Users\Fabian\.dsh	cwd=D:\文档\WorkSpace\dsh-lil-whale
```

不注册工具、不改界面、不读业务数据。写文件是因为 stdout 会被宿主吃掉，文件是重启之后唯一能拿出来对的证据。

## 怎么装的

```powershell
dsh plugin --profile web add "link:D:\文档\WorkSpace\dsh-lil-whale\plugin\dsh-group-probe"
dsh plugin --profile whale add "link:D:\文档\WorkSpace\dsh-lil-whale\plugin\dsh-group-probe"   # DSH_HOME=她的
```

## 已经证实的事（2026-11-09）

1. **`dsh plugin add` 会自动把包名追加进 `dsh.profile.bundles`**，不用手工改 `package.json`。
   当年那次「装进去了但什么都没发生」，原因大概率就在这儿 —— 只进了 `dependencies`，没进 `bundles`，配置层根本没合成它。
2. 两个 profile 的 `--dump-config` 里都能看到：

   ```
   # == dsh-group-probe
   - id: dsh-group-probe
     name: dsh-group-probe
   ```

   这证明**配置合成**成功（bundle manifest 的 `dsh.bundle.patch` 被读到、insert 行进了合成树）。

## 还没证实的

**运行时那一行。** `--dump-config` 只合成、不启动插件，所以 `probe\apply.log` 现在还不存在。
重启宿主之后：

- 重启你的 web（`web` profile）→ 一行，`home=C:\Users\Fabian\.dsh`
- 关开她的窗（`whale` profile）→ 另一行，`home=D:\文档\WorkSpace\lil-whale\dsh-home`

两行都在，探针就算彻底走通，M1 的第一块砖落地。
