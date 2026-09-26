import { useState, useRef, useEffect, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ConfirmPopoverProps {
  title: string
  confirmText?: string
  cancelText?: string
  onConfirm: () => void
  children: ReactNode
  className?: string
}

export function ConfirmPopover({ title, confirmText = '确认', cancelText = '取消', onConfirm, children, className }: ConfirmPopoverProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  return (
    <div ref={rootRef} className={cn('relative inline-flex', className)}>
      <div onClick={() => setOpen((v) => !v)}>{children}</div>
      {open && (
        <div className="absolute right-0 top-[calc(100%+4px)] z-50 w-48 rounded-xl bg-card p-3 shadow-xl shadow-black/40">
          <p className="text-[13px] leading-[18px] text-text">{title}</p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => setOpen(false)}
              className="rounded-md px-2.5 py-1 text-[12px] text-text-secondary hover:bg-surface-hover transition-colors"
            >
              {cancelText}
            </button>
            <button
              onClick={() => { setOpen(false); onConfirm() }}
              className="rounded-md bg-danger px-2.5 py-1 text-[12px] text-white hover:opacity-90 transition-opacity"
            >
              {confirmText}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
