import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Compass,
  Bug,
  Lock,
  CloudOff,
  LogOut,
  FileQuestion,
  Home,
  ArrowLeft,
  RefreshCw,
  ChevronDown,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export type ErrorCode = '404' | '403' | '500' | '503' | '401' | 'gone'

const CODE_ICON: Record<ErrorCode, LucideIcon> = {
  '404': Compass,
  '403': Lock,
  '500': Bug,
  '503': CloudOff,
  '401': LogOut,
  'gone': FileQuestion,
}

interface ErrorStateProps {
  code: ErrorCode
  /** 500 时传入真实 Error，开发态可展开堆栈 */
  error?: Error | null
  /** 503 时自定义重试行为；不传则刷新页面 */
  onRetry?: () => void
  /** 传 true 时不占满全屏，只在父容器内居中（用于被 Layout 包裹的场景） */
  inline?: boolean
  className?: string
}

const BTN_PRIMARY =
  'inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-accent-foreground transition hover:bg-accent-hover active:scale-[0.98]'
const BTN_SECONDARY =
  'inline-flex h-10 items-center gap-2 rounded-xl bg-secondary px-5 text-sm font-semibold text-text-secondary transition hover:bg-surface-hover active:scale-[0.98]'

export function ErrorState({ code, error, onRetry, inline = false, className }: ErrorStateProps) {
  const { t } = useTranslation()
  const [showDetail, setShowDetail] = useState(false)
  const Icon = CODE_ICON[code]
  const isProd = import.meta.env.PROD

  const goHome = () => { window.location.href = '/' }
  const goBack = () => {
    if (window.history.length > 1) window.history.back()
    else window.location.href = '/'
  }
  const reload = () => window.location.reload()

  return (
    <div
      className={cn(
        'relative flex w-full items-center justify-center overflow-hidden bg-bg px-6',
        inline ? 'h-full min-h-[320px]' : 'h-dvh',
        className,
      )}
    >
      {/* 点阵背景：与 canvas 404 页同语言 */}
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(128,128,128,0.16) 1px, transparent 1.5px)',
          backgroundSize: '20px 20px',
        }}
      />
      <section className="relative w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-2xl bg-secondary text-text-secondary">
          <Icon className="size-7" />
        </div>
        <h1 className="text-2xl font-semibold text-text">
          {t(`errorState.codes.${code}.title`)}
        </h1>
        <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-text-muted">
          {t(`errorState.codes.${code}.desc`)}
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {code === '404' && (
            <>
              <button onClick={goBack} className={BTN_SECONDARY}>
                <ArrowLeft className="size-4" />
                {t('errorState.back')}
              </button>
              <button onClick={goHome} className={BTN_PRIMARY}>
                <Home className="size-4" />
                {t('errorState.backHome')}
              </button>
            </>
          )}

          {code === '500' && (
            <>
              <button onClick={reload} className={BTN_PRIMARY}>
                <RefreshCw className="size-4" />
                {t('errorState.refresh')}
              </button>
              <button onClick={goHome} className={BTN_SECONDARY}>
                <Home className="size-4" />
                {t('errorState.backHome')}
              </button>
            </>
          )}

          {code === '503' && (
            <>
              <button onClick={onRetry ?? reload} className={BTN_PRIMARY}>
                <RefreshCw className="size-4" />
                {t('errorState.retry')}
              </button>
              <button onClick={goHome} className={BTN_SECONDARY}>
                <Home className="size-4" />
                {t('errorState.backHome')}
              </button>
            </>
          )}

          {(code === '403' || code === 'gone') && (
            <button onClick={goHome} className={BTN_PRIMARY}>
              <Home className="size-4" />
              {t('errorState.backHome')}
            </button>
          )}

          {code === '401' && (
            <button onClick={goHome} className={BTN_PRIMARY}>
              {t('errorState.login')}
            </button>
          )}
        </div>

        {/* 500 错误详情：仅开发态可展开，避免线上暴露堆栈 */}
        {code === '500' && error && !isProd && (
          <div className="mt-8 text-left">
            <button
              onClick={() => setShowDetail((v) => !v)}
              className="mx-auto flex items-center gap-1 text-xs text-text-muted transition hover:text-text"
            >
              {t('errorState.detail')}
              <ChevronDown className={cn('size-3.5 transition-transform', showDetail && 'rotate-180')} />
            </button>
            {showDetail && (
              <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-surface-hover p-3 text-left text-[11px] leading-4 text-text-muted">
                {error.message}
                {'\n\n'}
                {error.stack}
              </pre>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
