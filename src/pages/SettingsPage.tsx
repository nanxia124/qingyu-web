import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound, Bell, Shield, Palette, Users, Database } from 'lucide-react'
import { cn } from '@/lib/utils'

const sections = [
  { id: 'api', label: 'pages.settings.api', icon: KeyRound },
  { id: 'notify', label: 'pages.settings.notify', icon: Bell },
  { id: 'security', label: 'pages.settings.security', icon: Shield },
  { id: 'appearance', label: 'pages.settings.appearance', icon: Palette },
  { id: 'team', label: 'pages.settings.team', icon: Users },
  { id: 'data', label: 'pages.settings.data', icon: Database },
]

export default function SettingsPage() {
  const { t } = useTranslation()
  const [active, setActive] = useState('api')
  const [apiKey, setApiKey] = useState('')
  const [apiBase, setApiBase] = useState('')
  const [saved, setSaved] = useState(false)

  // 初始化时从localStorage读取
  useEffect(() => {
    const savedKey = localStorage.getItem('api_key') || ''
    const savedBase = localStorage.getItem('api_base') || ''
    setApiKey(savedKey)
    setApiBase(savedBase)
  }, [])

  const save = () => {
    localStorage.setItem('api_key', apiKey)
    localStorage.setItem('api_base', apiBase)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="mx-auto flex max-w-5xl gap-6 p-6">
      {/* 左侧设置分类 */}
      <aside className="w-48 shrink-0 space-y-0.5">
        {sections.map((s) => (
          <button
            key={s.id}
            onClick={() => setActive(s.id)}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[14px] transition-colors',
              active === s.id
                ? 'bg-card font-medium text-text'
                : 'text-text-muted hover:bg-card hover:text-text',
            )}
          >
            <s.icon className="size-4" />
            {s.label}
          </button>
        ))}
      </aside>

      {/* 右侧内容 */}
      <div className="min-w-0 flex-1 rounded-xl bg-card p-6">
        {active === 'api' && (
          <>
            <h4 className="text-[18px] font-bold leading-[26px] text-text">{t("pages.settings.apiTitle")}</h4>
            <p className="mt-1 text-[12px] leading-[18px] text-text-muted">{t("pages.settings.apiDesc")}</p>
            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-text-muted">{t("pages.settings.serverAddr")}</label>
                <input
                  value={apiBase}
                  onChange={(e) => setApiBase(e.target.value)}
                  className="w-full rounded-lg bg-input px-3 py-2.5 text-[14px] text-text outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-text-muted">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full rounded-lg bg-input px-3 py-2.5 text-[14px] text-text outline-none placeholder:text-text-muted focus:ring-1 focus:ring-accent"
                />
              </div>
              <button
                onClick={save}
                className="rounded-lg bg-accent px-5 py-2 text-[14px] font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
              >
                {saved ? t('pages.settings.saved') : t('pages.settings.save')}
              </button>
            </div>
          </>
        )}
        {active !== 'api' && (
          <div className="flex h-48 items-center justify-center text-[14px] text-text-muted">
            「{t(sections.find((s) => s.id === active)?.label ?? '')}」{t('pages.settings.developing')}
          </div>
        )}
      </div>
    </div>
  )
}