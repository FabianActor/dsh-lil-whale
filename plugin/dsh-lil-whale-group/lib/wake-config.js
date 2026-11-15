/**
 * 叫醒参数的定义：只有这一份（2026-11-15 小肥鱼/小鱼丸）。
 *
 * 为什么单独一个文件：以前 index.js 里写一份默认值、render-env.mjs 用正则去
 * "读源码的文字形状"再写一份 —— 形态一改（`const WAKE = {…}` → `numSetting(...)`）
 * 正则就静默匹配不到、退回硬编码，纸开始印旧数。同一个坑挖了两次，第二次说明
 * 不是坑的问题，是方法的问题：**别让渲染器去"读"代码，让它"用"同一个函数。**
 *
 * 这个模块只负责"默认值 + 覆盖"这一步算法，**配置从哪来由调用方决定**。
 * 小鱼丸 2026-11-15 补的那一半要记住：共享代码消灭"定义漂移"，不消灭"输入漂移"——
 * 两边只要读的不是同一份配置文件，照样会有一张更可信的假纸。
 */

export const WAKE_DEFAULTS = {
  cooldownSec: 15,
  perHour: 40,
  perDay: 200,
  totalPerDay: 400,
  maxWakesPerDay: 24,
}

function numOr(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/**
 * 纯函数：cfg 是已经读出来的配置对象（不是路径）。
 * 返回生效值 + 哪几个键被配置覆盖了（给纸和账本看"这个数从哪来"）。
 */
export function resolveWake(cfg) {
  const wake = cfg?.wake && typeof cfg.wake === 'object' ? cfg.wake : {}
  const watch = cfg?.watch && typeof cfg.watch === 'object' ? cfg.watch : {}
  const overrides = []
  for (const key of ['cooldownSec', 'perHour', 'perDay', 'totalPerDay']) {
    if (wake[key] !== undefined) overrides.push(`wake.${key}`)
  }
  if (watch.maxWakesPerDay !== undefined) overrides.push('watch.maxWakesPerDay')
  return {
    cooldownSec: numOr(wake.cooldownSec, WAKE_DEFAULTS.cooldownSec),
    perHour: numOr(wake.perHour, WAKE_DEFAULTS.perHour),
    perDay: numOr(wake.perDay, WAKE_DEFAULTS.perDay),
    totalPerDay: numOr(wake.totalPerDay, WAKE_DEFAULTS.totalPerDay),
    maxWakesPerDay: numOr(watch.maxWakesPerDay, WAKE_DEFAULTS.maxWakesPerDay),
    overrides,
  }
}

/** 一行摘要，给日志和纸用：15s/40h/200d/400total cap=24/day */
export function wakeCapsText(resolved) {
  return `${resolved.cooldownSec}s/${resolved.perHour}h/${resolved.perDay}d/${resolved.totalPerDay}total cap=${resolved.maxWakesPerDay}/day`
}
