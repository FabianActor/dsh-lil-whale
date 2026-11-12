/**
 * 群聊页面（Client 半边）。
 *
 * 侧边栏顶部一个图标，点开是主面板里的一页：三条鱼的群，
 * 有名字、有内容、有时间、有头像（默认是名字首字，可在设置里改）。
 *
 * 另有一页设置（设置 → 小小肥鱼）：侧边栏名称、三个头像的文字与颜色、显示名。
 *
 * 数据全部来自宿主那几条路由（/group/api/messages、/group/api/send、
 * /group/api/config、/group/api/presence），不在浏览器里直接读文件。
 */
window.__ModuleLoader__.load({
  id: 'lil-whale-group-ui',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } = React

    const PANEL_ID = 'group'
    const SETTINGS_ID = 'lil-whale'

    // 宽度：两侧各留 4% 页边距，再宽就压到边框上了
    const WIDTH_MIN = 30
    const WIDTH_MAX = 92

    // 显示名兜底（真正的值在 ui-config.json 的 names 里，可在设置里改）
    const NAMES = { lee: '大肥鱼', whale: '小肥鱼', fabian: 'Fabian' }

    const DEFAULT_CONFIG = {
      panelLabel: '鱼群',
      notifyScope: 'all',
      avatars: {
        lee: { text: '大', tint: '#4a7dbd' },
        whale: { text: '小', tint: '#c2705a' },
        fabian: { text: 'F', tint: '#5c8a6a' },
      },
      names: { lee: '大肥鱼', whale: '小肥鱼', fabian: 'Fabian' },
      /** 座位名：会话 id 前 6 位 → 这段会话在群里显示的名字（同一个人的第二段会话用得上）。 */
      seats: {},
    }

    const t = {
      panel: '鱼群',
      title: '群',
      empty: '这里还什么都没有。说一句，就有了。',
      placeholder: '在群里说点什么…',
      send: '发送',
      toAll: '所有人',
      toLee: '大肥鱼',
      toWhale: '小肥鱼',
      groupOnly: '在群里说（谁会醒由阀门决定）',
      toOne: (name) => `只有 ${name} 会被叫醒`,
      typing: (names) => `${names} 正在回复…`,
      // 两档"忙"，群聊私聊同一套：在回这一段（typing）/ 在别处忙（busy，可能就在另一个窗口）。
      // 宿主只给得出 reason，给不出"这句话回谁"——所以文案也只承诺到这一层。
      busy: (names) => `${names} 正在忙…`,
      mention: '右键 @',
      settingsTitle: '小小肥鱼',
      settingsHint: '这些只改显示，不碰她的文件。',
    }

    // 没发出去的字不能因为"切走看一眼"就没。草稿只存在这台机器的浏览器里
    // （localStorage，按会话分键），不进她的家、不进群记录。
    const GROUP_DRAFT_KEY = 'dsh-group-draft'
    const dmDraftKeyOf = (peer) => `dsh-group-dm-draft-${peer}`
    const readDraft = (key) => {
      try { return window.localStorage?.getItem(key) ?? '' } catch { return '' }
    }
    const writeDraft = (key, value) => {
      try {
        if (value) window.localStorage?.setItem(key, value)
        else window.localStorage?.removeItem(key)
      } catch { /* 存不进去也让打字继续：草稿没了是遗憾，打字卡住是故障 */ }
    }

    /**
     * 一条 presence 记录 → { status, reason }。
     * 兼容旧形状（直接是字符串）：服务端升级前后页面都别白。
     */
    function presenceOf(presence, id) {
      const value = presence ? presence[id] : undefined
      if (typeof value === 'string') return { status: value, reason: 'self' }
      if (value && typeof value === 'object') {
        return { status: String(value.status ?? 'idle'), reason: String(value.reason ?? 'self') }
      }
      return { status: 'idle', reason: 'self' }
    }
    // 一份配置：模块级缓存，侧边栏 label 要能同步读到
    let cachedConfig = null

    async function loadConfig(force = false) {
      if (cachedConfig && !force) return cachedConfig
      try {
        const response = await fetch('/group/api/config', { headers: { accept: 'application/json' } })
        if (response.ok) {
          const data = await response.json()
          if (data && typeof data === 'object') cachedConfig = { ...DEFAULT_CONFIG, ...data }
        }
      } catch {
        // 拿不到就用默认值，页面照样能用
      }
      return cachedConfig ?? DEFAULT_CONFIG
    }

    async function saveConfig(next) {
      const response = await fetch('/group/api/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      cachedConfig = { ...DEFAULT_CONFIG, ...(await response.json()) }
      return cachedConfig
    }

    /**
     * 名字：默认按成员 id 取。
     * 但同一个人的多段会话会共用一个 id（`lee`），所以如果能拿到这条消息的 `s`，
     * 就先在 `seats` 里找座位名 —— 群里因此能分出「大肥鱼·工」和「大肥鱼·家」。
     */
    function nameOf(config, id, s) {
      const seat = s ? config?.seats?.[s] : ''
      if (typeof seat === 'string' && seat.trim() !== '') return seat
      return config?.names?.[id] || NAMES[id] || id
    }

    function avatarOf(config, id) {
      return config?.avatars?.[id] || DEFAULT_CONFIG.avatars[id] || { text: '?', tint: '#8a8a8a' }
    }

    /**
     * 窄布局判定：量**自己这块地方**有多宽，不看窗口。
     *
     * dsh 官方没有"手机模式"这个概念——界面按**容器宽度**自适应（`container-type: inline-size`
     * 配 `@container (width <= N)`，例如官方 agent-preset 在 540px、permission-presets 在 460px
     * 收缩），因为同一块界面可能被放进侧栏、主区或弹窗，窗口宽度说明不了它有多少可用空间。
     * 这里用 ResizeObserver 量根元素的 inline-size，跟容器查询是同一个判据；
     * 差别只在 `@container` 只能改样式，而"拆成两屏"是结构变化，必须在 JS 里决定。
     *
     * 阈值为什么不是 768：768 是官方 layout 判 **frame（整个窗口）** 要不要变抽屉的数，
     * 而这块面板拿到的是 frame 减掉侧栏之后的宽度。把 frame 的尺子拿来量面板，
     * 等于把侧栏的宽度重复扣了一次。
     *
     * 这里按"放不放得下两栏"定：列表 280 + 会话 360 ≈ 640。
     * 选 640 还有一个好处：侧栏收起会给面板腾出约 224px（280 → 56），
     * 640 落在这个跳变之外，拖宽拖窄不会在两档之间来回翻。
     */
    const NARROW_INLINE_PX = 640

    function measureInline(node) {
      if (!node) return 0
      // 跟官方 layout 同一个量法：`el.getBoundingClientRect().width`（不是 clientWidth，
      // 那个会砍掉边框、还会取整）。
      const rect = node.getBoundingClientRect?.()
      return rect?.width || node.clientWidth || 0
    }

    function useNarrow(ref) {
      const [narrow, setNarrow] = useState(false)
      useEffect(() => {
        const node = ref?.current
        if (!node) return undefined
        const apply = (width) => setNarrow(Number.isFinite(width) && width > 0 && width < NARROW_INLINE_PX)
        apply(measureInline(node))
        if (typeof ResizeObserver === 'undefined') {
          const onResize = () => apply(measureInline(node))
          window.addEventListener('resize', onResize)
          return () => window.removeEventListener('resize', onResize)
        }
        const observer = new ResizeObserver((entries) => {
          const entry = entries[0]
          if (!entry) return
          const width = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect?.width
          apply(width)
        })
        observer.observe(node)
        return () => observer.disconnect()
      }, [ref])
      return narrow
    }

    /**
     * 触控设备判定。官方输入卡用 `@media (pointer: coarse)` 把字号抬到 16px——
     * iOS 聚焦小于 16px 的输入框会把整页放大一下。窄窗口不等于手指操作，两件事分开判。
     */
    const COARSE_QUERY = '(pointer: coarse)'

    function useCoarsePointer() {
      const [coarse, setCoarse] = useState(() => {
        try { return window.matchMedia(COARSE_QUERY).matches } catch { return false }
      })
      useEffect(() => {
        let mq = null
        try { mq = window.matchMedia(COARSE_QUERY) } catch { return undefined }
        const sync = () => setCoarse(mq.matches)
        try {
          if (mq.addEventListener) mq.addEventListener('change', sync)
          else if (mq.addListener) mq.addListener(sync)
        } catch { /* ignore */ }
        sync()
        return () => {
          try {
            if (mq.removeEventListener) mq.removeEventListener('change', sync)
            else if (mq.removeListener) mq.removeListener(sync)
          } catch { /* ignore */ }
        }
      }, [])
      return coarse
    }

    /**
     * 说话对象里可以带座位：`lee@ae4daa` = 指名大肥鱼的那一段。
     * 不带 @ 就是叫这个人本身——两段谁空谁应。
     */
    function splitTarget(to) {
      const text = typeof to === 'string' ? to : ''
      const at = text.indexOf('@')
      return at < 0 ? { base: text, seat: '' } : { base: text.slice(0, at), seat: text.slice(at + 1) }
    }

    function targetName(config, to) {
      const { base, seat } = splitTarget(to)
      if (seat === '') return nameOf(config, base)
      const named = config?.seats?.[seat]
      if (typeof named === 'string' && named.trim() !== '') return named
      return `${nameOf(config, base)} · ${seat}`
    }

    const baseStyle = {
      color: 'var(--dsw-alias-label-primary)',
      fontFamily: 'inherit',
      height: '100%',
      minHeight: 0,
    }

    /** 头像：一块圆角方块，里面是 1–2 个字。颜色取自配置。 */
    /**
     * 头像。
     *
     * `onContextMenu` / `title` 故意挂在**头像自己**身上，而不是外面再包一层：
     * 包一层的话，热区取决于那一层的宽度（曾经被拉成半个气泡那么宽），
     * 右键哪里算"点在头像上"就说不清了。这里 34×34 就是 34×34。
     */
    function Avatar({ config, member, size = 34, onContextMenu, title }) {
      const avatar = avatarOf(config, member)
      const box = {
        width: size, height: size, borderRadius: Math.round(size * 0.3),
        flex: '0 0 auto',
        cursor: onContextMenu ? 'context-menu' : undefined,
        background: avatar.tint,
        color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: Math.max(11, Math.round(size * 0.42)),
        fontWeight: 500,
        userSelect: 'none',
        overflow: 'hidden',
      }
      // 有照片就画照片，没有才退回文字。`v` 是换图时间戳：
      // 同一张脸换了图，URL 跟着变，浏览器不用清缓存。
      if (avatar.image) {
        return h('div', { onContextMenu, title, style: box },
          h('img', {
            src: `/group/api/avatar?member=${encodeURIComponent(member)}&v=${avatar.version || 0}`,
            alt: nameOf(config, member),
            draggable: false,
            style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
          }),
        )
      }
      return h('div', { onContextMenu, title, style: box }, avatar.text)
    }
    /**
     * dsh 自己的 Markdown 渲染器，来自浏览器静态模块表（`@deepseek-ai/dsh-client-ui-primitives`）。
     * 群里的消息是 markdown：当纯文本画会把 **加粗**、`代码` 原样显示出来。
     * 解析不到就退回纯文本 —— 宁可少渲染，不要空白。
     */
    const MarkdownText = (() => {
      try {
        const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
        const md = primitives && primitives.MarkdownText
        // dsh 的 MarkdownText 是 React.memo(...) 包出来的，typeof 是 "object" 不是 "function"。
        // 只认 function 会把它判成"没有"——这个坑我踩过一次。
        if (md && (typeof md === 'function' || typeof md === 'object')) return md
        console.warn('[lil-whale-group-ui] primitives 里没有可用的 MarkdownText，用自带渲染兜底')
        return null
      } catch (error) {
        // 退化成纯文本可以接受，但必须留一条痕迹：静默降级等于把错误藏起来。
        console.warn('[lil-whale-group-ui] 取不到 @deepseek-ai/dsh-client-ui-primitives，退回纯文本：', error?.message ?? error)
        return null
      }
    })()


    /* ───────── 自带的轻量 markdown 渲染 ─────────
     * 群里写的是 markdown。dsh 的 `MarkdownText` 优先（视觉和主界面完全一致），
     * 但它来自浏览器静态模块表，能不能 require 到不受我们控制 —— 所以这里留一份
     * 自己的实现：粗体/斜体/行内代码/链接/标题/列表/引用/代码块/段落。
     * 不做表格、不做嵌套列表、不做脚注：群聊里没人写那些，写了也读得懂。
     * 每个块都打 key，避免 React 警告。
     */

    function inlineNodes(text) {
      const nodes = []
      const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)\s]+\))/g
      let last = 0
      let match
      let k = 0
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) nodes.push(text.slice(last, match.index))
        const token = match[0]
        if (token.startsWith('`')) {
          nodes.push(
            h(
              'code',
              {
                key: `c${k}`,
                style: {
                  padding: '1px 5px',
                  borderRadius: 4,
                  background: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.06))',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  fontSize: '0.92em',
                },
              },
              token.slice(1, -1),
            ),
          )
        } else if (token.startsWith('**')) {
          nodes.push(h('strong', { key: `b${k}`, style: { fontWeight: 600 } }, token.slice(2, -2)))
        } else if (token.startsWith('*')) {
          nodes.push(h('em', { key: `i${k}` }, token.slice(1, -1)))
        } else {
          const cut = token.indexOf('](')
          const label = token.slice(1, cut)
          const href = token.slice(cut + 2, -1)
          nodes.push(
            h(
              'a',
              {
                key: `a${k}`,
                href,
                target: '_blank',
                rel: 'noreferrer',
                style: { color: 'var(--dsw-alias-link, var(--dsw-alias-state-business-primary, #4a7dbd))' },
              },
              label,
            ),
          )
        }
        last = match.index + token.length
        k += 1
      }
      if (last < text.length) nodes.push(text.slice(last))
      return nodes
    }

    function MarkdownBody({ text }) {
      const blocks = String(text ?? '').replace(/\r\n/g, '\n').split(/\n{2,}/)
      const out = []
      blocks.forEach((raw, index) => {
        const block = raw.replace(/^\n+|\n+$/g, '')
        if (!block) return
        const key = `blk${index}`

        const fence = block.match(/^```(\w*)\n([\s\S]*?)\n?```$/)
        if (fence) {
          out.push(
            h(
              'pre',
              {
                key,
                style: {
                  margin: '4px 0',
                  padding: '10px 12px',
                  borderRadius: 8,
                  overflowX: 'auto',
                  background: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.06))',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  fontSize: 13,
                  lineHeight: '20px',
                },
              },
              h('code', null, fence[2]),
            ),
          )
          return
        }

        const heading = block.match(/^(#{1,6})\s+(.*)$/)
        if (heading && !block.includes('\n')) {
          const level = heading[1].length
          out.push(
            h(
              'div',
              {
                key,
                style: {
                  fontSize: level <= 2 ? 16 : 15,
                  fontWeight: 600,
                  lineHeight: '24px',
                  margin: '2px 0 2px',
                  color: 'var(--dsw-alias-label-primary)',
                },
              },
              ...inlineNodes(heading[2]),
            ),
          )
          return
        }

        const lines = block.split('\n')
        const isBullet = (line) => /^\s*([-*+]|\d+\.)\s+/.test(line)
        if (lines.every(isBullet)) {
          const ordered = /^\s*\d+\./.test(lines[0])
          const Tag = ordered ? 'ol' : 'ul'
          out.push(
            h(
              Tag,
              {
                key,
                style: {
                  margin: '2px 0',
                  paddingLeft: 22,
                  listStyleType: ordered ? 'decimal' : 'disc',
                  lineHeight: '22px',
                },
              },
              ...lines.map((line, li) =>
                h('li', { key: `li${li}`, style: { margin: '1px 0' } }, ...inlineNodes(line.replace(/^\s*([-*+]|\d+\.)\s+/, ''))),
              ),
            ),
          )
          return
        }

        if (block.startsWith('>')) {
          out.push(
            h(
              'div',
              {
                key,
                style: {
                  margin: '2px 0',
                  paddingLeft: 10,
                  borderLeft: '2px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.15))',
                  color: 'var(--dsw-alias-label-secondary)',
                  lineHeight: '22px',
                },
              },
              ...inlineNodes(block.replace(/^>\s?/gm, '')),
            ),
          )
          return
        }

        out.push(
          h(
            'div',
            { key, style: { lineHeight: '22px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' } },
            ...inlineNodes(block),
          ),
        )
      })
      return h('div', null, ...out)
    }

    /**
     * 官方的 MarkdownText 依赖它自己的 React context（`MarkdownDelegateProvider`）：
     * 在 dsh 主界面里有人在外面套好了，在我们这种独立 slot 里不一定有。
     * 缺 context 时它会直接抛错 —— 一抛整页就白了。所以这里加一层错误边界：
     * 一条消息渲染失败就退回我们自己的渲染器，别把整页带走。
     */
    /**
     * MarkdownText 需要一份 labels 文案（复制按钮、代码块工具条、脚注）。
     * 官方插件是用自己的 i18n 生成的；我们没接 i18n，就给一份写死的。
     * 少了它会直接 "Cannot read properties of undefined" —— 实测过。
     */
    const MARKDOWN_LABELS = {
      code: {
        copyLabel: '复制',
        copiedLabel: '已复制',
        toolbarLabels: { codeLabel: '代码', wrapLabel: '自动换行', unwrapLabel: '不换行' },
      },
      footnotes: '脚注',
    }

    class SafeMarkdown extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }

      static getDerivedStateFromError() {
        return { failed: true }
      }

      componentDidCatch(error) {
        console.warn('[lil-whale-group-ui] MarkdownText 渲染失败，这条改用自带渲染：', error?.message ?? error)
      }

      render() {
        if (this.state.failed || !MarkdownText) return h(MarkdownBody, { text: this.props.text })
        return h(MarkdownText, { text: this.props.text, labels: MARKDOWN_LABELS })
      }
    }

    /**
     * 消息上方的时间戳。
     *
     * 只写 `16:08` 会有歧义：可能是三分钟前，也可能是三个月前。规则（Fabian 2026-11-11 定）：
     *   今天        → 「今天 16:08」
     *   今年内更早  → 「11月10日 09:45」
     *   去年及以前  → 「2025年12月31日 23:00」
     * 判断"今天"用本地日历日，不用时间差 —— 差 8 小时和"跨了一次午夜"是两回事。
     */
    function formatStamp(ts) {
      const date = new Date(ts ?? '')
      if (Number.isNaN(date.getTime())) return ''
      const pad = (n) => String(n).padStart(2, '0')
      const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
      const now = new Date()
      const today = date.getFullYear() === now.getFullYear()
        && date.getMonth() === now.getMonth()
        && date.getDate() === now.getDate()
      if (today) return `今天 ${clock}`
      const monthDay = `${date.getMonth() + 1}月${date.getDate()}日 ${clock}`
      return date.getFullYear() === now.getFullYear()
        ? monthDay
        : `${date.getFullYear()}年${monthDay}`
    }

    /** 一条消息：左边是别人，右边是自己。 */
    /** 一条消息里的图片怎么取：id/ext 必须有，path/algo 有就带上（读取端优先认记录自己的说法）。 */
