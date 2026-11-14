// 「看外面（B站只读）」这一节：按这条鱼 profile 里真实的白名单生成。
//
// 为什么不在模板里写死：2026-11-14 模板曾写死"18 个工具 + 追更三件"，
// 但 fishball 的白名单里没有 watchlist、多了 duty_*，纸就和事实不一样了。
// 这里直接读 profile patch 里的 BILI_MCP_TOOLS，白名单是什么就写什么。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BT = '`'; // 反引号，单引号字符串里可以直接写，这里给 readability 用

export function biliSectionOf(opts) {
  const dshHome = opts.dshHome;
  const profile = opts.profile;
  const patch = join(dshHome, 'profiles', profile, 'cordis.patch.yml');
  const none = [
    '## 看外面（B站）',
    '',
    '你手里**没有**接外面的眼睛（profile 里没有 B站 MCP 块）。想知道外面的事，问人，或者等以后。',
    '',
  ].join('\n');
  if (!existsSync(patch)) return none;
  const text = readFileSync(patch, 'utf8');
  if (!/id:\s*mcp-bili-readonly/.test(text)) return none;
  const m = text.match(/BILI_MCP_TOOLS:\s*['"]?([a-zA-Z0-9_,\s]+)['"]?/);
  if (!m) return none;
  const tools = m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const readOnly = tools.filter((t) => !t.startsWith('watchlist_') && !t.startsWith('duty_'));
  const lines = [];
  lines.push('## 看外面（B站，只读；2026-11-14 起）');
  lines.push('');
  lines.push('你手里有 ' + tools.length + ' 个只看不写的工具，名字都以 ' + BT + 'mcp__bili__' + BT + ' 开头。');
  lines.push('');
  lines.push('**能做的**：' + readOnly.map((t) => BT + t.replace(/^bili_/, '') + BT).join('、') + '。');
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
    '**今天可以不想看**：醒来先 ' + BT + 'roll({ reason })' + BT +
      '。骰子说 ' + BT + 'skip=true' + BT + '，就写一行"今天不想看"、别碰 B站；骰子说可以看，看多少由你自己定。',
  );
  lines.push('');
  lines.push(
    '**看完往哪儿写**：两本。' + BT + 'notes\\给主人的信.md' + BT + ' 是给他看的，可以挑着说；' +
      BT + 'notes\\<日期>.md' + BT + ' 是给你自己的，原样写。',
  );
  lines.push('');
  lines.push(
    '**别人家不能盯**：另一条鱼的家默认不许监听。想知道她那边的事，合法办法是让她发消息告诉你——她的产出、她的发现，都算她的话。',
  );
  lines.push('');
  return lines.join('\n');
}
