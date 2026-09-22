import { Copy, Lock, LockOpen, Trash2, X } from 'lucide-react'
import type { CanvasNode } from './types'

export function NodeHoverToolbar({
  node,
  onClose,
  onCopy,
  onDelete,
  onToggleLock,
  onFontSizeDelta,
}: {
  node: CanvasNode
  onClose?: () => void
  onCopy: (node: CanvasNode) => void
  onDelete: (node: CanvasNode) => void
  onToggleLock: (node: CanvasNode) => void
  onFontSizeDelta: (nodeId: string, delta: number) => void
}) {
  const isText = node.type === 'text'

  return (
    <div className="absolute -top-12 left-1/2 z-50 flex -translate-x-1/2 items-center gap-0.5 rounded-xl bg-[#1c1c1c] p-1 ring-1 ring-[#383838] shadow-xl">
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onCopy(node)}
        className="flex size-7 items-center justify-center rounded-lg text-[#bebebe] hover:bg-[#303030]"
        title="复制"
      >
        <Copy className="size-4" />
      </button>

      {isText && (
        <>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onFontSizeDelta(node.id, -1)}
            className="flex size-7 items-center justify-center rounded-lg text-[12px] font-semibold text-[#bebebe] hover:bg-[#303030]"
            title="减小字号"
          >
            A-
          </button>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onFontSizeDelta(node.id, 1)}
            className="flex size-7 items-center justify-center rounded-lg text-[12px] font-semibold text-[#bebebe] hover:bg-[#303030]"
            title="增大字号"
          >
            A+
          </button>
        </>
      )}

      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onToggleLock(node)}
        className="flex size-7 items-center justify-center rounded-lg text-[#bebebe] hover:bg-[#303030]"
        title={node.locked ? '解锁' : '锁定'}
      >
        {node.locked ? <Lock className="size-4" /> : <LockOpen className="size-4" />}
      </button>

      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onDelete(node)}
        className="flex size-7 items-center justify-center rounded-lg text-red-400 hover:bg-[#303030]"
        title="删除"
      >
        <Trash2 className="size-4" />
      </button>

      {onClose && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
          className="flex size-7 items-center justify-center rounded-lg text-[#9e9e99] hover:bg-[#303030]"
          title="关闭"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}
