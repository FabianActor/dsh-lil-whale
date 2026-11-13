// 计划表与唤醒额度的纯逻辑（2026-11-13 从 index.js 抽出来）。
//
// 为什么单独一个文件：这些函数是"给定输入 → 返回输出"的，不碰 ctx、不发消息、不写日志。
// 抽出来以后 `scripts/test-plan.mjs` 可以直接 import 真代码做行为测试 ——
// 不再靠 grep 源码字符串（那种检查改名就误报、注释就能骗过）。
//
// 读文件、写日志、决定要不要叫醒，仍然留在 index.js：这里只做判断。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 本地日期键 yyyy-mm-dd（"今天"一律按本机时区算，不用 UTC）。 */
export function todayKey(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 这条鱼的计划表在哪：优先用名册里的 home，缺了退回调用方给的默认家。 */
export function planFileOf(member, homeRoot) {
  return join(member.home ?? homeRoot, 'plan', 'wake-plan.json')
}

/**
 * 读她自己写的那份"什么时候该推我"。格式不对一律只记一行、不推。
 *
 * @param {object} opts
 * @param {object} opts.member 名册成员（要 home / key）
 * @param {object} opts.st 这条鱼的巡守账（planFired 记今天已推过的 id）
 * @param {Date}   opts.now
 * @param {number} [opts.graceMin=1] 允许迟到的分钟数（自执行宽 15 分钟，巡守窗口 2 分钟）
 * @param {string} opts.homeRoot 成员没有 home 时的默认家
 * @param {number} [opts.maxItems=3] 表最多认几条
 * @param {(msg: string) => void} [opts.onNote] 格式问题的留痕回调
 * @returns {{id: string, at: string, why: string}[]}
 */
export function planDue({ member, st, now, graceMin = 1, homeRoot, maxItems = 3, onNote = () => {} }) {
  const note = (msg) => onNote(msg)
  let raw
  try {
    raw = JSON.parse(readFileSync(planFileOf(member, homeRoot), 'utf8'))
  } catch (e) {
    if (e?.code !== 'ENOENT') note(`plan-unreadable ${e?.message ?? e}`)
    return []
  }
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : null
  if (!list) {
    note('plan-bad-shape（要一个数组，或 {items:[...]}）')
    return []
  }
  if (list.length > maxItems) note(`plan-too-many count=${list.length} 只认前 ${maxItems} 条`)
  const today = todayKey(now)
  const mins = now.getHours() * 60 + now.getMinutes()
  const fired = st.planFired ?? {}
  const out = []
  for (const it of list.slice(0, maxItems)) {
    const id = String(it?.id ?? 'unnamed')
    if (it?.enabled === false) continue
    if (!it?.why) { note(`plan-item-without-why id=${id}`); continue }
    if (it?.until && String(it.until) < today) { note(`plan-expired id=${id} until=${it.until}`); continue }
    if (fired[id] === today) continue
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(it?.at ?? ''))
    if (!m) { note(`plan-bad-time id=${id} at=${it?.at}`); continue }
    // 可选 days：[ "sun", "mon" ... ]，只在这些日子推；不写 = 每天。
    if (Array.isArray(it?.days) && it.days.length > 0) {
      const dow = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()]
      const wanted = it.days.map((x) => String(x).slice(0, 3).toLowerCase())
      if (!wanted.includes(dow)) continue
    }
    const delta = mins - (Number(m[1]) * 60 + Number(m[2]))
    if (delta < 0 || delta > graceMin) continue
    out.push({ id, at: String(it.at), why: String(it.why) })
  }
  return out
}

/** 闹钟递的那句话。开着的窗直接用；刚被推开的窗也递进去，等她起来自己读到。 */
export function planDeliveryText(job) {
  const who = job.by === 'self' ? '自己的闹钟' : '巡守递话'
  return `${who}：\`${job.key}\` 到点了（${job.tag}）。\n\n表上写的理由：${job.itemWhy || '（没写）'}\n\n做着看不做也行，你定。这条只递一次。`
}

/**
 * 从一份 wakes 文件的内容里读出这条鱼今天/这一小时被叫醒过几次。
 * 文件内容是按成员键的对象（`{"whale":{...}}`）；也兼容早期平铺格式（直接 `{hourCount,...}`）。
 */
export function parseWakeCounts(json, memberKey) {
  const state = json?.[memberKey] ?? json ?? {}
  return { hour: Number(state?.hourCount) || 0, day: Number(state?.dayCount) || 0 }
}

/** 全池今天一共叫醒过多少次：把一份 wakes 文件里所有成员的 dayCount 相加。 */
export function sumWakesToday(json, today) {
  let sum = 0
  for (const state of Object.values(json ?? {})) {
    if (state?.dayStart === today) sum += Number(state?.dayCount) || 0
  }
  return sum
}
