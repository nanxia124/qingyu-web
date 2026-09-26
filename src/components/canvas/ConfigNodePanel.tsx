import Tooltip from '@/components/ui/Tooltip'
import { useRef } from 'react'
import { ArrowUp, Copy, Maximize2, X } from 'lucide-react'
import type { CanvasNode, NodeConfig } from './types'

export function ConfigNodePanel({
  node,
  onClose,
  onChangeConfig,
  onGenerate,
  onUploadImage,
  onZoomToNode,
  onCopy,
}: {
  node: CanvasNode
  onClose: () => void
  onChangeConfig: (nodeId: string, patch: Partial<NodeConfig>) => void
  onGenerate: (node: CanvasNode) => void
  onUploadImage: (node: CanvasNode, file: File) => void
  onZoomToNode?: (node: CanvasNode) => void
  onCopy?: (node: CanvasNode) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isImage = node.type === 'image'
  const model = node.config?.model || ''
  const ratio = node.config?.ratio || '1:1'
  const quality = node.config?.quality || '自动'
  const count = node.config?.count || 1

  return (
    <div className="absolute left-1/2 top-full z-50 mt-3 w-[360px] -translate-x-1/2 rounded-2xl bg-[#1c1c1c] p-4 ring-1 ring-[#383838] shadow-2xl">
      {/* 标题 + 关闭 */}
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-[#bebebe]">
          {isImage ? '图片节点' : '生成配置'}
        </span>
        <Tooltip title="关闭">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onClose}
            className="flex size-6 items-center justify-center rounded-lg text-[#9e9e99] hover:bg-[#303030]"
          >
            <X className="size-4" />
          </button>
        </Tooltip>
      </div>

      {/* 图片节点：上传占位块 + 文件 input */}
      {isImage && (
        <div
          role="button"
          tabIndex={0}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => fileInputRef.current?.click()}
          className="mb-3 flex h-20 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[#444] text-[#9e9e99] hover:border-[#666]"
        >
          <span className="text-[20px] leading-none">+</span>
          <span className="text-[12px]">上传参考图</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onUploadImage(node, f)
              e.target.value = ''
            }}
          />
        </div>
      )}

      {/* 模型下拉 + 可选操作 + 生成按钮 */}
      <div className="flex items-center gap-2">
        {onZoomToNode && (
          <Tooltip title="放大到节点">
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onZoomToNode(node)}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[#9e9e99] hover:bg-[#303030]"
            >
              <Maximize2 className="size-4" />
            </button>
          </Tooltip>
        )}
        {onCopy && (
          <Tooltip title="复制节点">
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onCopy(node)}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[#9e9e99] hover:bg-[#303030]"
            >
              <Copy className="size-4" />
            </button>
          </Tooltip>
        )}
        <select
          value={model}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => onChangeConfig(node.id, { model: e.target.value })}
          className="h-8 flex-1 cursor-pointer rounded-lg bg-[#272727] px-2 text-[13px] font-semibold text-[#bebebe] outline-none"
        >
          {model ? <option value={model}>{model}</option> : <option value="">暂未获取到模型</option>}
        </select>
        <Tooltip title="生成">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onGenerate(node)}
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#e0e0e0] text-[#1c1c1c] hover:bg-white"
          >
            <ArrowUp className="size-5" />
          </button>
        </Tooltip>
      </div>

      {/* 比例 / 质量 / 数量信息 */}
      <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-[#272727] px-2 py-1.5 text-[12px] font-semibold text-[#bebebe]">
        <span>{ratio}</span>
        <span className="text-[#555]">·</span>
        <span>{quality}</span>
        <span className="text-[#555]">·</span>
        <span>{count} 张</span>
      </div>
    </div>
  )
}
