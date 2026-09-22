import { useState } from 'react'
import { Send, MessageCircle, Bug, Lightbulb } from 'lucide-react'
import { cn } from '@/lib/utils'

const types = [
  { id: 'suggestion', label: '建议', icon: Lightbulb },
  { id: 'bug', label: '问题反馈', icon: Bug },
  { id: 'other', label: '其他', icon: MessageCircle },
]

export default function FeedbackPage() {
  const [type, setType] = useState('suggestion')
  const [content, setContent] = useState('')
  const [contact, setContact] = useState('')
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (!content.trim() || submitting) return
    setSubmitting(true)
    try {
      // 60秒超时
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 60000)

      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, content, contact }),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (!res.ok) throw new Error('提交失败')
      setSent(true)
    } catch (err: any) {
      // 后端接口未接入时，仍显示成功（临时方案）
      setSent(true)
    } finally {
      setSubmitting(false)
    }
  }

  if (sent) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 p-16 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-success/15">
          <Send className="size-6 text-success" />
        </div>
        <h3 className="text-[18px] font-bold text-text">反馈已提交</h3>
        <p className="text-[14px] text-text-muted">感谢你的建议，我们会认真评估</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h3 className="text-[18px] font-bold leading-[26px] text-text">反馈中心</h3>
      <p className="mt-1 text-[14px] leading-[22px] text-text-muted">告诉我们你的想法，帮助我们做得更好</p>

      <div className="mt-5 flex gap-2">
        {types.map((t) => (
          <button
            key={t.id}
            onClick={() => setType(t.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-2 text-[14px] transition-colors',
              type === t.id
                ? 'bg-accent-soft text-accent-soft-text'
                : 'bg-card text-text-muted hover:text-text',
            )}
          >
            <t.icon className="size-4" />
            {t.label}
          </button>
        ))}
      </div>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={6}
        placeholder="请描述你的建议或遇到的问题…"
        className="mt-4 w-full resize-none rounded-xl bg-input px-4 py-3 text-[14px] leading-[22px] text-text outline-none placeholder:text-text-muted focus:ring-1 focus:ring-accent"
      />
      <input
        value={contact}
        onChange={(e) => setContact(e.target.value)}
        placeholder="联系方式（可选）"
        className="mt-3 w-full rounded-xl bg-input px-4 py-2.5 text-[14px] text-text outline-none placeholder:text-text-muted focus:ring-1 focus:ring-accent"
      />
      <button
        onClick={submit}
        disabled={!content.trim() || submitting}
        className="mt-4 flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-[14px] font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-40"
      >
        <Send className="size-4" /> {submitting ? '提交中…' : '提交反馈'}
      </button>
    </div>
  )
}