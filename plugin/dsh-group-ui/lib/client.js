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
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const PANEL_ID = 'group'
    const SETTINGS_ID = 'lil-whale'

    // 宽度：两侧各留 4% 页边距，再宽就压到边框上了
    const WIDTH_MIN = 30
    const WIDTH_MAX = 92

    // 显示名兜底（真正的值在 ui-config.json 的 names 里，可在设置里改）
    const NAMES = { lee: '大肥鱼', whale: '小肥鱼', fabian: 'Fabian' }

    const DEFAULT_CONFIG = {
      panelLabel: '鱼群',
      contentWidth: 72,
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

    /** 一条消息：左边是别人，右边是自己。 */
    function Bubble({ config, message, onMention }) {
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
          display: 'flex', gap: 10, padding: '10px 16px',
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
              padding: '8px 12px', borderRadius: 12,
              background: mine
                ? 'var(--dsw-alias-bg-layer-3, rgba(0,0,0,0.06))'
                : 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.03))',
              border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.08))',
              fontSize: 14, lineHeight: 1.6,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            },
          }, message.text),
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
      return h('div', {
        onPointerDown: (event) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture?.(event.pointerId)
          start.current = {
            x: event.clientX,
            spanPx: containerRef?.current?.clientWidth ?? window.innerWidth,
            startPct: width,
          }
        },
        onPointerMove: (event) => {
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
          onCommit?.()
        },
        onPointerCancel: () => {
          start.current = null
          onCommit?.()
        },
        title: '拖动调整宽度',
        style: {
          position: 'absolute', top: 0, bottom: 0, width: 14,
          [side]: -7, cursor: 'col-resize', touchAction: 'none',
        },
      })
    }

    /** "@ 谁" 的小面板：一行一个成员，头像 + 名字。点「所有人」= 不指定对象。 */
    function AtPicker({ config, current, onPick, onClose }) {
      const rows = [
        { id: 'all', label: t.toAll, plain: true },
        { id: 'lee', label: nameOf(config, 'lee') },
        { id: 'whale', label: nameOf(config, 'whale') },
      ]
      return h('div', {
        onMouseLeave: onClose,
        style: {
          position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, zIndex: 20,
          minWidth: 180, padding: 6, borderRadius: 12,
          background: 'var(--dsw-alias-bg-layer-1, #fff)',
          border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12))',
          boxShadow: '0 8px 28px rgba(0,0,0,0.18)',
        },
      }, rows.map((row) => {
        const active = (current || 'all') === row.id
        return h('button', {
          key: row.id,
          onClick: () => onPick(row.id),
          onMouseDown: (event) => event.preventDefault(),
          style: {
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            padding: '7px 8px', border: 'none', borderRadius: 8,
            background: active ? 'var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06))' : 'transparent',
            color: 'var(--dsw-alias-label-primary)',
            font: 'inherit', fontSize: 13, cursor: 'pointer', textAlign: 'left',
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

    /** 主面板：群聊。 */
    function GroupPage() {
      const [config, setConfig] = useState(DEFAULT_CONFIG)
      const [messages, setMessages] = useState([])
      const [text, setText] = useState('')
      const [to, setTo] = useState('all')
      const [error, setError] = useState(null)
      const [sending, setSending] = useState(false)
      const [presence, setPresence] = useState({})
      const [pickerOpen, setPickerOpen] = useState(false)
      const [widthPct, setWidthPct] = useState(DEFAULT_CONFIG.contentWidth)
      const bottom = useRef(null)
      const scrollRef = useRef(null)

      const refresh = useCallback(async () => {
        try {
          const response = await fetch('/group/api/messages', { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const data = await response.json()
          setMessages(Array.isArray(data.messages) ? data.messages : [])
          setError(null)
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
      }, [])

      useEffect(() => {
        void loadConfig().then((value) => {
          setConfig(value)
          if (typeof value?.contentWidth === 'number') setWidthPct(value.contentWidth)
        })
      }, [])

      useEffect(() => {
        void refresh()
        const timer = setInterval(() => { void refresh() }, 3000)
        return () => clearInterval(timer)
      }, [refresh])

      useEffect(() => {
        bottom.current?.scrollIntoView({ block: 'end' })
      }, [messages.length])

      const persistWidth = useCallback(async () => {
        try {
          const next = { ...(cachedConfig ?? DEFAULT_CONFIG), contentWidth: Math.round(widthPct) }
          await saveConfig(next)
        } catch {
          // 宽度不是数据，存不上就下次再说
        }
      }, [widthPct])

      const submit = useCallback(async () => {
        const value = text.trim()
        if (value === '' || sending) return
        setSending(true)
        try {
          const response = await fetch('/group/api/send', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ to, text: value }),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          setText('')
          await refresh()
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          setSending(false)
        }
      }, [text, to, sending, refresh])

      const busy = ['lee', 'whale'].filter((id) => presence?.[id] === 'working')
      const typingLine = busy.length
        ? t.typing(busy.map((id) => nameOf(config, id)).join('、'))
        : null

      return h('div', {
        style: { ...baseStyle, display: 'flex', flexDirection: 'column' },
      },
        h('div', {
          style: {
            padding: '16px 20px 12px',
            borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1))',
          },
        },
          h('div', { style: { fontSize: 16, fontWeight: 600 } }, config.panelLabel || t.title),
          error
            ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-error, #c0392b)', marginTop: 4 } }, error)
            : null,
        ),
        h('div', {
          ref: scrollRef,
          style: { flex: 1, overflowY: 'auto', padding: '8px 0', minHeight: 0, position: 'relative' },
        },
          messages.length === 0
            ? h('div', {
              style: {
                height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--dsw-alias-label-tertiary)', fontSize: 13,
              },
            }, t.empty)
            : h('div', {
              style: { width: `${widthPct}%`, margin: '0 auto', position: 'relative' },
            },
              messages.map((message, index) => h(Bubble, {
                key: `${message.ts}-${index}`,
                config,
                message,
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
          style: {
            borderTop: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1))',
            padding: '10px 0 14px',
          },
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
                        border: 'none', background: 'transparent', cursor: 'pointer',
                        color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, lineHeight: 1, padding: 2,
                      },
                    }, '×'))),
              h('textarea', {
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
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                h('button', {
                  onClick: () => setPickerOpen((open) => !open),
                  title: '指定说话对象',
                  style: {
                    width: 28, height: 28, borderRadius: '50%', flex: '0 0 auto',
                    border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12))',
                    background: pickerOpen ? 'var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06))' : 'transparent',
                    color: 'var(--dsw-alias-label-secondary)',
                    cursor: 'pointer', fontSize: 13, lineHeight: 1,
                  },
                }, '@'),
                h('div', { style: { flex: 1, fontSize: 11, color: 'var(--dsw-alias-label-caption)' } },
                  to === 'all' ? t.groupOnly : t.toOne(nameOf(config, to))),
                h('button', {
                  onClick: () => { void submit() },
                  disabled: sending || text.trim() === '',
                  title: t.send,
                  style: {
                    width: 32, height: 32, borderRadius: '50%', flex: '0 0 auto',
                    border: 'none',
                    background: 'var(--dsw-alias-brand-primary, #4a7dbd)',
                    color: 'var(--dsw-alias-label-primary-foreground, #fff)',
                    cursor: sending || text.trim() === '' ? 'not-allowed' : 'pointer',
                    opacity: sending || text.trim() === '' ? 0.4 : 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'opacity 120ms ease',
                  },
                }, h('svg', {
                  width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
                  stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
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
      )
    }

    /** 设置页：侧边栏名称 / 三个头像 / 三个显示名。 */
    function SettingsPage() {
      const [config, setConfig] = useState(DEFAULT_CONFIG)
      const [status, setStatus] = useState('')
      const [saving, setSaving] = useState(false)

      useEffect(() => {
        void loadConfig(true).then(setConfig)
      }, [])

      const patch = (mutator) => {
        setConfig((prev) => {
          const next = { ...prev }
          mutator(next)
          return next
        })
      }

      const save = async () => {
        setSaving(true)
        setStatus('')
        try {
          await saveConfig(config)
          setStatus('已保存。侧边栏名称要刷新页面才变。')
        } catch (e) {
          setStatus(`保存失败：${String(e?.message ?? e)}`)
        } finally {
          setSaving(false)
        }
      }

      const rowStyle = { display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }
      const inputStyle = {
        flex: 1, minWidth: 0, padding: '6px 8px', borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12))',
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: 13,
      }

      return h('div', { style: { ...baseStyle, padding: '4px 2px' } },
        h('div', { style: { fontSize: 15, fontWeight: 600 } }, t.settingsTitle),
        h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', marginTop: 4 } }, t.settingsHint),

        h('div', { style: { ...rowStyle, marginTop: 16 } },
          h('span', { style: { width: 84, fontSize: 13 } }, '侧边栏名称'),
          h('input', {
            value: config.panelLabel ?? '',
            maxLength: 12,
            onChange: (event) => patch((next) => { next.panelLabel = event.target.value }),
            style: inputStyle,
          }),
        ),

        h('div', { style: { marginTop: 18, fontSize: 13, fontWeight: 600 } }, '名字'),
        h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', marginTop: 4, lineHeight: 1.7 } },
          '仅修改显示效果，无法修改 ta 的自我认知。若想让 ta 改名请试着直接和 ta 聊聊？'),
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

        h('div', { style: { marginTop: 18, fontSize: 13, fontWeight: 600 } }, '头像'),
        h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', marginTop: 4 } },
          '文字 1–2 个（也可以是 emoji），颜色是底色。'),
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
            style: { width: 36, height: 28, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' },
          }),
          h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, nameOf(config, member)),
        )),

        h('div', { style: { ...rowStyle, marginTop: 18 } },
          h('button', {
            onClick: () => { void save() },
            disabled: saving,
            style: {
              padding: '6px 14px', borderRadius: 8, border: 'none',
              background: 'var(--dsw-alias-brand-primary, #4a7dbd)',
              color: 'var(--dsw-alias-label-primary-foreground, #fff)',
              fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.6 : 1,
            },
          }, saving ? '保存中…' : '保存'),
          status
            ? h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, status)
            : null,
        ),
      )
    }

    /** 侧边栏图标：一个对话气泡。 */
    function GroupIcon({ size = 18 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
      },
        h('path', { d: 'M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z' }),
        h('path', { d: 'M5.5 6.5h5' }),
        h('path', { d: 'M5.5 8.5h3' }),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 「正在回复…」那三个点的呼吸动画。只在浏览器里注入一次。
        if (typeof document !== 'undefined' && !document.getElementById('dsh-group-keyframes')) {
          const style = document.createElement('style')
          style.id = 'dsh-group-keyframes'
          style.textContent = '@keyframes dshGroupPulse{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-1px)}}'
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
