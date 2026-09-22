import { Copy, Download, Trash2 } from 'lucide-react'
import type { CanvasNode } from './types'

export interface ContextMenuPos {
  x: number
  y: number
  nodeId: string
}

export interface CanvasContextMenuProps {
  position: ContextMenuPos | null
  node?: CanvasNode
  onClose: () => void
  onCopy: () => void
  onDelete: () => void
  onDownloadImage?: () => void
  onAction?: (action: string) => void
}

const item =
  'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] font-semibold text-[#bebebe] transition-colors hover:bg-[#303030]'

export function CanvasContextMenu({
  position,
  node,
  onClose,
  onCopy,
  onDelete,
  onDownloadImage,
  onAction,
}: CanvasContextMenuProps) {
  if (!position) return null

  const run = (action: string, handler: () => void) => () => {
    onAction?.(action)
    handler()
    onClose()
  }

  return (
    <div
      className="absolute z-50 w-40 rounded-lg bg-[#1c1c1c] py-1 shadow-xl ring-1 ring-[#383838]"
      style={{ left: position.x, top: position.y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button type="button" onClick={run('copy', onCopy)} className={item}>
        <Copy className="size-4" />
        <span>复制</span>
      </button>

      {node?.type === 'image' && onDownloadImage && (
        <button type="button" onClick={run('download-image', onDownloadImage)} className={item}>
          <Download className="size-4" />
          <span>下载图片</span>
        </button>
      )}

      <button type="button" onClick={run('delete', onDelete)} className={`${item} text-red-400`}>
        <Trash2 className="size-4" />
        <span>删除</span>
      </button>

      <div className="my-1 h-px bg-[#383838]" />

      <button type="button" onClick={run('cancel', onClose)} className={item}>
        <span>取消</span>
      </button>
    </div>
  )
}
