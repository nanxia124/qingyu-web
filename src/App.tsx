import { lazy, Suspense, Component } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from '@/components/layout/AppLayout'
import ProtectedRoute from '@/components/ProtectedRoute'
import AdminRoute from '@/components/AdminRoute'
import { ErrorState } from '@/components/states/ErrorState'
import { RouteSkeleton } from '@/components/states/RouteSkeleton'

// 所有页面按需加载，减少首屏体积
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage'))
const WorkbenchPage = lazy(() => import('@/pages/WorkbenchPage'))
const ChatPage = lazy(() => import('@/pages/ChatPage'))
const TranslatePage = lazy(() => import('@/pages/TranslatePage'))
const PlanPage = lazy(() => import('@/pages/PlanPage'))
const ImageToolsPage = lazy(() => import('@/pages/ImageToolsPage'))
const AssetsPage = lazy(() => import('@/pages/AssetsPage'))
const FavoritesPage = lazy(() => import('@/pages/FavoritesPage'))
const FeedbackPage = lazy(() => import('@/pages/FeedbackPage'))
const SettingsPage = lazy(() => import('@/pages/SettingsPage'))
const MonitorPage = lazy(() => import('@/pages/MonitorPage'))
const SubscriptionPage = lazy(() => import('@/pages/SubscriptionPage'))
const WalletPage = lazy(() => import('@/pages/WalletPage'))
const AdminPage = lazy(() => import('@/pages/admin/AdminPage'))
const ProfilePage = lazy(() => import('@/pages/account/ProfilePage'))
const SecurityPage = lazy(() => import('@/pages/account/SecurityPage'))
const BillingPage = lazy(() => import('@/pages/account/BillingPage'))
const TeamsPage = lazy(() => import('@/pages/team/TeamsPage'))
const TeamMembersPage = lazy(() => import('@/pages/team/TeamMembersPage'))

// 画布模块原生集成（替代 iframe）：整体懒加载，首次进入 /canvas 才拉取画布 chunk
const CanvasRoute = lazy(() => import('@canvas/index').then((m) => ({ default: m.CanvasRoute })))
const CanvasNewRoute = lazy(() => import('@canvas/index').then((m) => ({ default: m.CanvasNewRoute })))
const CanvasProjectRoute = lazy(() => import('@canvas/index').then((m) => ({ default: m.CanvasProjectRoute })))
const CanvasVideoRoute = lazy(() => import('@canvas/index').then((m) => ({ default: m.CanvasVideoRoute })))

// 错误边界：任何组件渲染抛错时显示兜底页，避免整应用白屏
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  state = { hasError: false, error: null }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error } }
  componentDidCatch(error: Error) { console.error('页面渲染错误:', error) }
  render() {
    if (this.state.hasError) {
      return <ErrorState code="500" error={this.state.error} />
    }
    return this.props.children
  }
}

function PageFallback() {
  return <RouteSkeleton />
}

function lazyPage(el: ReactElement) {
  return <Suspense fallback={<PageFallback />}>{el}</Suspense>
}

// 画布路由用同一个lazyPage
const lazyCanvas = lazyPage

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/reset-password" element={lazyPage(<ResetPasswordPage />)} />
        <Route path="/admin-secret-8f3k2x7z" element={<AdminRoute>{lazyPage(<AdminPage />)}</AdminRoute>} />
        <Route path="/admin" element={<Navigate to="/admin-secret-8f3k2x7z" replace />} />
        {/* 旧后台地址保留兼容，但统一回到同一个登录和导航入口 */}
        <Route path="/admin/users" element={<Navigate to="/admin-secret-8f3k2x7z?section=users" replace />} />
        <Route path="/admin/tenants" element={<Navigate to="/admin-secret-8f3k2x7z?section=tenants" replace />} />
        <Route path="/admin/audits" element={<Navigate to="/admin-secret-8f3k2x7z?section=audits" replace />} />
        <Route path="/admin/billing" element={<Navigate to="/admin-secret-8f3k2x7z?section=billing" replace />} />
        <Route path="/admin/monitor" element={<Navigate to="/admin-secret-8f3k2x7z?section=monitor" replace />} />
        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route path="/" element={lazyPage(<WorkbenchPage />)} />
          <Route path="/chat" element={lazyPage(<ChatPage />)} />
          {/* /generate 重定向到真实生图页 */}
          <Route path="/generate" element={<Navigate to="/image" replace />} />
          <Route path="/translate" element={lazyPage(<TranslatePage />)} />
          <Route path="/plan" element={lazyPage(<PlanPage />)} />
          <Route path="/canvas" element={lazyCanvas(<CanvasRoute />)} />
          <Route path="/canvas/new" element={lazyCanvas(<CanvasNewRoute />)} />
          <Route path="/canvas/:id" element={lazyCanvas(<CanvasProjectRoute />)} />
          <Route path="/image" element={lazyPage(<ImageToolsPage />)} />
          <Route path="/video" element={lazyCanvas(<CanvasVideoRoute />)} />
          <Route path="/assets" element={lazyPage(<AssetsPage />)} />
          <Route path="/favorites" element={lazyPage(<FavoritesPage />)} />
          <Route path="/feedback" element={lazyPage(<FeedbackPage />)} />
          <Route path="/settings" element={lazyPage(<SettingsPage />)} />
          <Route path="/subscription" element={lazyPage(<SubscriptionPage />)} />
          <Route path="/wallet" element={lazyPage(<WalletPage />)} />
          {/* 个人中心 */}
          <Route path="/account/profile" element={lazyPage(<ProfilePage />)} />
          <Route path="/account/security" element={lazyPage(<SecurityPage />)} />
          <Route path="/account/billing" element={lazyPage(<BillingPage />)} />
          {/* 团队系统 */}
          <Route path="/teams" element={lazyPage(<TeamsPage />)} />
          <Route path="/teams/:id/members" element={lazyPage(<TeamMembersPage />)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  )
}
