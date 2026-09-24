import { Tooltip } from 'antd'
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
      <Tooltip title="复制">
        <button type="button" onClick={onCopy} className={btn}>
          <Copy className="size-4" />
        </button>
      </Tooltip>
      <Tooltip title="删除">
        <button type="button" onClick={onDelete} className={`${btn} text-red-400`}>
          <Trash2 className="size-4" />
        </button>
      </Tooltip>
      <Tooltip title="左对齐">
        <button type="button" onClick={() => onAlign('left')} className={btn}>
          <AlignStartVertical className="size-4" />
        </button>
      </Tooltip>
      <Tooltip title="水平居中">
        <button type="button" onClick={() => onAlign('hcenter')} className={btn}>
          <AlignCenterVertical className="size-4" />
        </button>
      </Tooltip>
      <Tooltip title="右对齐">
        <button type="button" onClick={() => onAlign('right')} className={btn}>
          <AlignEndVertical className="size-4" />
        </button>
      </Tooltip>
      <Tooltip title="顶对齐">
        <button type="button" onClick={() => onAlign('top')} className={btn}>
          <AlignStartHorizontal className="size-4" />
        </button>
      </Tooltip>
      <Tooltip title="垂直居中">
        <button type="button" onClick={() => onAlign('vcenter')} className={btn}>
          <AlignCenterHorizontal className="size-4" />
        </button>
      </Tooltip>
      <Tooltip title="底对齐">
        <button type="button" onClick={() => onAlign('bottom')} className={btn}>
          <AlignEndHorizontal className="size-4" />
        </button>
      </Tooltip>
      <Tooltip title="分组">
        <button type="button" onClick={onGroup} className={btn}>
          <Maximize2 className="size-4" />
        </button>
      </Tooltip>
    </div>
  )
}
