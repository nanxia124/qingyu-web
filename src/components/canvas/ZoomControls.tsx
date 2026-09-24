import { Tooltip } from 'antd'
import { ZoomIn, ZoomOut, Frame, Maximize2, Download } from 'lucide-react'
import type { Viewport } from './types'

export interface ZoomControlsProps {
  viewport: Viewport
  onChange: (v: Viewport) => void
  onFitView: () => void
  onResetView: () => void
  onExportPng?: () => void
}

const btn =
  'flex size-8 items-center justify-center rounded-lg text-[#9e9e99] transition-colors hover:bg-[#303030]'

export function ZoomControls({ viewport, onChange, onFitView, onResetView, onExportPng }: ZoomControlsProps) {
  const zoomOut = () => onChange({ ...viewport, k: Math.max(0.1, +(viewport.k - 0.1).toFixed(2)) })
  const zoomIn = () => onChange({ ...viewport, k: Math.min(5, +(viewport.k + 0.1).toFixed(2)) })

  return (
    <div className="absolute bottom-4 right-4 z-50 flex items-center gap-1 rounded-xl bg-[#1c1c1c] p-1.5 ring-1 ring-[#383838]">
      <Tooltip title="缩小">
        <button type="button" onClick={zoomOut} className={btn}>
          <ZoomOut className="size-4" />
        </button>
      </Tooltip>
      <span className="w-12 text-center text-[12px] font-semibold tabular-nums text-[#9e9e99]">
        {Math.round(viewport.k * 100)}%
      </span>
      <Tooltip title="放大">
        <button type="button" onClick={zoomIn} className={btn}>
          <ZoomIn className="size-4" />
        </button>
      </Tooltip>
      <Tooltip title="适应画布">
        <button type="button" onClick={onFitView} className={btn}>
          <Frame className="size-4" />
        </button>
      </Tooltip>
      <Tooltip title="重置视图">
        <button type="button" onClick={onResetView} className={btn}>
          <Maximize2 className="size-4" />
        </button>
      </Tooltip>
      {onExportPng && (
        <Tooltip title="导出PNG">
          <button type="button" onClick={onExportPng} className={btn}>
            <Download className="size-4" />
          </button>
        </Tooltip>
      )}
    </div>
  )
}
