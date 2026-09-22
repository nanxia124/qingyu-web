import { useState, useEffect } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Settings,
  MessageSquareWarning,
  LogOut,
  LogIn,
  PanelLeftClose,
  PanelLeftOpen,
  Users,
  User,
  CreditCard,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import AuthModal from '@/components/AuthModal'
import { useAuthStore } from '@/stores/useAuthStore'
import {
  SidebarHomeIcon,
  SidebarChatIcon,
  SidebarImageIcon,
  SidebarVideoIcon,
  SidebarCanvasIcon,
  SidebarTeamIcon,
  SidebarFavoriteIcon,
} from './SidebarIcons'

type IconComp = (props: { className?: string }) => React.ReactElement

const navItems: { to: string; label: string; tooltip: string; icon: IconComp; exact?: boolean; preload?: () => void; requireAuth?: boolean }[] = [
  { to: '/', label: '首页', tooltip: '首页', icon: SidebarHomeIcon, exact: true },
  { to: '/chat', label: '聊天', tooltip: '聊天', icon: SidebarChatIcon },
  { to: '/image-tools', label: '图像', tooltip: '图像生成', icon: SidebarImageIcon },
  { to: '/video', label: '影像', tooltip: '影像', icon: SidebarVideoIcon },
  { to: '/canvas?mode=recent', label: '画布', tooltip: '画布', icon: SidebarCanvasIcon, preload: () => { void import('@canvas/index') } },
  // 以下页面未登录时点击直接弹登录窗
  { to: '/assets', label: '团队', tooltip: '团队资产', icon: SidebarTeamIcon, requireAuth: true },
  { to: '/favorites', label: '收藏', tooltip: '我的收藏', icon: SidebarFavoriteIcon, requireAuth: true },
]

const utilityItems: { to: string; label: string; tooltip: string; icon: typeof Settings; requireAuth?: boolean }[] = [
  { to: '/teams', label: '团队', tooltip: '团队管理', icon: Users, requireAuth: true },
  { to: '/account/profile', label: '个人', tooltip: '个人中心', icon: User, requireAuth: true },
  { to: '/account/billing', label: '账单', tooltip: '账单与发票', icon: CreditCard },
  { to: '/feedback', label: '反馈', tooltip: '反馈中心', icon: MessageSquareWarning },
  { to: '/settings', label: '设置', tooltip: '系统设置', icon: Settings },
]

const pageTitles: Record<string, string> = {
  '/': '首页',
  '/chat': '聊天',
  '/image-tools': '图像',
  '/video': '影像',
  '/canvas': '画布',
  '/assets': '团队',
  '/favorites': '收藏',
  '/feedback': '反馈',
  '/settings': '设置',
}

