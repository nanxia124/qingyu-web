import { useEffect } from 'react'
import { createPortal } from 'react-dom'

interface ToastProps {
  msg: string
  type: 'success' | 'error'
  action?: { label: string; onClick: () => void }
  pos?: 'top' | 'input'
  onClose: () => void
}

export function Toast({ msg, type, action, pos = 'top', onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000)
    return () => clearTimeout(timer)
  }, [onClose])

  if (pos === 'input') {
    return (
      <span className="absolute bottom-full right-0 mb-1 flex items-center gap-1.5 whitespace-nowrap rounded-full bg-success/15 px-2.5 py-1 text-[12px] text-success shadow-lg">
        <svg className="size-3" viewBox="0 0 12 12" fill="none"><path d="M2 6.5L4.5 9L10 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        {msg}
        {action && (
          <button
            onClick={() => { action.onClick(); onClose() }}
            className="ml-1 border-l border-white/20 pl-1.5 font-semibold text-white/80 hover:text-white"
          >
            {action.label}
          </button>
        )}
      </span>
    )
  }

  return createPortal(
    <div className={`fixed left-1/2 top-6 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] shadow-xl ${
      type === 'success' ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'
    }`}>
      {msg}
      {action && (
        <button
          onClick={() => { action.onClick(); onClose() }}
          className="ml-2 border-l border-white/20 pl-2 font-medium hover:opacity-80"
        >
          {action.label}
        </button>
      )}
    </div>,
    document.body
  )
}
