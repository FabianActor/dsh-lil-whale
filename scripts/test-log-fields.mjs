#!/usr/bin/env node
// 字段契约静态检查（2026-11-16，CHANGELOG r179）
//
// 契约（2026-11-15 18:35 定，r131）：watchman.log / sleep.log / intent.log 里
//   - 被门拦下的原因用 deny=
//   - 细分原因用 reason=
//   - 观察/异常用 note=
// 不再出现 why=。
//
// 强制的只有"代码里还写不写"，因为写的时候就是这里决定的。
// 唯一豁免：autostartLog() 写的是另一本账（pool\state\autostart.log），
// 沿用 fmt=1 的旧写法（`skip why=main-port-not-listening`），按整行含
// "autostartLog" 放行。
//
// 为什么要有这个检查：分界行只是写给"读日志的人"的边界，它不会让漏改的
// 写者自动守规矩。2026-11-15 的 fmt=3 写了 fields=deny,note,reason，
// 但代码里仍有 31 处 why=，直到 2026-11-16 08:19 才被现场日志抓到。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const lib = path.join(here, '..', 'plugin', 'dsh-lil-whale-group', 'lib');
const files = fs.readdirSync(lib).filter((f) => f.endsWith('.js'));

const offenders = [];
let exempt = 0;
for (const f of files) {
  const src = fs.readFileSync(path.join(lib, f), 'utf8');
  const lines = src.split(/\r?\n/);
  lines.forEach((line, i) => {
    const isAutoStart = line.includes('autostartLog');
    let from = 0;
    for (;;) {
      const at = line.indexOf('why=', from);
      if (at < 0) break;
      if (isAutoStart) exempt += 1;
      else offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 150)}`);
      from = at + 4;
    }
  });
}

if (offenders.length > 0) {
  console.error(`test-log-fields：FAIL，代码里仍写着 why=（${offenders.length} 处）：`);
  for (const line of offenders) console.error('  ' + line);
  console.error('改成 deny=（被门拦下）/ reason=（细分原因）/ note=（观察/异常）。');
  process.exit(1);
}
console.log(`test-log-fields：PASS（why= 共 ${exempt} 处，全部是 autostart.log 的豁免）`);
