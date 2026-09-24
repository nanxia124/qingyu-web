import { useState, useRef, useEffect } from 'react'
import { Send, Plus, Copy } from 'lucide-react'
import { App, Tooltip } from 'antd'
import { cn } from '@/lib/utils'
import { SpeechInputButton } from '@/components/speech-input-button'
import { useTranslation } from 'react-i18next'

interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
}

export default function ChatPage() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 输入框自动增高
  useEffect(() => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 160) + 'px'
    }
  }, [input])

  const send = () => {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    setMessages((m) => [...m, { id: Date.now(), role: 'user', content: text }])
    setSending(true)
    setTimeout(() => {
      setMessages((m) => [
        ...m,
        {
          id: Date.now() + 1,
          role: 'assistant',
          content: t('chat.servicePending'),
        },
      ])
      setSending(false)
    }, 400)
  }

  const copyMessage = async (id: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1200)
    } catch {
      message.error(t('chat.copyFailed'))
    }
  }

  const hasMessages = messages.length > 0

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* 顶部模型选择器占位（右上角） */}
      <div className="flex justify-end px-4 pt-3">
        <button className="flex h-[30px] items-center gap-2 rounded-full bg-card px-3 text-[12px] font-medium text-text-secondary transition-colors hover:bg-card-hover">
          <span className="size-1.5 rounded-full bg-success" />
          {t('chat.selectModel')}
        </button>
      </div>

      {/* 消息区 */}
      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-6">
        {!hasMessages ? (
          /* 空状态 */
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <h2 className="text-[18px] font-bold leading-[26px] text-text-active">
                {t('chat.greeting')}
              </h2>
              <p className="mt-3 text-[14px] leading-[22px] text-text-muted">
                {t('chat.subtitle')}
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-[820px] flex-col gap-6">
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  'flex flex-col',
                  m.role === 'user' ? 'items-end' : 'items-start',
                )}
              >
                {m.role === 'user' ? (
                  /* 用户消息：右对齐，背景 #f0f0f2，圆角 12，内边距 16/12 */
                  <div className="w-[520px] max-w-full rounded-xl bg-secondary px-4 py-3">
                    <p className="text-[14px] leading-[24px] text-text">{m.content}</p>
                  </div>
                ) : (
                  /* AI 消息：左对齐，无背景，文字直接显示 */
                  <div className="w-[640px] max-w-full">
                    <p className="text-[14px] leading-[24px] text-text">{m.content}</p>
                    {/* meta + 复制 */}
                    <div className="mt-3 flex items-center gap-3">
                      <span className="text-[12px] leading-[18px] text-text-muted">{t('chat.justNow')}</span>
                      <Tooltip title={t('chat.copy')}>
                      <button
                        onClick={() => copyMessage(m.id, m.content)}
                        className="flex size-7 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-hover hover:text-text-active"
                      >
                        {copiedId === m.id ? (
                          <span className="text-[10px] text-success">{t('chat.copied')}</span>
                        ) : (
                          <Copy className="size-[14px]" />
                        )}
                      </button>
                      </Tooltip>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {sending && (
              <div className="flex items-center gap-2 text-[12px] text-text-muted">
                <span className="size-1.5 animate-pulse rounded-full bg-accent" />
                {t('chat.thinking')}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 输入区：居中 600×60 */}
      <div className="shrink-0 px-4 pb-5">
        <div className="mx-auto w-[600px] max-w-full">
          <div className="flex min-h-[60px] items-end gap-2 rounded-xl bg-card px-2 py-2 transition-colors hover:bg-surface-hover">
            {/* 附件按钮 */}
            <Tooltip title={t('chat.addAttachment')}>
              <button
                onClick={() => message.info(t('chat.attachSoon'))}
                className="flex size-[34px] shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-active"
              >
                <Plus className="size-[18px]" />
              </button>
            </Tooltip>
            {/* 输入框 */}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              rows={1}
              placeholder={t('chat.placeholder')}
              className="chat-input max-h-40 flex-1 resize-none bg-transparent text-[14px] leading-[22px] text-text outline-none placeholder:text-text-muted"
            />
            {/* 语音输入按钮 */}
            <SpeechInputButton onResult={(text) => setInput((prev) => prev ? prev + " " + text : text)} />
            {/* 发送按钮 */}
            <Tooltip title={t('chat.send')}>
              <button
                onClick={send}
                disabled={!input.trim() || sending}
                className={cn(
                  'flex size-[34px] shrink-0 items-center justify-center rounded-full transition-colors',
                  input.trim()
                    ? 'bg-accent text-accent-foreground hover:bg-accent-hover'
                    : 'bg-secondary text-text-muted',
                )}
              >
                <Send className="size-[16px]" />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  )
}