/**
 * 巡守自检行（`roster-audit` / `roster-mismatch`）的形状。
 *
 * 2026-11-18 小肥鱼读账时发现：一行里三个数相等、`exclude=` 又点着两个名字，
 * 可 `members=` 到底含不含被排除的那个，这一行没说清——她自己拿名册算了一遍才定。
 *   `members=5 homes=5 pins=5 scope=fish exclude=fabian(human),lee(home-outside-pond) ok`
 * 她的判据：「一行里放两个字段，就要写清它们的关系；否则读的人得自己算一遍。」
 *
 * 所以 `fmt=3` 起（`fmt=4` 于 2026-11-18 15:4x 改了两处可能被读错的格子，形状再次变化），**每个数都自带口径，排除项贴在它真正影响的那一格上**：
 *   - `members=5(fish;keys=6;not-fish=fabian)` —— 5 是鱼；名册 6 个键；fabian 是人，不进这个数
 *   - `homes=4(fish-home:…;other:lee(no-dsh-home))` —— 只有带 `dsh-home\` 的目录才是鱼家；
 *     `homes\` 下别的目录（例如 lee 放自己东西的 `homes\lee`）单独列，不混进"家"里
 *   - `home-check=4(fish;skip=lee:watcher;watcher-home-from=members)` —— 只有 4 条鱼参与
 *     「家↔名册」比对；巡守被跳过（身份=`watcher`），它的家在 `members.json` 里查
 *   - `pins=5(keys:…)` —— 钉住会话的成员**键**（不是鱼数），名字也列出来
 * 旧行（`fmt=1` / `fmt=2`）不改：读的人先看 `fmt` 再决定按哪版读（`docs\detail\日志都记在哪.md`）。
 *
 * 2026-11-18 15:3x 小肥鱼与小鱼丸读账时又发现一处：旧写法把 `homes\lee` 数进 `homes=5`
 * 又把 lee 标成 `home-outside-pond`，读的人会以为"它在 homes\ 底下却又在家外"。
 * 两件事都对——`homes\lee` 是 lee 放自己文件的目录，不是**鱼家**（没有 `dsh-home\`）；
 * 飞行成员 lee 在名册里的 home 是 `C:\Users\Fabian\.dsh`。所以 `homes` 改成只数鱼家、
 * `other` 列出非鱼家目录，`skip` 的说明也改成"角色 + 真正的家"。
 */

const FMT = 4

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
 * @param {string[]} input.homeKeys     `homes\` 下的**鱼家**目录名（含 `dsh-home\` 的那些）
 * @param {string[]} input.otherHomeKeys `homes\` 下不是鱼家的目录名（没有 `dsh-home\`）
 * @param {Object<string, string>} input.watcherHomes 巡守键 → 它在名册里写的 home（不在 `homes\` 下）
 * @param {string[]} input.pinKeys      `pins.json` 的键
 */
export function rosterAuditCounts({ rosterKeys = [], fishEntries = [], humanKeys = [], homeKeys = [], otherHomeKeys = [], watcherHomes = {}, pinKeys = [] }) {
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
    otherHomeKeys: [...otherHomeKeys].sort(),
    watcherHomes,
    homeChecked,
    // pins 数的是「钉住会话的成员键」，不是鱼；名字也列出来，免得哪天多一个人被读成多一条鱼
    pinKeys: [...pinKeys].sort(),
  }
}

/**
 * 拼一行。`problems` 非空时事件名是 `roster-mismatch`，否则 `roster-audit` 并以 `ok` 收尾。
 */
export function buildRosterAuditLine({ ts, counts, problems = [] }) {
  // 巡守的家不写进这一列：路径里带 `:` 和 `\\`，套在括号里会让"按 ( 切"的读者
  // 静默丢掉整截家信息（小鱼丸 2026-11-18 #20 用三种朴素切法验出来的）。
  // 写成"从名册读"反而无歧义：身份（watcher）在这里，位置在 members.json 里。
  const skip = counts.watcherKeys.map((key) => `${key}:watcher`).join(',')
  const other = counts.otherHomeKeys?.length
    ? counts.otherHomeKeys.map((key) => `${key}(no-dsh-home)`).join(',')
    : 'none'
  const parts = [
    `members=${counts.fishKeys.length}(fish;keys=${counts.rosterKeys.length};not-fish=${namesOf(counts.humanKeys)})`,
    `homes=${counts.homeKeys.length}(fish-home:${namesOf(counts.homeKeys)};other:${other})`,
    `home-check=${counts.homeChecked.length}(fish;skip=${skip || 'none'}${skip ? ';watcher-home-from=members' : ''})`,
    `pins=${counts.pinKeys.length}(keys:${namesOf(counts.pinKeys)})`,
  ]
  const kind = problems.length ? 'roster-mismatch' : 'roster-audit'
  const tail = problems.length ? problems.join(' ') : 'ok'
  return `${ts} | ${kind} | fmt=${FMT} ${parts.join(' ')} ${tail}`
}
