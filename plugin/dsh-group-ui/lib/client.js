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

    function nameOf(config, id) {
      return config?.names?.[id] || NAMES[id] || id
    }

    function avatarOf(config, id) {
      return config?.avatars?.[id] || DEFAULT_CONFIG.avatars[id] || { text: '?', tint: '#8a8a8a' }
    }

    const baseStyle = {
      color: 'var(--dsw-alias-label-primary)',
      fontFamily: 'inherit',
      height: '100%',
      minHeight: 0,
    }

    /** 头像：一块圆角方块，里面是 1–2 个字。颜色取自配置。 */
    function Avatar({ config, member, size = 34 }) {
      const avatar = avatarOf(config, member)
      return h('div', {
        style: {
          width: size, height: size, borderRadius: Math.round(size * 0.3),
          flex: '0 0 auto',
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

    /** 一条消息：左边是别人，右边是自己。 */
    function Bubble({ config, message, onMention, animate = false }) {
      // 只在挂载时决定「要不要动画」：否则后续每次重渲染都会让老消息重新弹一遍。
      const animateOnMount = useRef(animate).current
      const mine = message.from === 'fabian'
      const who = nameOf(config, message.from)
      const target = message.to && message.to !== 'all' ? ` → ${nameOf(config, message.to)}` : ''
      const time = (() => {
        const date = new Date(message.ts)
        if (Number.isNaN(date.getTime())) return ''
        return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
      })()
      return h('div', {
        style: {
          display: 'flex', gap: 10, padding: '6px 12px',
          flexDirection: mine ? 'row-reverse' : 'row',
        },
      },
        h('div', {
          // 右键头像就 @ 他：比先去面板里找人快
          onContextMenu: (event) => {
            event.preventDefault()
            if (!mine && onMention) onMention(message.from)
          },
          title: mine ? undefined : `${t.mention}${who}`,
          style: { cursor: mine ? 'default' : 'context-menu' },
        }, h(Avatar, { config, member: message.from, size: 34 })),
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
    function AtPicker({ config, current, onPick, onClose }) {
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
      const rows = [
        { id: 'all', label: t.toAll, plain: true },
        { id: 'lee', label: nameOf(config, 'lee') },
        { id: 'whale', label: nameOf(config, 'whale') },
      ]
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
          row.plain
            ? h('div', {
              style: {
                width: 26, height: 26, borderRadius: '50%',
                border: '1px dashed var(--dsw-alias-border-l3, rgba(0,0,0,0.2))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, color: 'var(--dsw-alias-label-tertiary)',
              },
            }, '群')
            : h(Avatar, { config, member: row.id, size: 26 }),
          h('span', { style: { flex: 1 } }, row.label),
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

    /** 私聊页：左边是能单独说话的人，右边默认空白；点谁开谁，再点一次收起。 */
    function DmPage({ config, presence }) {
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

      useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }) }, [messages.length])
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
              padding: '8px 12px', border: 'none', textAlign: 'left',
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

      const chatHeader = h('div', {
        style: { flex: 'none', padding: '10px 20px', borderBottom: '0.5px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.1))' },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { fontSize: 14, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' } }, nameOf(config, activePeer)),
          presence?.[activePeer] === 'working'
            ? h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, t.typing(nameOf(config, activePeer)))
            : null))

      const fadeMask = { WebkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - 46px), transparent 100%)', maskImage: 'linear-gradient(to bottom, #000 calc(100% - 46px), transparent 100%)' }
      // 滚到边界时消息在输入框后面渐隐（照 dsh 的样子）：用 mask 而不是盖一层渐变，免得挡住点击。
      const widthHandles = [
        h(WidthHandle, { key: 'left', side: 'left', width: dmWidth, containerRef: scrollRef, onChange: setDmWidth, onCommit: persistDmWidth }),
        h(WidthHandle, { key: 'right', side: 'right', width: dmWidth, containerRef: scrollRef, onChange: setDmWidth, onCommit: persistDmWidth }),
      ]
      // 私聊的左右边界跟群聊同款：拖住两侧，列宽实时变；宽度存在这台机器上。
      const messageList = h('div', { ref: scrollRef, style: { flex: 1, overflowY: 'auto', padding: '8px 0 46px', minHeight: 0, ...fadeMask } },
        h('div', { style: { width: `${dmWidth}%`, margin: '0 auto', position: 'relative' } },
          messages.length === 0
            ? h('div', { style: { padding: '28px 20px', fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-tertiary)' } },
              '还没有私下说过话。这里的话只有你们两个看得见。')
          : messages.map((message, index) => h(Bubble, { key: `${message.ts}-${index}`, config, message, animate: animateRef.current })),
          h('div', { ref: bottom }),
          widthHandles))

      const composer = h('div', {
          style: { flex: 'none', padding: '10px 0 18px' },
      },
        h('div', {
          style: {
            width: `${dmWidth}%`, margin: '0 auto', boxSizing: 'border-box',
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
              fontSize: 14, lineHeight: '24px', padding: '4px 2px', minHeight: 44, maxHeight: 220,
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

      return h('div', { style: { flex: 1, minHeight: 0, height: '100%', display: 'flex' } },
        h('div', { style: { width: sidebar, flex: 'none', position: 'relative', display: 'flex', minHeight: 0 } },
          h('div', { style: { flex: 1, overflowY: 'auto', padding: '6px 0', minWidth: 0 } }, contactList),
          h('div', {
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
            }))),
        h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' } },
          rightPane,
          error
            ? h('div', { style: { flex: 'none', padding: '0 16px 8px', fontSize: 12, color: 'var(--dsw-alias-label-error, #c0392b)' } }, error)
            : null))
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

      useEffect(() => {
        bottom.current?.scrollIntoView({ block: 'end' })
      }, [messages.length])

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
            body: JSON.stringify(tab === 'dm' ? { text: value } : { to, text: value }),
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
          style: { flex: 1, overflowY: 'auto', padding: '8px 0 46px', minHeight: 0, position: 'relative', WebkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - 46px), transparent 100%)', maskImage: 'linear-gradient(to bottom, #000 calc(100% - 46px), transparent 100%)' },
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
                    h(Avatar, { config, member: to, size: 18 }),
                    h('span', null, nameOf(config, to)),
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
                placeholder: to === 'all' ? t.placeholder : `对 ${nameOf(config, to)} 说…`,
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
                  to === 'all' ? t.groupOnly : t.toOne(nameOf(config, to))),
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