export default function AppLayout() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const currentTitle = pageTitles[location.pathname] ?? t('brand.name')

  // 动态设置浏览器标签页标题
  useEffect(() => {
    document.title = t('brand.documentTitle')
  }, [t])

  // Auth store
  const { isLoggedIn, logout, checkSession, user, authModalOpen, openAuthModal, closeAuthModal } = useAuthStore()

  // 页面加载时检查会话
  useEffect(() => {
    checkSession()
  }, [])

  // 未登录直接访问需登录页面（团队资产/我的收藏/团队管理/个人中心）时，弹出登录窗
  useEffect(() => {
    const protectedPrefixes = ['/assets', '/favorites', '/teams', '/account/profile']
    if (!isLoggedIn && protectedPrefixes.some((p) => location.pathname.startsWith(p))) {
      openAuthModal()
    }
  }, [location.pathname, isLoggedIn, openAuthModal])

  const isCanvas = location.pathname.startsWith('/canvas')
  const isVideo = location.pathname.startsWith('/video')

  const sidebarWidth = expanded ? 'w-[140px]' : 'w-[50px]'

  const handleLogout = async () => {
    await logout()
    navigate('/')
    window.location.reload()
  }

  const requireAuthClick = (requireAuth?: boolean) => (e: React.MouseEvent) => {
    if (requireAuth && !isLoggedIn) {
      e.preventDefault()
      openAuthModal()
    }
  }

  const renderItem = (
    to: string,
    label: string,
    tooltip: string,
    Icon: IconComp,
    exact?: boolean,
    preload?: () => void,
    requireAuth?: boolean,
  ) => (
    <NavLink
      key={to + label}
      to={to}
      end={exact}
      title={tooltip}
      onClick={requireAuthClick(requireAuth)}
      className="group relative flex h-[44px] w-full items-center outline-none transition-transform duration-200 ease-out active:scale-[0.96]"
      style={{ transformOrigin: '50% 50%' }}
      onMouseEnter={preload}
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              'absolute left-[8px] top-1/2 h-[30px] -translate-y-1/2 rounded-full transition-all duration-200',
              expanded ? 'w-[124px]' : 'w-[34px]',
              isActive
                ? 'bg-nav-active'
                : 'opacity-0 group-hover:bg-nav-hover group-hover:opacity-100',
            )}
          />
          <span className="relative z-10 flex h-[30px] w-[50px] shrink-0 items-center justify-center">
            <Icon
              className={cn(
                'size-[22px] transition-colors',
                isActive
                  ? 'text-nav-text-active'
                  : 'text-nav-text group-hover:text-text-active',
              )}
            />
          </span>
          <span
            className={cn(
              'overflow-hidden whitespace-nowrap text-left text-[14px] font-medium leading-[20px] transition-all duration-200',
              expanded ? 'w-[90px] translate-x-0 opacity-100' : 'w-[0px] -translate-x-2 opacity-0',
              isActive ? 'text-text' : 'text-text-muted',
            )}
          >
            {label}
          </span>
        </>
      )}
    </NavLink>
  )

  const renderUtilityItem = (
    to: string,
    label: string,
    tooltip: string,
    Icon: typeof Settings,
    requireAuth?: boolean,
  ) => (
    <NavLink
      key={to}
      to={to}
      title={tooltip}
      onClick={requireAuthClick(requireAuth)}
      className="group relative flex h-[44px] w-full items-center outline-none transition-transform duration-200 ease-out active:scale-[0.96]"
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              'absolute left-[8px] top-1/2 h-[30px] -translate-y-1/2 rounded-full transition-all duration-200',
              expanded ? 'w-[124px]' : 'w-[34px]',
              isActive
                ? 'bg-nav-active'
                : 'opacity-0 group-hover:bg-nav-hover group-hover:opacity-100',
            )}
          />
          <span className="relative z-10 flex h-[30px] w-[50px] shrink-0 items-center justify-center">
            <Icon
              className={cn(
                'size-[22px] transition-colors',
                isActive
                  ? 'text-nav-text-active'
                  : 'text-nav-text group-hover:text-text-active',
              )}
            />
          </span>
          <span
            className={cn(
              'overflow-hidden whitespace-nowrap text-left text-[14px] font-medium leading-[20px] transition-all duration-200',
              expanded ? 'w-[90px] translate-x-0 opacity-100' : 'w-[0px] -translate-x-2 opacity-0',
              isActive ? 'text-text' : 'text-text-muted',
            )}
          >
            {label}
          </span>
        </>
      )}
    </NavLink>
  )

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#f4f4f6]">
      {/* ── 左侧导航栏 ── */}
      <aside
        className={cn(
          'relative z-40 flex h-full shrink-0 flex-col border-r border-[#e2e2e8] bg-[#f4f4f6] transition-all duration-300 ease-out',
          sidebarWidth,
        )}
      >
        {/* Logo 区：点 LOGO 切换折叠/展开，悬浮时变成折叠按钮图标 */}
        <div className="flex h-[60px] shrink-0 items-center px-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="group relative flex size-[34px] shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-nav-hover"
            title={expanded ? '收起侧栏' : '展开侧栏'}
          >
            {/* 默认：小怪兽 LOGO */}
            <img
              src="/icons/logo.svg"
              alt={t('brand.name')}
              className="absolute h-[28px] w-[28px] shrink-0 transition-all duration-200 group-hover:opacity-0 group-hover:scale-75"
            />
            {/* 悬浮：折叠/展开箭头图标 */}
            {expanded ? (
              <PanelLeftClose
                size={18}
                className="absolute text-text-muted opacity-0 transition-all duration-200 group-hover:opacity-100 group-hover:scale-100"
              />
            ) : (
              <PanelLeftOpen
                size={18}
                className="absolute text-text-muted opacity-0 transition-all duration-200 group-hover:opacity-100 group-hover:scale-100"
              />
            )}
          </button>
          <span
            className={cn(
              'overflow-hidden whitespace-nowrap text-[15px] font-bold leading-[22px] text-text transition-all duration-200 ease-out',
              expanded ? 'w-[60px] translate-x-0 opacity-100' : 'w-[0px] -translate-x-2 opacity-0',
            )}
          >
            {t('brand.name')}
          </span>
        </div>

        {/* 主导航 */}
        <nav className="flex-1 overflow-y-auto px-0 py-2">
          {navItems.map((item) =>
            renderItem(item.to, item.label, item.tooltip, item.icon, item.exact, item.preload, item.requireAuth),
          )}

          {/* 工具区 */}
          <div className="mt-2 border-t border-[#e2e2e8] pt-2">
            {utilityItems.map((item) => renderUtilityItem(item.to, item.label, item.tooltip, item.icon, item.requireAuth))}
          </div>
        </nav>

        {/* 底部：登录/退出登录 */}
        <div className="shrink-0 border-t border-[#e2e2e8] px-2 py-2">
          {isLoggedIn ? (
            /* 已登录：显示退出登录 */
            <button
              onClick={handleLogout}
              title="退出登录"
              className="group relative flex h-[44px] w-full items-center outline-none transition-transform duration-200 ease-out active:scale-[0.96]"
            >
              <span className="absolute left-[8px] top-1/2 h-[30px] w-[34px] -translate-y-1/2 rounded-full opacity-0 transition-all duration-200 group-hover:bg-nav-hover group-hover:opacity-100" />
              <span className="relative z-10 flex h-[30px] w-[50px] shrink-0 items-center justify-center">
                <LogOut className="size-[20px] text-text-muted transition-colors group-hover:text-red-400" />
              </span>
              {expanded && (
                <span className="whitespace-nowrap text-[14px] font-medium leading-[20px] text-text-muted transition-colors group-hover:text-red-400">
                  退出登录
                </span>
              )}
            </button>
          ) : (
            /* 未登录：显示登录按钮 */
            <button
              onClick={() => openAuthModal()}
              title="登录 / 注册"
              className="group relative flex h-[44px] w-full items-center outline-none transition-transform duration-200 ease-out active:scale-[0.96]"
            >
              <span className="absolute left-[8px] top-1/2 h-[30px] w-[34px] -translate-y-1/2 rounded-full opacity-0 transition-all duration-200 group-hover:bg-nav-hover group-hover:opacity-100" />
              <span className="relative z-10 flex h-[30px] w-[50px] shrink-0 items-center justify-center">
                <LogIn className="size-[20px] text-text-muted transition-colors group-hover:text-text" />
              </span>
              {expanded && (
                <span className="whitespace-nowrap text-[14px] font-medium leading-[20px] text-text-muted transition-colors group-hover:text-text">
                  登录 / 注册
                </span>
              )}
            </button>
          )}
          {expanded && (
            <div className="mt-2 px-1 text-[11px] leading-[16px] text-text-muted/50">
              v1.0.0
            </div>
          )}
        </div>
      </aside>

      {/* ── 右侧主内容区 ── */}
      <div className={cn(
        'flex min-w-0 flex-1 flex-col',
        !(isCanvas || isVideo) && 'app-brand',
      )}>

        {/* 内容区 */}
        <main
          className={cn(
            'relative flex-1 overflow-hidden',
            isCanvas && 'bg-transparent',
          )}
        >
          <Outlet />
        </main>
      </div>

      {/* 登录弹窗（全局：底部登录按钮、受保护导航、各页生成按钮均可触发） */}
      {authModalOpen && (
        <AuthModal
          onClose={() => closeAuthModal()}
          onSuccess={() => {
            // 登录成功后不刷新页面，保留用户未登录前输入的内容
            closeAuthModal()
          }}
        />
      )}
    </div>
  )
}