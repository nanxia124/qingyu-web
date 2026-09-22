import {
  Copy,
  Trash2,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  Maximize2,
} from 'lucide-react'

export type AlignType = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

export interface SelectionToolbarProps {
  x: number
  y: number
  count: number
  onCopy: () => void
  onDelete: () => void
  onAlign: (type: AlignType) => void
  onGroup: () => void
}

const btn =
  'flex size-7 items-center justify-center rounded-lg text-[#bebebe] transition-colors hover:bg-[#303030]'

export function SelectionToolbar({ x, y, count, onCopy, onDelete, onAlign, onGroup }: SelectionToolbarProps) {
  if (count <= 1) return null

  return (
    <div
      className="absolute z-50 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-[#1c1c1c] p-1.5 ring-1 ring-[#383838]"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button type="button" onClick={onCopy} className={btn} data-tip="复制">
        <Copy className="size-4" />
      </button>
      <button type="button" onClick={onDelete} className={`${btn} text-red-400`} data-tip="删除">
        <Trash2 className="size-4" />
      </button>
      <button type="button" onClick={() => onAlign('left')} className={btn} data-tip="左对齐">
        <AlignStartVertical className="size-4" />
      </button>
      <button type="button" onClick={() => onAlign('hcenter')} className={btn} data-tip="水平居中">
        <AlignCenterVertical className="size-4" />
      </button>
      <button type="button" onClick={() => onAlign('right')} className={btn} data-tip="右对齐">
        <AlignEndVertical className="size-4" />
      </button>
      <button type="button" onClick={() => onAlign('top')} className={btn} data-tip="顶对齐">
        <AlignStartHorizontal className="size-4" />
      </button>
      <button type="button" onClick={() => onAlign('vcenter')} className={btn} data-tip="垂直居中">
        <AlignCenterHorizontal className="size-4" />
      </button>
      <button type="button" onClick={() => onAlign('bottom')} className={btn} data-tip="底对齐">
        <AlignEndHorizontal className="size-4" />
      </button>
      <button type="button" onClick={onGroup} className={btn} data-tip="分组">
        <Maximize2 className="size-4" />
      </button>
    </div>
  )
}
