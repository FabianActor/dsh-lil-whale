// test-upgrade-json.mjs —— 升级单的格式检查（CHANGELOG r186）。
//
// 为什么要有它：upgrade.json 是给"用户的代理"读的，格式错了不会报错，
// 只会让代理少做一步（少重生成、少修权限、少重启），然后在别处出错。
// 判据：每个条目都必须能回答"要做什么、做完看什么"。
import { readFileSync } from 'node:fs';
import { readFileSync as readPkg } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const specFile = new URL('upgrade.json', ROOT);
const pkgFile = new URL('plugin/dsh-lil-whale-group/package.json', ROOT);

const fail = [];
const need = (cond, msg) => { if (!cond) fail.push(msg); };
const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const isStrArray = (v) => Array.isArray(v) && v.every(isStr);

let spec;
try { spec = JSON.parse(readFileSync(specFile, 'utf8')); }
catch (e) { console.log(`FAIL test-upgrade-json：upgrade.json 读不了或不是 JSON（${e.message}）`); process.exit(1); }

let pkg;
try { pkg = JSON.parse(readFileSync(pkgFile, 'utf8')); }
catch (e) { console.log(`FAIL test-upgrade-json：包 package.json 读不了（${e.message}）`); process.exit(1); }

const ALLOWED = new Set(['package', 'restart', 'refresh-env', 'acl-repair', 'seed-profile', 'custom']);
const SEMVER = /^\d+\.\d+\.\d+$/;
const vnum = (v) => v.split('.').map((n) => Number(n));

need(spec._schema === 1, '缺少 "_schema": 1');
need(Array.isArray(spec.entries), '缺少 entries 数组');
if (Array.isArray(spec.entries)) {
  const seen = new Set();
  let prev = null;
  spec.entries.forEach((entry, i) => {
    const at = `entries[${i}]`;
    need(entry && typeof entry === 'object' && !Array.isArray(entry), `${at} 不是对象`);
    if (!entry || typeof entry !== 'object') return;
    need(isStr(entry.version) && SEMVER.test(entry.version), `${at}.version 不是 x.y.z`);
    need(isStr(entry.summary), `${at}.summary 空着`);
    need(isStrArray(entry.requires), `${at}.requires 必须是字符串数组`);
    if (Array.isArray(entry.requires)) {
      for (const r of entry.requires) need(ALLOWED.has(r), `${at}.requires 里有不认识的词 "${r}"（只认 ${[...ALLOWED].join(' / ')}）`);
      const hasRestart = entry.requires.includes('restart');
      need(!hasRestart || Array.isArray(entry.restart), `${at} 写了 restart 却没有 restart: [...] 名单`);
    }
    if (entry.restart !== undefined) need(isStrArray(entry.restart), `${at}.restart 必须是字符串数组`);
    if (entry.commands !== undefined) need(isStrArray(entry.commands), `${at}.commands 必须是字符串数组`);
    need(isStrArray(entry.verify) && entry.verify.length > 0, `${at}.verify 必须至少一条判据（做完看什么）`);
    need(entry.breaking === undefined || isStrArray(entry.breaking), `${at}.breaking 必须是字符串数组或省略`);
    if (isStr(entry.version)) {
      need(!seen.has(entry.version), `${at}.version 重复：${entry.version}`);
      seen.add(entry.version);
      if (prev) need(vnum(entry.version).join() < vnum(prev.version).join(), `${at} 没按版本倒序（${prev.version} 之后是 ${entry.version}）`);
      const d = vnum(entry.version); const p = vnum(pkg.version ?? '0.0.0');
      const less = d[0] < p[0] || (d[0] === p[0] && (d[1] < p[1] || (d[1] === p[1] && d[2] <= p[2])));
      need(less, `${at}.version ${entry.version} 比包版本 ${pkg.version} 还新——升级单不能预告未来`);
      prev = entry;
    }
  });
}

if (fail.length) {
  console.log(`FAIL test-upgrade-json（${fail.length} 条）：`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`PASS test-upgrade-json（升级单 ${spec.entries.length} 条，格式与判据齐全）`);
