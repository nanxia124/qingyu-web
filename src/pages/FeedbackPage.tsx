import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Send, MessageCircle, Bug, Lightbulb } from 'lucide-react'
import { cn } from '@/lib/utils'

const types = [
  { id: 'suggestion', label: 'pages.feedback.suggestion', icon: Lightbulb },
  { id: 'bug', label: 'pages.feedback.bug', icon: Bug },
  { id: 'other', label: 'pages.feedback.other', icon: MessageCircle },
]

export default function FeedbackPage() {
  const { t } = useTranslation()
  const [type, setType] = useState('suggestion')
  const [content, setContent] = useState('')
  const [contact, setContact] = useState('')
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!content.trim() || submitting) return
    setSubmitting(true)
    setError('')
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

      if (!res.ok) throw new Error(t('pages.feedback.failed'))
      setSent(true)
    } catch (err: any) {
      setError(err?.name === 'AbortError' ? t('pages.feedback.failed') : (err?.message || t('pages.feedback.failed')))
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
        <h3 className="text-[18px] font-bold text-text">{t("pages.feedback.submitted")}</h3>
        <p className="text-[14px] text-text-muted">{t("pages.feedback.thanks")}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h3 className="text-[18px] font-bold leading-[26px] text-text">{t("pages.feedback.title")}</h3>
      <p className="mt-1 text-[14px] leading-[22px] text-text-muted">{t("pages.feedback.subtitle")}</p>

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
        placeholder={t("pages.feedback.placeholder")}
        className="mt-4 w-full resize-none rounded-xl bg-input px-4 py-3 text-[14px] leading-[22px] text-text outline-none placeholder:text-text-muted focus:ring-1 focus:ring-accent"
      />
      <input
        value={contact}
        onChange={(e) => setContact(e.target.value)}
        placeholder={t("pages.feedback.contact")}
        className="mt-3 w-full rounded-xl bg-input px-4 py-2.5 text-[14px] text-text outline-none placeholder:text-text-muted focus:ring-1 focus:ring-accent"
      />
      <button
        onClick={submit}
        disabled={!content.trim() || submitting}
        className="mt-4 flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-[14px] font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-40"
      >
        <Send className="size-4" /> {submitting ? t('pages.feedback.submitting') : t('pages.feedback.submit')}
      </button>
      {error ? <p className="mt-3 text-[13px] text-danger" role="alert">{error}</p> : null}
    </div>
  )
}
