import { Tooltip } from 'antd'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { CanvasNode, NodeType, Viewport, ViewportSize } from './types'

const WIDTH = 240
const HEIGHT = 160

const NODE_COLOR: Record<NodeType, string> = {
  text: '#94a3b8',
  image: '#10b981',
  config: '#60a5fa',
}

export function Minimap({
  nodes,
  viewport,
  viewportSize,
  onViewportChange,
}: {
  nodes: CanvasNode[]
  viewport: Viewport
  viewportSize: ViewportSize
  onViewportChange: (v: Viewport) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [expanded, setExpanded] = useState(false)

  // 世界 bounds = 所有节点外扩 500，居中缩放
  const { bounds, scale, offset } = useMemo(() => {
    if (nodes.length === 0) {
      return {
        bounds: { x: -500, y: -500, w: 1000, h: 1000 },
        scale: 0.16,
        offset: { x: 40, y: 0 },
      }
    }
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const n of nodes) {
      minX = Math.min(minX, n.x)
      minY = Math.min(minY, n.y)
      maxX = Math.max(maxX, n.x + n.width)
      maxY = Math.max(maxY, n.y + (n.height ?? 240))
    }
    minX -= 500
    minY -= 500
    maxX += 500
    maxY += 500
    const bw = maxX - minX
    const bh = maxY - minY
    const s = Math.min(WIDTH / bw, HEIGHT / bh)
    return {
      bounds: { x: minX, y: minY, w: bw, h: bh },
      scale: s,
      offset: { x: (WIDTH - bw * s) / 2, y: (HEIGHT - bh * s) / 2 },
    }
  }, [nodes])

  // 小地图坐标 → 世界坐标
  const toWorld = useCallback(
    (mx: number, my: number) => ({
      x: (mx - offset.x) / scale + bounds.x,
      y: (my - offset.y) / scale + bounds.y,
    }),
    [bounds.x, bounds.y, offset.x, offset.y, scale],
  )

  // 视口在小地图上的矩形
  const viewportRect = useMemo(() => {
    const vx = -viewport.x / viewport.k
    const vy = -viewport.y / viewport.k
    const vw = viewportSize.width / viewport.k
    const vh = viewportSize.height / viewport.k
    const p1x = (vx - bounds.x) * scale + offset.x
    const p1y = (vy - bounds.y) * scale + offset.y
    const p2x = (vx + vw - bounds.x) * scale + offset.x
    const p2y = (vy + vh - bounds.y) * scale + offset.y
    return {
      x: p1x,
      y: p1y,
      w: Math.max(p2x - p1x, 4),
      h: Math.max(p2y - p1y, 4),
    }
  }, [bounds.x, bounds.y, offset.x, offset.y, scale, viewport, viewportSize.height, viewportSize.width])

  // 按下/拖拽：把点击点对齐到视口中心
  const jumpTo = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const world = toWorld(clientX - rect.left, clientY - rect.top)
      onViewportChange({
        x: viewportSize.width / 2 - world.x * viewport.k,
        y: viewportSize.height / 2 - world.y * viewport.k,
        k: viewport.k,
      })
    },
    [onViewportChange, toWorld, viewport.k, viewportSize.height, viewportSize.width],
  )

  if (!expanded) {
    return (
      <Tooltip title="小地图">
        <button
          onClick={() => setExpanded(true)}
          className="flex size-10 items-center justify-center rounded-lg bg-[#1c1c1c] text-[#9e9e99] ring-1 ring-[#383838] hover:bg-[#272727]"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="12" height="10" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <rect x="4" y="4" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.5" />
          </svg>
        </button>
      </Tooltip>
    )
  }
  return (
    <div className="relative">
      <button
        onClick={() => setExpanded(false)}
        className="absolute -right-1 -top-1 z-10 flex size-5 items-center justify-center rounded-full bg-[#383838] text-[#ccc] hover:bg-[#505050]"
      >
        ×
      </button>
    <div
      className="relative overflow-hidden rounded-lg bg-[#1c1c1c] ring-1 ring-[#383838]"
      style={{ width: WIDTH, height: HEIGHT }}
    >
      <div
        ref={containerRef}
        className="relative h-full w-full cursor-crosshair"
        onPointerDown={(e) => {
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
          setDragging(true)
          jumpTo(e.clientX, e.clientY)
        }}
        onPointerMove={(e) => {
          if (dragging) jumpTo(e.clientX, e.clientY)
        }}
        onPointerUp={() => setDragging(false)}
        onPointerLeave={() => setDragging(false)}
      >
        {nodes.map((n) => {
          const px = (n.x - bounds.x) * scale + offset.x
          const py = (n.y - bounds.y) * scale + offset.y
          return (
            <div
              key={n.id}
              className="absolute rounded-[1px]"
              style={{
                left: px,
                top: py,
                width: Math.max(n.width * scale, 2),
                height: Math.max((n.height ?? 240) * scale, 2),
                backgroundColor: NODE_COLOR[n.type],
                opacity: 0.8,
              }}
            />
          )
        })}
        <div
          className="pointer-events-none absolute border"
          style={{
            left: viewportRect.x,
            top: viewportRect.y,
            width: viewportRect.w,
            height: viewportRect.h,
            borderColor: '#5051F8',
            background: 'rgba(80, 81, 248, 0.12)',
          }}
        />
      </div>
    </div>
    </div>
  )
}
