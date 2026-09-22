import { Upload, Type, Image, Settings2, Undo2, Redo2, ClipboardPaste } from 'lucide-react'
import type { NodeType } from './types'

export interface CreateMenuPos {
  x: number
  y: number
}

export interface CreateNodeMenuProps {
  position: CreateMenuPos | null
  onClose: () => void
  onAddNodeAt: (type: NodeType, x: number, y: number) => void
  onUndo: () => void
  onRedo: () => void
  onPaste: () => void
}

const item =
  'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] font-semibold text-[#bebebe] transition-colors hover:bg-[#303030]'
const hint = 'ml-auto text-[11px] font-medium text-[#6a6a6a]'

export function CreateNodeMenu({
  position,
  onClose,
  onAddNodeAt,
  onUndo,
  onRedo,
  onPaste,
}: CreateNodeMenuProps) {
  if (!position) return null
  const { x, y } = position

  const add = (type: NodeType) => () => {
    onAddNodeAt(type, x, y)
    onClose()
  }
  const run = (handler: () => void) => () => {
    handler()
    onClose()
  }

  return (
    <div
      className="absolute z-50 w-48 rounded-lg bg-[#1c1c1c] py-1 shadow-xl ring-1 ring-[#383838]"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button type="button" onClick={add('image')} className={item}>
        <Upload className="size-4" />
        <span>上传</span>
      </button>
      <button type="button" onClick={add('text')} className={item}>
        <Type className="size-4" />
        <span>文本节点</span>
      </button>
      <button type="button" onClick={add('image')} className={item}>
        <Image className="size-4" />
        <span>图片节点</span>
      </button>
      <button type="button" onClick={add('config')} className={item}>
        <Settings2 className="size-4" />
        <span>生成配置</span>
      </button>

      <div className="my-1 h-px bg-[#383838]" />

      <button type="button" onClick={run(onUndo)} className={item}>
        <Undo2 className="size-4" />
        <span>撤销</span>
        <span className={hint}>Ctrl Z</span>
      </button>
      <button type="button" onClick={run(onRedo)} className={item}>
        <Redo2 className="size-4" />
        <span>重做</span>
        <span className={hint}>Ctrl Shift Z</span>
      </button>
      <button type="button" onClick={run(onPaste)} className={item}>
        <ClipboardPaste className="size-4" />
        <span>粘贴</span>
        <span className={hint}>Ctrl V</span>
      </button>
    </div>
  )
}
