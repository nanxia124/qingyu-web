import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Rocket, Loader2, CheckCircle2, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'

const stages = [
  { id: 'market', label: 'pages.plan.market' },
  { id: 'vision', label: 'pages.plan.vision' },
  { id: 'compliance', label: 'pages.plan.compliance' },
  { id: 'export', label: 'pages.plan.export' },
]

export default function PlanPage() {
  const { t } = useTranslation()
  const [product, setProduct] = useState('')
  const [target, setTarget] = useState('')
  const [running, setRunning] = useState(false)
  const [currentStage, setCurrentStage] = useState<string | null>(null)

  const start = () => {
    if (!product.trim() || running) return
    setRunning(true)
    setCurrentStage('market')
    const stageList = ['market', 'vision', 'compliance', 'export']
    stageList.forEach((s, i) => {
      setTimeout(() => setCurrentStage(s), (i + 1) * 700)
    })
    setTimeout(() => {
      setCurrentStage(null)
      setRunning(false)
    }, stageList.length * 700 + 300)
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      {/* 输入卡片 */}
      <div className="mb-6 rounded-xl bg-card p-6">
        <h3 className="flex items-center gap-2 text-[18px] font-bold leading-[26px] text-text">
          <Rocket className="size-5 text-accent" />
          {t("pages.plan.title")}
        </h3>
        <p className="mt-1 text-[12px] leading-[18px] text-text-muted">
          {t("pages.plan.subtitle")}
        </p>

        <div className="mt-4 space-y-3">
          <input
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            placeholder={t("pages.plan.productPh")}
            className="w-full rounded-lg bg-input px-3 py-2.5 text-[14px] text-text outline-none placeholder:text-text-muted focus:ring-1 focus:ring-accent"
          />
          <textarea
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            rows={3}
            placeholder={t("pages.plan.bgPh")}
            className="w-full resize-none rounded-lg bg-input px-3 py-2.5 text-[14px] text-text outline-none placeholder:text-text-muted focus:ring-1 focus:ring-accent"
          />
          <button
            onClick={start}
            disabled={!product.trim() || running}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-[14px] font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            {running ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
            {running ? t('pages.plan.running') : t('pages.plan.start')}
          </button>
        </div>
      </div>

      {/* 阶段指示 */}
      <div className="flex items-center gap-2">
        {stages.map((s, i) => (
          <div key={s.id} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                'flex flex-1 items-center gap-2 rounded-lg px-3 py-2.5 text-[14px] transition-colors',
                currentStage === s.id
                  ? 'bg-accent-soft text-accent-soft-text'
                  : 'bg-card text-text-muted',
              )}
            >
              {currentStage === s.id ? (
                <Loader2 className="size-4 animate-spin text-accent" />
              ) : currentStage !== null &&
                stages.findIndex((x) => x.id === currentStage) > i ? (
                <CheckCircle2 className="size-4 text-success" />
              ) : (
                <Circle className="size-4" />
              )}
              <span className="hidden sm:inline">{s.label}</span>
            </div>
            {i < stages.length - 1 && <div className="h-px w-2 bg-border" />}
          </div>
        ))}
      </div>
    </div>
  )
}