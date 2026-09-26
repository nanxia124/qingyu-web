import { useState, useRef, useEffect, useCallback, Fragment } from 'react'
import { Send, Plus, Copy, Square, Trash2, MessageSquare, ChevronLeft, ChevronRight, RefreshCw, Volume2, VolumeX, ArrowDown, Download, RotateCcw, Globe, User, Thermometer, Settings } from 'lucide-react'
import { App, Tooltip, Switch, Dropdown } from 'antd'
import { ConfirmPopover } from '@/components/ConfirmPopover'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { SpeechInputButton } from '@/components/speech-input-button'
import { ModelPicker } from '@canvas/components/model-picker'
import { useConfigStore } from '@canvas/stores/use-config-store'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  status?: 'completed' | 'aborted' | 'failed' | 'streaming'
  tokensIn?: number
  tokensOut?: number
  createdAt?: string
}

interface Conversation {
  id: string
  title: string
  updatedAt: string
}

const PRESET_ROLES = [
  { key: 'default', label: '默认', systemPrompt: '' },
  { key: 'coder', label: '代码助手', systemPrompt: '你是一个资深全栈工程师。回答时给出可运行代码并用 markdown 代码块包裹，解释关键部分。' },
  { key: 'writer', label: '写作搭档', systemPrompt: '你是一个专业写作助手，帮用户润色文字、改写文案、起草文章，语气自然。' },
  { key: 'translator', label: '翻译官', systemPrompt: '你是一个专业翻译。中文翻英文，其他语言翻中文，只输出翻译结果。' },
  { key: 'interviewer', label: '面试模拟', systemPrompt: '你是技术面试官，每次只问一个问题，等用户回答后再评价并问下一个。' },
]

// 聊天页本地偏好设置（存在浏览器 localStorage，不登录也记住）
const CHAT_SETTINGS_KEY = 'chat-settings-v1'
interface ChatSettings {
  enterToSend: boolean      // true=Enter 发送；false=Ctrl/Cmd+Enter 发送
  autoScroll: boolean       // 新消息来时自动滚到底
  clearAfterSend: boolean   // 发送后清空输入框
}
const defaultChatSettings: ChatSettings = { enterToSend: true, autoScroll: true, clearAfterSend: true }
function loadChatSettings(): ChatSettings {
  try {
    const raw = localStorage.getItem(CHAT_SETTINGS_KEY)
    return raw ? { ...defaultChatSettings, ...JSON.parse(raw) } : defaultChatSettings
  } catch { return defaultChatSettings }
}

