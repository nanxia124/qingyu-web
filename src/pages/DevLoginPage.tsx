import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { setBillingToken, getInstallationId } from '@/lib/billing'
import { useAuthStore } from '@/stores/useAuthStore'

/**
 * 本地开发一键登录中转页：http://localhost:5173/dev-login
 * 页面在前端自己的上下文里向后端要 token 并保存登录态，不经过临时 HTML 页跳转。
 * 生产构建下此页面为死页面。
 */
export default function DevLoginPage() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(true)

  const runDevLogin = useCallback(async () => {
    setRunning(true)
    setError(null)
    try {
      // 带上本机固定设备编号，后端据此复用同一会话，避免重复登录互相踢下线
      const loginUrl = `/api/dev-login?format=json&installationId=${encodeURIComponent(getInstallationId())}`
      const res = await fetch(loginUrl, { headers: { Accept: 'application/json' } })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`)
      const { token, uid, email } = data as { token: string; uid: string; email: string }
      // 登录态全部在当前页面（localhost:5173 同源）写入，不会因跳转丢失
      setBillingToken(token)
      localStorage.setItem('token', token)
      localStorage.setItem('appwrite_uid', uid)
      localStorage.setItem('dev_login', '1')
      localStorage.setItem('infinite-canvas:locale', 'zh-CN')
      localStorage.removeItem('infinite-canvas:locale-manual')
      useAuthStore.setState({
        user: { id: uid, email, name: uid, emailVerified: true, createdAt: new Date().toISOString() },
        isLoggedIn: true,
      })
      navigate('/', { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : '登录失败')
      setRunning(false)
    }
  }, [navigate])

  useEffect(() => {
    void runDevLogin()
  }, [runDevLogin])

  // 生产构建：直接拦截，什么都不做
  if (import.meta.env.PROD) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-text-secondary">
        该页面仅本地开发环境可用
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-text">
      {error ? (
        <>
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={() => void runDevLogin()}
            className="rounded-lg bg-accent px-5 py-2 text-sm text-accent-foreground hover:bg-accent-hover"
          >
            重试
          </button>
        </>
      ) : (
        <p className="text-sm text-text-secondary">{running ? '正在登录…' : ''}</p>
      )}
    </div>
  )
}
