#!/usr/bin/env node
// fi-0030：同一条对话的时间在两个文件里两套表示——jsonl 是 ISO Z，
// 投递账本的 `last-ts=` 是 epoch 毫秒。看账的人得自己换算，换错了还会
// 以为"文件里存的是本地化字符串"（11-25 早上真发生过）。
//
// 修法：投递行紧跟着再写一格 `last-ts-iso=`，同一个时刻两种写法并排。
// 这不像"统一单位"那样要动历史行（账本只追加），读的人挑顺手的那个。
//
// 这个检查管三件事：
//   ① 代码里两格必须挨着写（挨着才不会只改一处）；
//   ② 换算本身对（epoch 毫秒 → ISO Z，逐毫秒相等）；
//   ③ 给一本真账（--log）就逐行验：两格都在的行必须对得上，
//      只有一格的旧行跳过并数出来——"跳过多少"要说，不然看不出覆盖面。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

let fail = 0;
const say = (ok, msg) => {
  if (!ok) fail += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`);
};

// ① 源码：两格挨着
const src = fs.readFileSync(path.join(root, 'plugin', 'dsh-lil-whale-group', 'lib', 'index.js'), 'utf8');
const adjacent = /last-ts=\$\{[^}]*\}[^\n]*last-ts-iso=\$\{/.test(src);
say(adjacent, '投递行里 last-ts= 后面紧跟 last-ts-iso=（同一个时刻两种写法）');

// ② 换算：epoch 毫秒 ↔ ISO Z
const samples = [
  [1795329024247, '2026-11-22T06:30:24.247Z'],
  [1800000000000, '2027-01-15T08:00:00.000Z'],
  [0, '1970-01-01T00:00:00.000Z'],
];
for (const [ms, iso] of samples) {
  say(new Date(ms).toISOString() === iso, `${ms} → ${new Date(ms).toISOString()}（期望 ${iso}）`);
}

// ③ 真账
const li = process.argv.indexOf('--log');
if (li !== -1) {
  const logPath = process.argv[li + 1];
  const lines = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean);
  let both = 0;
  let skips = 0;
  let bad = 0;
  for (const line of lines) {
    const mts = /last-ts=(\d+)/.exec(line);
    const miso = /last-ts-iso=(\S+)/.exec(line);
    if (!mts || !miso) { skips += 1; continue; }
    both += 1;
    const want = Number(mts[1]);
    const got = Date.parse(miso[1]);
    if (got !== want) {
      bad += 1;
      if (bad <= 3) console.log(`  对不上：last-ts=${want} last-ts-iso=${miso[1]}`);
    }
  }
  say(bad === 0, `真账逐行换算：checked=${both} skipped=${skips} mismatch=${bad}`);
}

console.log(fail === 0 ? 'test-delivery-ts：PASS' : `test-delivery-ts：FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
