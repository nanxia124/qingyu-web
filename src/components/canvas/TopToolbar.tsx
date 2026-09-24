import { Tooltip } from 'antd'
import {
  MousePointer2,
  Hand,
  Type,
  Image,
  Settings2,
  Copy,
  ClipboardPaste,
  Trash2,
  Undo2,
  Redo2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Tool, NodeType } from './types'

export interface TopToolbarProps {
  tool: Tool
  onToolChange: (tool: Tool) => void
  onAddNode: (type: NodeType) => void
  onCopy: () => void
  onPaste: () => void
  onDelete: () => void
  onUndo: () => void
  onRedo: () => void
  canUndo?: boolean
  canRedo?: boolean
}

const btn =
  'flex size-8 items-center justify-center rounded-lg text-[#9e9e99] transition-colors hover:bg-[#303030] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent'
const activeBtn = 'bg-[#5051F8] text-white hover:bg-[#5051F8]'
const divider = 'mx-1 h-5 w-px bg-[#383838]'

export function TopToolbar({
  tool,
  onToolChange,
  onAddNode,
  onCopy,
  onPaste,
  onDelete,
  onUndo,
  onRedo,
  canUndo = true,
  canRedo = true,
}: TopToolbarProps) {
  return (
    <div className="flex items-center gap-1 rounded-xl bg-[#1c1c1c] p-1.5 ring-1 ring-[#383838]">
      <Tooltip title="选择">
        <button
          type="button"
          onClick={() => onToolChange('select')}
          className={cn(btn, tool === 'select' && activeBtn)}
        >
          <MousePointer2 className="size-4" />
        </button>
      </Tooltip>
      <Tooltip title="平移">
        <button
          type="button"
          onClick={() => onToolChange('pan')}
          className={cn(btn, tool === 'pan' && activeBtn)}
        >
          <Hand className="size-4" />
        </button>
      </Tooltip>

      <div className={divider} />

      <Tooltip title="文本节点">
        <button type="button" onClick={() => onAddNode('text')} className={btn}>
          <Type className="size-4" />
        </button>
      </Tooltip>
      <Tooltip title="图片节点">
        <button type="button" onClick={() => onAddNode('image')} className={btn}>
          <Image className="size-4" />
        </button>
      </Tooltip>
      <Tooltip title="生成配置">
        <button type="button" onClick={() => onAddNode('config')} className={btn}>
          <Settings2 className="size-4" />
        </button>
      </Tooltip>

      <div className={divider} />

      <Tooltip title="复制">
        <button type="button" onClick={onCopy} className={btn}>
          <Copy className="size-4" />
        </button>
      </Tooltip>
      <Tooltip title="粘贴">
        <button type="button" onClick={onPaste} className={btn}>
          <ClipboardPaste className="size-4" />
        </button>
      </Tooltip>
      <Tooltip title="删除">
        <button type="button" onClick={onDelete} className={cn(btn, 'hover:text-red-400')}>
          <Trash2 className="size-4" />
        </button>
      </Tooltip>

      <div className={divider} />

      <Tooltip title="撤销">
        <button type="button" onClick={onUndo} disabled={!canUndo} className={btn}>
          <Undo2 className="size-4" />
        </button>
      </Tooltip>
      <Tooltip title="重做">
        <button type="button" onClick={onRedo} disabled={!canRedo} className={btn}>
          <Redo2 className="size-4" />
        </button>
      </Tooltip>
    </div>
  )
}
