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
  id: 'dsh-group-ui',
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
      mention: '右键 @',
      settingsTitle: '小小肥鱼',
      settingsHint: '这些只改显示，不碰她的文件。',
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
      return h('div', {
        onContextMenu,
        title,
        style: {
          width: size, height: size, borderRadius: Math.round(size * 0.3),
          flex: '0 0 auto',
          cursor: onContextMenu ? 'context-menu' : undefined,
          background: avatar.tint,
          color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: Math.max(11, Math.round(size * 0.42)),
          fontWeight: 500,
          userSelect: 'none',
        },
      }, avatar.text)
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
        console.warn('[dsh-group-ui] primitives 里没有可用的 MarkdownText，用自带渲染兜底')
        return null
      } catch (error) {
        // 退化成纯文本可以接受，但必须留一条痕迹：静默降级等于把错误藏起来。
        console.warn('[dsh-group-ui] 取不到 @deepseek-ai/dsh-client-ui-primitives，退回纯文本：', error?.message ?? error)
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
        console.warn('[dsh-group-ui] MarkdownText 渲染失败，这条改用自带渲染：', error?.message ?? error)
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
    function Bubble({ config, message, onMention, animate = false }) {
      // 只在挂载时决定「要不要动画」：否则后续每次重渲染都会让老消息重新弹一遍。
      const animateOnMount = useRef(animate).current
      const mine = message.from === 'fabian'
      const who = nameOf(config, message.from, message.s)
      // 指名到座位的消息，显示"→ 大肥鱼 · 家"，只写给这个人的显示"→ 大肥鱼"。
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
              }, h(SafeMarkdown, { text: message.text })),
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
      // 名字下面列出座位：同一个人有几段会话，就有几行「大肥鱼 · 工」这样可选。
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
        }
      } catch {
        return null
      }
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
      const animateRef = useRef(false)
      const pickedOnceRef = useRef(false)
      const peerRef = useRef(null)
      const [text, setText] = useState('')
      const [sending, setSending] = useState(false)
      const [error, setError] = useState(null)
      const [unread, setUnread] = useState({ dm: {} })
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
        if (activePeer === null) { setMessages([]); return }
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
        }
      }, [activePeer])

      useEffect(() => {
        const tick = async () => {
          await loadContacts()
          await loadMessages()
          const counts = await loadUnread()
          if (counts) setUnread(counts)
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

      /**
       * 贴到底。
       *
       * 原来用 `bottom.scrollIntoView({block:'end'})`：它会连外层容器一起滚，
       * 而 markdown（代码块、字体）排版落定后高度还会再变一次 —— 于是"打开就贴在底"
       * 常常差几十像素，最后一条消息正好卡进底部那 46px 的渐隐带，看着像被切了。
       * 这里改成直接设 scrollTop，并在下一帧、200ms 后各补一次。
       */
      const stickToBottom = useCallback(() => {
        const el = scrollRef.current
        if (el) el.scrollTop = el.scrollHeight
      }, [])

      useEffect(() => {
        stickToBottom()
        const raf = requestAnimationFrame(stickToBottom)
        const timer = setTimeout(stickToBottom, 200)
        return () => { cancelAnimationFrame(raf); clearTimeout(timer) }
      }, [messages.length, activePeer, stickToBottom])
      useEffect(() => { if (activePeer !== null) inputRef.current?.focus() }, [activePeer])

      const pick = (peer) => {
        setActivePeer((current) => (current === peer ? null : peer))
        setMessages([])
        setText('')
      }

      const submit = useCallback(async () => {
        const value = text.trim()
        if (value === '' || sending || activePeer === null) return
        setSending(true)
        try {
          const response = await fetch('/group/api/dm', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ peer: activePeer, text: value }),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          setText('')
          await loadMessages()
          await loadContacts()
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          setSending(false)
        }
      }, [text, sending, activePeer, loadMessages, loadContacts])

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
          presence?.[activePeer] === 'working'
            ? h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, t.typing(nameOf(config, activePeer)))
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
      const messageList = h('div', { ref: scrollRef, style: { flex: 1, overflowY: 'auto', padding: '8px 0 58px', minHeight: 0, ...fadeMask } },
        h('div', { style: { width: narrow ? '100%' : `${dmWidth}%`, margin: '0 auto', position: 'relative' } },
          messages.length === 0
            ? h('div', { style: { padding: '28px 20px', fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-tertiary)' } },
              '还没有私下说过话。这里的话只有你们两个看得见。')
          : messages.map((message, index) => h(Bubble, { key: `${message.ts}-${index}`, config, message, animate: animateRef.current })),
          h('div', { ref: bottom }),
          widthHandles))

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
          h('textarea', {
            ref: inputRef,
            value: text,
            onChange: (event) => setText(event.target.value),
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
            h('div', { style: { flex: 1, fontSize: 11, color: 'var(--dsw-alias-label-caption)' } }, '不进群记录，只有你们两个看得见'),
            h('button', {
              onClick: () => { void submit() },
              disabled: sending || text.trim() === '',
              title: t.send,
              style: {
                flex: '0 0 32px', width: 32, height: 32, padding: 0, border: 'none',
                background: 'transparent', position: 'relative',
                cursor: sending || text.trim() === '' ? 'not-allowed' : 'pointer',
                opacity: sending || text.trim() === '' ? 0.4 : 1,
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

      const chatPane = h('div', { style: { flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' } }, chatHeader, messageList, composer)
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
      const [text, setText] = useState('')
      const [to, setTo] = useState('all')
      const [error, setError] = useState(null)
      const [sending, setSending] = useState(false)
      const [presence, setPresence] = useState({})
      const [seats, setSeats] = useState([])
      const [pickerOpen, setPickerOpen] = useState(false)
      const [tab, setTab] = useState('group')
      const [unread, setUnread] = useState({ group: 0, dm: {}, total: 0 })
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
        } catch (e) {
          setError(String(e?.message ?? e))
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
          // 座位：名册里有几段会话就列几段，@ 面板据此多出「大肥鱼 · 工」这种可选项
          const response = await fetch('/group/api/seats', { headers: { accept: 'application/json' } })
          if (response.ok) {
            const data = await response.json()
            if (Array.isArray(data?.seats)) setSeats(data.seats)
          }
        } catch {
          // 拿不到就不列座位，只保留"叫这个人"
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

      /** 贴到底：见 DmPage 里同一处的说明（scrollIntoView 会连外层一起滚，且排版会二次变化）。 */
      const stickToBottom = useCallback(() => {
        const el = scrollRef.current
        if (el) el.scrollTop = el.scrollHeight
      }, [])

      useEffect(() => {
        stickToBottom()
        const raf = requestAnimationFrame(stickToBottom)
        const timer = setTimeout(stickToBottom, 200)
        return () => { cancelAnimationFrame(raf); clearTimeout(timer) }
      }, [messages.length, tab, stickToBottom])

      const persistWidth = useCallback(() => {
        setWidthPct((current) => {
          try { window.localStorage?.setItem('dsh-group-width', String(current)) } catch {}
          return current
        })
      }, [])
      const submit = useCallback(async () => {
        const value = text.trim()
        if (value === '' || sending) return
        setSending(true)
        try {
          const endpoint = tab === 'dm' ? '/group/api/dm' : '/group/api/send'
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(tab === 'dm' ? { text: value } : (() => {
              const { base, seat } = splitTarget(to)
              return seat === '' ? { to: base, text: value } : { to: base, toSeat: seat, text: value }
            })()),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          setText('')
          await refresh()
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          setSending(false)
        }
      }, [text, to, sending, refresh, tab])

      const busy = ['lee', 'whale'].filter((id) => presence?.[id] === 'working')
      const typingLine = busy.length
        ? t.typing(busy.map((id) => nameOf(config, id)).join('、'))
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
                onClick: () => { setTab(item.key); setText('') },
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
          ref: scrollRef,
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
              messages.map((message, index) => h(Bubble, {
                key: `${message.ts}-${index}`,
                config,
                message,
                animate: animateRef.current,
                onMention: (id) => setTo(id),
              })),
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
              h('textarea', {
                ref: inputRef,
                value: text,
                onChange: (event) => setText(event.target.value),
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
                h('div', { style: { flex: 1, fontSize: 11, color: 'var(--dsw-alias-label-caption)' } },
                  to === 'all' ? t.groupOnly : t.toOne(targetName(config, to))),
                h('button', {
                  onClick: () => { void submit() },
                  disabled: sending || text.trim() === '',
                  title: t.send,
                  style: {
                    flex: '0 0 32px', width: 32, height: 32, padding: 0, border: 'none',
                    background: 'transparent', position: 'relative',
                    cursor: sending || text.trim() === '' ? 'not-allowed' : 'pointer',
                    opacity: sending || text.trim() === '' ? 0.4 : 1,
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
    function SettingsPage() {
      const [config, setConfig] = useState(DEFAULT_CONFIG)
      const [status, setStatus] = useState('')
      const [dirty, setDirty] = useState(false)
      const [seats, setSeats] = useState([])
      const timerRef = useRef(null)

      useEffect(() => {
        void loadConfig(true).then(setConfig)
      }, [])

      // 座位：名册里有几段被钉住的会话，就列几行（不硬编码，加会话不用改代码）。
      useEffect(() => {
        let alive = true
        fetch('/group/api/seats')
          .then((response) => (response.ok ? response.json() : null))
          .then((data) => { if (alive && Array.isArray(data?.seats)) setSeats(data.seats) })
          .catch(() => {})
        return () => { alive = false }
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

      // 一个设置分组 = 一层描边卡片。照 dsh 的 token 画，不自造颜色。
      const Section = ({ title, hint, children }) => h('div', {
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

      return h('div', { style: { ...baseStyle, padding: '22px 24px 24px' } },
        h('div', { style: { fontSize: 16, fontWeight: 500, lineHeight: '24px' } }, t.settingsTitle),
        h('div', { style: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', marginTop: 4 } }, t.settingsHint),

        h(Section, { title: '侧边栏标题' },
          h('div', { style: rowStyle },
            h('input', {
              value: config.panelLabel ?? '',
              maxLength: 12,
              onChange: (event) => patch((next) => { next.panelLabel = event.target.value }),
              style: inputStyle,
            }),
          ),
        ),

        h(Section, { title: '名字', hint: '仅修改显示效果，无法修改 ta 的自我认知。若想让 ta 改名请试着直接和 ta 聊聊？' },
          ['lee', 'whale', 'fabian'].map((member) => h('div', { key: `name-${member}`, style: rowStyle },
            h(Avatar, { config, member, size: 26 }),
            h('input', {
              value: config.names?.[member] ?? NAMES[member] ?? '',
              maxLength: 16,
              onChange: (event) => patch((next) => {
                next.names = { ...(next.names ?? {}) }
                next.names[member] = event.target.value
              }),
              style: inputStyle,
            }),
          )),
        ),

        h(Section, {
          title: '座位名',
          hint: '同一个人可能有两段会话同时在群里。这里给每一段起个名字，群里就能分出是哪一段说的；留空则用上面的大名。',
        },
          seats.length === 0
            ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', marginTop: 8 } }, '名册里还没有登记的会话。')
            : seats.map((seat) => h('div', { key: `seat-${seat.prefix}`, style: rowStyle },
              h(Avatar, { config, member: seat.member, size: 26 }),
              h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', flex: '0 0 auto' } }, seat.prefix),
              h('input', {
                value: config.seats?.[seat.prefix] ?? '',
                maxLength: 16,
                placeholder: nameOf(config, seat.member),
                onChange: (event) => patch((next) => {
                  next.seats = { ...(next.seats ?? {}) }
                  const text = event.target.value
                  if (text.trim() === '') delete next.seats[seat.prefix]
                  else next.seats[seat.prefix] = text
                }),
                style: inputStyle,
              }),
            )),
        ),

        h(Section, { title: '头像', hint: '文字 1–2 个（也可以是 emoji），颜色是底色。' },
          ['lee', 'whale', 'fabian'].map((member) => h('div', { key: `avatar-${member}`, style: rowStyle },
            h(Avatar, { config, member, size: 28 }),
            h('input', {
              value: config.avatars?.[member]?.text ?? '',
              maxLength: 2,
              onChange: (event) => patch((next) => {
                next.avatars = { ...(next.avatars ?? {}) }
                next.avatars[member] = { ...(next.avatars?.[member] ?? {}), text: event.target.value }
              }),
              style: { ...inputStyle, flex: '0 0 56px', minWidth: 56, textAlign: 'center' },
            }),
            h('input', {
              type: 'color',
              value: config.avatars?.[member]?.tint ?? '#888888',
              onChange: (event) => patch((next) => {
                next.avatars = { ...(next.avatars ?? {}) }
                next.avatars[member] = { ...(next.avatars?.[member] ?? {}), tint: event.target.value }
              }),
              style: { width: 32, height: 32, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' },
            }),
            h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, nameOf(config, member)),
          )),
        ),

        h(Section, { title: '红点', hint: '侧边栏和标签上的未读数算哪些话。私聊永远算（那里的话本来就是给你的）。' },
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
        console.info('[dsh-group-ui] client build v3 · markdown labels:', Object.keys(MARKDOWN_LABELS).join(','))
        // 「正在回复…」那三个点的呼吸动画。只在浏览器里注入一次。
        if (typeof document !== 'undefined' && !document.getElementById('dsh-group-keyframes')) {
          const style = document.createElement('style')
          style.id = 'dsh-group-keyframes'
      style.textContent = '@keyframes dshGroupPulse{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-1px)}}' + '@keyframes dshGroupRise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}'
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
