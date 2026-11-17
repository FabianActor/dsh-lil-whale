// 「看外面（B站）」这一节：按这条鱼 profile 里真实挂着的东西生成。
//
// 2026-11-15 起两条路：
//   1. dsh-bili-eyes 插件（bundle）：bili_look / bili_look_zoom / bili_find / bili_feed /
//      bili_comments / bili_surf / bili_inbox（写操作默认关）。whale 走这条。
//   2. 自研只读 MCP（mcp-bili-readonly，16 个 mcp__bili__* 工具）：fishball 等还没换的走这条。
// 哪条在跑就读哪条的口径，纸和事实保持一致（2026-11-14 定下的规矩：纸只写机制，不写期望）。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BT = '`'; // 反引号，单引号字符串里可以直接写，这里给 readability 用

// ── dsh-bili-eyes 插件那一支 ──────────────────────────────────────
function eyesSection(dshHome, profile) {
  const home = dshHome;
  const cfgFile = join(home, 'bili-eyes.json');
  let cfg = {};
  try {
    cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
  } catch {
    cfg = {};
  }
  const credFile = join(home, 'bili-eyes', 'credential.json');
  let loggedIn = false;
  let who = '';
  try {
    const cred = JSON.parse(readFileSync(credFile, 'utf8'));
    loggedIn = Boolean(cred?.cookies?.SESSDATA);
    who = cred?.uname || '';
  } catch {
    loggedIn = false;
  }

  const lines = [];
  lines.push('## 看外面（B站，用 dsh-bili-eyes）');
  lines.push('');
  lines.push('看视频用的是插件 `dsh-bili-eyes`。它给的是一套名字不带前缀的工具：');
  lines.push('');
  lines.push(
    '- ' + BT + 'bili_look' + BT + ' —— **看一条视频**：一下载视频、切一张分镜图（格号烧在图上，每格约一分钟），' +
      '同时给你 B站 AI 总结、分段、热评、弹幕热词与最密集的时段，还有**每格的台词**（B站 AI 字幕）。' +
      '想看某一段可以给 from/to（秒）；每格台词要短一点给 detail:"low"。',
  );
  lines.push(
    '- ' + BT + 'bili_look_zoom' + BT + ' —— **放大看某几秒**：给 from/to（相差不超过 60 秒）和 cells（1~9，越少每格越大），' +
      '直接从高清直链上取帧（1080P），不整段下载。看分镜上哪一格格子太小、字看不清时用它。',
  );
  lines.push(
    '- **分镜图上的字有多小**：' + BT + 'bili_look' + BT + ' 给的分镜图是 **874×701、12 格均分，每格约 290×230** ——' +
      '这个尺寸下的字**不足以判字形**。要引用画面上的文字，先用 ' + BT + 'bili_look_zoom' + BT + ' 放大复核' +
      '（它自己的输出会写清"多少 P / 几格"），结论里注明尺寸（例如 `@1011x625`）。' +
      '2026-11-17 实测：三条鱼在 480P 分镜上把同一个字读成 ta / ta / 她，抬到单格 1011×625 才一致——**不是眼力问题，是字号问题**。',
  );
  lines.push(
    '- ' + BT + 'bili_find' + BT + ' —— 搜视频（关键词、排序、时长、条数）。',
  );
  lines.push(
    '- ' + BT + 'bili_feed' + BT + ' —— 看推荐流/动态。',
  );
  lines.push(
    '- ' + BT + 'bili_comments' + BT + ' —— 单独拉一条视频的评论。',
  );
  lines.push(
    '- ' + BT + 'bili_surf' + BT + ' —— 顺着线索自己逛一圈 B站（按你的口味挑、总结），比一次一次找省。',
  );
  lines.push(
    '- ' + BT + 'bili_inbox' + BT + ' —— 收件箱：回复我的、@ 我的、私信。',
  );
  lines.push('');
  lines.push('**额度**：每小时最多新看 **' + (cfg.maxPerHour ?? 30) + ' 个视频**、搜 **' + (cfg.maxFindPerHour ?? 60) + ' 次**；' +
    '同一个视频同一个窗口 24 小时内再看是缓存（不算新看）。放大看另算，上限是它的两倍。超了就直接告诉你超了。');
  lines.push('');
  lines.push('**画面数据**：视频下载到 `pool\\cache\\bili-eyes\\media`（总量上限 ' + (cfg.mediaMaxMb ?? 2048) + ' MB，超了从最旧的删）；' +
    '分镜清晰度短边 ' + (cfg.scanQuality ?? '480') + 'P（整片看用，够看清构图和字幕），放大看才用高清直链。');
  lines.push('');
  lines.push(
    '**写操作默认是关的**：' + BT + 'bili_like' + BT + ' / ' + BT + 'bili_fav' + BT + ' / ' + BT + 'bili_comment' + BT + ' / ' +
      BT + 'bili_dm' + BT + ' / ' + BT + 'bili_post' + BT + ' / ' + BT + 'bili_follow' + BT + ' 这些工具在组合里**存在**，' +
      '但插件权限表里每一格默认 `off` —— 你调了会被拒，不是你没用对。要用得 Fabian 在设置页里逐格打开。',
  );
  if (loggedIn) {
    lines.push('');
    lines.push(
      '**登录**：用的是 Fabian 的号' + (who ? '（' + who + '）' : '') + '—— B站 AI 字幕、AI 总结、高清直链都靠它。' +
        '所以你的观看会记在他账号的浏览记录里；这是共用一只眼睛的代价，不是秘密。',
    );
  } else {
    lines.push('');
    lines.push(
      '**还没登录**：B站 AI 字幕/总结和高清直链都要登录才给。看视频之前先跟 Fabian 说一声，让他在设置页里扫码（或跑 `dsh-bili-eyes login`）。',
    );
  }
  // 2026-11-17：bili_* 换成插件，fishball 的旧探索本（duty_*）还留在自研 MCP 里。
  try {
    const patchText = readFileSync(join(home, 'profiles', profile, 'cordis.patch.yml'), 'utf8');
    if (/id:\s*mcp-bili-readonly/.test(patchText) && /duty_paths/.test(patchText)) {
      lines.push('');
      lines.push(
        '**旧探索本还在**：' + BT + 'duty_paths' + BT + ' / ' + BT + 'duty_report_append' + BT + ' / ' + BT + 'duty_seen_append' + BT +
          ' / ' + BT + 'duty_seen_recent' + BT + ' / ' + BT + 'duty_digest_append' + BT +
          ' 五个工具仍留在旧的自研 MCP 里，写在你自己的 ' + BT + 'bili-duty' + BT + ' 下；看视频/搜/逛用上面这些新工具。',
      );
    }
  } catch {}

  lines.push('');
  lines.push(
    '**别人家不能盯**：另一条鱼的家默认不许监听。想知道她那边的事，合法办法是让她发消息告诉你——她的产出、她的发现，都算她的话。',
  );
  lines.push('');
  return lines.join('\n');
}

