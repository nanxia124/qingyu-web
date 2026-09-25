import { lazy, Suspense } from 'react'
import type { ReactElement } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from '@/components/layout/AppLayout'
import ProtectedRoute from '@/components/ProtectedRoute'
import AdminRoute from '@/components/AdminRoute'
import { RouteErrorBoundary } from '@/components/states/RouteErrorBoundary'
import { RouteSkeleton, type SkeletonVariant } from '@/components/states/RouteSkeleton'

// 所有页面按需加载，减少首屏体积
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage'))
const DevLoginPage = lazy(() => import('@/pages/DevLoginPage'))
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
const EraserPage = lazy(() => import('@/pages/EraserPage'))

// 画布模块原生集成（替代 iframe）：整体懒加载，首次进入 /canvas 才拉取画布 chunk
const CanvasRoute = lazy(() => import('@canvas/index').then((m) => ({ default: m.CanvasRoute })))
const CanvasNewRoute = lazy(() => import('@canvas/index').then((m) => ({ default: m.CanvasNewRoute })))
const CanvasProjectRoute = lazy(() => import('@canvas/index').then((m) => ({ default: m.CanvasProjectRoute })))
const CanvasVideoRoute = lazy(() => import('@canvas/index').then((m) => ({ default: m.CanvasVideoRoute })))

function lazyPage(el: ReactElement, variant: SkeletonVariant = 'grid') {
  return <Suspense fallback={<RouteSkeleton variant={variant} />}>{el}</Suspense>
}

// 画布路由用 canvas 专用骨架（全屏画布 + 底部工具栏）
const lazyCanvas = (el: ReactElement) => lazyPage(el, 'canvas')

export default function App() {
  return (
    <RouteErrorBoundary>
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/reset-password" element={lazyPage(<ResetPasswordPage />)} />
        {/* 本地开发一键登录（生产构建页面自行禁用） */}
        <Route path="/dev-login" element={lazyPage(<DevLoginPage />, 'workspace')} />
        <Route path="/admin-secret-8f3k2x7z" element={<AdminRoute>{lazyPage(<AdminPage />)}</AdminRoute>} />
        <Route path="/admin" element={<Navigate to="/admin-secret-8f3k2x7z" replace />} />
        {/* 旧后台地址保留兼容，但统一回到同一个登录和导航入口 */}
        <Route path="/admin/users" element={<Navigate to="/admin-secret-8f3k2x7z?section=users" replace />} />
        <Route path="/admin/tenants" element={<Navigate to="/admin-secret-8f3k2x7z?section=tenants" replace />} />
        <Route path="/admin/audits" element={<Navigate to="/admin-secret-8f3k2x7z?section=audits" replace />} />
        <Route path="/admin/billing" element={<Navigate to="/admin-secret-8f3k2x7z?section=billing" replace />} />
        <Route path="/admin/monitor" element={<Navigate to="/admin-secret-8f3k2x7z?section=monitor" replace />} />
        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route path="/" element={lazyPage(<WorkbenchPage />, 'grid')} />
          <Route path="/chat" element={lazyPage(<ChatPage />, 'chat')} />
          {/* /generate 重定向到真实生图页 */}
          <Route path="/generate" element={<Navigate to="/image" replace />} />
          <Route path="/translate" element={lazyPage(<TranslatePage />, 'workspace')} />
          <Route path="/eraser" element={lazyPage(<EraserPage />, 'workspace')} />
          <Route path="/plan" element={lazyPage(<PlanPage />, 'workspace')} />
          <Route path="/canvas" element={lazyCanvas(<CanvasRoute />)} />
          <Route path="/canvas/new" element={lazyCanvas(<CanvasNewRoute />)} />
          <Route path="/canvas/:id" element={lazyCanvas(<CanvasProjectRoute />)} />
          <Route path="/image" element={lazyPage(<ImageToolsPage />, 'workspace')} />
          <Route path="/video" element={lazyCanvas(<CanvasVideoRoute />)} />
          <Route path="/assets" element={lazyPage(<AssetsPage />, 'grid')} />
          <Route path="/favorites" element={lazyPage(<FavoritesPage />, 'grid')} />
          <Route path="/feedback" element={lazyPage(<FeedbackPage />, 'list')} />
          <Route path="/settings" element={lazyPage(<SettingsPage />, 'settings')} />
          <Route path="/subscription" element={lazyPage(<SubscriptionPage />, 'list')} />
          <Route path="/wallet" element={lazyPage(<WalletPage />, 'list')} />
          {/* 个人中心 */}
          <Route path="/account/profile" element={lazyPage(<ProfilePage />, 'settings')} />
          <Route path="/account/security" element={lazyPage(<SecurityPage />, 'settings')} />
          <Route path="/account/billing" element={lazyPage(<BillingPage />, 'list')} />
          {/* 团队系统 */}
          <Route path="/teams" element={lazyPage(<TeamsPage />, 'list')} />
          <Route path="/teams/:id/members" element={lazyPage(<TeamMembersPage />, 'list')} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </RouteErrorBoundary>
  )
}
