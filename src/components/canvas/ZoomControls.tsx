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
      <button type="button" onClick={zoomOut} className={btn} data-tip="缩小">
        <ZoomOut className="size-4" />
      </button>
      <span className="w-12 text-center text-[12px] font-semibold tabular-nums text-[#9e9e99]">
        {Math.round(viewport.k * 100)}%
      </span>
      <button type="button" onClick={zoomIn} className={btn} data-tip="放大">
        <ZoomIn className="size-4" />
      </button>
      <button type="button" onClick={onFitView} className={btn} data-tip="适应画布">
        <Frame className="size-4" />
      </button>
      <button type="button" onClick={onResetView} className={btn} data-tip="重置视图">
        <Maximize2 className="size-4" />
      </button>
      {onExportPng && (
        <button type="button" onClick={onExportPng} className={btn} data-tip="导出PNG">
          <Download className="size-4" />
        </button>
      )}
    </div>
  )
}