// 把 ISO 时间戳转成"今天/昨天/M月D日"，用于消息列表按天分组
function dayLabel(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const today = new Date()
  const yest = new Date(); yest.setDate(today.getDate() - 1)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, today)) return '今天'
  if (sameDay(d, yest)) return '昨天'
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export default function ChatPage() {
  const { message } = App.useApp()
  const config = useConfigStore((s) => s.config)

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [model, setModel] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [showScrollBottom, setShowScrollBottom] = useState(false)
  const [role, setRole] = useState('default')
  const [temperature, setTemperature] = useState(0.7)
  const [webSearch, setWebSearch] = useState(false)
  const [chatSettings, setChatSettings] = useState<ChatSettings>(loadChatSettings)

  const updateChatSettings = (patch: Partial<ChatSettings>) => {
    setChatSettings((prev) => {
      const next = { ...prev, ...patch }
      try { localStorage.setItem(CHAT_SETTINGS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const isAtBottomRef = useRef(true)

  // 输入框自动增高
  useEffect(() => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 160) + 'px'
    }
  }, [input])

  // 自动滚动到底部（受"自动跟随新消息"开关控制）
  useEffect(() => {
    if (chatSettings.autoScroll && isAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, chatSettings.autoScroll])

  // 加载历史对话列表
  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/conversations', { credentials: 'include' })
      if (!res.ok) return
      const data = await res.json()
      setConversations(data.conversations || [])
    } catch { /* 未登录或网络错误，静默 */ }
  }, [])

  useEffect(() => { loadConversations() }, [loadConversations])

  // 切换对话时加载消息
  const selectConversation = useCallback(async (convId: string) => {
    if (convId === activeConvId) return
    // 切走时，如果当前还是没发过消息的临时对话，直接删掉
    if (activeConvId && activeConvId.startsWith('temp-')) {
      setConversations((list) => list.filter((c) => c.id !== activeConvId))
    }
    setActiveConvId(convId)
    setLoadingHistory(true)
    try {
      const res = await fetch(`/api/chat/conversations/${convId}/messages`, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setMessages((data.messages || []).map((m: any) => ({
          id: m.id, role: m.role, content: m.content,
          status: m.status, tokensIn: m.tokensIn, tokensOut: m.tokensOut, createdAt: m.createdAt,
        })))
      }
    } catch { /* ignore */ } finally { setLoadingHistory(false) }
  }, [activeConvId])

  // 新建对话
  const newConversation = () => {
    // 如果当前还有没发过消息的临时对话，先清掉
    if (activeConvId && activeConvId.startsWith('temp-')) {
      setConversations((list) => list.filter((c) => c.id !== activeConvId))
    }
    const tempId = `temp-${Date.now()}`
    setConversations((list) => [{ id: tempId, title: '', updatedAt: new Date().toISOString() }, ...list])
    setActiveConvId(tempId)
    setMessages([])
    setInput('')
  }

  // 删除对话
  // 临时对话：直接前端删，不弹确认
  const deleteTempConversation = (convId: string) => {
    setConversations((list) => list.filter((c) => c.id !== convId))
    if (activeConvId === convId) {
      setActiveConvId(null)
      setMessages([])
    }
  }

  // 正式对话：调后端删
  const deleteRealConversation = async (convId: string) => {
    try {
      await fetch(`/api/chat/conversations/${convId}`, { method: 'DELETE', credentials: 'include' })
      message.success('已删除')
      setConversations((list) => list.filter((c) => c.id !== convId))
      if (activeConvId === convId) newConversation()
    } catch { message.error('删除失败') }
  }

  // 滚动监听
  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    isAtBottomRef.current = atBottom
    setShowScrollBottom(!atBottom && el.scrollHeight > el.clientHeight + 200)
  }

  const scrollToBottom = () => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }

  // 发送消息（流式）
  const send = async () => {
    const text = input.trim()
    if (!text || sending) return

    // 1. 如果是临时对话 id，先建一个真正的后端对话
    let convId = activeConvId
    if (convId && convId.startsWith('temp-')) {
      try {
        const res = await fetch('/api/chat/conversations', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || '建对话失败')
        }
        const conv = await res.json()
        convId = conv.id
        setActiveConvId(convId)
        const tempId = activeConvId
        setConversations((list) => list.map((c) => c.id === tempId ? { id: conv.id, title: conv.title, updatedAt: conv.updatedAt } : c))
      } catch (e: any) {
        message.error(e.message || '建对话失败')
        return
      }
    }

    // 2. 把用户消息加进去
    const nowIso = new Date().toISOString()
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: text, createdAt: nowIso }
    const aiMsg: ChatMessage = { id: `a-${Date.now()}`, role: 'assistant', content: '', status: 'streaming', createdAt: nowIso }
    setMessages((m) => [...m, userMsg, aiMsg])
    if (chatSettings.clearAfterSend) setInput('')
    setSending(true)
    isAtBottomRef.current = true

    // 3. 构造发给上游的 messages（包含历史 + 角色 system prompt）
    const rolePrompt = PRESET_ROLES.find(r => r.key === role)?.systemPrompt
    const historyForApi = [
      ...(rolePrompt ? [{ role: 'system', content: rolePrompt }] : []),
      ...messages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ]

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/proxy/openai/v1/chat/completions', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: historyForApi, stream: true, temperature }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `请求失败 (${res.status})`)
      }

      // 4. 读 SSE 流
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let fullText = ''
      let buffer = ''
      let tokensIn = 0
      let tokensOut = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const data = trimmed.slice(5).trim()
          if (data === '[DONE]') continue
          try {
            const json = JSON.parse(data)
            const delta = json.choices?.[0]?.delta?.content || ''
            if (delta) {
              fullText += delta
              setMessages((msgs) => msgs.map((m) => m.id === aiMsg.id ? { ...m, content: fullText } : m))
            }
            if (json.usage) {
              tokensIn = json.usage.prompt_tokens || 0
              tokensOut = json.usage.completion_tokens || 0
            }
          } catch { /* 不完整的 chunk，跳过 */ }
        }
      }

      // 5. 流结束，保存两条消息到后端
      setMessages((msgs) => msgs.map((m) => m.id === aiMsg.id ? { ...m, status: 'completed', tokensIn, tokensOut } : m))
      try {
        await fetch(`/api/chat/conversations/${convId}/messages`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'user', content: userMsg.content }),
        })
        await fetch(`/api/chat/conversations/${convId}/messages`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'assistant', content: fullText, status: 'completed', tokensIn, tokensOut }),
        })
        loadConversations()
      } catch { /* 保存失败不影响用户看到结果 */ }

      // 第一条消息后自动生成标题
      if (messages.filter(m => m.role === 'user').length === 0) {
        autoTitle(convId, text)
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setMessages((msgs) => msgs.map((m) => m.id === aiMsg.id ? { ...m, status: 'aborted' } : m))
      } else {
        setMessages((msgs) => msgs.map((m) => m.id === aiMsg.id ? { ...m, status: 'failed', content: m.content || (e.message || '发送失败') } : m))
        message.error(e.message || '发送失败')
      }
    } finally {
      setSending(false)
      abortRef.current = null
    }
  }

  // 停止生成
  const stop = () => { abortRef.current?.abort() }

  // 自动生成对话标题
  const autoTitle = async (convId: string, firstUserText: string) => {
    try {
      const res = await fetch('/api/proxy/openai/v1/chat/completions', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, stream: false,
          messages: [
            { role: 'system', content: '用不超过15个字给下面这段话起一个对话标题，只输出标题本身。' },
            { role: 'user', content: firstUserText.slice(0, 200) },
          ],
        }),
      })
      if (!res.ok) return
      const data = await res.json()
      const title = data.choices?.[0]?.message?.content?.trim().slice(0, 40)
      if (title) {
        await fetch(`/api/chat/conversations/${convId}`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        })
        loadConversations()
      }
    } catch { /* 标题生成失败不影响主流程 */ }
  }

  // 失败重试：删掉失败消息和对应的 user 消息，重新发
  const retryFailed = (failedMsgId: string) => {
    if (sending) return
    const idx = messages.findIndex(m => m.id === failedMsgId)
    if (idx < 0) return
    let userIdx = idx - 1
    while (userIdx >= 0 && messages[userIdx].role !== 'user') userIdx--
    if (userIdx < 0) return
    const userContent = messages[userIdx].content
    setMessages(messages.slice(0, userIdx))
    setTimeout(() => send(), 100)
    // send 用的是 input，需要把 userContent 塞进去
    setInput(userContent)
  }

  // 导出对话为 Markdown
  const exportConversation = () => {
    if (!messages.length) { message.info('还没有对话内容'); return }
    const title = conversations.find(c => c.id === activeConvId)?.title || '对话'
    let md = `# ${title}\n\n`
    for (const m of messages) {
      if (m.status === 'streaming' || m.status === 'failed') continue
      md += m.role === 'user' ? `## 我\n\n${m.content}\n\n` : `## AI\n\n${m.content}\n\n`
    }
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title}.md`
    a.click()
    URL.revokeObjectURL(url)
    message.success('已导出')
  }
  // 重新生成：找到最后一条用户消息，去掉它之后的内容，重新发
  const regenerate = async () => {
    if (sending || messages.length < 2) return
    let lastUserIdx = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { lastUserIdx = i; break }
    }
    if (lastUserIdx < 0) return
    const userContent = messages[lastUserIdx].content
    setMessages(messages.slice(0, lastUserIdx))
    setInput(userContent)
    setTimeout(() => send(), 100)
  }

  const copyMessage = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      message.success('已复制')
    } catch { message.error('复制失败') }
  }

  // 组件卸载时停止朗读
  useEffect(() => {
    return () => { try { speechSynthesis.cancel() } catch { /* ignore */ } }
  }, [])

  // TTS 朗读 / 停止
  const toggleSpeak = (msg: ChatMessage) => {
    if (!('speechSynthesis' in window)) {
      message.warning('当前浏览器不支持语音朗读')
      return
    }
    if (speakingId === msg.id) {
      speechSynthesis.cancel()
      setSpeakingId(null)
      return
    }
    speechSynthesis.cancel()
    const utter = new SpeechSynthesisUtterance(msg.content)
    utter.lang = 'zh-CN'
    utter.onend = () => setSpeakingId((cur) => (cur === msg.id ? null : cur))
    utter.onerror = () => setSpeakingId((cur) => (cur === msg.id ? null : cur))
    setSpeakingId(msg.id)
    speechSynthesis.speak(utter)
  }

  const hasMessages = messages.length > 0

  return (
    <div className="flex h-full bg-bg">
      {/* 左侧历史栏 */}
      <div className={cn(
        'shrink-0 flex flex-col transition-all duration-200',
        sidebarOpen ? 'w-[260px]' : 'w-0 overflow-hidden'
      )}>
        <div className="h-full flex flex-col bg-card/40">
          <div className="p-3">
            <Tooltip title="新建对话">
              <button
                onClick={newConversation}
                className="flex size-9 items-center justify-center rounded-lg bg-card text-text hover:bg-surface-hover transition-colors"
              >
                <Plus className="size-4" />
              </button>
            </Tooltip>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-3">
            {conversations.length === 0 ? (
              <p className="px-3 py-4 text-[12px] text-text-muted">还没有历史对话</p>
            ) : conversations.map((c) => {
              const isTemp = c.id.startsWith('temp-')
              return (
              <div
                key={c.id}
                onClick={() => selectConversation(c.id)}
                className={cn(
                  'group mb-1 flex cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-[13px] transition-colors',
                  c.id === activeConvId ? 'bg-surface-hover text-text-active' : isTemp ? 'bg-card text-text-muted hover:bg-surface-hover' : 'bg-card text-text-secondary hover:bg-surface-hover'
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <MessageSquare className="size-3.5 shrink-0 opacity-60" />
                  <span className="truncate">{c.title || '新对话'}</span>
                </div>
                {isTemp ? (
                  <button
                    onClick={() => deleteTempConversation(c.id)}
                    className="shrink-0 opacity-0 group-hover:opacity-100 text-text-muted hover:text-danger transition-opacity"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                ) : (
                  <ConfirmPopover
                    title="删除这个对话？"
                    confirmText="删除"
                    onConfirm={() => deleteRealConversation(c.id)}
                    className="shrink-0 opacity-0 group-hover:opacity-100"
                  >
                    <button className="flex text-text-muted hover:text-danger transition-opacity">
                      <Trash2 className="size-3.5" />
                    </button>
                  </ConfirmPopover>
                )}
              </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* 主区域 */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* 顶栏 */}
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="flex size-8 items-center justify-center rounded-lg text-text-muted hover:bg-surface-hover hover:text-text-active transition-colors"
          >
            {sidebarOpen ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
          {hasMessages && (
            <Tooltip title="导出对话">
              <button onClick={exportConversation}
                className="ml-2 flex size-8 items-center justify-center rounded-lg text-text-muted hover:bg-surface-hover hover:text-text-active transition-colors">
                <Download className="size-4" />
              </button>
            </Tooltip>
          )}
          <div className="flex items-center gap-3">
            <ModelPicker config={config} value={model} onChange={setModel} capability="text" />
            <Dropdown
              trigger={['click']}
              placement="bottomRight"
              dropdownRender={() => (
                <div className="min-w-[230px] rounded-xl bg-card p-3 shadow-xl">
                  <div className="mb-1 text-[13px] font-medium text-text-active">聊天设置</div>
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-[13px] text-text-secondary">Enter 发送</span>
                    <Switch size="small" checked={chatSettings.enterToSend} onChange={(v) => updateChatSettings({ enterToSend: v })} />
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-[13px] text-text-secondary">自动跟随新消息</span>
                    <Switch size="small" checked={chatSettings.autoScroll} onChange={(v) => updateChatSettings({ autoScroll: v })} />
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-[13px] text-text-secondary">发送后清空输入框</span>
                    <Switch size="small" checked={chatSettings.clearAfterSend} onChange={(v) => updateChatSettings({ clearAfterSend: v })} />
                  </div>
                  <p className="mt-2 text-[11px] text-text-muted">
                    {chatSettings.enterToSend ? 'Enter 发送 · Shift+Enter 换行' : 'Ctrl/Cmd+Enter 发送 · Enter 换行'}
                  </p>
                  <p className="text-[11px] text-text-muted">设置自动保存在本浏览器</p>
                </div>
              )}
            >
              <Tooltip title="聊天设置">
                <button className="flex size-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text-active">
                  <Settings className="size-4" />
                </button>
              </Tooltip>
            </Dropdown>
          </div>
        </div>

        {/* 消息区 */}
        <div ref={scrollRef} onScroll={onScroll} className="relative flex-1 overflow-y-auto px-4 pb-6">
          {!hasMessages && !loadingHistory ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <h2 className="text-[28px] font-bold leading-[36px] text-text-active">有什么可以帮你？</h2>
                <p className="mt-3 text-[14px] leading-[22px] text-text-muted">输入你的问题，开始对话</p>
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-[820px] flex-col gap-6">
              {messages.map((m) => (
                <div key={m.id} className={cn('flex flex-col', m.role === 'user' ? 'items-end' : 'items-start')}>
                  {m.role === 'user' ? (
                    <div className="w-[520px] max-w-full rounded-xl bg-secondary px-4 py-3">
                      <p className="whitespace-pre-wrap text-[14px] leading-[24px] text-text">{m.content}</p>
                    </div>
                  ) : (
                    <div className="w-[680px] max-w-full">
                      {m.status === 'streaming' && !m.content ? (
                        <div className="flex items-center gap-2 text-[12px] text-text-muted">
                          <span className="size-1.5 animate-pulse rounded-full bg-accent" />
                          思考中...
                        </div>
                      ) : (
                        <div className="max-w-none text-text text-[14px] leading-[24px] [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_h1]:text-[18px] [&_h1]:font-bold [&_h1]:my-3 [&_h2]:text-[16px] [&_h2]:font-bold [&_h2]:my-2 [&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:my-2 [&_code]:bg-surface-hover [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[13px] [&_pre]:bg-surface-hover [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_a]:text-accent [&_a]:underline [&_strong]:text-text-active [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-text-secondary">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                        </div>
                      )}
                      {m.status === 'failed' && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-[12px] text-danger">{m.content || '发送失败'}</span>
                          <button onClick={() => retryFailed(m.id)}
                            className="flex items-center gap-1 rounded-md bg-surface-hover px-2 py-1 text-[12px] text-text hover:text-text-active">
                            <RotateCcw className="size-3" /> 重试
                          </button>
                        </div>
                      )}
                      {m.status === 'aborted' && <p className="mt-2 text-[12px] text-text-muted">已停止生成</p>}
                      {m.content && (
                        <div className="mt-3 flex items-center gap-3">
                          {m.status === 'completed' && (
                            <Tooltip title={speakingId === m.id ? '停止朗读' : '朗读'}>
                              <button
                                onClick={() => toggleSpeak(m)}
                                className="flex size-7 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-hover hover:text-text-active"
                              >
                                {speakingId === m.id
                                  ? <VolumeX className="size-[14px]" />
                                  : <Volume2 className="size-[14px]" />}
                              </button>
                            </Tooltip>
                          )}
                          {m.status === 'completed' && (
                            <Tooltip title="重新生成">
                              <button
                                onClick={regenerate} disabled={sending}
                                className="flex size-7 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-hover hover:text-text-active"
                              >
                                <RefreshCw className="size-[14px]" />
                              </button>
                            </Tooltip>
                          )}
                          <Tooltip title="复制">
                            <button
                              onClick={() => copyMessage(m.content)}
                              className="flex size-7 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-hover hover:text-text-active"
                            >
                              <Copy className="size-[14px]" />
                            </button>
                          </Tooltip>
                          {m.tokensOut ? (
                            <Tooltip title={`输入 ${m.tokensIn} · 输出 ${m.tokensOut} `}>
                              <span className="text-[11px] text-text-muted">↓{m.tokensIn} ↑{m.tokensOut}</span>
                            </Tooltip>
                          ) : null}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {showScrollBottom && (
            <button onClick={scrollToBottom}
              className="absolute bottom-4 right-6 flex size-10 items-center justify-center rounded-full bg-card text-text-secondary shadow-lg hover:bg-surface-hover hover:text-text-active transition-all">
              <ArrowDown className="size-4" />
            </button>
          )}
        </div>

        {/* 输入区 */}
        <div className="shrink-0 px-4 pb-5">
          <div className="mx-auto w-[760px] max-w-full">
            <div className="mb-2 flex items-center gap-4 px-1 text-[12px] text-text-muted">
              <Dropdown trigger={['click']} menu={{
                items: PRESET_ROLES.map(r => ({ key: r.key, label: r.label })),
                onClick: ({ key }) => setRole(key), selectedKeys: [role],
              }}>
                <button className="flex items-center gap-1.5 rounded-full px-2 py-1 hover:bg-surface-hover transition-colors">
                  <User className="size-3.5" /> {PRESET_ROLES.find(r => r.key === role)?.label}
                </button>
              </Dropdown>
              <div className="flex items-center gap-1.5">
                <Thermometer className="size-3.5" />
                <input type="range" min={0} max={100} value={Math.round(temperature * 100)}
                  onChange={(e) => setTemperature(Number(e.target.value) / 100)}
                  className="w-20 accent-blue-400" />
                <span className="w-8 tabular-nums">{temperature.toFixed(1)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Globe className="size-3.5" />
                <span>联网</span>
                <Switch size="small" checked={webSearch} onChange={setWebSearch} />
              </div>
            </div>
            <div className="flex min-h-[48px] items-center gap-2 rounded-full bg-card px-3 py-2 transition-colors hover:bg-surface-hover">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  if (chatSettings.enterToSend) {
                    if (!e.shiftKey) { e.preventDefault(); send() }
                  } else if (e.ctrlKey || e.metaKey) {
                    e.preventDefault()
                    send()
                  }
                }}
                rows={1}
                placeholder="输入你的问题..."
                className="chat-input max-h-40 min-h-[22px] flex-1 resize-none border-0 bg-transparent py-0 pl-1 text-[14px] leading-[22px] text-text outline-none placeholder:text-text-muted"
              />
              <div className="flex size-[34px] shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-active [&_.ant-btn]:!h-auto [&_.ant-btn]:!w-auto [&_.ant-btn]:!p-0 [&_.ant-btn]:!text-current [&_.ant-btn]:!shadow-none">
                <SpeechInputButton onResult={(text) => setInput((prev) => prev ? prev + ' ' + text : text)} />
              </div>
              {sending ? (
                <Tooltip title="停止">
                  <button onClick={stop} className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-white text-gray-900 hover:bg-gray-200">
                    <Square className="size-[14px]" />
                  </button>
                </Tooltip>
              ) : (
                <Tooltip title="发送">
                  <button
                    onClick={send} disabled={!input.trim()}
                    className={cn(
                      'flex size-[34px] shrink-0 items-center justify-center rounded-full transition-colors',
                      input.trim() ? 'bg-white text-gray-900 hover:bg-gray-200' : 'text-text-secondary hover:bg-surface-hover hover:text-text-active'
                    )}
                  >
                    <Send className="size-[16px]" />
                  </button>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
