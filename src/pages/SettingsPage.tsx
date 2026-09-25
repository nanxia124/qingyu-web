import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { App } from 'antd'
import { Bell, Shield, Palette, Users, Database } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/useAuthStore'
import { getInstallationId } from '@/lib/billing'

const sections = [
  { id: 'notify', label: 'pages.settings.notify', icon: Bell },
  { id: 'security', label: 'pages.settings.security', icon: Shield },
  { id: 'appearance', label: 'pages.settings.appearance', icon: Palette },
  { id: 'team', label: 'pages.settings.team', icon: Users },
  { id: 'data', label: 'pages.settings.data', icon: Database },
]

type DeviceSession = {
  id: string
  installationId: string
  displayName: string
  clientType: string
  browserFamily: string
  osFamily: string
  status: string
  online: boolean
  lastSeenAt: string | null
  expiresAt: string
}

function isValidSession(session: DeviceSession) {
  return ['pending', 'active'].includes(session.status) && new Date(session.expiresAt).getTime() > Date.now()
}

function sessionStatusLabel(session: DeviceSession) {
  if (session.status === 'revoked') return '已踢出'
  if (session.status === 'expired' || (['pending', 'active'].includes(session.status) && !isValidSession(session))) return '已过期'
  if (!isValidSession(session)) return '已失效'
  if (session.status === 'pending') return '待登录'
  return session.online ? '在线' : '离线'
}

