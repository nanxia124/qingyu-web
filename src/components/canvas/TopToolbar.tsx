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
      <button
        type="button"
        onClick={() => onToolChange('select')}
        className={cn(btn, tool === 'select' && activeBtn)}
        data-tip="选择"
      >
        <MousePointer2 className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => onToolChange('pan')}
        className={cn(btn, tool === 'pan' && activeBtn)}
        data-tip="平移"
      >
        <Hand className="size-4" />
      </button>

      <div className={divider} />

      <button type="button" onClick={() => onAddNode('text')} className={btn} data-tip="文本节点">
        <Type className="size-4" />
      </button>
      <button type="button" onClick={() => onAddNode('image')} className={btn} data-tip="图片节点">
        <Image className="size-4" />
      </button>
      <button type="button" onClick={() => onAddNode('config')} className={btn} data-tip="生成配置">
        <Settings2 className="size-4" />
      </button>

      <div className={divider} />

      <button type="button" onClick={onCopy} className={btn} data-tip="复制">
        <Copy className="size-4" />
      </button>
      <button type="button" onClick={onPaste} className={btn} data-tip="粘贴">
        <ClipboardPaste className="size-4" />
      </button>
      <button type="button" onClick={onDelete} className={cn(btn, 'hover:text-red-400')} data-tip="删除">
        <Trash2 className="size-4" />
      </button>

      <div className={divider} />

      <button type="button" onClick={onUndo} disabled={!canUndo} className={btn} data-tip="撤销">
        <Undo2 className="size-4" />
      </button>
      <button type="button" onClick={onRedo} disabled={!canRedo} className={btn} data-tip="重做">
        <Redo2 className="size-4" />
      </button>
    </div>
  )
}
