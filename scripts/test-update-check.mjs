import { versionFromTag, newerThan, latestReleaseOf, LATEST_RELEASE_API } from '../plugin/dsh-lil-whale-group-ui/lib/version-core.js'

let pass = 0
const fails = []
function check(name, fn) {
  try {
    fn()
    pass += 1
  } catch (error) {
    fails.push(`${name}：${error.message}`)
  }
}
function eq(actual, expected, what) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what} 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
  }
}

// ---- tag 解析 ----
check('v 前缀能剥掉', () => eq(versionFromTag('v1.12.2'), '1.12.2', 'versionFromTag'))
check('没有 v 也认', () => eq(versionFromTag('1.12.2'), '1.12.2', 'versionFromTag'))
check('前后空白能容忍', () => eq(versionFromTag('  v1.12.2\n'), '1.12.2', 'versionFromTag'))
check('预发布 tag 认', () => eq(versionFromTag('v1.13.0-rc.1'), '1.13.0-rc.1', 'versionFromTag'))
check('两位版本不认', () => eq(versionFromTag('v1.12'), null, 'versionFromTag'))
check('带前缀的名字不认', () => eq(versionFromTag('release-1.12.2'), null, 'versionFromTag'))
check('空值不认', () => eq(versionFromTag(null), null, 'versionFromTag'))

// ---- 版本比较 ----
check('次版本更高', () => eq(newerThan('1.13.0', '1.12.2'), true, 'newerThan'))
check('同版本不算更新', () => eq(newerThan('1.12.2', '1.12.2'), false, 'newerThan'))
check('旧版本不算更新', () => eq(newerThan('1.12.1', '1.12.2'), false, 'newerThan'))
check('第三位按数字比，不按字符串', () => eq(newerThan('1.12.10', '1.12.9'), true, 'newerThan'))
check('主版本跳变', () => eq(newerThan('2.0.0', '1.99.99'), true, 'newerThan'))
check('预发布按数字段比', () => eq(newerThan('1.13.0-rc.1', '1.12.2'), true, 'newerThan'))
check('缺一侧返回 null', () => eq(newerThan(null, '1.12.2'), null, 'newerThan'))

// ---- Release JSON ----
check('标准 Release 能读', () => {
  const r = latestReleaseOf({ tag_name: 'v1.12.2', html_url: 'https://github.com/FabianActor/dsh-lil-whale/releases/tag/v1.12.2' })
  eq(r.version, '1.12.2', 'latestReleaseOf.version')
  eq(r.url, 'https://github.com/FabianActor/dsh-lil-whale/releases/tag/v1.12.2', 'latestReleaseOf.url')
})
check('读不出 tag 要抛错（不能装成已是最新）', () => {
  let threw = false
  try { latestReleaseOf({ tag_name: 'nightly' }) } catch { threw = true }
  eq(threw, true, '抛错')
})
check('空 JSON 也要抛错', () => {
  let threw = false
  try { latestReleaseOf({}) } catch { threw = true }
  eq(threw, true, '抛错')
})

// ---- 数据源写死成 GitHub Releases（不是 npm registry） ----
check('API 指向 GitHub Releases 的 latest', () => {
  eq(LATEST_RELEASE_API, 'https://api.github.com/repos/FabianActor/dsh-lil-whale/releases/latest', 'LATEST_RELEASE_API')
})

console.log(`test-update-check：合计 ${pass + fails.length}，PASS ${pass}，FAIL ${fails.length}`)
for (const f of fails) console.log(' - ' + f)
process.exit(fails.length ? 1 : 0)
