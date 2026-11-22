# 第三方插件（与基座无关）

这里收的是"给小鱼装第三方插件"这件事的全部沉淀：**每个插件一个文件夹**，文件夹名就是给人看的名字。

```
advanced notes on third-party plugins/
  README.md                  ← 本文件：规矩与目录
  给小鱼装-billion-context/
    给小鱼装-billion-context.md
  让小鱼能看B站-bili-eyes/
    让小鱼能看B站-bili-eyes.md
    scripts/                 ← 只在需要时建
      bili-section.mjs
      patch-bili-eyes-note.mjs
      test-thirdparty-patch.mjs
  让小鱼禁掉鱼八股-fishtalk/
    让小鱼禁掉鱼八股-fishtalk.md
```

规矩：

- **一个插件一个文件夹**；文件夹里放一个同名 `.md` 说明（怎么装、怎么配、怎么验、踩过什么坑）。
- **针对这个插件写的适配脚本**（打补丁、生成某一节、自测）放进该文件夹的 `scripts/`；没有就不建。
- 这些插件都不是基座的一部分：装不装都能跑，基座的安装/升级/体检文档不依赖它们。
- 适配脚本对第三方插件本体的改动属于"第三方插件的本地补丁"，**不写进基座 CHANGELOG 正文**；每一代改了什么、为什么，写进对应插件的 `.md`（目前只有 bili-eyes 有「补丁代次索引」）。
- 换了另一台机器装这些插件，照文件夹里的 `.md` 走即可；脚本里的路径默认从鱼塘根推，不要写死本机绝对路径。

如果你**成功给小鱼装过这里的插件**（或别的第三方插件、踩通了没写过的坑），欢迎[开 issue](https://github.com/FabianActor/dsh-lil-whale/issues)分享——这类经验比 bug 报告更稀缺，我们会把它整理进这一册。

## 目录

- [给小鱼装 billion-context](给小鱼装-billion-context/给小鱼装-billion-context.md) —— 两个情形：全新装（XDG 是开关、回填会让时间塌成批次时刻、怎么用她自己的原话验收）／把用过 billion-context 的老会话迁成一条鱼（会话 + 附件 + 压缩库 + 工作区登记 + 旧家收尾，含 `restore` 只 UPDATE 的坑）。
- [让小鱼能看 B 站（dsh-bili-eyes）](让小鱼能看B站-bili-eyes/让小鱼能看B站-bili-eyes.md) —— 装包、一条鱼一份配置、凭证按鱼各存一份（只读不需要登录）、怎么验她真的看见了、写操作默认全关；适配脚本在 [该文件夹的 `scripts/`](让小鱼能看B站-bili-eyes/scripts/)。
- [让小鱼禁掉鱼八股（fishtalk）](让小鱼禁掉鱼八股-fishtalk/让小鱼禁掉鱼八股-fishtalk.md) —— 一鱼一份语料（`FISHTALK_HOME` 与四条静默回落）；`fishtalk_check` 的真实边界（`ok:true` 只等于没撞黑名单、没重复、没照抄，不是「像人」；空绿与脏绿）；语料池只放真人（误喂事故与存档）；谁在用；上游 issue #3。