export default function SettingsPage() {
  const { t } = useTranslation()
  const { message, modal } = App.useApp()
  const { isLoggedIn, activateCurrentDevice } = useAuthStore()
  const [active, setActive] = useState('security')
  const [sessions, setSessions] = useState<DeviceSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionsError, setSessionsError] = useState('')
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null)
  const [activatingCurrentDevice, setActivatingCurrentDevice] = useState(false)
  const validSessions = sessions.filter(isValidSession)
  const historicalSessions = sessions.filter((session) => !isValidSession(session))
  const currentInstallationId = getInstallationId()
  const currentDeviceOnline = validSessions.some((session) => session.installationId === currentInstallationId && session.online)
  const canActivateCurrentDevice = isLoggedIn && localStorage.getItem('dev_login') !== '1' && !currentDeviceOnline

  const loadSessions = async () => {
    if (!isLoggedIn) {
      setSessions([])
      return
    }
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
    if (revokingSessionId || activatingCurrentDevice) return
    modal.confirm({
      title: '踢出设备',
      content: '确定要踢出这台设备吗？踢出后它需要重新登录。',
      okText: '确定踢出',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        setRevokingSessionId(sessionId)
        try {
          await api.delete(`/account/sessions/${sessionId}`)
          setSessions((current) => current.map((session) => session.id === sessionId ? { ...session, status: 'revoked', online: false } : session))
          void message.success('设备已踢出，需要重新登录才能使用')
          await loadSessions()
        } catch (error: any) {
          void message.error(error?.message || '踢出设备失败')
        } finally {
          setRevokingSessionId(null)
        }
      },
    })
  }

  const activateDevice = () => {
    if (activatingCurrentDevice || revokingSessionId) return
    modal.confirm({
      title: '切换本设备为在线',
      content: '切换后本设备可以操作，其他已登录设备会变为离线；如果设备名额已满，最早的设备可能会被移出登录名额。',
      okText: '切换到本设备',
      cancelText: '取消',
      onOk: async () => {
        setActivatingCurrentDevice(true)
        try {
          await activateCurrentDevice()
          await message.success('本设备已切换为在线')
          await loadSessions()
        } catch (error: any) {
          await message.error(error?.message || '切换设备失败，请稍后重试')
        } finally {
          setActivatingCurrentDevice(false)
        }
      },
    })
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:flex-row sm:p-6">
      {/* 左侧设置分类 */}
      <aside className="grid shrink-0 grid-cols-2 gap-0.5 sm:block sm:w-48 sm:space-y-0.5">
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
            <s.icon className="size-4 shrink-0" />
            {t(s.label)}
          </button>
        ))}
      </aside>

      {/* 右侧内容 */}
      <div className="min-w-0 flex-1 rounded-xl bg-card p-6">
        {active === 'security' && (
          <>
            <h4 className="text-[18px] font-bold leading-[26px] text-text">登录设备</h4>
            <p className="mt-1 text-[12px] leading-[18px] text-text-muted">最多保留 3 台设备登录，同时只有 1 台设备可以在线操作。</p>
            <p className="mt-1 text-[12px] leading-[18px] text-text-muted">同一设备使用不同浏览器会分别记录；历史记录不占登录名额。</p>
            {canActivateCurrentDevice && <button
              type="button"
              onClick={activateDevice}
              disabled={activatingCurrentDevice || revokingSessionId !== null}
              className="mt-4 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-wait disabled:opacity-50"
            >
              {activatingCurrentDevice ? '正在切换…' : '切换到本设备'}
            </button>}
            {sessionsError && <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
              <span>{sessionsError}</span>
              <button type="button" onClick={() => void loadSessions()} disabled={sessionsLoading} className="shrink-0 rounded-md px-2 py-1 hover:bg-red-500/10">重新读取</button>
            </div>}
            {sessionsLoading ? (
              <p className="mt-5 text-[13px] text-text-muted">正在读取设备列表…</p>
            ) : sessions.length === 0 ? (
              !sessionsError && <p className="mt-5 text-[13px] text-text-muted">暂时没有设备记录。</p>
            ) : (
              <div className="mt-5 space-y-6">
                {[{ title: '有效登录设备', items: validSessions, historical: false }, { title: '历史登录记录', items: historicalSessions, historical: true }].map((group) => (
                  <section key={group.title} className="space-y-3">
                    <h5 className="text-[13px] font-medium text-text-muted">{group.title}（{group.items.length}）</h5>
                    {group.items.length === 0 && <p className="text-[12px] text-text-muted">{group.historical ? '暂无历史记录。' : '暂无有效登录设备。'}</p>}
                    {group.items.map((session) => (
                      <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-input px-4 py-3">
                        <div className="min-w-0 flex-1 basis-48">
                          <div className="flex items-center gap-2 text-[14px] font-medium text-text">
                            <span className={cn('size-2 shrink-0 rounded-full', !group.historical && session.online ? 'bg-emerald-400' : 'bg-text-muted')} />
                            <span className="min-w-0 truncate" title={session.displayName}>{session.displayName || '网页设备'}</span>
                            <span className="shrink-0 whitespace-nowrap text-[11px] font-normal text-text-muted">{sessionStatusLabel(session)}</span>
                          </div>
                          <p className="mt-1 break-words text-[11px] text-text-muted">
                            {[session.browserFamily, session.osFamily].filter(Boolean).join(' · ') || session.clientType}
                            {session.lastSeenAt ? ` · 最近活动 ${new Date(session.lastSeenAt).toLocaleString()}` : ''}
                          </p>
                        </div>
                        {!group.historical && <button
                          type="button"
                          onClick={() => void revokeSession(session.id)}
                          disabled={revokingSessionId !== null || activatingCurrentDevice}
                          className="shrink-0 whitespace-nowrap rounded-lg bg-secondary px-3 py-2 text-[12px] text-text-muted transition-colors hover:bg-red-500/15 hover:text-red-300 disabled:cursor-wait disabled:opacity-50"
                        >
                          {revokingSessionId === session.id ? '正在踢出…' : '踢出设备'}
                        </button>}
                      </div>
                    ))}
                  </section>
                ))}
              </div>
            )}
          </>
        )}
        {active !== 'security' && (
          <div className="flex h-48 items-center justify-center text-[14px] text-text-muted">
            「{t(sections.find((s) => s.id === active)?.label ?? '')}」{t('pages.settings.developing')}
          </div>
        )}
      </div>
    </div>
  )
}
