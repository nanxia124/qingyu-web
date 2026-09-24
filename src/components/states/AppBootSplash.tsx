import { useTranslation } from 'react-i18next'

/**
 * 首屏启动全屏等待：应用 bootstrap / 拉配置 / 拉用户信息期间展示。
 * 居中品牌光晕 + 一行提示语，不要空转 spinner。
 */
export function AppBootSplash() {
  const { t } = useTranslation()
  return (
    <div className="flex h-dvh w-full flex-col items-center justify-center gap-6 bg-bg">
      <div className="relative flex size-16 items-center justify-center">
        <div className="absolute inset-0 animate-ping rounded-full bg-accent/20" />
        <div className="relative flex size-12 items-center justify-center rounded-2xl bg-accent/10">
          <div className="size-5 rounded-md bg-accent" />
        </div>
      </div>
      <p className="text-sm text-text-muted">{t('loading.boot')}</p>
    </div>
  )
}
