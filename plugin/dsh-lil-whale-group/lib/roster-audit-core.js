/**
 * 巡守自检行（`roster-audit` / `roster-mismatch`）的形状。
 *
 * 2026-11-18 小肥鱼读账时发现：一行里三个数相等、`exclude=` 又点着两个名字，
 * 可 `members=` 到底含不含被排除的那个，这一行没说清——她自己拿名册算了一遍才定。
 *   `members=5 homes=5 pins=5 scope=fish exclude=fabian(human),lee(home-outside-pond) ok`
 * 她的判据：「一行里放两个字段，就要写清它们的关系；否则读的人得自己算一遍。」
 *
 * 所以 `fmt=3` 起，**每个数都自带口径，排除项贴在它真正影响的那一格上**：
 *   - `members=5(fish;keys=6;not-fish=fabian)` —— 5 是鱼；名册 6 个键；fabian 是人，不进这个数
 *   - `homes=5(dirs:…)` —— `homes\` 下 5 个目录，名字列出来，不用再 `ls`
 *   - `home-check=4(fish;skip=lee:home-outside-pond)` —— 只有 4 条鱼参与「家↔名册」比对，
 *     lee 被跳过，以及为什么
 *   - `pins=5(keys:…)` —— 钉住会话的成员**键**（不是鱼数），名字也列出来
 * 旧行（`fmt=1` / `fmt=2`）不改：读的人先看 `fmt` 再决定按哪版读（`docs\detail\日志都记在哪.md`）。
 */

const FMT = 3

function namesOf(list) {
  return list && list.length ? list.join(',') : 'none'
}

/**
 * 把 `auditRoster()` 里散着的集合收成一张表。纯函数：不读文件、不看钟，只数。
 *
 * @param {object} input
 * @param {string[]} input.rosterKeys   名册里的全部键（含人）
 * @param {Array<[string, object]>} input.fishEntries 名册里的鱼（[键, 成员]）
 * @param {string[]} input.humanKeys    名册里 `kind !== 'fish'` 的键
 * @param {string[]} input.homeKeys     `homes\` 下的目录名
 * @param {string[]} input.pinKeys      `pins.json` 的键
 */
export function rosterAuditCounts({ rosterKeys = [], fishEntries = [], humanKeys = [], homeKeys = [], pinKeys = [] }) {
  const fishKeys = fishEntries.map(([key]) => key)
  // 巡守也是鱼，但它的家用的是默认 HOME、不在 `homes\` 下 —— 只有「家↔名册」这一项要跳过它。
  const watcherKeys = fishEntries
    .filter(([, member]) => member?.role === 'watcher')
    .map(([key]) => key)
  const homeChecked = fishKeys.filter((key) => !watcherKeys.includes(key))
  return {
    rosterKeys,
    fishKeys,
    watcherKeys,
    humanKeys,
    // 目录名排序，让同一台机器上的两行可以直接比
    homeKeys: [...homeKeys].sort(),
    homeChecked,
    // pins 数的是「钉住会话的成员键」，不是鱼；名字也列出来，免得哪天多一个人被读成多一条鱼
    pinKeys: [...pinKeys].sort(),
  }
}

/**
 * 拼一行。`problems` 非空时事件名是 `roster-mismatch`，否则 `roster-audit` 并以 `ok` 收尾。
 */
export function buildRosterAuditLine({ ts, counts, problems = [] }) {
  const skip = counts.watcherKeys.map((key) => `${key}:home-outside-pond`).join(',')
  const parts = [
    `members=${counts.fishKeys.length}(fish;keys=${counts.rosterKeys.length};not-fish=${namesOf(counts.humanKeys)})`,
    `homes=${counts.homeKeys.length}(dirs:${namesOf(counts.homeKeys)})`,
    `home-check=${counts.homeChecked.length}(fish;skip=${skip || 'none'})`,
    `pins=${counts.pinKeys.length}(keys:${namesOf(counts.pinKeys)})`,
  ]
  const kind = problems.length ? 'roster-mismatch' : 'roster-audit'
  const tail = problems.length ? problems.join(' ') : 'ok'
  return `${ts} | ${kind} | fmt=${FMT} ${parts.join(' ')} ${tail}`
}
