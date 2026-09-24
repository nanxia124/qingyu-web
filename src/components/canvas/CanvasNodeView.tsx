import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  Image as ImageIcon,
  Info,
  Trash2,
  Upload,
  Maximize2,
  Copy,
  ArrowUp,
  Sparkles,
  SlidersHorizontal,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CanvasNode, ConnectionHandleType } from './types'

export const NODE_DEFAULT_HEIGHT = 200
export type ResizeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

interface CanvasNodeViewProps {
  node: CanvasNode
  selected: boolean
  isConnectTarget: boolean
  connectingId: string | null
  onPointerDownDrag: (e: ReactPointerEvent, node: CanvasNode) => void
  onConnectStart: (e: ReactPointerEvent, nodeId: string, handleType: ConnectionHandleType) => void
  onTextCommit: (nodeId: string, text: string) => void
  onGenerate: (node: CanvasNode) => void
  onUploadImage: (node: CanvasNode, file: File) => void
  onDeleteNode: (nodeId: string) => void
}

const selectionBlue = '#2f80ff'

export function CanvasNodeView({
  node, selected, isConnectTarget, connectingId,
  onPointerDownDrag, onConnectStart, onTextCommit, onGenerate, onUploadImage, onDeleteNode,
}: CanvasNodeViewProps) {
  const [hovered, setHovered] = useState(false)
  const [editingText, setEditingText] = useState(false)
  const [textDraft, setTextDraft] = useState(node.text ?? '')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const locked = Boolean(node.locked)
  const showHandles = !locked && (selected || isConnectTarget || connectingId === node.id || hovered)
  const showSource = node.type !== 'config'

  const handlePointerDown = (e: ReactPointerEvent) => {
    if (locked) return
    onPointerDownDrag(e, node)
  }

  const commitText = () => {
    setEditingText(false)
    onTextCommit(node.id, textDraft)
  }

  return (
    <div
      data-node-id={node.id}
      className={cn(
        'group/node absolute flex select-none flex-col overflow-visible rounded-[18px] border bg-[#1c1c1c]',
        selected ? 'z-50' : 'z-10',
      )}
      style={{
        left: node.x, top: node.y, width: node.width, minHeight: NODE_DEFAULT_HEIGHT,
        borderColor: (selected || isConnectTarget) ? selectionBlue : '#3a3a3a',
        borderWidth: selected ? 2 : 1,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onPointerDown={handlePointerDown}
    >
      {selected && (
        <div className="absolute -top-6 left-0 text-[12px] font-medium text-[#888]">
          {node.type === 'image' ? '图片' : node.type === 'text' ? '参考内容' : '配置'}
        </div>
      )}

      {selected && (
        <div className="absolute -top-11 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-xl bg-white p-1 shadow-lg" style={{ zIndex: 60 }}>
          <button className="flex size-7 items-center justify-center rounded-lg text-[#333] hover:bg-[#eee]"><Info className="size-3.5" /></button>
          <button onPointerDown={(e) => e.stopPropagation()} onClick={() => onDeleteNode(node.id)} className="flex size-7 items-center justify-center rounded-lg text-[#333] hover:bg-[#eee]"><Trash2 className="size-3.5" /></button>
          <button onPointerDown={(e) => e.stopPropagation()} onClick={() => fileInputRef.current?.click()} className="flex size-7 items-center justify-center rounded-lg text-[#333] hover:bg-[#eee]"><Upload className="size-3.5" /></button>
        </div>
      )}

      {node.type === 'text' && (
        <div className="flex flex-1 flex-col">
          <div className="flex items-center gap-2 px-4 pt-3">
            <span className="text-[13px] font-medium text-[#999]">参考内容</span>
          </div>
          <div className="px-4 pt-2">
            <button onPointerDown={(e) => e.stopPropagation()} className="flex size-9 items-center justify-center rounded-xl bg-[#2a2a2a] text-[#999] hover:bg-[#333]">+</button>
          </div>
          <div className="flex-1 px-4 py-3">
            {editingText ? (
              <textarea autoFocus value={textDraft} onChange={(e) => setTextDraft(e.target.value)} onBlur={commitText}
                onKeyDown={(e) => { if (e.key === 'Escape') setEditingText(false); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.target as HTMLTextAreaElement).blur() }}
                onPointerDown={(e) => e.stopPropagation()}
                className="h-full w-full resize-none bg-transparent text-[14px] leading-[22px] text-[#ccc] outline-none"
                placeholder="描述要生成的图片内容" />
            ) : (
              <p onDoubleClick={(e) => { e.stopPropagation(); setTextDraft(node.text ?? ''); setEditingText(true) }}
                className="cursor-text whitespace-pre-wrap break-words text-[14px] leading-[22px] text-[#777]">
                {node.text || '描述要生成的图片内容'}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 px-3 pb-3">
            <button onPointerDown={(e) => e.stopPropagation()} className="flex size-7 items-center justify-center rounded-lg text-[#888] hover:bg-[#2a2a2a]"><Maximize2 className="size-3.5" /></button>
            <button onPointerDown={(e) => e.stopPropagation()} className="flex size-7 items-center justify-center rounded-lg text-[#888] hover:bg-[#2a2a2a]"><Copy className="size-3.5" /></button>
            <button onPointerDown={(e) => e.stopPropagation()} className="flex h-7 items-center gap-1.5 rounded-full bg-[#2a2a2a] px-3 text-[12px] text-[#ccc] hover:bg-[#333]"><Sparkles className="size-3.5" />{node.config?.model || '暂未获取到模型'}</button>
            <button onPointerDown={(e) => e.stopPropagation()} className="flex h-7 items-center gap-1.5 rounded-full bg-[#2a2a2a] px-3 text-[12px] text-[#ccc] hover:bg-[#333]"><SlidersHorizontal className="size-3.5" />自动 · 1:1 · 3 张</button>
            <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onGenerate(node) }} className="ml-auto flex size-9 items-center justify-center rounded-full bg-[#2a2a2a] text-[#ccc] hover:bg-[#333]"><ArrowUp className="size-4" /></button>
          </div>
        </div>
      )}

      {node.type === 'image' && (
        node.imageSrc ? (
          <img src={node.imageSrc} alt="image" draggable={false} onDragStart={(e) => e.preventDefault()} className="flex-1 rounded-[18px] object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: '#666' }}>
            <div className="flex size-14 items-center justify-center rounded-2xl bg-[#2a2a2a]">
              <ImageIcon className="size-6 opacity-30" />
            </div>
            <span className="text-[10px] tracking-[0.18em] opacity-50">空图片节点</span>
          </div>
        )
      )}

      {node.type === 'config' && node.config && (
        <div className="flex flex-1 flex-col p-4">
          <span className="text-[13px] font-medium text-[#999]">生成配置</span>
          <div className="mt-3 rounded-xl bg-[#2a2a2a] px-3 py-2 text-[12px] text-[#ccc]">{node.config.model}</div>
          <div className="mt-2 rounded-xl bg-[#2a2a2a] px-3 py-2 text-[12px] text-[#ccc]">{node.config.ratio} · {node.config.quality} · {node.config.count} 张</div>
          <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onGenerate(node) }}
            className="mt-3 h-9 rounded-xl bg-[#2f80ff] text-[13px] font-medium text-white hover:bg-[#4a90ff]">生成</button>
        </div>
      )}

      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadImage(node, f); e.target.value = '' }} />

      <div className={cn('absolute top-1/2 z-30 flex size-12 -translate-y-1/2 cursor-crosshair items-center justify-center transition-opacity duration-150 -left-6', showHandles ? 'opacity-100' : 'pointer-events-none opacity-0')}
        onPointerDown={(e) => { e.stopPropagation(); onConnectStart(e, node.id, 'target') }}>
        <div className="size-3 rounded-full border-2 border-[#888] bg-[#1c1c1c] transition-transform hover:scale-125" />
      </div>
      {showSource && (
        <div className={cn('absolute top-1/2 z-30 flex size-12 -translate-y-1/2 cursor-crosshair items-center justify-center transition-opacity duration-150 -right-6', showHandles ? 'opacity-100' : 'pointer-events-none opacity-0')}
          onPointerDown={(e) => { e.stopPropagation(); onConnectStart(e, node.id, 'source') }}>
          <div className="size-3 rounded-full border-2 border-[#888] bg-[#1c1c1c] transition-transform hover:scale-125" />
        </div>
      )}
    </div>
  )
}