const imageUrlOf = (image) => {
  const params = new URLSearchParams({ id: String(image.id), ext: String(image.ext) })
  if (typeof image.path === 'string' && image.path !== '') params.set('path', image.path)
  if (typeof image.algo === 'string' && image.algo !== '') params.set('algo', image.algo)
  return `/group/api/image?${params.toString()}`
}
function Bubble({ config, message, onMention, animate = false }) {
      // 只在挂载时决定「要不要动画」：否则后续每次重渲染都会让老消息重新弹一遍。
      const animateOnMount = useRef(animate).current
      const mine = message.from === 'fabian'
      const who = nameOf(config, message.from, message.s)
      // 指名到座位的消息，显示"→ 大肥鱼 · 日常"，只写给这个人的显示"→ 大肥鱼"。
      const targetTo = message.toSeat ? `${message.to}@${message.toSeat}` : message.to
      const target = message.to && message.to !== 'all' ? ` → ${targetName(config, targetTo)}` : ''
      const time = formatStamp(message.ts)
      return h('div', {
        style: {
          display: 'flex', gap: 10, padding: '6px 12px',
          flexDirection: mine ? 'row-reverse' : 'row',
        },
      },
        h(Avatar, {
          config,
          member: message.from,
          size: 34,
          // 右键头像就 @ 他：比先去面板里找人快。
          // 私聊页不传 onMention —— 那里没有"@给谁"这回事，右键就该是浏览器自己的菜单。
          onContextMenu: mine || !onMention
            ? undefined
            : (event) => { event.preventDefault(); onMention(message.from) },
          title: mine || !onMention ? undefined : `${t.mention}${who}`,
        }),
        h('div', {
          style: {
            display: 'flex', flexDirection: 'column', gap: 4,
            alignItems: mine ? 'flex-end' : 'flex-start',
            maxWidth: '78%', minWidth: 0,
          },
        },
          h('div', {
            style: {
              display: 'flex', alignItems: 'baseline', gap: 6,
              fontSize: 12, color: 'var(--dsw-alias-label-tertiary)',
            },
          }, h('span', null, who + target), h('span', null, time)),
          h('div', {
            style: {
              padding: '8px 12px', borderRadius: 'var(--dsw-radius-lg, 12px)',
              background: mine ? 'rgba(74, 125, 189, 0.12)' : 'rgba(15, 20, 30, 0.06)',
              fontSize: 14, lineHeight: '22px',
              wordBreak: 'break-word',
              animation: animateOnMount ? 'dshGroupRise 240ms cubic-bezier(.2,.8,.2,1) both' : undefined,
            },
              },
              message.image
                ? h('img', {
                  src: imageUrlOf(message.image),
                  alt: '图片',
                  loading: 'lazy',
                  onClick: () => {
                    try {
                      window.open(imageUrlOf(message.image), '_blank')
                    } catch { /* 弹窗被拦就算了，图本身已经在页面上 */ }
                  },
                  style: {
                    display: 'block', maxWidth: 260, maxHeight: 260,
                    borderRadius: 'var(--dsw-radius-md, 8px)', cursor: 'zoom-in',
                    marginBottom: message.text ? 6 : 0,
                  },
                })
                : null,
              message.text ? h(SafeMarkdown, { text: message.text }) : null),
        ),
      )
    }

    /**
     * 消息区两侧的拖拽热区。
     *
     * 这里**不画线**。可见性折腾了很多轮（边框盖住、token 近透明、定位写法换了就消失），
     * 结论是：与其画一条看不见的线，不如不画 —— 光标移进来会变成左右箭头，
     * 那本身就是提示。热区给到 14px，比看起来需要的宽，因为少了视觉提示更难瞄准。
     */
    function WidthHandle({ side, width, onChange, onCommit, containerRef }) {
      const start = useRef(null)
      const [hovered, setHovered] = useState(false)
      const [dragging, setDragging] = useState(false)
      // 指针离顶端多远：那条 72px 的短线段跟着它漂（照抄原生 dsh 的手感）
      const [pointerY, setPointerY] = useState(null)
      const active = hovered || dragging
      return h('div', {
        onPointerEnter: () => setHovered(true),
        onPointerLeave: () => {
          if (start.current) return
          setHovered(false)
          setPointerY(null)
        },
        onPointerDown: (event) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture?.(event.pointerId)
          setDragging(true)
          start.current = {
            x: event.clientX,
            spanPx: containerRef?.current?.clientWidth ?? window.innerWidth,
            startPct: width,
          }
        },
        onPointerMove: (event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setPointerY(Math.max(0, Math.min(rect.height, event.clientY - rect.top)))
          if (!start.current) return
          const { x, spanPx, startPct } = start.current
          if (!(spanPx > 0)) return
          // 居中列：两侧同时外扩，所以位移要乘 2
          const deltaPct = ((event.clientX - x) * 2 * 100) / spanPx
          const raw = side === 'left' ? startPct - deltaPct : startPct + deltaPct
          onChange(Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, raw)))
        },
        onPointerUp: (event) => {
          event.currentTarget.releasePointerCapture?.(event.pointerId)
          start.current = null
          setDragging(false)
          onCommit?.()
        },
        onPointerCancel: () => {
          start.current = null
          setDragging(false)
          onCommit?.()
        },
        title: '拖动调整宽度',
        style: {
          position: 'absolute', top: 0, bottom: 0, width: 14,
          [side]: -7, cursor: 'col-resize', touchAction: 'none',
        },
      },
        h('div', {
          style: {
            position: 'absolute', left: '50%', marginLeft: -1, width: 2, height: 72,
            top: pointerY === null ? 'calc(50% - 36px)' : `${pointerY - 36}px`,
            borderRadius: 2,
            // 平时完全透明；指针进到热区才浮出一段 72px、两端渐隐的短线段，跟着指针漂。
            backgroundImage: dragging
              ? 'linear-gradient(to bottom, transparent 0%, var(--dsw-alias-brand-primary, #4a7dbd) 33%, var(--dsw-alias-brand-primary, #4a7dbd) 66%, transparent 100%)'
              : 'linear-gradient(to bottom, transparent 0%, #b8bec8 33%, #b8bec8 66%, transparent 100%)',
            opacity: active ? 1 : 0,
            transition: 'opacity 120ms ease',
            pointerEvents: 'none',
          },
        }),
      )
    }

    /** "@ 谁" 的小面板：一行一个成员，头像 + 名字。点「所有人」= 不指定对象。 */
    function AtPicker({ config, current, seats, onPick, onClose }) {
      const [hovered, setHovered] = useState(null)
      const boxRef = useRef(null)
      // 移出去不关；点别处才关。她自己点 @ 钮那种情况由 data-at-anchor 放行，
      // 否则 mousedown 先关、click 再开，那个按钮就永远关不上了。
      useEffect(() => {
        const onDown = (event) => {
          const target = event.target
          if (boxRef.current && boxRef.current.contains(target)) return
          if (target?.closest?.('[data-at-anchor]')) return
          onClose()
        }
        const onKey = (event) => { if (event.key === 'Escape') onClose() }
        document.addEventListener('mousedown', onDown)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('mousedown', onDown)
          document.removeEventListener('keydown', onKey)
        }
      }, [onClose])
      // 名字下面列出座位：同一个人有几段会话，就有几行「大肥鱼 · 开发」这样可选。
      const rows = [{ id: 'all', label: t.toAll, plain: true }]
      for (const member of ['lee', 'whale']) {
        rows.push({ id: member, label: nameOf(config, member) })
        for (const seat of (seats ?? []).filter((item) => item.member === member)) {
          rows.push({
            id: `${member}@${seat.prefix}`,
            label: config?.seats?.[seat.prefix] || `${nameOf(config, member)} · ${seat.prefix}`,
            indented: true,
          })
        }
      }
      return h('div', {
        ref: boxRef,
        style: {
          position: 'absolute', bottom: 46, left: 4, zIndex: 30,
          width: 200, maxHeight: 240, overflowY: 'auto', padding: 6, borderRadius: 12,
          background: 'var(--dsw-alias-bg-layer-1, #fff)',
          border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12))',
          boxShadow: '0 8px 28px rgba(0,0,0,0.18)',
        },
      }, rows.map((row) => {
        const active = (current || 'all') === row.id
        const lit = active || hovered === row.id
        return h('button', {
          key: row.id,
          onClick: () => onPick(row.id),
          onMouseDown: (event) => event.preventDefault(),
          onMouseEnter: () => setHovered(row.id),
          onMouseLeave: () => setHovered(null),
          style: {
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            padding: '7px 8px', border: 'none', borderRadius: 8,
            background: lit ? 'var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06))' : 'transparent',
            color: 'var(--dsw-alias-label-primary)',
            font: 'inherit', fontSize: 13, cursor: 'pointer', textAlign: 'left',
            transition: 'background 90ms ease',
          },
        },
          h('div', { style: { marginLeft: row.indented ? 14 : 0, display: 'flex', flex: 1, minWidth: 0 } },
            row.plain
              ? h('div', {
                style: {
                  width: 26, height: 26, borderRadius: '50%',
                  border: '1px dashed var(--dsw-alias-border-l3, rgba(0,0,0,0.2))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, color: 'var(--dsw-alias-label-tertiary)',
                },
              }, '群')
              : h(Avatar, { config, member: splitTarget(row.id).base, size: 26 }),
            h('span', { style: { flex: 1, marginLeft: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, row.label),
          ),
          active ? h('span', { style: { color: 'var(--dsw-alias-brand-primary, #4a7dbd)', fontSize: 12 } }, '✓') : null,
        )
      }))
    }

    async function markRead(channel, peer) {
      try {
        await fetch('/group/api/read', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ channel, peer }),
        })
      } catch {
        // 清不掉就继续亮着，比假装看过好
      }
    }

    function dmTotal(unread) {
      return Object.values(unread?.dm ?? {}).reduce((sum, count) => sum + (Number(count) || 0), 0)
    }

    async function loadUnread() {
      try {
        const response = await fetch('/group/api/unread', { headers: { accept: 'application/json' } })
        if (!response.ok) return null
        const data = await response.json()
        return {
          group: Number(data?.group) || 0,
          dm: data?.dm && typeof data.dm === 'object' ? data.dm : {},
          total: Number(data?.total) || 0,
          // 上次看到哪儿：面板拿它画「以上为历史消息」那条线（他 2026-11-11 要的）
          seen: {
            group: typeof data?.seen?.group === 'string' ? data.seen.group : '',
            dm: data?.seen?.dm && typeof data.seen.dm === 'object' ? data.seen.dm : {},
          },
        }
      } catch {
        return null
      }
    }

    /** 一条淡灰细线 + 一行小字：上次看到这里，新的在下面。不抢眼，只做分界。 */
    function HistoryDivider({ nodeRef }) {
      // 0.5px 在 1x 屏上会碎成一排看不见的点。这条线是"从哪儿开始看"的唯一线索，用 1px。
      const line = { flex: 1, height: 1, background: 'var(--dsw-alias-border-l3, rgba(0,0,0,0.16))' }
      return h('div', { ref: nodeRef, style: { display: 'flex', alignItems: 'center', gap: 12, margin: '14px 24px' } },
        h('div', { style: line }),
        h('span', {
          style: {
            fontSize: 12, lineHeight: '16px', whiteSpace: 'nowrap',
            color: 'var(--dsw-alias-label-tertiary, rgba(0,0,0,0.45))',
          },
        }, '以上为历史消息'),
        h('div', { style: line }))
    }

    /**
     * 把分割线插在"第一条比 seenTs 新的消息"前面。
     * 第一次打开（seenTs 为空）不画；没有更新的消息也不画 —— 一条永远出现在最后面的线不是信息。
     */
    function withDivider(messages, seenTs, renderBubble, dividerRef) {
      const nodes = []
      let placed = false
      for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index]
        if (!placed && seenTs !== '' && String(message?.ts ?? '') > seenTs) {
          nodes.push(h(HistoryDivider, { key: 'history-divider', nodeRef: dividerRef }))
          placed = true
        }
        nodes.push(renderBubble(message, index))
      }
      return nodes
    }

    /**
     * 贴着底部看，还是翻历史。
     *
     * 两件事分开：`stickToBottom` 是"把视图放到最下面"，`measureBottom` 是"现在到底算不算在最下面"。
     * 只有本来就贴着底的时候，新消息才跟着滚 —— 否则人正翻到三天前，被一条新消息弹回今天。
     * 40px 不是手感，是"人眼还能接受自己被打断"的范围。
     */
    /**
     * 选图 / 粘贴 / 拖入，最后都走这里。
     * 群聊和私聊共用：只收图片、限 8 MB，超了直接说清楚，不静默丢掉。
     * 返回 { pendingImage, setPendingImage, imageBusy, attachImage, fileRef }。
     */
    function useImageAttach(setError) {
      const [pendingImage, setPendingImage] = useState(null)
      const [imageBusy, setImageBusy] = useState(false)
      const fileRef = useRef(null)
      const attachImage = useCallback(async (file) => {
        if (!file) return
        if (!/^image\//.test(file.type)) {
          setError('只能发图片（png / jpg / webp / gif）')
          return
        }
        if (file.size > 8 * 1024 * 1024) {
          setError(`图片太大：${(file.size / 1048576).toFixed(1)} MB，上限 8 MB`)
          return
        }
        setImageBusy(true)
        try {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result ?? ''))
            reader.onerror = () => reject(new Error('这张图读不出来'))
            reader.readAsDataURL(file)
          })
          setPendingImage(dataUrl)
          setError(null)
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          setImageBusy(false)
        }
      }, [setError])
      return { pendingImage, setPendingImage, imageBusy, attachImage, fileRef }
    }

    function useFollowTail(scrollRef, deps) {
      const atBottomRef = useRef(true)
      const [atBottom, setAtBottom] = useState(true)
      const stickToBottom = useCallback(() => {
        const el = scrollRef.current
        if (el) el.scrollTop = el.scrollHeight
      }, [scrollRef])
      const measureBottom = useCallback(() => {
        const el = scrollRef.current
        if (!el) return
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight
        const next = distance <= 40
        if (next !== atBottomRef.current) {
          atBottomRef.current = next
          setAtBottom(next)
        }
      }, [scrollRef])
      const jumpToBottom = useCallback(() => {
        atBottomRef.current = true
        setAtBottom(true)
        stickToBottom()
        requestAnimationFrame(stickToBottom)
      }, [stickToBottom])
      useEffect(() => {
        if (!atBottomRef.current) return undefined
        stickToBottom()
        const raf = requestAnimationFrame(stickToBottom)
        const timer = setTimeout(stickToBottom, 200)
        return () => { cancelAnimationFrame(raf); clearTimeout(timer) }
      }, deps)
      return { atBottom, measureBottom, jumpToBottom }
    }

    /**
     * 回到底部按钮 —— 照 dsh 的 `EvIC1a_toBottom`：34px、悬浮在消息区底部上方、
     * 贴着内容列的右边缘，不压输入框。
     *
     * 圆用内嵌 SVG 画而不是 `border-radius`：这个壳上 `border-radius` 出过两次
     * "样式算对了、画出来还是圆角矩形"，改用 `<circle>` 之后一次就对了（见 PRD 附录 A.10/A.11）。
     */
    function JumpToBottom({ onClick, rightInset }) {
      return h('div', {
        style: {
          position: 'absolute', left: 0, right: 0, bottom: 10, height: 0,
          display: 'flex', justifyContent: 'flex-end', pointerEvents: 'none', zIndex: 8,
        },
      }, h('button', {
        type: 'button',
        onClick,
        title: '回到底部',
        'aria-label': '回到底部',
        style: {
          position: 'relative', width: 34, height: 34, marginTop: -34, padding: 0,
          boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: 0, background: 'transparent', cursor: 'pointer', pointerEvents: 'auto',
          color: 'var(--dsw-alias-label-primary, rgba(0,0,0,0.8))',
          marginRight: rightInset,
        },
      },
        h('svg', {
          width: 34, height: 34, viewBox: '0 0 34 34',
          style: {
            position: 'absolute', inset: 0,
            filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.10)) drop-shadow(0 4px 12px rgba(0,0,0,0.10))',
          },
        }, h('circle', { cx: 17, cy: 17, r: 17, fill: 'var(--dsw-alias-button-floating-fill, #ffffff)' })),
        h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', style: { position: 'relative' } },
          h('path', {
            d: 'M4 6.5L8 10.5L12 6.5',
            stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
          }))))
    }

    /**
     * 回到上次看到的位置 —— 和 `JumpToBottom` 是一对，只是朝上。
     *
     * 进来时视角在底部（新的在眼前），可"上次看到哪儿"在头顶上面；
     * 没有这个按钮，人只能自己往上滚去找那条线。线在视口上方才出现，滚到它跟前就消失。
     */
    function JumpToHistory({ onClick, rightInset }) {
      return h('div', {
        style: {
          position: 'absolute', left: 0, right: 0, top: 10, height: 0,
          display: 'flex', justifyContent: 'flex-end', pointerEvents: 'none', zIndex: 8,
        },
      }, h('button', {
        type: 'button',
        onClick,
        title: '回到上次看到的位置',
        'aria-label': '回到上次看到的位置',
        style: {
          position: 'relative', width: 34, height: 34, padding: 0,
          boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: 0, background: 'transparent', cursor: 'pointer', pointerEvents: 'auto',
          color: 'var(--dsw-alias-label-primary, rgba(0,0,0,0.8))',
          marginRight: rightInset,
        },
      },
        h('svg', {
          width: 34, height: 34, viewBox: '0 0 34 34',
          style: {
            position: 'absolute', inset: 0,
            filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.10)) drop-shadow(0 4px 12px rgba(0,0,0,0.10))',
          },
        }, h('circle', { cx: 17, cy: 17, r: 17, fill: 'var(--dsw-alias-button-floating-fill, #ffffff)' })),
        h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', style: { position: 'relative' } },
          h('path', {
            d: 'M4 9.5L8 5.5L12 9.5',
            stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
          }))))
    }

    /**
     * 过场页：本地数据回来得太快，第一帧画了、第二帧就被真内容顶掉，人只会看到一次闪。
     * 所以给一个最短显示时间——不是为了好看，是为了让"正在打开"这件事有存在感。
     */
    function useSplash(minMs = 420) {
      const startedRef = useRef(Date.now())
      const finishedRef = useRef(false)
      const [visible, setVisible] = useState(true)
      const done = useCallback(() => {
        if (finishedRef.current) return
        finishedRef.current = true
        const wait = Math.max(0, minMs - (Date.now() - startedRef.current))
        if (wait > 0) setTimeout(() => setVisible(false), wait)
        else setVisible(false)
      }, [minMs])
      const reset = useCallback(() => {
        finishedRef.current = false
        startedRef.current = Date.now()
        setVisible(true)
      }, [])
      return { visible, done, reset }
    }

    /**
     * 转圈 + 一行小字。圈用 SVG 描边画，别指望 `border-radius`（这个壳上它漏过两次）。
     *
     * 底色必须是不透明的：内容在它后面照常渲染（这样滚到底部那一步在揭幕之前就做完了），
     * 只是被盖住看不见 —— 否则揭幕那一刻会先看到最早的一条，再"跳"到最新。
     */
    function LoadingSplash({ label }) {
      return h('div', {
        style: {
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 12, pointerEvents: 'none',
          background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
        },
      },
        h('svg', { width: 28, height: 28, viewBox: '0 0 28 28', style: { animation: 'dshGroupSpin .9s linear infinite' } },
          h('circle', { cx: 14, cy: 14, r: 11, fill: 'none', stroke: 'var(--dsw-alias-border-l2, rgba(0,0,0,0.10))', strokeWidth: 2 }),
          h('circle', {
            cx: 14, cy: 14, r: 11, fill: 'none', strokeLinecap: 'round',
            stroke: 'var(--dsw-alias-label-tertiary, rgba(0,0,0,0.45))', strokeWidth: 2,
            strokeDasharray: '18 52',
          })),
        h('div', { style: { fontSize: 12, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary, rgba(0,0,0,0.45))' } }, label))
    }

    /**
     * 私聊页：宽屏时左边是能单独说话的人、右边是会话；窄屏时照微信那样分两屏
     * ——先选人，再进会话，会话页左上角一个返回。
     */
    function DmPage({ config, presence }) {
      const rootRef = useRef(null)
      const narrow = useNarrow(rootRef)
      const coarse = useCoarsePointer()
      const [contacts, setContacts] = useState([])
      const [activePeer, setActivePeer] = useState(null)
      const [messages, setMessages] = useState([])
      // 第一屏数据到之前先画占位：别让人看见"还没有私下说过话"闪一下再变成列表。
      const { visible: dmSplash, done: dmSplashDone, reset: dmSplashReset } = useSplash(420)
      const animateRef = useRef(false)
      const pickedOnceRef = useRef(false)
      const peerRef = useRef(null)
      const [text, setText] = useState('')
      const [sending, setSending] = useState(false)
      // setError 必须先声明再传下去：`const` 有暂时性死区，先用到后声明是 ReferenceError，
      // 整页白屏（2026-11-12 他报的 bug：私聊页面白屏）。
      const [error, setError] = useState(null)
      // 私聊一样能发图：和群聊共用 useImageAttach，只是发出去的地址不同。
      const { pendingImage, setPendingImage, imageBusy, attachImage, fileRef } = useImageAttach(setError)
      // 切到谁，就把他/她那段没写完的草稿捞回来（每个人一份，存在这台机器上）。
      useEffect(() => {
        if (activePeer === null) return
        setText(readDraft(dmDraftKeyOf(activePeer)))
      }, [activePeer])
      const [unread, setUnread] = useState({ dm: {} })
      // 每个对端"上次看到哪儿"，进这一段时冻结一次：之后边读边刷新不能让线跟着往下跑。
      const seenDmRef = useRef({})
      const [seenDm, setSeenDm] = useState({})
      const [sidebar, setSidebar] = useState(() => {
        try {
          const saved = Number(window.localStorage?.getItem('dsh-group-dm-sidebar'))
          return Number.isFinite(saved) && saved >= 140 && saved <= 420 ? saved : 208
        } catch { return 208 }
      })
      // 私聊列宽：可拖、记在本机（跟左边的联系人栏一样，属于"这一台机器上的手感"）
      const [dmWidth, setDmWidth] = useState(() => {
        try {
          const saved = Number(window.localStorage?.getItem('dsh-group-dm-width'))
          return Number.isFinite(saved) && saved >= 30 && saved <= 92 ? saved : 72
        } catch { return 72 }
      })
      const persistDmWidth = useCallback(() => {
        setDmWidth((current) => {
          try { window.localStorage?.setItem('dsh-group-dm-width', String(current)) } catch {}
          return current
        })
      }, [])
      const scrollRef = useRef(null)
      const bottom = useRef(null)
      const inputRef = useRef(null)

      const loadContacts = useCallback(async () => {
        try {
          const response = await fetch('/group/api/dm/contacts', { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const data = await response.json()
          setContacts(Array.isArray(data?.contacts) ? data.contacts : [])
          setError(null)
        } catch (e) {
          setError(String(e?.message ?? e))
        }
      }, [])

      const loadMessages = useCallback(async () => {
        if (activePeer === null) { setMessages([]); dmSplashReset(); return }
        try {
          const response = await fetch(`/group/api/dm?peer=${encodeURIComponent(activePeer)}`, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const data = await response.json()
          // 换人（或第一次装填）时整屏都是新节点：那一刻不弹，弹的只是「后来进来的」。
          if (peerRef.current !== activePeer) { peerRef.current = activePeer; animateRef.current = false }
          setTimeout(() => { animateRef.current = true }, 0)
          setMessages(Array.isArray(data?.messages) ? data.messages : [])
          setError(null)
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          dmSplashDone()
        }
      }, [activePeer])

      useEffect(() => {
        const tick = async () => {
          await loadContacts()
          await loadMessages()
          const counts = await loadUnread()
          if (counts) {
            setUnread(counts)
            // 先到先冻：这一刻的 seen 才是"进来之前看到哪儿"。
            // 1.5 秒后 markRead 会把游标推到最新，那之后再读就永远没有新消息了。
            const peer = peerRef.current
            if (peer && seenDmRef.current[peer] === undefined) {
              seenDmRef.current[peer] = String(counts.seen?.dm?.[peer] ?? '')
              setSeenDm({ ...seenDmRef.current })
            }
          }
        }
        void tick()
        const timer = setInterval(() => { void tick() }, 3000)
        return () => clearInterval(timer)
      }, [loadContacts, loadMessages])

      // 打开这一段、页面在前台、停 1.5 秒，才算读过
      useEffect(() => {
        if (activePeer === null) return
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
        const timer = setTimeout(() => {
          void markRead('dm', activePeer).then(() => loadUnread().then((counts) => { if (counts) setUnread(counts) }))
        }, 1500)
        return () => clearTimeout(timer)
      }, [activePeer])

      // 贴底/翻历史：跟群聊共用一套（见 useFollowTail 的说明）。
      // 早先这里是 `bottom.scrollIntoView({block:'end'})`：它会连外层容器一起滚，
      // 而 markdown 排版落定后高度还会再变一次 —— "打开就贴在底"常常差几十像素。
      const { atBottom: dmAtBottom, measureBottom: measureDmBottom, jumpToBottom: jumpDmBottom } = useFollowTail(scrollRef, [messages.length, activePeer, dmSplash])
      useEffect(() => { if (activePeer !== null) inputRef.current?.focus() }, [activePeer])

      const pick = (peer) => {
        setActivePeer((current) => (current === peer ? null : peer))
        setMessages([])
        setText('')
        // 换人也是一次"打开"：重新走一遍过场，否则中间会空一下
        dmSplashReset()
      }

      const submit = useCallback(async () => {
        const value = text.trim()
        if ((value === '' && pendingImage === null) || sending || activePeer === null) return
        setSending(true)
        try {
          let image = null
          if (pendingImage !== null) {
            const uploaded = await fetch('/group/api/image', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ dataUrl: pendingImage }),
            })
            const result = await uploaded.json().catch(() => null)
            if (!uploaded.ok) throw new Error(result?.detail ?? `图片上传失败 HTTP ${uploaded.status}`)
            image = result?.image ?? null
          }
          const response = await fetch('/group/api/dm', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ peer: activePeer, text: value, ...(image === null ? {} : { image }) }),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          setText('')
          writeDraft(dmDraftKeyOf(activePeer), '')
          setPendingImage(null)
          await loadMessages()
          await loadContacts()
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          setSending(false)
        }
      }, [text, sending, activePeer, loadMessages, loadContacts, pendingImage])

      const shortTime = (ts) => {
        const date = new Date(ts ?? '')
        if (Number.isNaN(date.getTime())) return ''
        const pad = (n) => String(n).padStart(2, '0')
        return date.toDateString() === new Date().toDateString()
          ? `${pad(date.getHours())}:${pad(date.getMinutes())}`
          : `${date.getMonth() + 1}/${date.getDate()}`
      }

      const contactList = contacts.length === 0
        ? h('div', { style: { padding: '16px 14px', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, '还没有能私下说话的人。')
        : contacts.map((contact) => {
          const active = contact.peer === activePeer
          return h('button', {
            key: contact.peer,
            onClick: () => pick(contact.peer),
            title: active ? '再点一次收起' : `和 ${nameOf(config, contact.peer)} 说话`,
            style: {
              width: '100%', display: 'flex', alignItems: 'center', gap: 10,
              padding: narrow ? '12px 14px' : '8px 12px', border: 'none', textAlign: 'left',
              background: active ? 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.05))' : 'transparent',
              cursor: 'pointer', fontFamily: 'inherit',
            },
          },
            h(Avatar, { config, member: contact.peer, size: 34 }),
            h('div', { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 6 } },
                h('span', {
                  style: {
                    fontSize: 13, fontWeight: 500, color: 'var(--dsw-alias-label-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  },
                }, nameOf(config, contact.peer)),
                (Number(unread?.dm?.[contact.peer]) || 0) > 0
                  ? h('span', {
                      style: {
                        minWidth: 16, height: 16, padding: '0 5px', borderRadius: 9999,
                        background: 'var(--dsw-alias-label-error, #e5484d)',
                        color: 'var(--dsw-alias-label-primary-foreground, #fff)',
                        fontSize: 10, lineHeight: '16px', textAlign: 'center', fontWeight: 600,
                      },
                    }, String(unread.dm[contact.peer]))
                  : null,
                h('span', { style: { marginLeft: 'auto', fontSize: 11, color: 'var(--dsw-alias-label-caption)' } }, shortTime(contact.last?.ts))),
              h('div', {
                style: {
                  fontSize: 12, color: 'var(--dsw-alias-label-tertiary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                },
              }, contact.last ? contact.last.text : '还没有说过话')),
          )
        })

      const blankPane = h('div', {
        style: {
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 8, padding: '0 24px', textAlign: 'center',
        },
      },
        h('div', { style: { fontSize: 15, fontWeight: 500, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' } }, '选一个人说话'),
        h('div', { style: { fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-tertiary)' } },
          '左边是能私下说话的人。这里的话不进群记录。'))

      const backButton = narrow
        ? h('button', {
            onClick: () => setActivePeer(null),
            title: '返回联系人',
            style: {
              flex: '0 0 28px', width: 28, height: 28, padding: 0, border: 'none',
              background: 'transparent', color: 'var(--dsw-alias-label-secondary)',
              cursor: 'pointer', display: 'grid', placeItems: 'center', marginLeft: -6,
            },
          },
            h('svg', { width: 18, height: 18, viewBox: '0 0 18 18', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' },
              h('path', { d: 'M11 3L5.5 9L11 15' })))
        : null

      const chatHeader = h('div', {
        style: { flex: 'none', padding: narrow ? '8px 12px' : '10px 20px', borderBottom: '0.5px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.1))' },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          backButton,
          h('span', { style: { fontSize: 14, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' } }, nameOf(config, activePeer)),
          presenceOf(presence, activePeer).status === 'working'
            ? h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } },
              presenceOf(presence, activePeer).reason === 'group'
                ? t.busy(nameOf(config, activePeer))
                : t.typing(nameOf(config, activePeer)))
            : null))

      const fadeMask = { WebkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - 46px), transparent 100%)', maskImage: 'linear-gradient(to bottom, #000 calc(100% - 46px), transparent 100%)' }
      // 窄屏没有"两栏"这回事，拖列宽也就没意义（手指也没有 14px 的精度，只会误触）。
      const widthHandles = narrow
        ? []
        : [
          h(WidthHandle, { key: 'left', side: 'left', width: dmWidth, containerRef: scrollRef, onChange: setDmWidth, onCommit: persistDmWidth }),
          h(WidthHandle, { key: 'right', side: 'right', width: dmWidth, containerRef: scrollRef, onChange: setDmWidth, onCommit: persistDmWidth }),
        ]
      // 私聊的左右边界跟群聊同款：拖住两侧，列宽实时变；宽度存在这台机器上。
      const messageArea = h('div', {
        style: { flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' },
      },
        h('div', { ref: scrollRef, onScroll: measureDmBottom, style: { flex: 1, overflowY: 'auto', padding: '8px 0 58px', minHeight: 0, ...fadeMask } },
          h('div', { style: { width: narrow ? '100%' : `${dmWidth}%`, margin: '0 auto', position: 'relative' } },
            messages.length === 0
            ? h('div', { style: { padding: '28px 20px', fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-tertiary)' } },
              '还没有私下说过话。这里的话只有你们两个看得见。')
          : withDivider(messages, String(seenDm[activePeer] ?? ''), (message, index) => h(Bubble, { key: `${message.ts}-${index}`, config, message, animate: animateRef.current })),
            h('div', { ref: bottom }),
            widthHandles)),
        dmSplash ? h(LoadingSplash, { label: '正在打开私聊…' }) : null,
        dmAtBottom ? null : h(JumpToBottom, {
          onClick: jumpDmBottom,
          rightInset: narrow ? '16px' : `calc(${(100 - dmWidth) / 2}% + 10px)`,
        }))

      const composer = h('div', {
          // 窄屏时给 home 条留位置：`env(safe-area-inset-bottom)` 在没刘海的设备上就是 0。
          style: narrow
            ? { flex: 'none', padding: '8px 12px calc(8px + env(safe-area-inset-bottom, 0px))' }
            : { flex: 'none', padding: '10px 0 18px' },
      },
        h('div', {
          style: {
            width: narrow ? '100%' : `${dmWidth}%`, margin: '0 auto', boxSizing: 'border-box',
            // 跟群聊那张卡同形：不写成 flex 列的话，textarea 只按自己的默认宽度（约 20 字）排，
            // 右边会空出一大片 —— 输入框就"没占满整个区域"。
            display: 'flex', flexDirection: 'column', position: 'relative',
            background: 'var(--dsw-specific-input-major, var(--dsw-alias-bg-layer-1, #fff))',
            borderRadius: 'var(--dsw-radius-panel, 16px)',
            boxShadow: 'var(--dsw-elevation-soft, 0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06))',
            gap: 10, padding: '10px 12px 8px',
          },
        },
          pendingImage !== null
            ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h('img', {
                src: pendingImage,
                alt: '待发送的图片',
                style: { maxHeight: 72, maxWidth: 120, borderRadius: 8, display: 'block' },
              }),
              h('button', {
                onClick: () => setPendingImage(null),
                title: '去掉这张图',
                style: {
                  width: 20, height: 20, borderRadius: '50%', border: 'none',
                  background: 'var(--dsw-alias-bg-layer-3, rgba(0,0,0,0.06))',
                  color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, lineHeight: 1,
                  padding: 0, cursor: 'pointer', display: 'grid', placeItems: 'center',
                },
              }, '×'),
              h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } },
                imageBusy ? '读取中…' : '只有你们两个看得见'))
            : null,
          h('textarea', {
            ref: inputRef,
            value: text,
            onChange: (event) => {
              setText(event.target.value)
              if (activePeer !== null) writeDraft(dmDraftKeyOf(activePeer), event.target.value)
            },
            onPaste: (event) => {
              const items = event.clipboardData?.items
              if (!items) return
              for (const item of Array.from(items)) {
                if (item.kind === 'file' && /^image\//.test(item.type)) {
                  event.preventDefault()
                  void attachImage(item.getAsFile())
                  return
                }
              }
            },
            onDragOver: (event) => {
              if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) event.preventDefault()
            },
            onDrop: (event) => {
              const file = event.dataTransfer?.files?.[0]
              if (!file) return
              event.preventDefault()
              void attachImage(file)
            },
            onKeyDown: (event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submit()
              }
            },
            placeholder: `只对 ${nameOf(config, activePeer)} 说…`,
            rows: 1,
            style: {
              border: 'none', outline: 'none', resize: 'none', background: 'transparent',
              color: 'var(--dsw-alias-label-primary)', font: 'inherit',
              width: '100%', boxSizing: 'border-box',
              // 窄屏（多半是手机）用 16px：iOS 在聚焦小于 16px 的输入框时会把整页放大一下。
              fontSize: coarse ? 16 : 14, lineHeight: '24px', padding: '4px 2px', minHeight: 44, maxHeight: 220,
            },
          }),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            h('button', {
              onClick: () => fileRef.current?.click(),
              title: '发一张图（也可以直接粘贴或拖进来）',
              style: {
                flex: '0 0 32px', width: 32, height: 32, padding: 0, border: 'none',
                background: 'transparent', position: 'relative', cursor: 'pointer',
                display: 'grid', placeItems: 'center', opacity: imageBusy ? 0.4 : 1,
              },
            },
              h('svg', { width: 32, height: 32, viewBox: '0 0 32 32', style: { position: 'absolute', inset: 0 } },
                h('circle', {
                  cx: 16, cy: 16, r: 15.5, fill: 'transparent',
                  stroke: 'var(--dsw-alias-border-l2, rgba(0,0,0,0.12))', strokeWidth: 1,
                })),
              h('svg', {
                width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
                stroke: 'var(--dsw-alias-label-secondary)', strokeWidth: 1.4,
                strokeLinecap: 'round', strokeLinejoin: 'round', style: { position: 'relative' },
              },
                h('rect', { x: 2.5, y: 3.5, width: 11, height: 9, rx: 1.5 }),
                h('path', { d: 'M2.5 10.5l3-3 2.5 2.5 2-2 3.5 3.5' }),
                h('circle', { cx: 10.5, cy: 6.5, r: 1 }))),
            h('input', {
              ref: fileRef,
              type: 'file',
              accept: 'image/png,image/jpeg,image/webp,image/gif',
              style: { display: 'none' },
              onChange: (event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                void attachImage(file)
              },
            }),
            h('div', { style: { flex: 1, fontSize: 11, color: 'var(--dsw-alias-label-caption)' } }, '不进群记录，只有你们两个看得见'),
            h('button', {
              onClick: () => { void submit() },
              disabled: sending || (text.trim() === '' && pendingImage === null),
              title: t.send,
              style: {
                flex: '0 0 32px', width: 32, height: 32, padding: 0, border: 'none',
                background: 'transparent', position: 'relative',
                cursor: sending || (text.trim() === '' && pendingImage === null) ? 'not-allowed' : 'pointer',
                opacity: sending || (text.trim() === '' && pendingImage === null) ? 0.4 : 1,
                display: 'grid', placeItems: 'center',
              },
            },
              h('svg', { width: 32, height: 32, viewBox: '0 0 32 32', style: { position: 'absolute', inset: 0 } },
                h('circle', { cx: 16, cy: 16, r: 16, fill: 'var(--dsw-alias-brand-primary, #4a7dbd)' })),
              h('svg', {
                width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
                stroke: 'var(--dsw-alias-label-primary-foreground, #fff)', strokeWidth: 1.8,
                strokeLinecap: 'round', strokeLinejoin: 'round', style: { position: 'relative' },
              }, h('path', { d: 'M8 13V3M4 7l4-4 4 4' }))))))

      const chatPane = h('div', { style: { flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' } }, chatHeader, messageArea, composer)
      const rightPane = activePeer === null ? blankPane : chatPane
      // 窄屏分两屏：没选人时只显示联系人，选了人只显示会话（返回键在会话头部）。
      const showList = narrow ? activePeer === null : true
      const showChat = narrow ? activePeer !== null : true

      return h('div', { ref: rootRef, style: { flex: 1, minHeight: 0, height: '100%', display: 'flex' } },
        showList
          ? h('div', { style: { width: narrow ? '100%' : sidebar, flex: 'none', position: 'relative', display: 'flex', minHeight: 0 } },
            h('div', { style: { flex: 1, overflowY: 'auto', padding: narrow ? '4px 0' : '6px 0', minWidth: 0 } }, contactList),
            narrow ? null : h('div', {
              title: '拖这里改变左侧宽度',
              onPointerDown: (event) => {
                event.preventDefault()
                const startX = event.clientX
                const startWidth = sidebar
                const target = event.currentTarget
                target.setPointerCapture(event.pointerId)
                const move = (moveEvent) => {
                  const next = Math.max(140, Math.min(420, startWidth + (moveEvent.clientX - startX)))
                  setSidebar(next)
                }
                const up = () => {
                  target.removeEventListener('pointermove', move)
                  target.removeEventListener('pointerup', up)
                  target.removeEventListener('pointercancel', up)
                  setSidebar((current) => { try { window.localStorage?.setItem('dsh-group-dm-sidebar', String(current)) } catch {} ; return current })
                }
                target.addEventListener('pointermove', move)
                target.addEventListener('pointerup', up)
                target.addEventListener('pointercancel', up)
              },
              style: {
                position: 'absolute', top: 0, bottom: 0, right: -3, width: 7,
                cursor: 'col-resize', touchAction: 'none', zIndex: 5,
              },
            },
              h('div', {
                'aria-hidden': 'true',
                style: {
                  position: 'absolute', top: 0, bottom: 0, right: 3, width: 1,
                  background: 'var(--dsw-alias-border-l3, rgba(0,0,0,0.12))',
                },
              })))
          : null,
        showChat
          ? h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' } },
            rightPane,
            error
              ? h('div', { style: { flex: 'none', padding: '0 16px 8px', fontSize: 12, color: 'var(--dsw-alias-label-error, #c0392b)' } }, error)
              : null)
          : null)
    }
    /** 主面板：群聊。 */
    function GroupPage() {
      const [config, setConfig] = useState(DEFAULT_CONFIG)
      const animateRef = useRef(false)
      const pickedOnceRef = useRef(false)
      const [messages, setMessages] = useState([])
      const [text, setText] = useState(() => readDraft(GROUP_DRAFT_KEY))
      const [to, setTo] = useState('all')
      const [error, setError] = useState(null)
      const [sending, setSending] = useState(false)
      // 待发送的图（data URL）。上传在 submit 里做，这里只存"用户选了哪张"。
      const { pendingImage, setPendingImage, imageBusy, attachImage, fileRef } = useImageAttach(setError)
      // 群聊草稿：改一个字就存，切走 / 刷新 / 重新进页面都还在。
      // 发出去以后 text 变空串，这里顺手把草稿删掉（见 writeDraft 的空值分支）。
      useEffect(() => { writeDraft(GROUP_DRAFT_KEY, text) }, [text])
      const [presence, setPresence] = useState({})
      const [seats, setSeats] = useState([])
      const [pickerOpen, setPickerOpen] = useState(false)
      const [tab, setTab] = useState('group')
      const [unread, setUnread] = useState({ group: 0, dm: {}, total: 0 })
      // 群聊"上次看到哪儿"：进这一页时冻结一次，线不跟着新消息往下跑。
      const seenGroupRef = useRef(null)
      const [seenGroup, setSeenGroup] = useState('')
      // 第一次拿到消息之前先画占位，别让人看见"还没有人说话"闪一下再变成列表。
      const { visible: splash, done: splashDone } = useSplash(420)
      // 列宽是"这台机器上怎么看"，不属于她家的数据，存在浏览器里。
      const [widthPct, setWidthPct] = useState(() => {
        try {
          const saved = Number(window.localStorage?.getItem('dsh-group-width'))
          return Number.isFinite(saved) && saved >= 30 && saved <= 92 ? saved : 72
        } catch { return 72 }
      })
      const bottom = useRef(null)
      const scrollRef = useRef(null)
      const inputRef = useRef(null)
      // "回到上次看到的位置"：群页刚打开时视角在底部，历史线在头顶上面。
      const dividerRef = useRef(null)
      const historyAboveRef = useRef(false)
      const [historyAbove, setHistoryAbove] = useState(false)
      // 线是不是在视口上方 —— 只回答这一件事，不回答"该不该显示"。
      const measureHistory = useCallback(() => {
        const el = scrollRef.current
        const line = dividerRef.current
        const next = Boolean(el && line && line.getBoundingClientRect().top < el.getBoundingClientRect().top + 4)
        if (next !== historyAboveRef.current) {
          historyAboveRef.current = next
          setHistoryAbove(next)
        }
      }, [])
      const jumpToHistory = useCallback(() => {
        const el = scrollRef.current
        if (!el) return
        const line = dividerRef.current
        // 没有线（没有新消息）就跳到最早的一条：两种情况下这个按钮都得做事。
        if (!line) { el.scrollTo({ top: 0, behavior: 'smooth' }); return }
        const top = line.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 8
        el.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
      }, [])

      const refresh = useCallback(async () => {
        try {
          const response = await fetch('/group/api/messages', { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const data = await response.json()
          setMessages(Array.isArray(data.messages) ? data.messages : [])
          setTimeout(() => { animateRef.current = true }, 0)
          setError(null)
          const counts = await loadUnread()
          if (counts) setUnread(counts)
          // 冻结"上次看到哪儿"：必须赶在 1.5 秒后 markRead 之前。
          // 漏了这一句的后果不是线偏几像素，是这条线永远不画（seenTs 恒为空串）。
          if (counts && seenGroupRef.current === null) {
            const frozen = String(counts.seen?.group ?? '')
            seenGroupRef.current = frozen
            setSeenGroup(frozen)
          }
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          splashDone()
        }
        try {
          const response = await fetch('/group/api/presence', { headers: { accept: 'application/json' } })
          if (response.ok) {
            const data = await response.json()
            setPresence(data?.members ?? {})
          }
        } catch {
          // 存在感掉了就当没人说话，宁可安静
        }
        try {
          // 座位：名册里有几段会话就列几段，@ 面板据此多出「大肥鱼 · 开发」这种可选项
          const response = await fetch('/group/api/seats', { headers: { accept: 'application/json' } })
          if (response.ok) {
            const data = await response.json()
            if (Array.isArray(data?.seats)) setSeats(data.seats)
          }
        } catch {
          // 拿不到就不列座位，只保留"叫这个人"
        }
        try {
          // 外观设置也每轮对一下：在设置页换了头像/名字，回到群里应该马上是新样子，
          // 而不是等整页刷新。内容没变就不 set，免得每 3 秒重渲染一次。
          const fresh = await loadConfig(true)
          if (fresh) {
            setConfig((prev) => (JSON.stringify(prev) === JSON.stringify(fresh) ? prev : fresh))
          }
        } catch {
          // 取不到就沿用旧的
        }
      }, [tab])

      useEffect(() => {
        void loadConfig().then((value) => {
          setConfig(value)
        })
      }, [])

      // 看过 1.5 秒才算读过：让红点有出现的余地，也不至于一闪就没
      useEffect(() => {
        if (tab !== 'group' || unread.group === 0) return
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
        const timer = setTimeout(() => { void markRead('group').then(() => refresh()) }, 1500)
        return () => clearTimeout(timer)
      }, [tab, unread.group, refresh])

      useEffect(() => {
        void refresh()
        const timer = setInterval(() => { void refresh() }, 3000)
        return () => clearInterval(timer)
      }, [refresh])

      // 贴底 / 翻历史 / 回到底部：跟私聊页共用一套（见 useFollowTail）。
      const { atBottom, measureBottom, jumpToBottom } = useFollowTail(scrollRef, [messages.length, tab, splash])
      // 线一旦挂上来就要立刻量：只靠 scroll 事件的话，进页面时的第一帧量不到。
      useEffect(() => { measureHistory() })

      const persistWidth = useCallback(() => {
        setWidthPct((current) => {
          try { window.localStorage?.setItem('dsh-group-width', String(current)) } catch {}
          return current
        })
      }, [])
      const submit = useCallback(async () => {
        const value = text.trim()
        if ((value === '' && pendingImage === null) || sending) return
        setSending(true)
        try {
          // 图先落盘拿到 id/x/ext，消息里只记定位信息（字节不进 jsonl）。
          let image = null
          if (pendingImage !== null) {
            const uploaded = await fetch('/group/api/image', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ dataUrl: pendingImage }),
            })
            const result = await uploaded.json().catch(() => null)
            if (!uploaded.ok) throw new Error(result?.detail ?? `图片上传失败 HTTP ${uploaded.status}`)
            image = result?.image ?? null
          }
          const { base, seat } = splitTarget(to)
          const endpoint = tab === 'dm' ? '/group/api/dm' : '/group/api/send'
          const body = tab === 'dm'
            ? { text: value, ...(image === null ? {} : { image }) }
            : {
              to: base, text: value,
              ...(seat === '' ? {} : { toSeat: seat }),
              ...(image === null ? {} : { image }),
            }
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          setText('')
          setPendingImage(null)
          await refresh()
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          setSending(false)
        }
      }, [text, to, sending, refresh, tab, pendingImage])

      // 两档忙：正在回这一段 / 在别处忙。群聊与私聊同一套文案。
      const groupBusy = ['lee', 'whale'].filter((id) => {
        const state = presenceOf(presence, id)
        return state.status === 'working' && state.reason === 'group'
      })
      const otherBusy = ['lee', 'whale'].filter((id) => {
        const state = presenceOf(presence, id)
        return state.status === 'working' && state.reason !== 'group'
      })
      const typingLine = groupBusy.length
        ? t.typing(groupBusy.map((id) => nameOf(config, id)).join('、'))
        : otherBusy.length
          ? t.busy(otherBusy.map((id) => nameOf(config, id)).join('、'))
          : null

      return h('div', {
        style: { ...baseStyle, display: 'flex', flexDirection: 'column' },
      },
        h('div', {
          style: {
            flex: 'none',
            padding: '10px 28px 0 20px',
            borderBottom: '0.5px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.12))',
          },
        },
          h('div', { style: { minHeight: 30, display: 'flex', alignItems: 'center', gap: 10 } },
            h('div', {
              style: {
                fontSize: 14,
                lineHeight: '20px',
                fontWeight: 500,
                color: 'var(--dsw-alias-label-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              },
            }, config.panelLabel || t.title),
          ),
          h('div', {
            style: {
              display: 'flex',
              gap: 32,
              marginTop: 10,
              paddingLeft: 8,
              minHeight: 25,
              alignItems: 'flex-start',
            },
          },
            [{ key: 'group', label: '群聊' }, { key: 'dm', label: '私聊' }].map((item) => {
              const active = tab === item.key
              return h('button', {
                key: item.key,
                onClick: () => setTab(item.key),
                style: {
                  position: 'relative',
                  minHeight: 35,
                  margin: '-10px -10px 0',
                  padding: '10px 10px 9px',
                  fontSize: 13,
                  fontWeight: 500,
                  lineHeight: '16px',
                  color: active
                    ? 'var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary, #4a7dbd))'
                    : 'var(--dsw-alias-label-tertiary)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                },
              },
                item.key === 'group'
                  ? (unread.group > 0 ? item.label + ' (' + unread.group + ')' : item.label)
                  : (dmTotal(unread) > 0 ? item.label + ' (' + dmTotal(unread) + ')' : item.label),
                h('span', {
                  style: {
                    position: 'absolute',
                    left: 10,
                    right: 10,
                    bottom: -1,
                    height: 2,
                    borderRadius: 2,
                    background: active
                      ? 'var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary, #4a7dbd))'
                      : 'transparent',
                  },
                }),
              )
            }),
          ),
          error
            ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-error, #c0392b)', padding: '0 0 8px' } }, error)
            : h('div', { style: { height: 8 } }),
        ),
        tab === 'dm'
          ? h(DmPage, { config, presence })
          : h(React.Fragment, null,
        h('div', {
          style: { flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' },
        },
        h('div', {
          ref: scrollRef,
          onScroll: () => { measureBottom(); measureHistory() },
          style: { flex: 1, overflowY: 'auto', padding: '8px 0 58px', minHeight: 0, position: 'relative', WebkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - 46px), transparent 100%)', maskImage: 'linear-gradient(to bottom, #000 calc(100% - 46px), transparent 100%)' },
        },
          messages.length === 0
            ? h('div', {
              style: {
                height: '100%', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: 10, padding: '0 24px', textAlign: 'center',
              },
            },
              h('div', {
                style: { fontSize: 15, fontWeight: 500, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' },
              }, tab === 'dm' ? '这里还没有人说话' : '群里还没有人说话'),
              h('div', {
                style: { fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-tertiary)' },
              }, tab === 'dm'
                ? '她私下写在给你的话会出现在这里。'
                : '开口说一句，这条线才算通。'),
              h('button', {
                onClick: () => { inputRef.current?.focus() },
                style: {
                  height: 32, padding: '0 14px', boxSizing: 'border-box',
                  borderRadius: 'var(--dsw-radius-md, 8px)',
                  border: '0.5px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12))',
                  background: 'transparent', color: 'var(--dsw-alias-label-primary)',
                  fontSize: 13, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer',
                },
              }, '说第一句'),
            )
            : h('div', {
              style: { width: `${widthPct}%`, margin: '0 auto', position: 'relative' },
            },
              withDivider(messages, seenGroup, (message, index) => h(Bubble, {
                key: `${message.ts}-${index}`,
                config,
                message,
                animate: animateRef.current,
                onMention: (id) => setTo(id),
              }), dividerRef),
              h('div', { ref: bottom }),
              h(WidthHandle, {
                side: 'left', width: widthPct, containerRef: scrollRef,
                onChange: setWidthPct, onCommit: persistWidth,
              }),
              h(WidthHandle, {
                side: 'right', width: widthPct, containerRef: scrollRef,
                onChange: setWidthPct, onCommit: persistWidth,
              }),
            ),
        ),
          // 过场页：盖住"从空到有"的那一下
          splash ? h(LoadingSplash, { label: '正在打开群聊…' }) : null,
          // 回到上次看到的位置：线在视口上方时才出现（刚进来、或往下翻过头了）
          historyAbove ? h(JumpToHistory, {
            onClick: jumpToHistory,
            rightInset: `calc(${(100 - widthPct) / 2}% + 10px)`,
          }) : null,
          // 回到底部：翻历史时才出现；和上面那个向上的按钮是一对
          atBottom ? null : h(JumpToBottom, {
            onClick: jumpToBottom,
            rightInset: `calc(${(100 - widthPct) / 2}% + 10px)`,
          }),
        ),
        h('div', {
          style: { padding: '10px 0 14px' },
        },
          h('div', { style: { width: `${widthPct}%`, margin: '0 auto' } },
            typingLine
              ? h('div', {
                style: {
                  fontSize: 12, color: 'var(--dsw-alias-label-tertiary)',
                  marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6,
                },
              },
                h('span', { style: { display: 'inline-flex', gap: 3 } },
                  [0, 1, 2].map((index) => h('span', {
                    key: index,
                    style: {
                      width: 4, height: 4, borderRadius: '50%',
                      background: 'var(--dsw-alias-label-tertiary)',
                      animation: `dshGroupPulse 1.2s ${index * 0.15}s infinite ease-in-out`,
                    },
                  }))),
                h('span', null, typingLine))
              : null,
            // 输入卡：照 dsh 的 InputBar 抄的形状（无边框、圆角面板、软投影）
            h('div', {
              style: {
                position: 'relative',
                display: 'flex', flexDirection: 'column',
                background: 'var(--dsw-specific-input-major, var(--dsw-alias-bg-layer-1, #fff))',
                borderRadius: 'var(--dsw-radius-panel, 16px)',
                boxShadow: 'var(--dsw-elevation-soft, 0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06))',
                gap: 10, padding: '10px 12px 8px',
              },
            },
              to === 'all'
                ? null
                : h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                  h('span', {
                    style: {
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '2px 4px 2px 2px', borderRadius: 999,
                      background: 'var(--dsw-alias-bg-layer-3, rgba(0,0,0,0.06))',
                      border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1))',
                      fontSize: 12, color: 'var(--dsw-alias-label-secondary)',
                    },
                  },
                    h(Avatar, { config, member: splitTarget(to).base, size: 18 }),
                    h('span', null, targetName(config, to)),
                    h('button', {
                      onClick: () => setTo('all'),
                      title: '取消指定',
                      style: {
                        width: 16, height: 16, borderRadius: '50%', border: 'none', background: 'transparent',
                        color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, lineHeight: 1, padding: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                      },
                    }, '×'))),
              pendingImage !== null
                ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                  h('img', {
                    src: pendingImage,
                    alt: '待发送的图片',
                    style: { maxHeight: 72, maxWidth: 120, borderRadius: 8, display: 'block' },
                  }),
                  h('button', {
                    onClick: () => setPendingImage(null),
                    title: '去掉这张图',
                    style: {
                      width: 20, height: 20, borderRadius: '50%', border: 'none',
                      background: 'var(--dsw-alias-bg-layer-3, rgba(0,0,0,0.06))',
                      color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, lineHeight: 1,
                      padding: 0, cursor: 'pointer', display: 'grid', placeItems: 'center',
                    },
                  }, '×'),
                  h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } },
                    imageBusy ? '读取中…' : '发出去就进群，删不掉'))
                : null,
              h('textarea', {
                ref: inputRef,
                value: text,
                onChange: (event) => setText(event.target.value),
                onPaste: (event) => {
                  const items = event.clipboardData?.items
                  if (!items) return
                  for (const item of Array.from(items)) {
                    if (item.kind === 'file' && /^image\//.test(item.type)) {
                      event.preventDefault()
                      void attachImage(item.getAsFile())
                      return
                    }
                  }
                },
                onDragOver: (event) => {
                  if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) event.preventDefault()
                },
                onDrop: (event) => {
                  const file = event.dataTransfer?.files?.[0]
                  if (!file) return
                  event.preventDefault()
                  void attachImage(file)
                },
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void submit()
                  }
                },
                placeholder: to === 'all' ? t.placeholder : `对 ${targetName(config, to)} 说…`,
                rows: 1,
                style: {
                  border: 'none', outline: 'none', resize: 'none', background: 'transparent',
                  color: 'var(--dsw-alias-label-primary)', font: 'inherit',
                  fontSize: 14, lineHeight: '24px', padding: '4px 2px',
                  minHeight: 44, maxHeight: 220,
                },
              }),
              h('div', { style: { position: 'relative', display: 'flex', alignItems: 'center', gap: 10 } },
                h('button', {
                  onClick: () => setPickerOpen((open) => !open),
                  title: '指定说话对象',
                  'data-at-anchor': '1',
                  style: {
                    flex: '0 0 32px', width: 32, height: 32, padding: 0, border: 'none',
                    background: 'transparent', position: 'relative', cursor: 'pointer',
                    display: 'grid', placeItems: 'center',
                  },
                },
                  h('svg', { width: 32, height: 32, viewBox: '0 0 32 32', style: { position: 'absolute', inset: 0 } },
                    h('circle', {
                      cx: 16, cy: 16, r: 15.5,
                      fill: pickerOpen ? 'var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06))' : 'transparent',
                      stroke: 'var(--dsw-alias-border-l2, rgba(0,0,0,0.12))', strokeWidth: 1,
                    })),
                  h('span', { style: { position: 'relative', fontSize: 15, lineHeight: 1, color: 'var(--dsw-alias-label-secondary)' } }, '@')),
                h('button', {
                  onClick: () => fileRef.current?.click(),
                  title: '发一张图（也可以直接粘贴或拖进来）',
                  style: {
                    flex: '0 0 32px', width: 32, height: 32, padding: 0, border: 'none',
                    background: 'transparent', position: 'relative', cursor: 'pointer',
                    display: 'grid', placeItems: 'center', opacity: imageBusy ? 0.4 : 1,
                  },
                },
                  h('svg', { width: 32, height: 32, viewBox: '0 0 32 32', style: { position: 'absolute', inset: 0 } },
                    h('circle', {
                      cx: 16, cy: 16, r: 15.5, fill: 'transparent',
                      stroke: 'var(--dsw-alias-border-l2, rgba(0,0,0,0.12))', strokeWidth: 1,
                    })),
                  h('svg', {
                    width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
                    stroke: 'var(--dsw-alias-label-secondary)', strokeWidth: 1.4,
                    strokeLinecap: 'round', strokeLinejoin: 'round', style: { position: 'relative' },
                  },
                    h('rect', { x: 2.5, y: 3.5, width: 11, height: 9, rx: 1.5 }),
                    h('path', { d: 'M2.5 10.5l3-3 2.5 2.5 2-2 3.5 3.5' }),
                    h('circle', { cx: 10.5, cy: 6.5, r: 1 }))),
                h('input', {
                  ref: fileRef,
                  type: 'file',
                  accept: 'image/png,image/jpeg,image/webp,image/gif',
                  style: { display: 'none' },
                  onChange: (event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    void attachImage(file)
                  },
                }),
                h('div', { style: { flex: 1, fontSize: 11, color: 'var(--dsw-alias-label-caption)' } },
                  to === 'all' ? t.groupOnly : t.toOne(targetName(config, to))),
                h('button', {
                  onClick: () => { void submit() },
                  disabled: sending || (text.trim() === '' && pendingImage === null),
                  title: t.send,
                  style: {
                    flex: '0 0 32px', width: 32, height: 32, padding: 0, border: 'none',
                    background: 'transparent', position: 'relative',
                    cursor: sending || (text.trim() === '' && pendingImage === null) ? 'not-allowed' : 'pointer',
                    opacity: sending || (text.trim() === '' && pendingImage === null) ? 0.4 : 1,
                    display: 'grid', placeItems: 'center', transition: 'opacity 120ms ease',
                  },
                },
                  h('svg', { width: 32, height: 32, viewBox: '0 0 32 32', style: { position: 'absolute', inset: 0 } },
                    h('circle', { cx: 16, cy: 16, r: 16, fill: 'var(--dsw-alias-brand-primary, #4a7dbd)' })),
                  h('svg', {
                    width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
                    stroke: 'var(--dsw-alias-label-primary-foreground, #fff)', strokeWidth: 1.8,
                    strokeLinecap: 'round', strokeLinejoin: 'round', style: { position: 'relative' },
                  }, h('path', { d: 'M8 13V3M4 7l4-4 4 4' }))),
              ),
              pickerOpen
                ? h(AtPicker, {
                  config,
                  seats,
                  current: to,
                  onPick: (id) => { setTo(id); setPickerOpen(false) },
                  onClose: () => setPickerOpen(false),
                })
                : null,
            ),
          ),
        ),
          ),
      )
    }

    /**
     * 数字输入框：自己没有「受控」依赖。
     * 每敲一下就去改 config，会让设置页整层重渲染，输入框跟着被换掉——光标就掉了（2026-11-10 实测）。
     * 所以：输入过程只改本地草稿，失焦或回车才提交；万一节点真的被换掉，把光标还回去。
     */
    function NumberField({ value, min, max, suffix, onCommit }) {
      const [draft, setDraft] = useState(String(value ?? min))
      const inputRef = useRef(null)
      const wasFocused = useRef(false)

      useEffect(() => { setDraft(String(value ?? min)) }, [value])

      useLayoutEffect(() => {
        const node = inputRef.current
        if (!node) return
        if (wasFocused.current && document.activeElement !== node) {
          node.focus()
          const end = node.value.length
          try { node.setSelectionRange(end, end) } catch {}
        }
      })

      const commit = () => {
        const parsed = Number(draft)
        const next = Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : value
        setDraft(String(next))
        onCommit(next)
      }

      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h('input', {
          ref: inputRef,
          type: 'number', min, max, step: 1,
          value: draft,
          onFocus: () => { wasFocused.current = true },
          onBlur: () => { wasFocused.current = false; commit() },
          onChange: (event) => { setDraft(event.target.value) },
          onKeyDown: (event) => { if (event.key === 'Enter') { event.currentTarget.blur() } },
          style: { width: 96, height: 32, padding: '0 10px', borderRadius: 'var(--dsw-radius-md, 8px)', border: '0.5px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' },
        }),
        suffix ? h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, suffix) : null,
      )
    }

    /** 设置页：侧边栏名称 / 三个头像 / 三个显示名。 */
    // 设置分组卡片：必须住在模块作用域。
    // 写在 SettingsPage 里面的话，每次 setConfig 重渲染都会造出一个新的函数引用，
    // React 把它当成「换了一个组件」⇒ 整棵子树卸载重挂，输入框每敲一个字就失焦。
    // （2026-11-12 他报的 bug：设置里所有输入框输入一个字符就丢焦点。）
    function SettingsSection({ title, hint, children }) {
      return h('div', {
        style: {
          marginTop: 16,
          border: '0.5px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12))',
          borderRadius: 'var(--dsw-radius-lg, 12px)',
          background: 'var(--dsw-alias-bg-layer-1, #fff)',
          overflow: 'hidden',
        },
      },
        h('div', { style: { padding: '12px 16px 0' } },
          h('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, title),
          hint
            ? h('div', { style: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', marginTop: 2 } }, hint)
            : null,
        ),
        h('div', { style: { padding: '4px 16px 12px' } }, children),
      )
    }

    function SettingsPage() {
      const [config, setConfig] = useState(DEFAULT_CONFIG)
      const [status, setStatus] = useState('')
      const [dirty, setDirty] = useState(false)
      const timerRef = useRef(null)

      useEffect(() => {
        void loadConfig(true).then(setConfig)
      }, [])

      // 改一个字段就存一次（400ms 防抖）。没有「保存」按钮：
      // 用户要的是「我改了它就记住」，而不是「我记得点保存」。
      const patch = (mutator) => {
        setConfig((prev) => {
          const next = { ...prev }
          mutator(next)
          return next
        })
        setDirty(true)
      }

      useEffect(() => {
        if (!dirty) return undefined
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => {
          setStatus('保存中…')
          void saveConfig(config)
            .then((saved) => {
              if (saved) setConfig(saved)
              setStatus('已保存')
              setDirty(false)
            })
            .catch((error) => {
              setStatus(`保存失败：${String(error?.message ?? error)}`)
            })
        }, 400)
        return () => { if (timerRef.current) clearTimeout(timerRef.current) }
      }, [config, dirty])

      const rowStyle = { display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }
      const inputStyle = {
        flex: 1, minWidth: 0, height: 32, padding: '0 10px', boxSizing: 'border-box',
        borderRadius: 'var(--dsw-radius-md, 8px)',
        border: '0.5px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12))',
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: 13,
      }
      const labelStyle = { width: 84, fontSize: 13, color: 'var(--dsw-alias-label-secondary)' }
      const smallBtnStyle = {
        height: 32, padding: '0 10px', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 12,
        borderRadius: 'var(--dsw-radius-md, 8px)', cursor: 'pointer',
        border: '0.5px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12))',
        background: 'transparent', color: 'var(--dsw-alias-label-secondary)',
      }

      // 头像照片：选一张 → 读成 data URL → 交给宿主写进 group\avatars\。
      // 大小和格式在这里先挡一道，用户就不用等到"上传失败"才知道图太大。
      const fileInputs = useRef({})
      const [avatarBusy, setAvatarBusy] = useState('')

      const uploadAvatar = (member, file) => {
        if (!file) return
        if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
          setStatus('只收 png / jpg / webp。')
          return
        }
        if (file.size > 1.5 * 1024 * 1024) {
          setStatus('这张图太大（超过 1.5 MB），换一张小点的。')
          return
        }
        const reader = new FileReader()
        setAvatarBusy(member)
        reader.onload = () => {
          fetch(`/group/api/avatar?member=${encodeURIComponent(member)}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ member, dataUrl: reader.result }),
          })
            .then((response) => response.json().catch(() => ({})).then((data) => ({ ok: response.ok, status: response.status, data })))
            .then(({ ok, status, data }) => {
              if (ok) {
                setConfig(data)
                setStatus('头像已保存')
                return
              }
              // 把宿主给的原因原样说出来。只说"失败了"等于没说 —— 现场为这句话多查了一轮。
              const reason = data?.error ?? `HTTP ${status}`
              const hint = data?.hint ? `（${data.hint}）` : ''
              setStatus(`头像没存上：${reason}${hint}`)
            })
            .catch(() => setStatus('头像没存上（连不上宿主）'))
            .finally(() => setAvatarBusy(''))
        }
        reader.onerror = () => {
          setAvatarBusy('')
          setStatus('这个文件读不出来。')
        }
        reader.readAsDataURL(file)
      }

      const clearAvatar = (member) => {
        fetch(`/group/api/avatar?member=${encodeURIComponent(member)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ member, clear: true }),
        })
          .then((response) => response.json().catch(() => ({})).then((data) => ({ ok: response.ok, status: response.status, data })))
          .then(({ ok, status, data }) => {
            if (ok) {
              setConfig(data)
              setStatus('照片已去掉')
              return
            }
            setStatus(`去不掉：${data?.error ?? `HTTP ${status}`}`)
          })
          .catch(() => setStatus('去不掉（连不上宿主）'))
      }


      // 一个设置分组用模块级的 SettingsSection 画（不能写在这里，见上面那段注释）。
      return h('div', { style: { ...baseStyle, padding: '22px 24px 24px' } },
        h('div', { style: { fontSize: 16, fontWeight: 500, lineHeight: '24px' } }, t.settingsTitle),
        h('div', { style: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', marginTop: 4 } }, t.settingsHint),

        h(SettingsSection, { title: '侧边栏标题' },
          h('div', { style: rowStyle },
            h('input', {
              value: config.panelLabel ?? '',
              maxLength: 12,
              onChange: (event) => patch((next) => { next.panelLabel = event.target.value }),
              style: inputStyle,
            }),
          ),
        ),

        // 名字 / 头像讲的是同一件事：这一位在群里长什么样。
        // （座位名那一组 2026-11-12 拿掉了：椅子已撤，界面不该再留一个空的入口。）
        h(SettingsSection, { title: '成员', hint: '此处修改名称仅修改显示效果，无法修改 ta 的自我认知。若想让 ta 改名请试着直接和 ta 聊聊？' },
          ['lee', 'whale', 'fabian'].map((member, index) => {
            const avatar = avatarOf(config, member)
            return h('div', {
              key: `member-${member}`,
              style: {
                padding: index === 0 ? '6px 0 12px' : '12px 0',
                borderTop: index === 0 ? 'none' : '0.5px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12))',
              },
            },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                h(Avatar, { config, member, size: 32 }),
                h('input', {
                  value: config.names?.[member] ?? NAMES[member] ?? '',
                  maxLength: 16,
                  onChange: (event) => patch((next) => {
                    next.names = { ...(next.names ?? {}) }
                    next.names[member] = event.target.value
                  }),
                  style: inputStyle,
                }),
              ),

              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, paddingLeft: 42, flexWrap: 'wrap' } },
                h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', width: 48, flex: '0 0 auto' } }, '头像'),
                h('input', {
                  value: avatar.text,
                  maxLength: 2,
                  title: '文字 1–2 个（也可以是 emoji）',
                  onChange: (event) => patch((next) => {
                    next.avatars = { ...(next.avatars ?? {}) }
                    next.avatars[member] = { ...(next.avatars?.[member] ?? {}), text: event.target.value }
                  }),
                  style: { ...inputStyle, flex: '0 0 52px', minWidth: 52, textAlign: 'center' },
                }),
                h('input', {
                  type: 'color',
                  value: avatar.tint,
                  title: '底色',
                  onChange: (event) => patch((next) => {
                    next.avatars = { ...(next.avatars ?? {}) }
                    next.avatars[member] = { ...(next.avatars?.[member] ?? {}), tint: event.target.value }
                  }),
                  style: { width: 32, height: 32, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', flex: '0 0 auto' },
                }),
                h('button', {
                  onClick: () => fileInputs.current[member]?.click(),
                  disabled: avatarBusy === member,
                  style: { ...smallBtnStyle, opacity: avatarBusy === member ? 0.6 : 1 },
                }, avatarBusy === member ? '上传中…' : (avatar.image ? '换一张照片' : '上传照片')),
                avatar.image
                  ? h('button', { onClick: () => clearAvatar(member), style: smallBtnStyle }, '去掉照片')
                  : null,
                // 选文件用真的 input[type=file]，只是藏起来 —— 点按钮等于点它
                h('input', {
                  type: 'file',
                  accept: 'image/png,image/jpeg,image/webp',
                  ref: (node) => { fileInputs.current[member] = node },
                  onChange: (event) => {
                    uploadAvatar(member, event.target.files?.[0])
                    event.target.value = ''
                  },
                  style: { display: 'none' },
                }),
                avatar.image
                  ? h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, '照片优先于文字')
                  : null,
              ),
            )
          }),
        ),

        h(SettingsSection, { title: '红点', hint: '侧边栏和标签上的未读数算哪些话。私聊永远算（那里的话本来就是给你的）。' },
          h('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
            [
              { key: 'all', label: '全部未读' },
              { key: 'mentions', label: '只提醒 @ 我的' },
            ].map((option) => {
              const active = (config.notifyScope ?? 'all') === option.key
              return h('button', {
                key: option.key,
                onClick: () => patch((next) => { next.notifyScope = option.key }),
                style: {
                  height: 32, padding: '0 12px', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 13,
                  borderRadius: 'var(--dsw-radius-md, 8px)', cursor: 'pointer',
                  border: '0.5px solid ' + (active ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-border-l2, rgba(0,0,0,0.12))'),
                  background: active ? 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.05))' : 'transparent',
                  color: active ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-label-secondary)',
                  fontWeight: active ? 600 : 400,
                },
              }, option.label)
            }),
          ),
          h('div', { style: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', marginTop: 8 } },
            (config.notifyScope ?? 'all') === 'mentions'
              ? '群里只有 @ 所有人 或 直接给你的话才算未读；大肥鱼跟小肥鱼之间的对话不打扰你。'
              : '群里任何人说的话都算未读（除了你自己发的）。'),
        ),

        h('div', {
          style: { marginTop: 16, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' },
        }, status || '改动会自动保存。侧边栏名称要刷新页面才变。'),
      )
    }

    /** 侧边栏图标：一个对话气泡。 */
    function GroupIcon({ size = 18 }) {
      const [unread, setUnread] = useState(0)
      useEffect(() => {
        let alive = true
        const tick = async () => {
          const counts = await loadUnread()
          if (alive && counts) setUnread(counts.total)
        }
        void tick()
        const timer = setInterval(() => { void tick() }, 5000)
        return () => { alive = false; clearInterval(timer) }
      }, [])

      return h('div', { style: { position: 'relative', width: size, height: size, display: 'grid', placeItems: 'center' } },
        h('svg', {
          width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
          stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
        },
          h('path', { d: 'M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z' }),
          h('path', { d: 'M5.5 6.5h5' }),
          h('path', { d: 'M5.5 8.5h3' }),
        ),
        unread > 0
          ? h('span', {
              'aria-label': '有新消息',
              title: '有新消息',
              style: {
                position: 'absolute', top: -1, right: -1, width: 6, height: 6,
                borderRadius: 9999, background: 'var(--dsw-alias-label-error, #e5484d)',
              },
            })
          : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 一行"我跑的是哪一版"的自报，方便判断浏览器是不是还在用旧 bundle
        console.info('[lil-whale-group-ui] client build v15 · busy-labels:', Object.keys(MARKDOWN_LABELS).join(','))
        // 「正在回复…」那三个点的呼吸动画 + 过场转圈。只在浏览器里注入一次。
        if (typeof document !== 'undefined' && !document.getElementById('lil-whale-group-keyframes')) {
          const style = document.createElement('style')
          style.id = 'lil-whale-group-keyframes'
      style.textContent = '@keyframes dshGroupPulse{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-1px)}}' + '@keyframes dshGroupRise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}' + '@keyframes dshGroupSpin{to{transform:rotate(360deg)}}'
          document.head.appendChild(style)
        }

        void loadConfig()

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 5,
          label: () => cachedConfig?.panelLabel || t.panel,
        }, GroupIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, GroupPage))

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: SETTINGS_ID,
          order: 50,
          label: () => t.settingsTitle,
        }, SettingsPage))
      },
    }
  },
})