// ── 自研只读 MCP 那一支（旧口径，保留给还没换的鱼）───────────────
function mcpSection(text) {
  const none = [
    '## 看外面（B站）',
    '',
    '你手里**没有**接外面的眼睛（profile 里既没有 B站 MCP 块，也没有 dsh-bili-eyes）。想知道外面的事，问人，或者等以后。',
    '',
  ].join('\n');
  const m = text.match(/BILI_MCP_TOOLS:\s*['"]?([a-zA-Z0-9_,\s]+)['"]?/);
  if (!m) return none;
  const tools = m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const readOnly = tools.filter((t) => !t.startsWith('watchlist_') && !t.startsWith('duty_'));
  const lines = [];
  lines.push('## 看外面（B站，只读；自研 MCP）');
  lines.push('');
  lines.push('你手里有 ' + tools.length + ' 个只看不写的工具，名字都以 ' + BT + 'mcp__bili__' + BT + ' 开头。');
  lines.push('');
  lines.push('**能做的**：' + readOnly.map((t) => BT + t.replace(/^bili_/, '') + BT).join('、') + '。');
  if (tools.includes('bili_frames') && tools.includes('bili_grab')) {
    lines.push('');
    lines.push(
      '**看画面分两档**：' + BT + 'frames' + BT + ' 是 B站 自带的故事板——480×270 缩略图、最多 12 帧、便宜，' +
        '先拿它扫一眼"大概拍了什么"；' + BT + 'grab' + BT + ' 是真解码原视频抽帧——1080P、最多 16 帧，' +
        '看得清人脸、屏幕上的字、硬字幕，代价是每帧一两千 token + 一两 MB 流量（也算一次额度）。' +
        '要看清楚就用 grab，别指望把 frames 的帧数调大了能看清。',
    );
  }
  if (tools.some((t) => t.startsWith('watchlist_'))) {
    lines.push('');
    lines.push(
      '**追更**：' + BT + 'watchlist_add(uid, why)' + BT + '（最多 5 个，why 必填）、' +
        BT + 'watchlist_list()' + BT + '、' + BT + 'watchlist_check()' + BT +
        '（同一个 UP 10 分钟内只查一次；没新的也会说"没什么新的，上次是 X"）。',
    );
  }
  if (tools.some((t) => t.startsWith('duty_'))) {
    lines.push('');
    lines.push(
      '**探索本**：' + BT + 'duty_paths' + BT + ' / ' + BT + 'duty_report_append' + BT + ' / ' +
        BT + 'duty_seen_append' + BT + ' / ' + BT + 'duty_seen_recent' + BT + ' / ' +
        BT + 'duty_digest_append' + BT + ' —— 一套现成的"看过什么"本子，写在你自己的 ' + BT + 'bili-duty' + BT + ' 下。',
    );
  }
  lines.push('');
  lines.push(
    '**不能做的**：发评论、点赞、收藏、私信、登录、发布。这些工具在你的组合里**根本不存在**——白名单在服务端执行，不是靠你自觉。',
  );
  lines.push('');
  lines.push(
    '**共用**：用的是 Fabian 的号（他没有第二个实名号）。你看过什么会记在他账号的浏览记录里；这是共用一只眼睛的代价，不是秘密。',
  );
  const quota = text.match(/BILI_QUOTA_PER_DAY:\s*['"]?(\d+)/);
  const hasMember = /BILI_MEMBER:/.test(text);
  if (hasMember && quota) {
    lines.push('');
    lines.push(
      '**每天最多 ' + quota[1] + ' 次请求**（搜索一次、看一条视频都算）。超了当天不再响应；连续失败 3 次当天封口。花在哪儿记在 ' +
        BT + 'pool\\state\\bili\\ledger.jsonl' + BT + '，你随时能查。',
    );
  } else {
    lines.push('');
    lines.push('**没有单独计数**：这条鱼没有开自己的水表（不设 ' + BT + 'BILI_MEMBER' + BT + '），所以调用不按人计。');
  }
  if (tools.includes('bili_crawl')) {
    lines.push('');
    lines.push('**' + BT + 'bili_crawl' + BT + '**：一次抓一轮，费额度，别当成"随便看看"。');
  }
  lines.push('');
  lines.push(
    '**别人家不能盯**：另一条鱼的家默认不许监听。想知道她那边的事，合法办法是让她发消息告诉你——她的产出、她的发现，都算她的话。',
  );
  lines.push('');
  return lines.join('\n');
}

export function biliSectionOf(opts) {
  const dshHome = opts.dshHome;
  const profile = opts.profile;

  // 1) 插件在不在：看 profile 的 package.json 里 bundle 清单
  let bundles = [];
  try {
    const pkg = JSON.parse(readFileSync(join(dshHome, 'profiles', profile, 'package.json'), 'utf8'));
    bundles = pkg?.dsh?.profile?.bundles ?? [];
  } catch {
    bundles = [];
  }
  if (bundles.includes('dsh-bili-eyes')) return eyesSection(dshHome, profile);

  // 2) 旧的 MCP 块
  const patch = join(dshHome, 'profiles', profile, 'cordis.patch.yml');
  if (!existsSync(patch)) return '' // 2026-11-15：没有眼睛就不写这一节（别让她知道有这扇门）;
  const text = readFileSync(patch, 'utf8');
  if (!/id:\s*mcp-bili-readonly/.test(text)) return '' // 2026-11-15：没有眼睛就不写这一节（别让她知道有这扇门）;
  return mcpSection(text);
}
