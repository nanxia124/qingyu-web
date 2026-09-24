import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

type ModelPickerProps = {
  models: string[]
  value: string
  onChange: (model: string) => void
  placeholder?: string
  className?: string
}

export function ModelPicker({ models, value, onChange, placeholder = '暂未获取到模型', className }: ModelPickerProps) {
  const [open, setOpen] = useState(false)
  const current = value && models.includes(value) ? value : models[0] || ''

  useEffect(() => {
    if (models[0] && value !== models[0]) onChange(models[0])
  }, [models, onChange, value])

  return (
    <div className={cn('relative', className)}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-full items-center justify-between rounded-full border border-border bg-transparent px-4 hover:border-border transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Sparkles className="size-3.5 shrink-0 text-text-secondary" />
          <span className="truncate text-[14px] text-text">{current || placeholder}</span>
        </span>
        <svg className={cn('size-3.5 shrink-0 text-text-secondary transition-transform', open && 'rotate-180')} viewBox="0 0 12 8" fill="none">
          <path d="M1 1L6 6L11 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-[40px] z-20 overflow-hidden rounded-xl bg-[#292929] shadow-xl shadow-black/50 ring-1 ring-border">
          {models.map((m) => (
            <button
              key={m}
              onClick={() => { onChange(m); setOpen(false) }}
              className={cn(
                'flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13px] hover:bg-surface-hover transition-colors',
                m === current ? 'text-accent' : 'text-text',
              )}
            >
              <Sparkles className="size-3.5 shrink-0 opacity-60" />
              <span className="truncate">{m}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
