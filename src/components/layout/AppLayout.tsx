import { useState, useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Tooltip } from 'antd'
import {
  Settings,
  MessageSquareWarning,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Users,
  User,
  CreditCard,
  Globe,
  Crown,
  Languages,
  ClipboardList,
  Search,
  Bell,
  Gift,
  Coins,
} from 'lucide-react'
import EnvironmentBadge from '@/components/EnvironmentBadge'
import { cn } from '@/lib/utils'
import AuthModal from '@/components/AuthModal'
import InviteModal from '@/components/InviteModal'
import { RouteErrorBoundary } from '@/components/states/RouteErrorBoundary'
import { useAuthStore } from '@/stores/useAuthStore'
import i18n, { changeAppLocale, onLanguageSuggestion, type AppLocale } from '@canvas/i18n'
import {
  SidebarHomeIcon,
  SidebarChatIcon,
  SidebarImageIcon,
  SidebarVideoIcon,
  SidebarCanvasIcon,
  SidebarTeamIcon,
  SidebarFavoriteIcon,
  QingyuLogoIcon,
} from './SidebarIcons'

// 统一接受自定义 SVG 图标和 lucide-react 图标。
type IconComp = React.ComponentType<{ className?: string }>

const navItems: { to: string; label: string; tooltip: string; icon: IconComp; exact?: boolean; preload?: () => void; requireAuth?: boolean }[] = [
  { to: '/', label: 'nav.home', tooltip: 'nav.home', icon: SidebarHomeIcon, exact: true },
  { to: '/chat', label: 'nav.chat', tooltip: 'nav.chat', icon: SidebarChatIcon },
  { to: '/image', label: 'nav.image', tooltip: 'nav.image', icon: SidebarImageIcon },
  { to: '/video', label: 'nav.video', tooltip: 'nav.video', icon: SidebarVideoIcon },
  { to: '/canvas?mode=recent', label: 'nav.canvas', tooltip: 'nav.canvas', icon: SidebarCanvasIcon, preload: () => { void import('@canvas/index') } },
  { to: '/assets', label: 'nav.assets', tooltip: 'nav.assets', icon: SidebarTeamIcon, requireAuth: true },
  { to: '/favorites', label: 'nav.favorites', tooltip: 'nav.favorites', icon: SidebarFavoriteIcon, requireAuth: true },
  { to: '/plan', label: 'nav.plan', tooltip: 'nav.plan', icon: ClipboardList },
]

const utilityItems: { to: string; label: string; tooltip: string; icon: typeof Settings; requireAuth?: boolean }[] = [
  { to: '/teams', label: 'nav.teams', tooltip: 'nav.teams', icon: Users, requireAuth: true },
]

const pageTitleKeys: Record<string, string> = {
  '/': 'nav.home',
  '/chat': 'nav.chat',
  '/image': 'nav.image',
  '/video': 'nav.video',
  '/canvas': 'nav.canvas',
  '/assets': 'nav.assets',
  '/favorites': 'nav.favorites',
  '/subscription': 'nav.subscription',
  '/translate': 'nav.translate',
  '/plan': 'nav.plan',
  '/feedback': 'nav.teams',
  '/settings': 'nav.teams',
}

