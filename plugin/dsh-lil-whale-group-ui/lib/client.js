/**
 * 群聊页面（Client 半边）。
 *
 * 侧边栏顶部一个图标，点开是主面板里的一页：三条鱼的群，
 * 有名字、有内容、有时间、有头像（默认是名字首字，可在设置里改）。
 *
 * 另有一页设置（设置 → 小小肥鱼）：侧边栏名称、三个头像的文字与颜色。（显示名不在这里改：A.82）
 *
 * 数据全部来自宿主那几条路由（/group/api/messages、/group/api/send、
 * /group/api/config、/group/api/presence），不在浏览器里直接读文件。
 */
window.__ModuleLoader__.load({
  // 模块 id 必须等于包名（含 scope）：客户端 boot 图按 package.json 的 name 去找这个 id，
  // 少写 scope 时 bundle 能取到、但加载器找不到模块，表现成 "import failed"。
  id: '@fabianactor/dsh-lil-whale-group-ui',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } = React
    // 官方的原图查看器（dsh 自己的聊天里点图片看大图就是它）：点外面/按 Esc 关。
    // 不自己画遮罩：官方那套的观感与交互（portal 到 body、关闭按钮、Esc）都是现成的，
    // 我们只负责"什么时候打开它"。
    const { ImageLightbox } = require('@deepseek-ai/dsh-client-ui-primitives')

    const PANEL_ID = 'group'
    const SETTINGS_ID = 'lil-whale'

    // 宽度：两侧各留 4% 页边距，再宽就压到边框上了
    const WIDTH_MIN = 30
    const WIDTH_MAX = 92

    // 显示名兜底（真正的值在名册里；名字只能由她自己改，A.82）
    // 兜底名必须是中性的：最小安装没有名册，不然会把作者家的名字显示给用户（r206）。
    const NAMES = { lee: '第一条鱼', whale: '第二条鱼', fabian: '宿主' }

    const DEFAULT_CONFIG = {
      panelLabel: '鱼群',
      notifyScope: 'all',
      avatars: {
        lee: { text: '大', tint: '#4a7dbd' },
        whale: { text: '小', tint: '#c2705a' },
        fabian: { text: 'F', tint: '#5c8a6a' },
      },
      names: { lee: '第一条鱼', whale: '第二条鱼', fabian: '宿主' },
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
      toLee: '第一条鱼',
      toWhale: '第二条鱼',
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
    const GROUP_DRAFT_KEY = 'dsh-lil-whale-group-draft'
    const dmDraftKeyOf = (peer) => `dsh-lil-whale-group-dm-draft-${peer}`
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
        headers: { 'content-type': 'application/json', 'x-llw-panel': '1' },
        body: JSON.stringify(next),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      cachedConfig = { ...DEFAULT_CONFIG, ...(await response.json()) }
      return cachedConfig
    }

    /**
     * 版本：读两个包当前版本；「检查更新」才去问 GitHub Releases。
     * 两个包必须一起用，所以两条一起显示、一起说"有没有新的"。
     */
    async function loadVersions() {
      const response = await fetch('/group/api/version', { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    }

    async function checkUpdates() {
      const response = await fetch('/group/api/check-update', {
        method: 'POST',
        headers: { 'x-llw-panel': '1' },
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`)
      return data
    }

    /** 版本状态 → 一句人话。检查失败要说出原因，不能显示成"已是最新"。 */
    function versionLineOf(state) {
      if (!state) return '还没读到版本'
      if (state.error) return `检查失败：${state.error}`
      const part = (label, side) => {
        if (!side) return `${label} 未知`
        if (side.error) return `${label} ${side.current ?? '未知'}（检查失败：${side.error}）`
        if (side.latest == null) return `${label} ${side.current ?? '未知'}`
        if (side.updateAvailable === true) return `${label} ${side.current} → 最新 ${side.latest}`
        if (side.updateAvailable === false) return `${label} ${side.current}（已是最新）`
        return `${label} ${side.current}（最新 ${side.latest}，无法比较）`
      }
      return `${part('宿主', state.host)}；${part('面板', state.ui)}`
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
      // 文字可以空着（2026-11-14 他说"输入框无法清空"）：空的时候退回名字首字，
      // 而不是把输入框里刚删掉的那个字又填回去。
      const shown = avatar.text || ([...nameOf(config, member)][0] ?? '?')
      return h('div', { onContextMenu, title, style: box }, shown)
    }

    /**
     * 带输入法保护的输入框。
     *
     * 不能直接拿配置里的字符串当受控值：中文输入法在**选字之前**就已经往输入框里
     * 塞拼音字母（"fei"），受控值每敲一下就重渲染一次，拼音还没上屏就被
     * `maxLength` / `slice` 截成 "f" 提交了（2026-11-14 他报的头像 bug）。
     *
     * 所以：输入过程中用本地 draft，`compositionstart` → `compositionend` 之间
     * **只改 draft、不提交**；上屏（compositionend）或失焦时才收成 `limit` 个码位交给外面。
     * 头像那个"清空后又跳回来"是另一半原因（服务端把空串当没填），两边一起修。
     */
    function ComposingTextInput({ value, limit = 0, trim = true, onCommit, style, title }) {
      const [draft, setDraft] = useState(value ?? '')
      const composingRef = useRef(false)
      const focusedRef = useRef(false)
      // 外面改了（例如另一个窗口同步过来）才回填；正在输入时不抢用户的光标。
      useEffect(() => {
        if (composingRef.current || focusedRef.current) return
        setDraft(value ?? '')
      }, [value])
      const clean = (raw) => {
        let text = String(raw ?? '')
        if (trim) text = text.trim()
        if (limit > 0) text = Array.from(text).slice(0, limit).join('')
        return text
      }
      const commit = (raw) => {
        const text = clean(raw)
        setDraft(text)
        onCommit(text)
      }
      return h('input', {
        value: draft,
        title,
        onFocus: () => { focusedRef.current = true },
        onBlur: (event) => {
          focusedRef.current = false
          commit(event.currentTarget.value)
        },
        onCompositionStart: () => { composingRef.current = true },
        onCompositionEnd: (event) => {
          composingRef.current = false
          commit(event.currentTarget.value)
        },
        onChange: (event) => {
          const raw = event.target.value
          // 输入法还在选字：只更新 draft，别截断、别提交（截断就是那个 "小f" 的来源）。
          if (composingRef.current) { setDraft(raw); return }
          commit(raw)
        },
        style,
      })
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
        console.warn('[dsh-lil-whale-group-ui] primitives 里没有可用的 MarkdownText，用自带渲染兜底')
        return null
      } catch (error) {
        // 退化成纯文本可以接受，但必须留一条痕迹：静默降级等于把错误藏起来。
        console.warn('[dsh-lil-whale-group-ui] 取不到 @deepseek-ai/dsh-client-ui-primitives，退回纯文本：', error?.message ?? error)
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

    /**
     * Markdown 把「单个换行」当空格（CommonMark 的软换行），于是用户在输入框里敲的回车，
     * 发出来就粘成一行 —— 2026-11-15 Fabian 报的"输入框能换行、发送后格式错了"。
     * 行尾补两个空格 = 硬换行；代码块（```）里不补，那会变成代码里的尾随空格。
     */
    const withHardBreaks = (text) => {
      const raw = String(text ?? '').replace(/\r\n/g, '\n')
      if (raw.includes('```')) return raw
      return raw.replace(/([^\n])\n(?!\n)/g, '$1  \n')
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
        console.warn('[dsh-lil-whale-group-ui] MarkdownText 渲染失败，这条改用自带渲染：', error?.message ?? error)
      }

      render() {
        if (this.state.failed || !MarkdownText) return h(MarkdownBody, { text: this.props.text })
        return h(MarkdownText, { text: withHardBreaks(this.props.text), labels: MARKDOWN_LABELS })
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
// 换行：Enter 发送，Shift+Enter 换行。手动插入而不是靠浏览器默认——
// 受控 textarea 上默认行为在部分输入法/组合状态下会被吃掉，这里只做一件事，不猜。
// 浏览器支持 field-sizing 时（Chromium 123+），输入框高度交给 CSS 自己长；
// 每敲一个字写一次 style 再读 scrollHeight，会强制整页排版，是快速输入卡的主因。
const GROW_BY_CSS = typeof CSS !== 'undefined' && Boolean(CSS.supports && CSS.supports('field-sizing', 'content'))

function growTextarea(el) {
  if (!el) return
  if (GROW_BY_CSS) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 220)}px`
}
// 发出去之后把高度收回去：以前只在输入时算高度，setText('') 之后框还停在旧高度（2026-11-15 第 1 条）。
function resetTextareaHeight(el) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight || 0, 220)}px`
}
function insertNewline(el, value, setValue) {
  const start = el.selectionStart ?? value.length
  const end = el.selectionEnd ?? start
  const next = `${value.slice(0, start)}\n${value.slice(end)}`
  setValue(next)
  requestAnimationFrame(() => {
    el.selectionStart = el.selectionEnd = start + 1
    growTextarea(el)
  })
}
// 点消息头上的行号复制引用：`群 #1763` / `私聊 fabian__lee2 #3`。
// 优先用 Clipboard API；不安全的上下文（非 https/非 localhost）会没有这个对象，
// 落到老办法（临时 textarea + execCommand），失败就返回 false，让调用方不显示「已复制」。
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 继续走兜底
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

const Bubble = React.memo(function Bubble({ config, message, onMention, animate = false, citePrefix = '' }) {
      // 只在挂载时决定「要不要动画」：否则后续每次重渲染都会让老消息重新弹一遍。
      const animateOnMount = useRef(animate).current
      // 点图片打开官方看图器（大图、点外面关）。
      const [previewIndex, setPreviewIndex] = useState(-1)
      // 行号点一下复制引用；1.2 秒内显示「已复制」当回执。
      const [lineCopied, setLineCopied] = useState(false)
      const images = Array.isArray(message.images) ? message.images : (message.image ? [message.image] : [])
      const imageSrcs = images.map((image) => imageUrlOf(image))
      const humanId = config?.humanId ?? 'fabian'
  const mine = message.from === humanId
      const who = nameOf(config, message.from, message.s)
      // 指名到座位的消息，显示"→ 大肥鱼 · 日常"，只写给这个人的显示"→ 大肥鱼"。
      const targetTo = message.toSeat ? `${message.to}@${message.toSeat}` : message.to
      const target = message.to && message.to !== 'all' ? ` → ${targetName(config, targetTo)}` : ''
      const time = formatStamp(message.ts)
      // 行号：引用地址。群是 messages.jsonl 的行，私聊是 pool\dm\<pair>.jsonl 的行。
      // 文件是 append-only，行号不会变；点一下复制成别人能直接引用的形状。
      const lineNo = typeof message.line === 'number' && message.line > 0 ? message.line : 0
      const cite = lineNo > 0 ? `${citePrefix} #${lineNo}`.trim() : ''
      const copyCite = () => {
        if (!cite) return
        copyToClipboard(cite).then((ok) => {
          if (!ok) return
          setLineCopied(true)
          window.setTimeout(() => setLineCopied(false), 1200)
        })
      }
      return h(React.Fragment, null,
        h('div', {
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
          },
          h('span', null, who + target),
          h('span', null, time),
          lineNo > 0 ? h('span', {
            key: 'line',
            title: lineCopied ? '已复制' : `点击复制引用：${cite}`,
            onClick: copyCite,
            style: { cursor: 'pointer', fontSize: 11, color: 'var(--dsw-alias-label-caption)', userSelect: 'none' },
          }, lineCopied ? '已复制' : `#${lineNo}`) : null),
          h('div', {
            style: {
              padding: '8px 12px', borderRadius: 'var(--dsw-radius-lg, 12px)',
              background: mine ? 'rgba(74, 125, 189, 0.12)' : 'rgba(15, 20, 30, 0.06)',
              fontSize: 14, lineHeight: '22px',
              wordBreak: 'break-word',
              animation: animateOnMount ? 'dshGroupRise 240ms cubic-bezier(.2,.8,.2,1) both' : undefined,
            },
              },
              imageSrcs.map((src, index) => h('img', {
                key: `img-${index}`,
                src,
                alt: '图片',
                loading: 'lazy',
                onClick: () => setPreviewIndex(index),
                style: {
                  display: 'block', maxWidth: 260, maxHeight: 260,
                  borderRadius: 'var(--dsw-radius-md, 8px)', cursor: 'zoom-in',
                  marginBottom: message.text || index < imageSrcs.length - 1 ? 6 : 0,
                },
              })),
              message.text ? h(SafeMarkdown, { text: message.text }) : null),
        )),
        // 看图器挂在气泡外面：它是 portal 到 body 的，放哪都一样，但放在气泡里会让气泡多一层嵌套。
        previewIndex >= 0 && imageSrcs[previewIndex]
          ? h(ImageLightbox, {
            src: imageSrcs[previewIndex],
            alt: '图片',
            labels: { dialog: '图片', close: '关闭' },
            onClose: () => setPreviewIndex(-1),
          })
          : null,
      )
    })

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
      // 名字下面列出座位：同一个人**真的有几段会话**时才列。
      // （2026-11-12 他报的"@ 按钮后面有椅子后缀"：以前名册里每人一段也会列一行
      //   `小肥鱼 · c145f6`，看着像两条鱼。一段就是常态，不列。）
      const rows = [{ id: 'all', label: t.toAll, plain: true }]
      const memberIds = Object.keys(config?.names ?? NAMES).filter((id) => id !== (config?.humanId ?? 'fabian'))
      for (const member of memberIds) {
        rows.push({ id: member, label: nameOf(config, member) })
        const mine = (seats ?? []).filter((item) => item.member === member)
        if (mine.length < 2) continue
        for (const seat of mine) {
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
        const response = await fetch('/group/api/read', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-llw-panel': '1' },
          body: JSON.stringify({ channel, peer }),
        })
        // 2026-11-19（Fabian 报"红点清了又回来"）：以前不看 response.ok，
        // 403/500 也当读过了。返回值给调用方，失败才谈得上重试。
        return response.ok
      } catch {
        // 清不掉就继续亮着，比假装看过好
        return false
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
    // 一条消息最多带几张图：多图是为了"一次说完一件事"，不是图库。
    const MAX_IMAGES = 4
    function useImageAttach(setError) {
      const [pendingImages, setPendingImages] = useState([])
      const [imageBusy, setImageBusy] = useState(false)
      const fileRef = useRef(null)
      const pendingRef = useRef([])
      useEffect(() => { pendingRef.current = pendingImages }, [pendingImages])
      // files 可以是 File、FileList 或数组：选图 / 粘贴 / 拖入三条路最后都走这里。
      const attachImages = useCallback(async (files) => {
        const list = files instanceof File ? [files] : Array.from(files ?? []).filter(Boolean)
        if (list.length === 0) return
        for (const file of list) {
          if (!/^image\//.test(file.type)) {
            setError('只能发图片（png / jpg / webp / gif）')
            return
          }
          if (file.size > 8 * 1024 * 1024) {
            setError(`图片太大：${(file.size / 1048576).toFixed(1)} MB，上限 8 MB`)
            return
          }
        }
        const room = MAX_IMAGES - pendingRef.current.length
        if (list.length > room) {
          setError(`一条消息最多带 ${MAX_IMAGES} 张图（还能加 ${Math.max(room, 0)} 张）`)
          return
        }
        setImageBusy(true)
        try {
          const urls = []
          for (const file of list) {
            urls.push(await new Promise((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(String(reader.result ?? ''))
              reader.onerror = () => reject(new Error('这张图读不出来'))
              reader.readAsDataURL(file)
            }))
          }
          setPendingImages((current) => [...current, ...urls])
          setError(null)
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          setImageBusy(false)
        }
      }, [setError])
      return { pendingImages, setPendingImages, imageBusy, attachImages, fileRef }
    }

    function useFollowTail(scrollRef, deps) {
      const atBottomRef = useRef(true)
      const [atBottom, setAtBottom] = useState(true)
      // 上一次量到的 scrollTop：用来分辨两件长得一样的事——
      // "人往下滚到底"（scrollTop 变大）和"内容变短、浏览器把 scrollTop 夹到底"
      // （scrollTop 变小）。后者 distance 也会变成 0，但人其实没想回底部。
      const lastTopRef = useRef(0)
      // 上一次量到的内容高度：scrollTop 没动、高度变高，说明"人没走、是被顶下去的"。
      // 2026-11-17 报的第 1 条：贴底时来一条比视口还高的消息，撑开发生在
      // 跟到底的那几个补丁之后，于是停在半路。这件事靠多设几个 setTimeout 修不好，得看高度。
      const lastHeightRef = useRef(0)
      const stickToBottom = useCallback(() => {
        const el = scrollRef.current
        if (el) {
          el.scrollTop = el.scrollHeight
          lastTopRef.current = el.scrollTop
          lastHeightRef.current = el.scrollHeight
        }
      }, [scrollRef])
      const measureBottom = useCallback(() => {
        const el = scrollRef.current
        if (!el) return
        const top = el.scrollTop
        const height = el.scrollHeight
        // 人没动、内容变高：这是"贴着底被顶下去"，不是"人离开了底"。
        // 直接补到底，并且仍然算贴底——否则长消息一来就永远停在半路。
        const grew = height > lastHeightRef.current
        const movedDown = top >= lastTopRef.current - 1
        if (atBottomRef.current && grew && movedDown) {
          lastHeightRef.current = height
          stickToBottom()
          return
        }
        lastHeightRef.current = height
        const distance = height - top - el.clientHeight
        const next = distance <= 40
        // 离开底部永远认；回到"底部"只认人往下滚的那一种。
        // 2026-11-16 报的闪烁：翻历史时来新消息，高度被夹了一下、distance=0，
        // 于是被当成"到底了"，下一条一来就 stickToBottom 把人弹到底。
        lastTopRef.current = top
        if (next !== atBottomRef.current && (next === false || movedDown)) {
          atBottomRef.current = next
          setAtBottom(next)
        }
      }, [scrollRef, stickToBottom])
      const jumpToBottom = useCallback(() => {
        atBottomRef.current = true
        setAtBottom(true)
        stickToBottom()
        requestAnimationFrame(stickToBottom)
      }, [stickToBottom])
      // 贴底时盯着内容高度：Markdown 排版、图片加载、代码块换行都在首帧之后还会长高。
      // 只认"贴底"这一个前提；人一翻历史就不管——不能把正在看三天前的人拽回今天。
      useEffect(() => {
        const el = scrollRef.current
        if (!el) return undefined
        let observer = null
        try {
          if (typeof ResizeObserver === 'undefined') return undefined
          observer = new ResizeObserver(() => {
            if (!atBottomRef.current) return
            stickToBottom()
          })
          // 内容列是滚动容器的第一个子元素；容器自己也要看（窗口高度变化）。
          observer.observe(el.firstElementChild || el)
          observer.observe(el)
        } catch {
          return undefined
        }
        return () => observer.disconnect()
      }, [scrollRef, stickToBottom, ...deps])
      useEffect(() => {
        if (!atBottomRef.current) return undefined
        stickToBottom()
        const raf = requestAnimationFrame(stickToBottom)
        const timer = setTimeout(stickToBottom, 200)
        const late = setTimeout(stickToBottom, 800)
        return () => { cancelAnimationFrame(raf); clearTimeout(timer); clearTimeout(late) }
      }, deps)
      return { atBottom, atBottomRef, measureBottom, jumpToBottom }
    }

    /**
     * 回到底部按钮 —— 照 dsh 的 `EvIC1a_toBottom`：34px、悬浮在消息区底部上方、
     * 贴着内容列的右边缘，不压输入框。
     *
     * 圆用内嵌 SVG 画而不是 `border-radius`：这个壳上 `border-radius` 出过两次
     * "样式算对了、画出来还是圆角矩形"，改用 `<circle>` 之后一次就对了（见 PRD 附录 A.10/A.11）。
     */
    /**
     * 浮在聊天区上的一句说明。
     *
     * 以前它和按钮共用同一个白胶囊样式，看起来像能点（2026-11-15 第 3 条）。
     * 现在说明只说明：浅底、无阴影、不接事件；按钮留着自己那份圆。
     */
    function FloatingHint({ children }) {
      return h('span', {
        style: {
          height: 24, display: 'flex', alignItems: 'center',
          padding: '0 8px', borderRadius: 999, fontSize: 12, whiteSpace: 'nowrap',
          color: 'var(--dsw-alias-label-tertiary, rgba(0,0,0,0.45))',
          background: 'var(--dsw-alias-bg-layer-3, rgba(0,0,0,0.06))',
          pointerEvents: 'none',
        },
      }, children)
    }

    function JumpToBottom({ onClick, rightInset, hint }) {
      // hint：翻历史时底下来了新消息，就在按钮左边写一句（2026-11-13 他要的）。
      // 不用红点、不改 tab 标题 —— 人在看群聊时不该被 "(1)" 提醒，只有"底下有东西"这一件事值得说。
      return h('div', {
        style: {
          position: 'absolute', left: 0, right: 0, bottom: 10, height: 0,
          display: 'flex', justifyContent: 'flex-end', alignItems: 'center', pointerEvents: 'none', zIndex: 8,
        },
      },
      hint
        ? h('span', { style: { marginTop: -30, marginRight: 8, display: 'flex' } }, h(FloatingHint, null, hint))
        : null,
      h('button', {
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
    function JumpToHistory({ onClick, rightInset, hint }) {
      return h('div', {
        style: {
          position: 'absolute', left: 0, right: 0, top: 12, height: 34,
          display: 'flex', justifyContent: 'flex-end', alignItems: 'center', pointerEvents: 'none', zIndex: 8,
        },
      },
      hint ? h('span', { style: { marginRight: 8, display: 'flex' } }, h(FloatingHint, null, hint)) : null,
      h('button', {
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
      // 输入法选字期间（拼音还没上屏）不落草稿：那时 value 里是 "xiaofei" 这种拼音字母，
      // 存进 localStorage 就是一份假的草稿。（和设置页 ComposingTextInput 同一类病。）
      const composingRef = useRef(false)
      const [text, setText] = useState('')
      const [sending, setSending] = useState(false)
      // setError 必须先声明再传下去：`const` 有暂时性死区，先用到后声明是 ReferenceError，
      // 整页白屏（2026-11-12 他报的 bug：私聊页面白屏）。
      const [error, setError] = useState(null)
      // 私聊一样能发图：和群聊共用 useImageAttach，只是发出去的地址不同。
      const { pendingImages, setPendingImages, imageBusy, attachImages, fileRef } = useImageAttach(setError)
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
          const saved = Number(window.localStorage?.getItem('dsh-lil-whale-group-dm-sidebar'))
          return Number.isFinite(saved) && saved >= 140 && saved <= 420 ? saved : 208
        } catch { return 208 }
      })
      // 私聊列宽：可拖、记在本机（跟左边的联系人栏一样，属于"这一台机器上的手感"）
      const [dmWidth, setDmWidth] = useState(() => {
        try {
          const saved = Number(window.localStorage?.getItem('dsh-lil-whale-group-dm-width'))
          return Number.isFinite(saved) && saved >= 30 && saved <= 92 ? saved : 72
        } catch { return 72 }
      })
      const persistDmWidth = useCallback(() => {
        setDmWidth((current) => {
          try { window.localStorage?.setItem('dsh-lil-whale-group-dm-width', String(current)) } catch {}
          return current
        })
      }, [])
      const scrollRef = useRef(null)
      const bottom = useRef(null)
      const inputRef = useRef(null)

      // 发出去（或粘贴/恢复草稿）之后按内容重算高度，否则框停在旧高度。
      useEffect(() => { if (!GROW_BY_CSS) resetTextareaHeight(inputRef.current) }, [text])

      const loadContacts = useCallback(async () => {
        try {
          const response = await fetch('/group/api/dm/contacts', { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const data = await response.json()
          const list = Array.isArray(data?.contacts) ? data.contacts : []
          // 最近说过话的排最上面；没有消息的按名字排在后面（跟微信一致）。
          const sorted = [...list].sort((a, b) => {
            const ta = Date.parse(a?.last?.ts ?? '') || 0
            const tb = Date.parse(b?.last?.ts ?? '') || 0
            if (tb !== ta) return tb - ta
            return String(a?.peer ?? '').localeCompare(String(b?.peer ?? ''))
          })
          setContacts(sorted)
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

      // 打开这一段、页面在前台、停 1.5 秒，才算读过。
      // 2026-11-14 Fabian 报：停在私聊页收到消息，红点不消失、要重进才清。
      // 根因是依赖只有 activePeer —— 新消息只更新 unread，没有第二次 markRead。
      // 现在把"这个对端未读数"也放进依赖：停在页面上每收到一条，都会重新走一次"停 1.5 秒 → 标读"。
      const activeUnread = Number(unread?.dm?.[activePeer]) || 0
      useEffect(() => {
        if (activePeer === null || activeUnread === 0) return
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
        const timer = setTimeout(() => {
          void markRead('dm', activePeer).then(() => loadUnread().then((counts) => { if (counts) setUnread(counts) }))
        }, 1500)
        return () => clearTimeout(timer)
      }, [activePeer, activeUnread])

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
        if ((value === '' && pendingImages.length === 0) || sending || activePeer === null) return
        setSending(true)
        try {
          const images = []
          for (const dataUrl of pendingImages) {
            const uploaded = await fetch('/group/api/image', {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-llw-panel': '1' },
              body: JSON.stringify({ dataUrl }),
            })
            const result = await uploaded.json().catch(() => null)
            if (!uploaded.ok) throw new Error(result?.detail ?? `图片上传失败 HTTP ${uploaded.status}`)
            if (result?.image) images.push(result.image)
          }
          const response = await fetch('/group/api/dm', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-llw-panel': '1' },
            body: JSON.stringify({ peer: activePeer, text: value, ...(images.length === 0 ? {} : { images }) }),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          setText('')
          writeDraft(dmDraftKeyOf(activePeer), '')
          setPendingImages([])
          await loadMessages()
          await loadContacts()
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          setSending(false)
        }
      }, [text, sending, activePeer, loadMessages, loadContacts, pendingImages.length])

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
                h('span', { style: { marginLeft: 'auto', fontSize: 11, color: 'var(--dsw-alias-label-caption)' } }, formatStamp(contact.last?.ts))),
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
      // 同群聊：打字不重排私聊历史。
      const dmListNode = useMemo(
        () => withDivider(messages, String(seenDm[activePeer] ?? ''), (message, index) => h(Bubble, {
          key: `${message.ts}-${index}`,
          config,
          message,
          animate: animateRef.current,
          // 私聊引用要写清是哪一本：pool\dm\<a>__<b>.jsonl，键按字典序排（与文件命名同规则）。
          citePrefix: `私聊 ${[(config?.humanId ?? 'fabian'), activePeer].sort().join('__')}`,
        })),
        [messages, seenDm, activePeer, config],
      )

      const messageArea = h('div', {
        style: { flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' },
      },
        h('div', { ref: scrollRef, onScroll: measureDmBottom, style: { flex: 1, overflowY: 'auto', padding: '8px 0 58px', minHeight: 0, ...fadeMask } },
          h('div', { style: { width: narrow ? '100%' : `${dmWidth}%`, margin: '0 auto', position: 'relative' } },
            messages.length === 0
            ? h('div', { style: { padding: '28px 20px', fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-tertiary)' } },
              '还没有私下说过话。这里的话只有你们两个看得见。')
          : dmListNode,
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
          pendingImages.length > 0
            ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
              ...pendingImages.map((src, index) => h('div', { key: `pending-${index}`, style: { position: 'relative' } },
                h('img', {
                  src,
                  alt: '待发送的图片',
                  style: { maxHeight: 72, maxWidth: 120, borderRadius: 8, display: 'block' },
                }),
                h('button', {
                  onClick: () => setPendingImages((current) => current.filter((_, i) => i !== index)),
                  title: '去掉这张图',
                  style: {
                    position: 'absolute', top: -6, right: -6,
                    width: 20, height: 20, borderRadius: '50%', border: 'none',
                    background: 'rgba(0,0,0,0.72)', color: '#fff', fontSize: 13, lineHeight: 1,
                    padding: 0, cursor: 'pointer', display: 'grid', placeItems: 'center',
                  },
                }, '×'))),
              h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } },
                imageBusy ? '读取中…' : '只有你们两个看得见'))
            : null,
          h('textarea', {
            ref: inputRef,
            value: text,
            onChange: (event) => {
              setText(event.target.value)
              if (!GROW_BY_CSS) growTextarea(event.currentTarget)
              if (activePeer !== null && !composingRef.current) writeDraft(dmDraftKeyOf(activePeer), event.target.value)
            },
            onCompositionStart: () => { composingRef.current = true },
            onCompositionEnd: (event) => {
              composingRef.current = false
              if (activePeer !== null) writeDraft(dmDraftKeyOf(activePeer), event.currentTarget.value)
            },
            onPaste: (event) => {
              const items = event.clipboardData?.items
              if (!items) return
              for (const item of Array.from(items)) {
                if (item.kind === 'file' && /^image\//.test(item.type)) {
                  event.preventDefault()
                  void attachImages(item.getAsFile())
                  return
                }
              }
            },
            onDragOver: (event) => {
              if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) event.preventDefault()
            },
            onDrop: (event) => {
              const files = event.dataTransfer?.files
              if (!files || files.length === 0) return
              event.preventDefault()
              void attachImages(files)
            },
            onKeyDown: (event) => {
              if (event.key === 'Enter' && event.shiftKey) {
                event.preventDefault()
                insertNewline(event.currentTarget, text, setText)
                return
              }
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
              fontSize: coarse ? 16 : 14, lineHeight: '24px', padding: '4px 2px', minHeight: 44, maxHeight: 220, fieldSizing: 'content',
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
                  multiple: true,
              style: { display: 'none' },
              onChange: (event) => {
                const files = event.target.files
                event.target.value = ''
                void attachImages(files)
              },
            }),
            h('div', { style: { flex: 1, fontSize: 11, color: 'var(--dsw-alias-label-caption)' } }, '不进群记录，只有你们两个看得见'),
            h('button', {
              onClick: () => { void submit() },
              disabled: sending || (text.trim() === '' && pendingImages.length === 0),
              title: t.send,
              style: {
                flex: '0 0 32px', width: 32, height: 32, padding: 0, border: 'none',
                background: 'transparent', position: 'relative',
                cursor: sending || (text.trim() === '' && pendingImages.length === 0) ? 'not-allowed' : 'pointer',
                opacity: sending || (text.trim() === '' && pendingImages.length === 0) ? 0.4 : 1,
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
                  setSidebar((current) => { try { window.localStorage?.setItem('dsh-lil-whale-group-dm-sidebar', String(current)) } catch {} ; return current })
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
      // 同 DmPage：输入法选字期间不落草稿（那时 value 里是拼音字母）。
      const composingRef = useRef(false)
      const [messages, setMessages] = useState([])
      // 输入框改成非受控：每敲一个字都 setState 会让整页（含最近 N 条气泡）重渲染，
      // 实测打 10 个字有 ~450ms 花在样式重算上（2026-11-15 第三轮）。
      // 现在只有「空 ↔ 非空」变化才 setState —— 只为发送按钮的灰态。
      const initialTextRef = useRef(readDraft(GROUP_DRAFT_KEY))
      const [hasText, setHasText] = useState(() => initialTextRef.current.trim() !== '')
      const draftTimerRef = useRef(null)
      const draftValueRef = useRef(initialTextRef.current)
      const [to, setTo] = useState('all')
      // @ 面板选中人的回调要稳定：Bubble 是 memo 的，每次渲染新函数会让 120 个气泡全部重渲染。
      const mentionTo = useCallback((id) => setTo(id), [])
      const [error, setError] = useState(null)
      const [sending, setSending] = useState(false)
      // 待发送的图（data URL）。上传在 submit 里做，这里只存"用户选了哪张"。
      const { pendingImages, setPendingImages, imageBusy, attachImages, fileRef } = useImageAttach(setError)
      // 群聊草稿：改一个字就存，切走 / 刷新 / 重新进页面都还在。
      // 发出去以后 text 变空串，这里顺手把草稿删掉（见 writeDraft 的空值分支）。
      // 输入法选字期间不写：那时 text 里是 "xiaofei"，存下去就是一份假草稿。
      const saveDraftSoon = useCallback((value) => {
        if (composingRef.current) return
        draftValueRef.current = value
        if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
        draftTimerRef.current = setTimeout(() => {
          draftTimerRef.current = null
          writeDraft(GROUP_DRAFT_KEY, value)
        }, 300)
      }, [])
      // 切 tab 不会卸载这个页面组件，只卸载输入框 —— 页面级的卸载清理够不着，
      // 所以切走时自己把还没落盘的那 300ms 写掉（2026-11-19 草稿复活 bug 的其中一半）。
      const flushGroupDraft = useCallback(() => {
        if (draftTimerRef.current) {
          clearTimeout(draftTimerRef.current)
          draftTimerRef.current = null
        }
        writeDraft(GROUP_DRAFT_KEY, draftValueRef.current)
      }, [])
      // 卸载（切 tab / 关面板）时把还没落盘的那 300ms 存掉，别让人刚打的字随组件一起消失。
      useEffect(() => () => {
        if (draftTimerRef.current) {
          clearTimeout(draftTimerRef.current)
          writeDraft(GROUP_DRAFT_KEY, draftValueRef.current)
        }
      }, [])
      const [presence, setPresence] = useState({})
      const [seats, setSeats] = useState([])
      const [pickerOpen, setPickerOpen] = useState(false)
      const [tab, setTab] = useState('group')
      // 切回群聊时给一次过场：从私聊/鱼塘回来，也是一整屏换掉，
      // 没有过场就像卡了一下（2026-11-12 他报"鱼塘→群聊会卡"）。
      const [tabSplash, setTabSplash] = useState(false)
      const tabSplashTimer = useRef(null)
      // 过场只盖信息流区域（2026-11-12 23:15 他要的）：量一下头部（标题 + tab 条）有多高，
      // 过场从那条线往下盖 —— 和"从外部进入鱼群"的过场范围一致，不盖头部和 tab 条。
      const headerRef = useRef(null)
      const [headerH, setHeaderH] = useState(0)
      useEffect(() => {
        const el = headerRef.current
        if (!el) return
        const measure = () => setHeaderH(el.getBoundingClientRect().height)
        measure()
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
        if (observer) observer.observe(el)
        window.addEventListener('resize', measure)
        return () => {
          if (observer) observer.disconnect()
          window.removeEventListener('resize', measure)
        }
      }, [])
      const switchTab = useCallback((key) => {
        if (key === tab) return
        if (key !== 'group') {
          flushGroupDraft()
          setTab(key)
          return
        }
        // 先把过场画出来（这一帧还是旧页面），下一帧再挂群聊内容。
        // 否则重列表和过场挤在同一帧里挂载，观感就是"先卡一下、动画再飞快过完"
        // —— 他 2026-11-12 22:53 报的正是这个。
        setTabSplash(true)
        if (tabSplashTimer.current) clearTimeout(tabSplashTimer.current)
        requestAnimationFrame(() => {
          setTab('group')
          tabSplashTimer.current = setTimeout(() => setTabSplash(false), 420)
        })
      }, [tab, flushGroupDraft])
      useEffect(() => () => { if (tabSplashTimer.current) clearTimeout(tabSplashTimer.current) }, [])
      // 从私聊/鱼塘切回来时，输入框是新建的：defaultValue 用的是页面挂载那一刻的草稿，
      // 之后再改、再删都不在它里面。按"现在存的那份"重放一次，删掉的草稿就不会回来
      // （2026-11-19 他报的 bug：删掉输入框、切去私聊、再回群聊，旧字又出现）。
      useEffect(() => {
        if (tab !== 'group') return
        const el = inputRef.current
        if (!el) return
        const stored = readDraft(GROUP_DRAFT_KEY)
        el.value = stored
        setHasText(stored.trim() !== '')
      }, [tab])

      const [unread, setUnread] = useState({ group: 0, dm: {}, total: 0 })
      // 群聊"上次看到哪儿"：进这一页时冻结一次，线不跟着新消息往下跑。
      const seenGroupRef = useRef(null)
      const [seenGroup, setSeenGroup] = useState('')
      // 第一次拿到消息之前先画占位，别让人看见"还没有人说话"闪一下再变成列表。
      const { visible: splash, done: splashDone } = useSplash(420)
      // 列宽是"这台机器上怎么看"，不属于她家的数据，存在浏览器里。
      const [widthPct, setWidthPct] = useState(() => {
        try {
          const saved = Number(window.localStorage?.getItem('dsh-lil-whale-group-width'))
          return Number.isFinite(saved) && saved >= 30 && saved <= 92 ? saved : 72
        } catch { return 72 }
      })
      const bottom = useRef(null)
      const scrollRef = useRef(null)
      const inputRef = useRef(null)
      // 消息多时的渲染窗口：只挂最近 N 条，往上翻再点「加载更早」（2026-11-15 他报 500 多条卡顿）。
      // 数据仍然一次拿全（后端不用动）；省的是「600 个气泡 + 每个气泡一次 markdown 解析」。
      const [renderLimit, setRenderLimit] = useState(120)
      // 翻历史时记住"眼睛在哪"：内容一变（新消息、渲染窗口挪动）就把 scrollTop 放回去。
      // 2026-11-16 报的闪烁：历史态收到新消息，视觉上先弹到底再弹回来。
      const historyTopRef = useRef(-1)
      // 平滑滚动的截止时刻：这段时间里浏览器自己在动 scrollTop，
      // 位置记录与"把眼睛放回去"都该让路，否则两边各推一把，会滚一半停住。
      const smoothScrollRef = useRef(0)
      const messagesLenRef = useRef(0)
      const pendingScrollRef = useRef(null)
      const pendingHistoryRef = useRef(null)
      const messagesSigRef = useRef('')
      const presenceSigRef = useRef('')
      const seatsSigRef = useRef('')
      // 发送后按内容重算高度（同 DmPage）。
      useEffect(() => { if (!GROW_BY_CSS) resetTextareaHeight(inputRef.current) }, [hasText])
      // "回到上次看到的位置"：群页刚打开时视角在底部，历史线在头顶上面。
      const dividerRef = useRef(null)
      const historyAboveRef = useRef(false)
      const historyVisitedRef = useRef(false)
      const [historyAbove, setHistoryAbove] = useState(false)
      // 线是不是在视口上方 —— 只回答这一件事，不回答"该不该显示"。
      const smoothTo = useCallback((el, top) => {
        const until = Date.now() + 1500
        smoothScrollRef.current = until
        el.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
        // 没有 scrollend 的浏览器（老版本）：到点自己收尾，别让"让路"一直开着。
        window.setTimeout(() => {
          if (smoothScrollRef.current !== until) return
          smoothScrollRef.current = 0
          historyTopRef.current = (el.scrollHeight - el.scrollTop - el.clientHeight > 40) ? el.scrollTop : -1
        }, 1600)
      }, [])
      const measureHistory = useCallback(() => {
        const el = scrollRef.current
        const line = dividerRef.current
        // 线在视口上方 = 上面还有没看过的。
        const lineAbove = Boolean(el && line && line.getBoundingClientRect().top < el.getBoundingClientRect().top + 4)
        // 点过一次就不再催：往下读时线会滑出视口上沿，以前会反复把提示亮出来（第 4 条）。
        // 贴底时也不催：人已经看见最新的了；2026-11-17 第 2 条就是新消息比视口高、
        // 分割线被顶出上沿，于是"回到历史未读"又亮起来。
        const next = lineAbove && !historyVisitedRef.current && !atBottomRef.current
        if (next !== historyAboveRef.current) {
          historyAboveRef.current = next
          setHistoryAbove(next)
        }
      }, [])
      const jumpToHistory = useCallback(() => {
        const el = scrollRef.current
        if (!el) return
        // 点过一次就当去过：这次往下读不该再被同一根线提醒。
        historyVisitedRef.current = true
        if (historyAboveRef.current) { historyAboveRef.current = false; setHistoryAbove(false) }
        const line = dividerRef.current
        if (line) {
          const top = line.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 8
          smoothTo(el, top)
          return
        }
        // 线不在当前窗口里（消息多、只挂了最近 N 条）：先把窗口扩到线那里，渲染完再滚。
        const seen = String(seenGroupRef.current ?? '')
        const idx = seen ? messages.findIndex((m) => String(m?.ts ?? '') > seen) : -1
        if (idx >= 0) {
          pendingHistoryRef.current = true
          setRenderLimit((n) => Math.max(n, messages.length - idx + 40))
          return
        }
        // 没有线（没有新消息）就跳到最早的一条：两种情况下这个按钮都得做事。
        smoothTo(el, 0)
      }, [messages])

      const refresh = useCallback(async () => {
        try {
          const response = await fetch('/group/api/messages', { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const data = await response.json()
          const incoming = Array.isArray(data.messages) ? data.messages : []
          // 内容没变就不 set：每 3 秒换一个新数组 = 让全部气泡重渲染一遍（窗口化之后是 120 个）。
          const sig = `${incoming.length}|${incoming.length ? String(incoming[incoming.length - 1]?.ts ?? '') : ''}`
          if (sig !== messagesSigRef.current) {
            messagesSigRef.current = sig
            const delta = incoming.length - messagesLenRef.current
            messagesLenRef.current = incoming.length
            // 人在翻历史时，新消息不能在下面直接挂上来把渲染窗口挤歪：
            // 窗口增量和消息放进同一批更新，避免"先少一条、再补回来"的一帧闪光。
            if (delta > 0 && !atBottomRef.current) setRenderLimit((n) => n + delta)
            setMessages(incoming)
          }
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
            const fresh = data?.members ?? {}
            const freshSig = JSON.stringify(fresh)
            if (freshSig !== presenceSigRef.current) {
              presenceSigRef.current = freshSig
              setPresence(fresh)
            }
          }
        } catch {
          // 存在感掉了就当没人说话，宁可安静
        }
        try {
          // 座位：名册里有几段会话就列几段，@ 面板据此多出「大肥鱼 · 开发」这种可选项
          const response = await fetch('/group/api/seats', { headers: { accept: 'application/json' } })
          if (response.ok) {
            const data = await response.json()
            if (Array.isArray(data?.seats)) {
              const seatsSig = JSON.stringify(data.seats)
              if (seatsSig !== seatsSigRef.current) {
                seatsSigRef.current = seatsSig
                setSeats(data.seats)
              }
            }
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

      useEffect(() => {
        void refresh()
        const timer = setInterval(() => { void refresh() }, 3000)
        return () => clearInterval(timer)
      }, [refresh])

      // 贴底 / 翻历史 / 回到底部：跟私聊页共用一套（见 useFollowTail）。
      const { atBottom, atBottomRef, measureBottom, jumpToBottom } = useFollowTail(scrollRef, [messages.length, tab, splash])

      // 贴底了就把"回到历史未读"收掉：人已经看见最新的了，留着只剩误导。
      // 2026-11-17 第 2 条：清完红点后来新消息，长消息把分割线顶出视口上沿，提示又亮。
      // 2026-11-19 第 3 条：贴底时提示消失、稍一上滑又出现——"到底"本身就是"已经见过这截"的证据，
      // 记进 historyVisitedRef；之后同一根线不再亮，等读完一批（markRead）才放行。
      useEffect(() => {
        if (!atBottom) return
        historyVisitedRef.current = true
        if (historyAboveRef.current) { historyAboveRef.current = false; setHistoryAbove(false) }
      }, [atBottom])

      // 「加载更早」之后保持眼睛原来的位置：上面新增了多少高度，就把滚动条往下推多少。
      useEffect(() => {
        const anchor = pendingScrollRef.current
        const el = scrollRef.current
        if (anchor && el) {
          pendingScrollRef.current = null
          const delta = el.scrollHeight - anchor.height
          if (delta > 0) el.scrollTop = anchor.top + delta
        }
        if (pendingHistoryRef.current) {
          pendingHistoryRef.current = null
          const line = dividerRef.current
          if (line && el) {
            const top = line.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 8
            smoothTo(el, top)
          }
        }
      }, [renderLimit])

      // 内容变化后把眼睛放回去：只在翻历史时动，贴底时不插手。
      // 用 layout effect：在浏览器绘制之前改 scrollTop，人才看不见那一下。
      useLayoutEffect(() => {
        const el = scrollRef.current
        // 「加载更早」「跳历史线」自带位置补偿，这里让路，免得两头各推一把。
        if (pendingScrollRef.current || pendingHistoryRef.current) return
        // 平滑滚动进行中：scrollTop 由浏览器接管，这里插手就会把它拽回来。
        if (Date.now() < smoothScrollRef.current) return
        if (atBottom || !el || historyTopRef.current < 0) return
        if (Math.abs(el.scrollTop - historyTopRef.current) > 1) el.scrollTop = historyTopRef.current
      }, [messages.length, renderLimit, atBottom])

      // 看过 1.5 秒才算读过：让红点有出现的余地，也不至于一闪就没。
      // 依赖里必须有 atBottom：翻历史回到底部的那一下才是"看见了"；
      // 以前少了它，读完了未读也不清（2026-11-15 第 5 条）。
      // 2026-11-19（Fabian 报"切走再回来红点又出现"）：两个坑补上——
      //   ①定时器被 clearTimeout 吞掉：1.5 秒内切走/离开页面，这次"读完"永远不会记；
      //   ②markRead 失败没人重试，而依赖不变，effect 不会再来一遍。
      const groupReadTimerRef = useRef(null)
      const finishGroupRead = useCallback(() => {
        groupReadTimerRef.current = null
        void markRead('group').then((ok) => {
          if (!ok) {
            // 服务端没记上：五秒后再来一次，别让"清不掉"沉成"以为清掉了"。
            groupReadTimerRef.current = setTimeout(finishGroupRead, 5000)
            return
          }
          historyVisitedRef.current = false
          // 读完一批后分割线会挪到新位置：立刻重量，别等下一次滚动。
          measureHistory()
          refresh()
          // 面板读完一批，喊一声；侧边栏红点不用等下一轮轮询。
          window.dispatchEvent(new Event('dsh-group-read'))
        })
      }, [refresh, measureHistory])
      useEffect(() => {
        if (tab !== 'group' || unread.group === 0 || !atBottom) return undefined
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return undefined
        const timer = setTimeout(finishGroupRead, 1500)
        groupReadTimerRef.current = timer
        return () => {
          // 切 tab / 离开页面：先把这次"读完"记上，再让定时器走开。
          clearTimeout(timer)
          if (groupReadTimerRef.current !== timer) return
          groupReadTimerRef.current = null
          void markRead('group')
        }
      }, [tab, unread.group, refresh, atBottom, finishGroupRead])
      // 翻历史时底下来了新消息：只数"最后一条之后新增了几条"，回到底部就清零。
      // 不用未读数（未读是服务器口径，可能包含别的窗口看过的，不能当"你还没看"的证据）。
      const lastSeenTsRef = useRef('')
      const [newBelow, setNewBelow] = useState(0)
      useEffect(() => {
        const last = messages.length > 0 ? String(messages[messages.length - 1]?.ts ?? '') : ''
        if (last === lastSeenTsRef.current) return
        const prev = lastSeenTsRef.current
        lastSeenTsRef.current = last
        if (prev === '' || tab !== 'group') return
        if (atBottom) return
        const delta = messages.filter((m) => String(m?.ts ?? '') > prev).length
        if (delta > 0) setNewBelow((current) => current + delta)
      }, [messages, atBottom, tab])
      useEffect(() => { if (atBottom) setNewBelow(0) }, [atBottom])
      // 线一旦挂上来就要立刻量：只靠 scroll 事件的话，进页面时的第一帧量不到。
      useEffect(() => {
        const el = scrollRef.current
        if (!el) return undefined
        const done = () => {
          smoothScrollRef.current = 0
          historyTopRef.current = (el.scrollHeight - el.scrollTop - el.clientHeight > 40) ? el.scrollTop : -1
        }
        el.addEventListener('scrollend', done)
        return () => el.removeEventListener('scrollend', done)
      }, [])

      useEffect(() => { measureHistory() })

      const persistWidth = useCallback(() => {
        setWidthPct((current) => {
          try { window.localStorage?.setItem('dsh-lil-whale-group-width', String(current)) } catch {}
          return current
        })
      }, [])
      const submit = useCallback(async () => {
        const rawValue = inputRef.current?.value ?? ''
        const value = rawValue.trim()
        if ((value === '' && pendingImages.length === 0) || sending) return
        setSending(true)
        try {
          // 图先落盘拿到 id/x/ext，消息里只记定位信息（字节不进 jsonl）。
          const images = []
          for (const dataUrl of pendingImages) {
            const uploaded = await fetch('/group/api/image', {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-llw-panel': '1' },
              body: JSON.stringify({ dataUrl }),
            })
            const result = await uploaded.json().catch(() => null)
            if (!uploaded.ok) throw new Error(result?.detail ?? `图片上传失败 HTTP ${uploaded.status}`)
            if (result?.image) images.push(result.image)
          }
          const { base, seat } = splitTarget(to)
          const endpoint = tab === 'dm' ? '/group/api/dm' : '/group/api/send'
          const body = tab === 'dm'
            ? { text: value, ...(images.length === 0 ? {} : { images }) }
            : {
              to: base, text: value,
              ...(seat === '' ? {} : { toSeat: seat }),
              ...(images.length === 0 ? {} : { images }),
            }
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-llw-panel': '1' },
            body: JSON.stringify(body),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          // 发送成功才清；而且只在"输入框里还是刚才发出去的那段"时才清——
          // 上传大图时要等几秒，这几秒里用户可能已经在打下一句了（2026-11-15 r151）。
          const stillSame = (inputRef.current?.value ?? '') === rawValue
          if (stillSame) {
            if (inputRef.current) inputRef.current.value = ''
            // 2026-11-16（第二条鱼报）：打完字 300ms 内就发送时，草稿防抖定时器还挂着；
            // 不清掉它，它会在发送成功之后把刚发出去的正文又写回草稿 —— 重进面板就是一条幽灵草稿。
            if (draftTimerRef.current) { clearTimeout(draftTimerRef.current); draftTimerRef.current = null }
            draftValueRef.current = ''
            setHasText(false)
            writeDraft(GROUP_DRAFT_KEY, '')
          } else {
            setHasText((inputRef.current?.value ?? '').trim() !== '')
          }
          setPendingImages([])
          await refresh()
        } catch (e) {
          // 发失败别把人刚打的字吞掉：输入框空着时把原文放回去（草稿已经按输入存过了）。
          if (inputRef.current && !inputRef.current.value) {
            if (draftTimerRef.current) { clearTimeout(draftTimerRef.current); draftTimerRef.current = null }
            draftValueRef.current = rawValue
            inputRef.current.value = rawValue
            setHasText(rawValue.trim() !== '')
            writeDraft(GROUP_DRAFT_KEY, rawValue)
          }
          setError(String(e?.message ?? e))
        } finally {
          setSending(false)
        }
      }, [to, sending, refresh, tab, pendingImages.length])

      // 两档忙：正在回这一段 / 在别处忙。群聊与私聊同一套文案。
      // 名单从配置（名册）来 —— 写死 lee/whale 时，新鱼的"正在忙"永远不会显示（A.32 同一个病）。
      const fishIds = Object.keys(config?.names ?? NAMES).filter((id) => id !== (config?.humanId ?? 'fabian'))
      const groupBusy = fishIds.filter((id) => {
        const state = presenceOf(presence, id)
        return state.status === 'working' && state.reason === 'group'
      })
      const otherBusy = fishIds.filter((id) => {
        const state = presenceOf(presence, id)
        return state.status === 'working' && state.reason !== 'group'
      })
      const typingLine = groupBusy.length
        ? t.typing(groupBusy.map((id) => nameOf(config, id)).join('、'))
        : otherBusy.length
          ? t.busy(otherBusy.map((id) => nameOf(config, id)).join('、'))
          : null

      // 打字时不该重排两百多条气泡（2026-11-13 他报"连续快速输入/删除会卡"）。
      // 列表只跟消息、分割线、宽度、配置有关；输入框里的文字不是它的输入。
      // 只渲染最近 N 条：500+ 条时，600 个气泡每 3 秒重排一次就是卡顿的来源。
      const visibleStart = Math.max(0, messages.length - renderLimit)
      // 打字时不能重新切片：slice 每次都是新数组，会让下面的 useMemo 依赖每帧都变，
      // 等于每敲一个字就重建一遍气泡元素树（2026-11-15 第二轮：他报快速输入仍卡）。
      const visibleMessages = useMemo(
        () => (visibleStart > 0 ? messages.slice(visibleStart) : messages),
        [messages, visibleStart],
      )
      const loadEarlier = useCallback(() => {
        const el = scrollRef.current
        if (el) pendingScrollRef.current = { height: el.scrollHeight, top: el.scrollTop }
        setRenderLimit((n) => n + 120)
      }, [])
      // r207：未完整安装时不装成正常聊天——服务端 /group/api/config 带 installState，
      // 这里据它显示一块安装指引（空壳面板是最容易被误当成"装坏了"的状态）。
      const installIncomplete = Boolean(config?.installState && config.installState.ok === false)
      const installBanner = installIncomplete
        ? h('div', {
            style: {
              margin: '10px 12px 0', padding: '10px 12px', boxSizing: 'border-box',
              border: '0.5px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12))',
              borderRadius: 'var(--dsw-radius-md, 8px)',
              background: 'var(--dsw-alias-bg-l2, rgba(0,0,0,0.03))',
              fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)',
            },
          },
            h('div', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary)', marginBottom: 4 } }, '这个鱼塘还没装完整'),
            h('div', null, '缺：' + (((config.installState.missing || []).join('、')) || '安装步骤')),
            h('div', { style: { marginTop: 4, wordBreak: 'break-all' } }, config.installState.hint || '按 README 跑一遍 scripts\\install.ps1'),
          )
        : null

      const groupListNode = useMemo(
        () => {
          const nodes = withDivider(visibleMessages, seenGroup, (message, index) => h(Bubble, {
            // key 用"在整条消息里的绝对位置"：渲染窗口往前挪时，一条消息的 key 不该变。
            // 以前用窗口内序号，新消息一来 visibleStart 动一下，120 个气泡全重挂一遍。
            key: `${message.ts}-${visibleStart + index}`,
            config,
            message,
            animate: animateRef.current,
            onMention: mentionTo,
            citePrefix: '群',
          }), dividerRef)
          if (visibleStart === 0) return nodes
          const earlier = h(
            'div',
            { key: 'load-earlier', style: { display: 'flex', justifyContent: 'center', padding: '6px 0 10px' } },
            h('button', {
              onClick: loadEarlier,
              style: {
                height: 28, padding: '0 12px', borderRadius: 999,
                border: '0.5px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12))',
                background: 'var(--dsw-alias-bg-layer-3, rgba(0,0,0,0.04))',
                color: 'var(--dsw-alias-label-secondary, rgba(0,0,0,0.6))',
                fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
              },
            }, `加载更早的 ${Math.min(120, visibleStart)} 条（还有 ${visibleStart} 条）`),
          )
          return [earlier, ...nodes]
        },
        [visibleMessages, visibleStart, seenGroup, config, widthPct, mentionTo, loadEarlier],
      )

      return h('div', {
        // position:relative 是给"切回群聊"的过场用的：过场要盖住整页，
        // 且要在群聊内容挂载之前先画出来（见 switchTab）。
        style: { ...baseStyle, display: 'flex', flexDirection: 'column', position: 'relative' },
      },
        h('div', {
          ref: headerRef,
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
            [{ key: 'group', label: '群聊' }, { key: 'dm', label: '私聊' }, { key: 'pond', label: '鱼塘' }].map((item) => {
              const active = tab === item.key
              return h('button', {
                key: item.key,
                onClick: () => switchTab(item.key),
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
                  // 2026-11-19：以前"在群聊且贴底"就把计数藏起来，看着像清了；
                  // 切到别的页又照实显示。现在只信服务端给的数，"清了"就等于真清了。
                  ? (unread.group > 0 ? item.label + ' (' + unread.group + ')' : item.label)
                  : item.key === 'dm'
                    ? (dmTotal(unread) > 0 ? item.label + ' (' + dmTotal(unread) + ')' : item.label)
                    : item.label,
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
        // 切回群聊的过场：挂在页根上，所以旧 tab 还在时也能先画出来。
        tabSplash
          ? h('div', { style: { position: 'absolute', left: 0, right: 0, top: headerH, bottom: 0, zIndex: 30 } }, h(LoadingSplash, { label: '正在打开群聊…' }))
          : null,
        tab === 'dm'
          ? h(DmPage, { config, presence })
          : tab === 'pond'
            ? h(PondPage, { embedded: true })
            : h(React.Fragment, null, installBanner,
        h('div', {
          style: { flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' },
        },
        h('div', {
          ref: scrollRef,
          onScroll: () => {
            const el = scrollRef.current
            if (el) {
              // 平滑滚动进行中：这几帧的 scrollTop 是半路值，记下来会把目标位置带偏。
              if (Date.now() >= smoothScrollRef.current) {
                historyTopRef.current = (el.scrollHeight - el.scrollTop - el.clientHeight > 40) ? el.scrollTop : -1
              }
            }
            measureBottom()
            measureHistory()
          },
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
              groupListNode,
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
          // 过场页：盖住"从空到有"的那一下，以及从别的 tab 切回群聊的那一下
          splash ? h(LoadingSplash, { label: '正在打开群聊…' }) : null,
          // 回到上次看到的位置：线在视口上方时才出现（刚进来、或往下翻过头了）
          historyAbove ? h(JumpToHistory, {
            onClick: jumpToHistory,
            rightInset: `calc(${(100 - widthPct) / 2}% + 10px)`,
            hint: '回到历史未读',
          }) : null,
          // 回到底部：翻历史时才出现；和上面那个向上的按钮是一对
          atBottom ? null : h(JumpToBottom, {
            onClick: jumpToBottom,
            rightInset: `calc(${(100 - widthPct) / 2}% + 10px)`,
            hint: newBelow > 0 ? '底部有了新消息' : null,
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
              pendingImages.length > 0
                ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                  ...pendingImages.map((src, index) => h('div', { key: `pending-${index}`, style: { position: 'relative' } },
                    h('img', {
                      src,
                      alt: '待发送的图片',
                      style: { maxHeight: 72, maxWidth: 120, borderRadius: 8, display: 'block' },
                    }),
                    h('button', {
                      onClick: () => setPendingImages((current) => current.filter((_, i) => i !== index)),
                      title: '去掉这张图',
                      style: {
                        position: 'absolute', top: -6, right: -6,
                        width: 20, height: 20, borderRadius: '50%', border: 'none',
                        background: 'rgba(0,0,0,0.72)', color: '#fff', fontSize: 13, lineHeight: 1,
                        padding: 0, cursor: 'pointer', display: 'grid', placeItems: 'center',
                      },
                    }, '×'))),
                  h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } },
                    imageBusy ? '读取中…' : '发出去就进群，删不掉'))
                : null,
              h('textarea', {
                ref: inputRef,
                defaultValue: initialTextRef.current,
                onChange: (event) => { if (!GROW_BY_CSS) growTextarea(event.currentTarget) },
                onInput: (event) => {
                  const value = event.currentTarget.value
                  // 只有「空 ↔ 非空」变了才 setState；同值时 React 自己会跳过。
                  setHasText(value.trim() !== '')
                  saveDraftSoon(value)
                },
                onCompositionStart: () => { composingRef.current = true },
                onCompositionEnd: (event) => {
                  composingRef.current = false
                  writeDraft(GROUP_DRAFT_KEY, event.currentTarget.value)
                },
                onPaste: (event) => {
                  const items = event.clipboardData?.items
                  if (!items) return
                  for (const item of Array.from(items)) {
                    if (item.kind === 'file' && /^image\//.test(item.type)) {
                      event.preventDefault()
                      void attachImages(item.getAsFile())
                      return
                    }
                  }
                },
                onDragOver: (event) => {
                  if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) event.preventDefault()
                },
                onDrop: (event) => {
                  const files = event.dataTransfer?.files
                  if (!files || files.length === 0) return
                  event.preventDefault()
                  void attachImages(files)
                },
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && event.shiftKey) {
                    event.preventDefault()
                    const ta = event.currentTarget
                    const start = ta.selectionStart ?? ta.value.length
                    const end = ta.selectionEnd ?? start
                    ta.value = `${ta.value.slice(0, start)}\n${ta.value.slice(end)}`
                    ta.selectionStart = ta.selectionEnd = start + 1
                    setHasText(ta.value.trim() !== '')
                    saveDraftSoon(ta.value)
                    return
                  }
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
                  minHeight: 44, maxHeight: 220, fieldSizing: 'content',
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
                  multiple: true,
                  style: { display: 'none' },
                  onChange: (event) => {
                    const files = event.target.files
                    event.target.value = ''
                    void attachImages(files)
                  },
                }),
                h('div', { style: { flex: 1, fontSize: 11, color: 'var(--dsw-alias-label-caption)' } },
                  to === 'all' ? t.groupOnly : t.toOne(targetName(config, to))),
                h('button', {
                  onClick: () => { void submit() },
                  disabled: sending || (!hasText && pendingImages.length === 0),
                  title: t.send,
                  style: {
                    flex: '0 0 32px', width: 32, height: 32, padding: 0, border: 'none',
                    background: 'transparent', position: 'relative',
                    cursor: sending || (!hasText && pendingImages.length === 0) ? 'not-allowed' : 'pointer',
                    opacity: sending || (!hasText && pendingImages.length === 0) ? 0.4 : 1,
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

    /** 设置页：侧边栏名称 / 三个头像。（显示名不在这里改：A.82） */
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

      // 版本：进设置页先读当前版本；「检查更新」是显式动作（要联网，不自动跑）。
      const [versions, setVersions] = useState(null)
      const [updateState, setUpdateState] = useState(null)
      const [updateBusy, setUpdateBusy] = useState(false)
      useEffect(() => {
        void loadVersions()
          .then((data) => setVersions(data))
          .catch(() => setVersions({ error: '连不上宿主，读不到版本' }))
      }, [])
      const runCheckUpdate = () => {
        setUpdateBusy(true)
        void checkUpdates()
          .then((data) => setUpdateState(data))
          .catch((error) => setUpdateState({ error: String(error?.message ?? error) }))
          .finally(() => setUpdateBusy(false))
      }

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
            headers: { 'content-type': 'application/json', 'x-llw-panel': '1' },
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
          headers: { 'content-type': 'application/json', 'x-llw-panel': '1' },
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
            h(ComposingTextInput, {
              value: config.panelLabel ?? '',
              limit: 12,
              onCommit: (text) => patch((next) => { next.panelLabel = text }),
              style: inputStyle,
            }),
          ),
        ),

        // 名字 / 头像讲的是同一件事：这一位在群里长什么样。
        // （座位名那一组 2026-11-12 拿掉了：椅子已撤，界面不该再留一个空的入口。）
        h(SettingsSection, { title: '成员', hint: '名字是她的称呼，只能由她自己改——让她在会话里调 rename。这里只改头像。' },
          Object.keys(config?.names ?? NAMES).map((member, index) => {
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
                h('span', { style: { fontSize: 14, color: 'var(--dsw-alias-label-primary)' } },
                  config.names?.[member] ?? NAMES[member] ?? member),
              ),

              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, paddingLeft: 42, flexWrap: 'wrap' } },
                h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', width: 48, flex: '0 0 auto' } }, '头像'),
                h(ComposingTextInput, {
                  value: avatar.text,
                  limit: 2,
                  title: '文字 1–2 个（也可以是 emoji）',
                  onCommit: (text) => patch((next) => {
                    next.avatars = { ...(next.avatars ?? {}) }
                    next.avatars[member] = { ...(next.avatars?.[member] ?? {}), text }
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

        h(SettingsSection, { title: '版本', hint: '两个包必须一起装：宿主 + 面板。版本也一起看。' },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' } },
            h('div', { style: { flex: 1, minWidth: 220, fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-primary)' } },
              versionLineOf(updateState ?? versions)),
            h('button', {
              onClick: runCheckUpdate,
              disabled: updateBusy,
              style: { ...smallBtnStyle, opacity: updateBusy ? 0.6 : 1 },
            }, updateBusy ? '检查中…' : '检查更新'),
          ),
          updateState?.checkedAt
            ? h('div', { style: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', marginTop: 6 } },
                `检查时间：${String(updateState.checkedAt).replace('T', ' ').slice(0, 19)}`)
            : null,
        ),

          h('div', { style: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', marginTop: 6 } },
            '查的是 GitHub Releases；npm 上只有两块 bundle，安装与更新请走仓库。'),
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
        // 面板里读完一批会喊一声：红点立刻消失，不必等下一轮轮询（第 5 条）。
        const onRead = () => { void tick() }
        window.addEventListener('dsh-group-read', onRead)
        return () => { alive = false; clearInterval(timer); window.removeEventListener('dsh-group-read', onRead) }
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

    // ---------- 鱼塘：开关鱼的一页（2026-11-12 晚） ----------
    //
    // 只做四件事：看谁醒着（端口开没开）、全部唤醒、全部休眠、逐条鱼开关。
    // 「检修」= 先跑一遍 doctor 再尝试唤醒，体检结果贴在页面底部 ——
    // 鱼死了的时候，最需要的往往不是再点一次启动，而是先知道她哪儿不对；
    // 起不来时不关窗口，报错留在页面里（他 2026-11-12 22:53 定的口径）。
    //
    // 巡守那条（role=watcher，就是你现在看的这个 3080）不给按钮：关掉它等于把
    // 正在看的这扇窗自己拔了。页面里会写清楚为什么。
    const POND_POLL_MS = 4000

    /** 面板上的时间戳：今天只写"今天 HH:MM"，更早写"月日 HH:MM"。与聊天那套 formatStamp 同一套口径。 */
    const pondStamp = (iso) => {
      const date = new Date(iso ?? '')
      if (Number.isNaN(date.getTime())) return ''
      const pad = (n) => String(n).padStart(2, '0')
      const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
      const now = new Date()
      const sameDay = date.getFullYear() === now.getFullYear()
        && date.getMonth() === now.getMonth()
        && date.getDate() === now.getDate()
      return sameDay ? `今天 ${clock}` : `${date.getMonth() + 1}月${date.getDate()}日 ${clock}`
    }

    const POND = {
      title: '鱼塘',
      subtitle: '看谁醒着，也在这里开关。',
      polling: '每 4 秒看一次',
      allUp: '全部唤醒',
      allDown: '全部休眠',
      up: '唤醒',
      maintain: '检修',
      restore: '回无人值守',
      modeLabel: '模式',
      modeUnattended: '无人值守',
      modeWindow: '开着窗',
      modeUnknown: '模式未知',
      maintainHint: '先休眠，再开一扇窗让你看；看完关窗，再点「回无人值守」',
      restoreHint: '关掉那个控制台窗，然后无窗起（会话由 host 挂上）',
      windowHint: '检修中：日志在刚开的控制台窗里；看完关窗，再点「回无人值守」。',
      upRunning: '已经在跑。要换模式先「休眠」，再「唤醒」或「检修」。',
      downHint: '停掉这条鱼的进程（会话会退到磁盘上）',
      downClosed: '本来就没开',
      openClosed: '没开，没有可打开的窗口',
      openAlready: '窗已经开着（检修中）',
      openBlockedShort: '无人值守：先休眠，再打开',
      upHint: '无窗起，会话由 host 自己挂上（无人值守）',
      down: '休眠',
      open: '打开 WebUI',
      pending: '处理中…',
      pendingHint: '正在执行（比如检修要先停再起，中间有十几秒没有进程）。等命令行起来，这中间不要点别的。',
      // 睡觉（2026-11-14，PRD A.73）：她自己决定睡，家长能强行叫醒。
      wake: '叫醒',
      wakeHint: '她自己在睡。叫醒会让她醒到本窗结束（记 pool\\state\\sleep.log）。',
      sleepDnd: '勿扰',
      sleepActive: '活跃',
      sleepHint: '她自己设的作息；群/私聊不会叫醒她，计划到点也不叫。',
      wakeForced: '上次被叫醒',
      wakeForcedHint: '家长在鱼塘面板或命令行叫醒过她。只留痕、不打扰；记录在她自己的状态文件 pool\state\sleep\<键>.json 的 lastForced。',
      sleepUnknown: '',
      openHint: '在新标签页打开她的 WebUI。只是看，不会多出一个 writer；无人值守时也能开。',
      openBlocked: '',
      running: '在跑',
      stopped: '没开',
      port: '端口',
      heartbeat: '心跳',
      heartbeatAgo: (minutes) => (minutes < 1 ? '刚刚' : `${minutes} 分钟前`),
      noHeartbeat: '没有记录',
      heartbeatStopped: '没在跑',
      lastRun: '起停账',
      selfHint: '这是你自己所在的窗口，不能从这里操作',
      confirmAllDown: '让所有鱼休眠？巡守那条（这个窗口）不会动。',
      busy: '正在动作…',
      result: '最近一次动作',
      empty: '名册里还没有鱼。',
      roleWatcher: '巡守',
      roleMember: '成员',
      demoOn: '看一个大家族的示例',
      demoOff: '回到真实鱼塘',
      demoHint: '谱系示例：模拟的名册，不会启动或关闭任何进程。',
      autoStartLabel: '起主 dsh 时把鱼也带起来',
      autoStartHint: '下次启动主 dsh 生效：巡守起来 8 秒后按名册逐条唤醒，不开浏览器窗。关掉＝只起巡守（空鱼塘，调试用）——鱼活不过主进程，没有「鱼自己单独活着」这个选项。',
      autoStartFailed: '开关没保存：',
      generation: (n) => (n <= 0 ? '根' : `第 ${n} 代`),
      modeText: (mode) => {
        const value = mode?.mode ?? null
        if (value === 'unattended') return POND.modeUnattended
        if (value === 'window') return POND.modeWindow
        return POND.modeUnknown
      },
    }

    // 谱系示例的数据。渲染走的就是下面同一套卡片与同一套排序，不是另捏一个界面。
    const POND_DEMO_FISH = [
      { key: 'lee', name: '大肥鱼', role: 'watcher', port: 3080, portOpen: true, bornAt: '2026-11-08T00:00:00+08:00', heartbeatAgeMs: 8000, canManage: false, lastRun: { ts: '22:58:12', event: 'started', raw: 'started pid=9520' } },
      { key: 'whale', name: '小肥鱼', role: 'member', port: 3082, portOpen: true, bornAt: '2026-11-08T23:32:00+08:00', heartbeatAgeMs: 42000, canManage: true, lastRun: { ts: '22:58:24', event: 'started', raw: 'started pid=22664' } },
      { key: 'fishball', name: '小鱼丸', role: 'member', port: 3083, portOpen: true, bornAt: '2026-11-12T18:40:00+08:00', heartbeatAgeMs: 95000, canManage: true, lastRun: { ts: '22:58:31', event: 'started', raw: 'started pid=22112' } },
      { key: 'shell', name: '小贝壳', role: 'member', port: 3084, portOpen: false, bornAt: '2026-11-18T09:10:00+08:00', heartbeatAgeMs: null, canManage: true },
      { key: 'star', name: '小海星', role: 'member', port: 3085, portOpen: false, bornAt: '2026-11-24T20:05:00+08:00', heartbeatAgeMs: null, canManage: true },
      { key: 'scale', name: '小鳞', role: 'member', port: 3086, portOpen: true, bornAt: '2026-11-29T08:30:00+08:00', heartbeatAgeMs: 130000, canManage: true, lastRun: { ts: '22:41:03', event: 'started', raw: 'started pid=31844' } },
      { key: 'tide', name: '小汐', role: 'member', port: 3087, portOpen: true, bornAt: '2026-11-30T21:00:00+08:00', heartbeatAgeMs: 240000, canManage: true },
      { key: 'algae', name: '小藻', role: 'member', port: 3088, portOpen: false, bornAt: '2026-12-02T11:20:00+08:00', heartbeatAgeMs: null, canManage: true },
      { key: 'bubble', name: '小泡', role: 'member', port: 3089, portOpen: true, bornAt: '2026-12-04T19:45:00+08:00', heartbeatAgeMs: 60000, canManage: true },
      { key: 'sand', name: '小砂', role: 'member', port: 3090, portOpen: false, bornAt: '2026-12-06T07:15:00+08:00', heartbeatAgeMs: null, canManage: true },
      { key: 'fin', name: '小鳍', role: 'member', port: 3091, portOpen: true, bornAt: '2026-12-09T10:00:00+08:00', heartbeatAgeMs: 310000, canManage: true },
      { key: 'tail', name: '小尾', role: 'member', port: 3092, portOpen: false, bornAt: '2026-12-11T16:40:00+08:00', heartbeatAgeMs: null, canManage: true },
      { key: 'moss', name: '小苔', role: 'member', port: 3093, portOpen: true, bornAt: '2026-12-13T09:05:00+08:00', heartbeatAgeMs: 55000, canManage: true },
      { key: 'bean', name: '小豆', role: 'member', port: 3094, portOpen: false, bornAt: '2026-12-15T22:30:00+08:00', heartbeatAgeMs: null, canManage: true },
      { key: 'foam', name: '小沫', role: 'member', port: 3095, portOpen: true, bornAt: '2026-12-17T12:00:00+08:00', heartbeatAgeMs: 190000, canManage: true },
      { key: 'feather', name: '小羽', role: 'member', port: 3096, portOpen: true, bornAt: '2026-12-20T08:20:00+08:00', heartbeatAgeMs: 72000, canManage: true },
      { key: 'glimmer', name: '小光', role: 'member', port: 3097, portOpen: false, bornAt: '2026-12-22T21:10:00+08:00', heartbeatAgeMs: null, canManage: true },
      { key: 'dew', name: '小露', role: 'member', port: 3098, portOpen: true, bornAt: '2026-12-25T06:45:00+08:00', heartbeatAgeMs: 260000, canManage: true },
    ]

    // 谱系示例里"谁是谁的子代"：树只按 parent 画，代数由树的深度算——
    // 不再存第二份 generation（示例里小豆写错过一次：父代第 1 代、标签却写第 3 代）。
    const POND_DEMO_PARENT = {
      lee: null,
      whale: 'lee', fishball: 'lee', shell: 'lee', star: 'lee',
      scale: 'whale', tide: 'whale',
      algae: 'fishball', bubble: 'fishball', sand: 'fishball',
      fin: 'scale', tail: 'scale', moss: 'tide', bean: 'fishball', foam: 'bubble',
      feather: 'moss', glimmer: 'moss', dew: 'fin',
    }
    for (const item of POND_DEMO_FISH) item.parent = POND_DEMO_PARENT[item.key] ?? null

    function pondChip(text) {
      return h(
        'span',
        {
          style: {
            fontSize: 12,
            lineHeight: '18px',
            padding: '2px 8px',
            borderRadius: 999,
            background: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.04))',
            color: 'var(--dsw-alias-label-secondary, #6b7076)',
            whiteSpace: 'nowrap',
          },
        },
        text,
      )
    }

    function pondButtonStyle(primary) {
      return {
        height: 28,
        padding: '0 12px',
        boxSizing: 'border-box',
        borderRadius: 'var(--dsw-radius-md, 8px)',
        fontSize: 12,
        fontWeight: 500,
        fontFamily: 'inherit',
        cursor: 'pointer',
        // 2026-11-16（宿主报的深色模式 bug）：以前底色用 brand-primary、文字写死 #fff——
        // 深色下 brand-primary 会变浅，于是白底白字。改成官方按钮那一对：
        // 底 var(--dsw-alias-button-primary-fill)，字 var(--dsw-alias-label-primary-foreground)。
        border: `0.5px solid ${primary ? 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #4d6bfe))' : 'var(--dsw-alias-border-l2, rgba(0,0,0,0.12))'}`,
        background: primary ? 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #4d6bfe))' : 'transparent',
        color: primary ? 'var(--dsw-alias-label-primary-foreground, #fff)' : 'var(--dsw-alias-label-primary, inherit)',
        transition: 'opacity .15s ease',
      }
    }

    function PondDot({ on }) {
      return h('svg', { width: 8, height: 8, viewBox: '0 0 8 8', 'aria-hidden': 'true', style: { flex: '0 0 auto' } },
        h('circle', {
          cx: 4, cy: 4, r: 3.2,
          fill: on ? 'var(--dsw-alias-label-success, #3fa45b)' : 'var(--dsw-alias-label-tertiary, #b8bcc4)',
        }),
      )
    }

    /** 鱼塘的记号：几条水波纹（他 22:53 说这枚好看，别换成别的）。 */
    function PondMark({ size = 18 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true',
        style: { flex: '0 0 auto', color: 'var(--dsw-alias-label-secondary, #6b7280)' },
      },
        h('path', { d: 'M1.8 4.9c1.3-1.5 2.6-1.5 3.9 0s2.6 1.5 3.9 0 2.6-1.5 3.9 0', stroke: 'currentColor', strokeWidth: 1.25, strokeLinecap: 'round' }),
        h('path', { d: 'M1.8 8c1.3-1.5 2.6-1.5 3.9 0s2.6 1.5 3.9 0 2.6-1.5 3.9 0', stroke: 'currentColor', strokeWidth: 1.25, strokeLinecap: 'round', opacity: 0.7 }),
        h('path', { d: 'M1.8 11.1c1.3-1.5 2.6-1.5 3.9 0s2.6 1.5 3.9 0 2.6-1.5 3.9 0', stroke: 'currentColor', strokeWidth: 1.25, strokeLinecap: 'round', opacity: 0.42 }),
      )
    }

    function PondPage(props) {
      const embedded = props?.embedded === true
      const [status, setStatus] = useState(null)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(null)
      const [openBusy, setOpenBusy] = useState(null)
      const [result, setResult] = useState(null)
      const [demo, setDemo] = useState(false)
      const [autoStart, setAutoStart] = useState(false)

      const load = useCallback(async () => {
        try {
          const response = await fetch('/pond/api/status', { headers: { accept: 'application/json' } })
          const data = await response.json()
          if (!response.ok || data?.ok === false) throw new Error(data?.detail || data?.error || `HTTP ${response.status}`)
          setStatus(data)
          setError(null)
        } catch (e) {
          setError(String(e?.message ?? e))
        }
      }, [])

      useEffect(() => {
        void load()
        const timer = setInterval(() => {
          void load()
        }, POND_POLL_MS)
        return () => clearInterval(timer)
      }, [load])

      // 自启动开关：读一次、改一次。改完下次启动主 dsh 生效。
      useEffect(() => {
        fetch('/pond/api/settings', { headers: { accept: 'application/json' } })
          .then((response) => response.json())
          .then((data) => {
            if (data?.settings) setAutoStart(data.settings.autoStartFish === true)
          })
          .catch(() => {})
      }, [])

      const toggleAutoStart = useCallback(async (next) => {
        setAutoStart(next)
        try {
          const response = await fetch('/pond/api/settings', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-llw-panel': '1' },
            body: JSON.stringify({ autoStartFish: next }),
          })
          const data = await response.json()
          if (!response.ok) throw new Error(data?.detail || data?.error || `HTTP ${response.status}`)
          setAutoStart(data?.settings?.autoStartFish === true)
        } catch (e) {
          setAutoStart(!next)
          setError(POND.autoStartFailed + String(e?.message ?? e))
        }
      }, [])

      const act = useCallback(
        async (action, key) => {
          const label = key ? `${action}:${key}` : action
          setBusy(label)
          setError(null)
          try {
            const response = await fetch('/pond/api/action', {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-llw-panel': '1' },
              body: JSON.stringify({ action, key }),
            })
            const data = await response.json()
            setResult({
              action,
              key,
              ok: response.ok && data?.ok !== false,
              output: data?.output || data?.hint || data?.error || '',
              at: Date.now(),
            })
            if (!response.ok) throw new Error(data?.hint || data?.error || `HTTP ${response.status}`)
            await load()
          } catch (e) {
            setError(String(e?.message ?? e))
          } finally {
            setBusy(null)
          }
        },
        [load],
      )

      const openFish = useCallback(async (key) => {
        // 2026-11-14 23:15（Fabian）：无人值守也能开 —— 浏览器里的 WebUI 只是"看"，写手还是那个进程，
        // 不会多出一个 writer。旧版这里拦 unattended，结果"打开"永远点不动。
        setOpenBusy(key)
        try {
          const response = await fetch(`/pond/api/url?key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } })
          const data = await response.json()
          if (!response.ok || !data?.url) throw new Error(data?.error || `HTTP ${response.status}`)
          window.open(data.url, '_blank', 'noopener')
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          setOpenBusy(null)
        }
      }, [])

      const liveFish = status?.fish ?? []
      const fish = demo ? POND_DEMO_FISH : liveFish
      const running = demo
        ? POND_DEMO_FISH.filter((item) => item.portOpen).length
        : (status?.summary?.running ?? 0)
      const total = demo ? POND_DEMO_FISH.length : (status?.summary?.total ?? 0)
      const busyAny = busy !== null

      // 谱系树（2026-11-12 23:15 他要的）：像文件树那样，子代挂在父代下面，
      // 用缩进 + 左侧竖线表达"这是谁的子代"，而不是只按代分组。
      // parent 指向名册里不存在的键（或自己指自己）时当根处理，防止坏数据画出环。
      const tree = useMemo(() => {
        const byKey = new Map(fish.map((item) => [item.key, item]))
        const childrenOf = new Map()
        const roots = []
        for (const item of fish) {
          const parent = item.parent && item.parent !== item.key && byKey.has(item.parent) ? item.parent : null
          if (parent === null) {
            roots.push(item)
          } else {
            if (!childrenOf.has(parent)) childrenOf.set(parent, [])
            childrenOf.get(parent).push(item)
          }
        }
        const byBirth = (a, b) => {
          const at = Date.parse(a.bornAt ?? '')
          const bt = Date.parse(b.bornAt ?? '')
          const aOk = Number.isFinite(at)
          const bOk = Number.isFinite(bt)
          if (aOk && bOk && at !== bt) return at - bt
          if (aOk !== bOk) return aOk ? -1 : 1
          return String(a.key).localeCompare(String(b.key))
        }
        roots.sort(byBirth)
        for (const list of childrenOf.values()) list.sort(byBirth)
        return { roots, childrenOf, byKey }
      }, [fish])

      // 一条鱼 = 一张卡 + 它自己的子代（递归）。seen 防环，depth 兜底。
      const nodeOf = (item, depth, seen) => {
        if (seen.has(item.key) || depth > 12) return null
        const nextSeen = new Set(seen)
        nextSeen.add(item.key)
        const kids = tree.childrenOf.get(item.key) ?? []
        const parentItem = item.parent ? tree.byKey.get(item.parent) ?? null : null
        return h(
          'div',
          { key: item.key, style: { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'stretch', minWidth: 0 } },
            depth > 0
              ? h(
                'div',
                { style: { flex: '0 0 16px', position: 'relative' }, 'aria-hidden': 'true' },
                h('div', {
                  style: {
                    position: 'absolute', left: 7, top: 0, bottom: 0, width: 1,
                    background: 'var(--dsw-alias-border-l2, rgba(0,0,0,0.1))',
                  },
                }),
                h('div', {
                  style: {
                    position: 'absolute', left: 7, top: 26, width: 9, height: 1,
                    background: 'var(--dsw-alias-border-l2, rgba(0,0,0,0.1))',
                  },
                }),
              )
              : null,
            h('div', { style: { flex: '0 1 auto', minWidth: 0, maxWidth: '100%' } }, card(item, parentItem, depth)),
          ),
          kids.length
            ? h(
              'div',
              {
                style: {
                  display: 'flex', flexDirection: 'column', gap: 8,
                  marginLeft: 7, paddingLeft: 9,
                  borderLeft: '0.5px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06))',
                },
              },
              kids.map((kid) => nodeOf(kid, depth + 1, nextSeen)),
            )
            : null,
        )
      }

      const card = (item, parentItem, depth) => {
        const self = item.canManage === false
        const hb = item.heartbeatAgeMs
        // 停了的鱼：心跳文件还留着最后一次的值，不能显示成"刚刚"（他 2026-11-13 12:09 报的）。
        const hbText = !item.portOpen
          ? POND.heartbeatStopped
          : hb === null || hb === undefined ? POND.noHeartbeat : POND.heartbeatAgo(Math.floor(hb / 60000))
        return h(
          'div',
          {
            key: item.key,
            style: {
              border: '0.5px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1))',
              borderRadius: 'var(--dsw-radius-lg, 12px)',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              background: 'var(--dsw-alias-bg-layer-1, #fff)',
              opacity: self ? 0.9 : 1,
              // 2026-11-13 他要求：卡片只包住内部文字，不占满整行。
              width: 'fit-content',
              maxWidth: '100%',
            },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
            h(PondDot, { on: item.portOpen }),
            h('span', {
              style: {
                fontSize: 14, fontWeight: 600, lineHeight: '20px',
                color: 'var(--dsw-alias-label-primary, inherit)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              },
            }, item.name),
            h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary, #8a8f98)' } }, item.key),
            Number.isInteger(depth) && depth > 0
              ? h('span', {
                style: {
                  fontSize: 11, lineHeight: '16px', padding: '0 6px', borderRadius: 999,
                  color: 'var(--dsw-alias-label-tertiary, #8a8f98)',
                  background: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.04))',
                  whiteSpace: 'nowrap',
                },
              }, POND.generation(depth))
              : null,
            h(
              'span',
              {
                style: {
                  marginLeft: 'auto', fontSize: 11, lineHeight: '16px', padding: '0 6px', borderRadius: 999,
                  border: '0.5px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12))',
                  color: 'var(--dsw-alias-label-secondary, #8a8f98)',
                  whiteSpace: 'nowrap',
                },
              },
              item.role === 'watcher' ? POND.roleWatcher : POND.roleMember,
            ),
          ),
          h(
            'div',
            {
              style: {
                fontSize: 12, lineHeight: '18px',
                color: 'var(--dsw-alias-label-secondary, #6b7076)',
                display: 'flex', gap: 14, flexWrap: 'wrap',
              },
            },
            h('span', null, `${POND.port} ${item.port ?? '—'}`),
            h('span', null, item.portOpen ? POND.running : POND.stopped),
            h('span', null, `${POND.heartbeat} ${hbText}`),
            h('span', { title: item.mode?.at ?? '' }, `${POND.modeLabel} ${POND.modeText(item.mode)}`),
            item.sleep
              ? h(
                'span',
                { style: { color: item.sleep.sleeping ? 'var(--dsw-alias-brand-primary, #4c8dff)' : 'inherit' }, title: POND.sleepHint },
                item.sleep.sleeping
                  ? `${POND.sleepDnd}${item.sleep.label ? ` · ${item.sleep.label}` : ''}`
                  : POND.sleepActive,
              )
              : null,
            item.sleep?.lastForced?.at
              ? h(
                'span',
                {
                  title: POND.wakeForcedHint,
                  style: { color: 'var(--dsw-alias-label-secondary, #6b7076)' },
                },
                `${POND.wakeForced} ${pondStamp(item.sleep.lastForced.at)}`,
              )
              : null,
            parentItem ? h('span', null, `家长 ${parentItem.name}`) : null,
          ),
          item.lastRun
            ? h(
              'div',
              {
                style: {
                  fontSize: 11, lineHeight: '16px',
                  color: 'var(--dsw-alias-label-tertiary, #8a8f98)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                },
                title: item.lastRun.raw,
              },
              `${POND.lastRun}：${item.lastRun.ts} ${item.lastRun.event}`,
            )
            : null,
          self
            ? h('div', { style: { fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary, #8a8f98)' } }, POND.selfHint)
            : (() => {
              const running = !!item.portOpen
              const windowMode = item.mode?.mode === 'window'
              const busyThis = busyAny
              const sleeping = !!item.sleep?.sleeping
              // 动作在飞的时候不要露"唤醒"（他 2026-11-14 23:23 的观察）：
              // 检修是先停再起，中间有十几秒"进程不在"，卡片会短暂显示只有「唤醒」——
              // 用户此时什么都不该点，只需要等命令行起来。所以执行期间只画一个灰着的「处理中…」。
              const pendingThis = busy !== null && (
                busy === `up:${item.key}` || busy === `maintain:${item.key}`
                || busy === `restore:${item.key}` || busy === `down:${item.key}`
                || busy === `wake:${item.key}` || busy === 'up-all' || busy === 'down-all'
              )
              // 只画当下能点的按钮（他 2026-11-14 23:15 的第②条要求）：
              // 一个永远灰着的按钮，和一个坏了的按钮，在纸上长得一样 —— 不该出现的就别画。
              const buttons = []
              if (pendingThis) {
                buttons.push(h(
                  'button',
                  { disabled: true, style: pondButtonStyle(false), title: POND.pendingHint },
                  POND.pending,
                ))
              } else if (!running) {
                buttons.push(h(
                  'button',
                  { onClick: () => act('up', item.key), disabled: busyThis, style: pondButtonStyle(true), title: POND.upHint },
                  busy === `up:${item.key}` ? '…' : POND.up,
                ))
              } else {
                buttons.push(h(
                  'button',
                  { onClick: () => openFish(item.key), disabled: openBusy === item.key, style: pondButtonStyle(false), title: POND.openHint },
                  openBusy === item.key ? '…' : POND.open,
                ))
                buttons.push(windowMode
                  ? h(
                    'button',
                    { onClick: () => act('restore', item.key), disabled: busyThis, style: pondButtonStyle(false), title: POND.restoreHint },
                    busy === `restore:${item.key}` ? '…' : POND.restore,
                  )
                  : h(
                    'button',
                    { onClick: () => act('maintain', item.key), disabled: busyThis, style: pondButtonStyle(false), title: POND.maintainHint },
                    busy === `maintain:${item.key}` ? '…' : POND.maintain,
                  ))
                if (sleeping) {
                  buttons.push(h(
                    'button',
                    { onClick: () => act('wake', item.key), disabled: busyThis, style: pondButtonStyle(false), title: POND.wakeHint },
                    busy === `wake:${item.key}` ? '…' : POND.wake,
                  ))
                }
                buttons.push(h(
                  'button',
                  { onClick: () => act('down', item.key), disabled: busyThis, style: pondButtonStyle(false), title: POND.downHint },
                  busy === `down:${item.key}` ? '…' : POND.down,
                ))
              }
              return h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2 } },
                h(
                  'div',
                  { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
                  ...buttons,
                ),
                windowMode
                  ? h('div', { style: { fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary, #8a8f98)' } }, POND.windowHint)
                  : null,
              )
            })(),
        )
      }

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 12, padding: embedded ? '12px 20px 24px' : '4px 20px 24px', minHeight: 0, flex: 1, overflowY: 'auto' } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h(PondMark, { size: 20 }),
          h('div', { style: { fontSize: 14, fontWeight: 600, marginRight: 2 } }, POND.title),
          pondChip(`${running} / ${total} 在跑`),
          pondChip(error && !demo ? '连不上本机服务' : POND.polling),
          h('div', { style: { display: 'flex', gap: 8 } },
            h(
              'button',
              { onClick: () => act('up-all'), disabled: busyAny || demo, style: pondButtonStyle(true) },
              busy === 'up-all' ? POND.busy : POND.allUp,
            ),
            h(
              'button',
              {
                onClick: () => {
                  if (window.confirm(POND.confirmAllDown)) void act('down-all')
                },
                disabled: busyAny || demo,
                style: pondButtonStyle(false),
              },
              busy === 'down-all' ? POND.busy : POND.allDown,
            ),
          ),
          h(
            'button',
            { onClick: () => setDemo((value) => !value), style: pondButtonStyle(false) },
            demo ? POND.demoOff : POND.demoOn,
          ),
          h(
            'label',
            {
              title: POND.autoStartHint,
              style: {
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 12, color: 'var(--dsw-alias-label-secondary, #6b7076)',
                cursor: 'pointer', whiteSpace: 'nowrap',
              },
            },
            h('input', {
              type: 'checkbox',
              checked: autoStart,
              disabled: demo,
              onChange: (event) => { void toggleAutoStart(event.target.checked) },
            }),
            POND.autoStartLabel,
          ),
        ),
        demo
          ? h('div', { style: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary, #8a8f98)' } }, POND.demoHint)
          : null,
        error && !demo
          ? h(
            'div',
            {
              style: {
                fontSize: 12, lineHeight: '18px', padding: '6px 10px',
                borderRadius: 'var(--dsw-radius-md, 8px)',
                border: '0.5px solid var(--dsw-alias-label-error, #e5484d)',
                color: 'var(--dsw-alias-label-error, #c93c40)',
              },
            },
            error,
          )
          : null,
        fish.length === 0
          ? h('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary, #8a8f98)' } }, POND.empty)
          : null,
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          tree.roots.map((item) => nodeOf(item, 0, new Set())),
        ),
        result
          ? h(
            'div',
            {
              style: {
                border: '0.5px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1))',
                borderRadius: 'var(--dsw-radius-lg, 12px)',
                padding: '10px 12px',
                display: 'flex', flexDirection: 'column', gap: 6,
                background: 'var(--dsw-alias-bg-layer-1, #fff)',
              },
            },
            h(
              'div',
              { style: { fontSize: 12, lineHeight: '18px', fontWeight: 600 } },
              `${POND.result} · ${result.action}${result.key ? ` · ${result.key}` : ''} · ${result.ok ? '成功' : '没成功'}`,
            ),
            h(
              'pre',
              {
                style: {
                  margin: 0, fontSize: 11, lineHeight: 1.5,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  maxHeight: 220, overflow: 'auto',
                  color: 'var(--dsw-alias-label-secondary, #6b7076)',
                },
              },
              result.output || '（没有输出）',
            ),
          )
          : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 一行"我跑的是哪一版"的自报，方便判断浏览器是不是还在用旧 bundle
        console.info('[dsh-lil-whale-group-ui] client build v56 · update-source-github:', Object.keys(MARKDOWN_LABELS).join(','))
        // 「正在回复…」那三个点的呼吸动画 + 过场转圈。只在浏览器里注入一次。
        if (typeof document !== 'undefined' && !document.getElementById('dsh-lil-whale-group-keyframes')) {
          const style = document.createElement('style')
          style.id = 'dsh-lil-whale-group-keyframes'
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
