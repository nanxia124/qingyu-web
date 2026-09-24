import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound, Bell, Shield, Palette, Users, Database } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/useAuthStore'

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
  const { isLoggedIn } = useAuthStore()
  const [active, setActive] = useState('api')
  const [apiKey, setApiKey] = useState('')
  const [apiBase, setApiBase] = useState('')
  const [saved, setSaved] = useState(false)
  const [sessions, setSessions] = useState<Array<{
    id: string
    displayName: string
    clientType: string
    browserFamily: string
    osFamily: string
    status: string
    online: boolean
    lastSeenAt: string | null
    expiresAt: string
  }>>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionsError, setSessionsError] = useState('')

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

  const loadSessions = async () => {
    if (!isLoggedIn) return
    setSessionsLoading(true)
    setSessionsError('')
    try {
      setSessions(await api.get('/account/sessions'))
    } catch (error: any) {
      setSessionsError(error?.message || '设备列表读取失败')
    } finally {
      setSessionsLoading(false)
    }
  }

  useEffect(() => {
    if (active === 'security') void loadSessions()
  }, [active, isLoggedIn])

  const revokeSession = async (sessionId: string) => {
    if (!window.confirm('确定要踢出这台设备吗？踢出后它需要重新登录。')) return
    try {
      await api.delete(`/account/sessions/${sessionId}`)
      await loadSessions()
    } catch (error: any) {
      setSessionsError(error?.message || '踢出设备失败')
    }
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
        {active === 'security' && (
          <>
            <h4 className="text-[18px] font-bold leading-[26px] text-text">登录设备</h4>
            <p className="mt-1 text-[12px] leading-[18px] text-text-muted">最多保留 3 台设备登录，同时只有 1 台设备可以在线操作。</p>
            {sessionsError && <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-[12px] text-red-300">{sessionsError}</p>}
            {sessionsLoading ? (
              <p className="mt-5 text-[13px] text-text-muted">正在读取设备列表…</p>
            ) : sessions.length === 0 ? (
              <p className="mt-5 text-[13px] text-text-muted">暂时没有设备记录。</p>
            ) : (
              <div className="mt-5 space-y-3">
                {sessions.map((session) => (
                  <div key={session.id} className="flex items-center justify-between gap-4 rounded-lg bg-input px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[14px] font-medium text-text">
                        <span className={cn('size-2 rounded-full', session.online ? 'bg-emerald-400' : 'bg-text-muted')} />
                        <span className="truncate">{session.displayName || '网页设备'}</span>
                        <span className="text-[11px] font-normal text-text-muted">{session.online ? '在线' : '离线'}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-text-muted">
                        {[session.browserFamily, session.osFamily].filter(Boolean).join(' · ') || session.clientType}
                        {session.lastSeenAt ? ` · 最近活动 ${new Date(session.lastSeenAt).toLocaleString()}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void revokeSession(session.id)}
                      className="shrink-0 rounded-lg bg-secondary px-3 py-2 text-[12px] text-text-muted transition-colors hover:bg-red-500/15 hover:text-red-300"
                    >
                      踢出设备
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {active !== 'api' && (
          <div className={cn('flex h-48 items-center justify-center text-[14px] text-text-muted', active === 'security' && 'hidden')}>
            「{t(sections.find((s) => s.id === active)?.label ?? '')}」{t('pages.settings.developing')}
          </div>
        )}
      </div>
    </div>
  )
}