export default function AppLayout() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(() => localStorage.getItem('sidebar-expanded') === 'true')
  const currentTitleKey = pageTitleKeys[location.pathname]
  const currentTitle = currentTitleKey ? t(currentTitleKey) : t('brand.name')

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


  // ── 语言 ──
  const [currentLocale, setCurrentLocale] = useState<AppLocale>(i18n.resolvedLanguage as AppLocale)
  const [langMenuOpen, setLangMenuOpen] = useState(false)
  const langMenuRef = useRef<HTMLDivElement>(null)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [inviteModalOpen, setInviteModalOpen] = useState(false)
  const [suggested, setSuggested] = useState<{ locale: AppLocale; country?: string } | null>(null)

  useEffect(() => {
    const onChange = (lng: string) => setCurrentLocale(lng as AppLocale)
    i18n.on('languageChanged', onChange)
    // 首次访问、未手动选择时，检测到不同语言则 toast 询问（不自动切换）
    const unsub = onLanguageSuggestion((detected) => setSuggested(detected))
    return () => { i18n.off('languageChanged', onChange); unsub() }
  }, [])

  useEffect(() => {
    if (!suggested) return
    const timer = window.setTimeout(() => setSuggested(null), 4500)
    return () => window.clearTimeout(timer)
  }, [suggested])

  // 点击语言菜单外部时关闭
  useEffect(() => {
    if (!langMenuOpen) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) {
        setLangMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [langMenuOpen])

  const pickLocale = (loc: AppLocale) => {
    void changeAppLocale(loc)
    setCurrentLocale(loc)
    setLangMenuOpen(false)
    setSuggested(null)
  }

  const LANG_LABELS: Record<string, string> = {
    'zh-CN': '简体中文', 'zh-TW': '繁體中文', 'en-US': 'English', 'ja-JP': '日本語',
    'ko-KR': '한국어', 'es-ES': 'Español', 'fr-FR': 'Français', 'de-DE': 'Deutsch',
    'ru-RU': 'Русский', 'pt-BR': 'Português', 'it-IT': 'Italiano', 'ar-SA': 'العربية',
    'tr-TR': 'Türkçe', 'hi-IN': 'हिन्दी', 'th-TH': 'ไทย', 'vi-VN': 'Tiếng Việt',
    'id-ID': 'Bahasa Indonesia',
  }
  // 菜单里只显示这些语言；其余语言资源保留但不展示，以后想恢复直接加进这个数组即可
  const VISIBLE_LOCALES: AppLocale[] = ['en-US', 'ja-JP', 'ko-KR', 'es-ES', 'zh-CN', 'zh-TW']
  // 中文（简/繁）排到最下面，其余按 VISIBLE_LOCALES 顺序
  const sortedLocales = [
    ...VISIBLE_LOCALES.filter((l) => !l.startsWith('zh-')),
    ...VISIBLE_LOCALES.filter((l) => l.startsWith('zh-')),
  ]

  const isCanvas = location.pathname.startsWith('/canvas')
  const isVideo = location.pathname.startsWith('/video')

  const sidebarWidth = expanded ? 'w-[148px]' : 'w-[56px]'

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
    <Tooltip title={t(tooltip)}>
    <NavLink
      key={to + label}
      to={to}
      end={exact}
      onClick={requireAuthClick(requireAuth)}
      className="group relative flex h-[44px] w-full items-center justify-start outline-none transition-transform duration-200 ease-out active:scale-[0.96]"
      style={{ transformOrigin: '50% 50%' }}
      onMouseEnter={preload}
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              'absolute top-1/2 -translate-y-1/2 rounded-full transition-all duration-200',
              expanded ? 'left-[8px] h-[30px] w-[132px]' : 'left-[13px] h-[30px] w-[30px]',
              isActive
                ? 'bg-nav-active'
                : 'opacity-0 group-hover:bg-nav-hover group-hover:opacity-100',
            )}
          />
          <span className="absolute left-[3px] top-1/2 z-10 flex h-[30px] w-[50px] -translate-y-1/2 items-center justify-center">
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
              expanded ? 'ml-[60px] w-[84px] translate-x-0 opacity-100' : 'w-[0px] -translate-x-2 opacity-0',
              isActive ? 'text-text' : 'text-text-muted',
            )}
          >
            {t(label)}
          </span>
        </>
      )}
    </NavLink>
    </Tooltip>
  )

  const renderUtilityItem = (
    to: string,
    label: string,
    tooltip: string,
    Icon: typeof Settings,
    requireAuth?: boolean,
  ) => (
    <Tooltip title={t(tooltip)}>
    <NavLink
      key={to}
      to={to}
      onClick={requireAuthClick(requireAuth)}
      className="group relative flex h-[44px] w-full items-center justify-start outline-none transition-transform duration-200 ease-out active:scale-[0.96]"
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              'absolute top-1/2 -translate-y-1/2 rounded-full transition-all duration-200',
              expanded ? 'left-[8px] h-[30px] w-[132px]' : 'left-[13px] h-[30px] w-[30px]',
              isActive
                ? 'bg-nav-active'
                : 'opacity-0 group-hover:bg-nav-hover group-hover:opacity-100',
            )}
          />
          <span className="absolute left-[3px] top-1/2 z-10 flex h-[30px] w-[50px] -translate-y-1/2 items-center justify-center">
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
              expanded ? 'ml-[60px] w-[84px] translate-x-0 opacity-100' : 'w-[0px] -translate-x-2 opacity-0',
              isActive ? 'text-text' : 'text-text-muted',
            )}
          >
            {t(label)}
          </span>
        </>
      )}
    </NavLink>
    </Tooltip>
  )

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-bg">
      {/* 全局顶部栏：只放站点级功能，页面内部标签继续留在主内容区 */}
      <header className="relative z-50 flex h-[56px] shrink-0 items-center gap-4 bg-nav-bg px-3">
        <div className="relative flex h-[44px] w-[220px] shrink-0 items-center gap-[10px]">
          <Tooltip title={expanded ? '收起侧栏' : '展开侧栏'}>
          <button
            onClick={() => { const next = !expanded; setExpanded(next); localStorage.setItem('sidebar-expanded', String(next)) }}
            className="group relative flex size-[34px] shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-nav-hover"
          >
            <QingyuLogoIcon className="absolute h-[28px] w-[28px] shrink-0 text-text transition-all duration-200 group-hover:opacity-0 group-hover:scale-75" />
            {expanded ? <PanelLeftClose size={18} className="absolute text-text-muted opacity-0 transition-all duration-200 group-hover:opacity-100 group-hover:scale-100" /> : <PanelLeftOpen size={18} className="absolute text-text-muted opacity-0 transition-all duration-200 group-hover:opacity-100 group-hover:scale-100" />}
          </button>
          </Tooltip>
          <Tooltip title="返回首页">
            <button
              type="button"
              onClick={() => navigate("/")}
              className="flex h-8 w-[104px] items-center overflow-hidden whitespace-nowrap rounded-md transition-opacity hover:opacity-80"
            >
              <img src="/litzone-wordmark.svg" alt="litzone" className="mt-[2px] h-[38px] w-auto max-w-none object-contain dark:invert" />
            </button>
          </Tooltip>
          <span className="absolute left-[160px] top-1/2 -translate-y-1/2"><EnvironmentBadge /></span>
        </div>
        {location.pathname === '/' && (
          <div className="hidden min-w-0 max-w-[560px] flex-1 md:flex">
            <label className="flex h-9 w-full items-center gap-2 rounded-xl bg-surface-hover px-3 text-text-muted transition-colors focus-within:bg-surface">
              <Search size={16} className="shrink-0" />
              <input
                value={new URLSearchParams(location.search).get('q') || ''}
                onChange={(e) => navigate(e.target.value ? `/?q=${encodeURIComponent(e.target.value)}` : '/')}
                className="home-search-input h-full min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-muted"
                placeholder="搜索灵感、作品、教程..."
                aria-label="全局搜索"
              />
            </label>
          </div>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Tooltip title="通知"><button className="relative flex size-9 items-center justify-center rounded-xl text-text-muted hover:bg-nav-hover hover:text-text"><Bell size={17} /><span className="absolute right-2 top-2 size-1.5 rounded-full bg-accent" /></button></Tooltip>
          <button onClick={() => (isLoggedIn ? setInviteModalOpen(true) : openAuthModal())} className="hidden items-center gap-1.5 rounded-xl border border-border bg-transparent px-3 py-2 text-xs font-semibold text-text-secondary hover:bg-surface-hover hover:text-text sm:flex"><Gift size={14} />邀请有礼</button>
          <button onClick={() => navigate('/wallet')} className="hidden items-center gap-1.5 rounded-xl border border-border bg-transparent px-3 py-2 text-xs font-semibold text-text-secondary hover:bg-surface-hover hover:text-text sm:flex"><Coins size={14} />积分商城</button>
          <button onClick={() => navigate('/subscription')} className="hidden items-center gap-1.5 rounded-xl border border-border bg-transparent px-3 py-2 text-xs font-semibold text-text-secondary hover:bg-surface-hover hover:text-text sm:flex"><Crown size={14} />订阅</button>
          {/* 我的：未登录点此弹登录；已登录弹出账号菜单 */}
          <div className="relative">
            <Tooltip title={t("nav.my")}>
            <button
              onClick={() => (isLoggedIn ? setAccountMenuOpen((v) => !v) : openAuthModal())}
              aria-expanded={isLoggedIn ? accountMenuOpen : undefined}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-transparent px-3 py-2 text-xs font-semibold text-text-secondary hover:bg-surface-hover hover:text-text"
            >
              <User size={14} />
              <span className="whitespace-nowrap">{t('nav.my')}</span>
            </button>
            </Tooltip>
            {isLoggedIn && accountMenuOpen && (
              <div className="absolute right-0 top-full mt-2 z-50 w-[160px] rounded-xl bg-card p-1 shadow-xl">
                {[
                  { label: '个人中心', to: '/account/profile' },
                  { label: '账单', to: '/account/billing' },
                  { label: '订阅', to: '/subscription' },
                  { label: '钱包', to: '/wallet' },
                  { label: '反馈', to: '/feedback' },
                  { label: '设置', to: '/settings' },
                ].map((item) => (
                  <button
                    key={item.to}
                    onClick={() => { setAccountMenuOpen(false); navigate(item.to) }}
                    className="flex w-full items-center rounded-lg px-3 py-2 text-[13px] text-text transition-colors hover:bg-secondary"
                  >
                    {item.label}
                  </button>
                ))}
                <div className="my-1 h-1" />
                <button
                  onClick={() => { setAccountMenuOpen(false); handleLogout() }}
                  className="flex w-full items-center rounded-lg px-3 py-2 text-[13px] text-red-400 transition-colors hover:bg-secondary"
                >
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
      {/* ── 左侧导航栏 ── */}
      <aside
        className={cn(
          'relative z-40 flex h-full shrink-0 flex-col bg-nav-bg transition-all duration-300 ease-out',
          sidebarWidth,
        )}
      >
        {/* 主导航 */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-0 pt-3 pb-2">
          {navItems.map((item) =>
            renderItem(item.to, item.label, item.tooltip, item.icon, item.exact, item.preload, item.requireAuth),
          )}

          {/* 工具区 */}
          <div className="mt-auto border-t border-border pt-2">
            {utilityItems.map((item) => renderUtilityItem(item.to, item.label, item.tooltip, item.icon, item.requireAuth))}
          </div>
        </nav>

        {/* 底部：语言切换 */}
        <div className="shrink-0 border-t border-border px-2 py-2">
          {/* 语言切换：点击按钮展开/收起，点击外部关闭 */}
          <div
            ref={langMenuRef}
            className="relative"
          >
            <Tooltip title={t("nav.language")}>
            <button
              onClick={() => setLangMenuOpen((v) => !v)}
              aria-expanded={langMenuOpen}
              className="group relative flex h-[44px] w-full items-center outline-none transition-transform duration-200 ease-out active:scale-[0.96]"
            >
              <span className="absolute left-[8px] top-1/2 h-[30px] w-[34px] -translate-y-1/2 rounded-full opacity-0 transition-all duration-200 group-hover:bg-nav-hover group-hover:opacity-100" />
              <span className="relative z-10 flex h-[30px] w-[50px] shrink-0 items-center justify-center">
                <Globe className="size-[20px] text-text-muted transition-colors group-hover:text-text" />
              </span>
              {expanded && (
                <span className="whitespace-nowrap text-[14px] font-medium leading-[20px] text-text-muted transition-colors group-hover:text-text">
                  {LANG_LABELS[currentLocale] ?? currentLocale}
                </span>
              )}
            </button>
            </Tooltip>
            {langMenuOpen && (
              <div className="absolute left-0 bottom-full z-50 w-[168px] pb-2">
                <div className="rounded-xl bg-card p-1 shadow-xl">
                  {sortedLocales.map((loc) => (
                    <button
                      key={loc}
                      onClick={() => pickLocale(loc)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors',
                        loc === currentLocale ? 'bg-accent/10 text-accent' : 'text-text hover:bg-secondary',
                      )}
                    >
                      <span className="flex-1 truncate text-left">{LANG_LABELS[loc] ?? loc}</span>
                      {loc === currentLocale && <span className="size-1.5 shrink-0 rounded-full bg-accent" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>
      </aside>

      {/* ── 右侧主内容区 ── */}
      <div className={cn(
        'flex min-w-0 flex-1 flex-col',
        !(isCanvas || isVideo) && 'app-brand',
      )}>

        {/* 内容区：页面级错误只替换内容区，保留侧栏和顶栏 */}
        <main
          className={cn(
            'relative flex-1 overflow-hidden',
            isCanvas && 'bg-transparent',
            !(isCanvas || isVideo) && 'rounded-tl-[16px]',
          )}
        >
          <RouteErrorBoundary inline>
            <Outlet />
          </RouteErrorBoundary>
        </main>
      </div>
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

      {/* 邀请有礼弹窗 */}
      {inviteModalOpen && <InviteModal onClose={() => setInviteModalOpen(false)} />}

      {/* 首次访问语言建议：顶部居中提示，不阻塞页面操作 */}
      {suggested && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex justify-center px-4">
          <div
            role="status"
            className="pointer-events-auto flex w-full max-w-3xl flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-border bg-card px-5 py-4 shadow-2xl animate-[languageToastIn_0.35s_ease-out]"
          >
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2">
                <Globe className="size-[18px] shrink-0 text-accent" />
                <span className="text-[15px] font-semibold text-text">语言检测</span>
              </div>
              <p className="text-[14px] leading-[22px] text-text-secondary">
                检测到您的 IP 可能来自 {suggested.country || '当前地区'}，是否切换到{LANG_LABELS[suggested.locale] ?? suggested.locale}？
              </p>
            </div>
            <div className="flex shrink-0 gap-3">
              <button
                onClick={() => pickLocale(suggested.locale)}
                className="rounded-lg bg-accent px-6 py-2 text-[14px] font-medium text-accent-foreground hover:bg-accent-hover"
              >
                切换
              </button>
              <button
                onClick={() => setSuggested(null)}
                className="rounded-lg bg-secondary px-6 py-2 text-[14px] text-text-secondary hover:bg-surface-hover"
              >
                保持当前
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
