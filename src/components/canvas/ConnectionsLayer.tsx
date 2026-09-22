import { useMemo } from 'react'
import type { CanvasConnection, CanvasNode, ConnectionDrag } from './types'
import { NODE_DEFAULT_HEIGHT } from './CanvasNodeView'

interface ConnectionsLayerProps {
  connections: CanvasConnection[]
  nodes: CanvasNode[]
  selectedConnectionId: string | null
  onSelectConnection: (id: string) => void
  activeDrag?: ConnectionDrag | null
}

const ACCENT = '#5051F8'

// source 在节点右中，target 在节点左中；高度缺省回退到节点卡片默认高度
function nodeCenter(node: CanvasNode) {
  return { x: node.x, y: node.y + (node.height ?? NODE_DEFAULT_HEIGHT) / 2 }
}

function bezierPath(sx: number, sy: number, ex: number, ey: number) {
  const dx = Math.abs(ex - sx)
  const curvature = Math.max(dx * 0.5, 50)
  return `M ${sx} ${sy} C ${sx + curvature} ${sy}, ${ex - curvature} ${ey}, ${ex} ${ey}`
}

// 正在拖拽中的连线：从 handle 出发跟随鼠标，hover 到目标节点时吸附到目标边缘
function buildActiveDragPath(activeDrag: ConnectionDrag, nodes: CanvasNode[]): string | null {
  const dragNode = nodes.find((n) => n.id === activeDrag.nodeId)
  if (!dragNode) return null
  const targetNode = activeDrag.hoverTargetId ? nodes.find((n) => n.id === activeDrag.hoverTargetId) : undefined
  const mouse = activeDrag.mouseWorld

  let startX: number
  let startY: number
  let endX: number
  let endY: number

  if (activeDrag.handleType === 'source') {
    const s = nodeCenter(dragNode)
    startX = s.x + dragNode.width
    startY = s.y
    if (targetNode) {
      const t = nodeCenter(targetNode)
      endX = t.x
      endY = t.y
    } else {
      endX = mouse.x
      endY = mouse.y
    }
  } else {
    const e = nodeCenter(dragNode)
    endX = e.x
    endY = e.y
    if (targetNode) {
      const t = nodeCenter(targetNode)
      startX = t.x + targetNode.width
      startY = t.y
    } else {
      startX = mouse.x
      startY = mouse.y
    }
  }

  return bezierPath(startX, startY, endX, endY)
}

export function ConnectionsLayer({
  connections,
  nodes,
  selectedConnectionId,
  onSelectConnection,
  activeDrag,
}: ConnectionsLayerProps) {
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  const activeDragPath = useMemo(() => {
    if (!activeDrag) return null
    return buildActiveDragPath(activeDrag, nodes)
  }, [activeDrag, nodes])

  return (
    <svg className="absolute left-0 top-0 overflow-visible" style={{ width: 1, height: 1 }}>
      {connections.map((conn) => {
        const from = nodeById.get(conn.source)
        const to = nodeById.get(conn.target)
        if (!from || !to) return null
        const s = nodeCenter(from)
        const t = nodeCenter(to)
        const d = bezierPath(s.x + from.width, s.y, t.x, t.y)
        const selected = selectedConnectionId === conn.id
        return (
          <g key={conn.id}>
            {/* 16px 透明命中热区 */}
            <path
              data-connection-id={conn.id}
              d={d}
              stroke="transparent"
              strokeWidth={16}
              fill="none"
              style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
              onClick={(e) => {
                e.stopPropagation()
                onSelectConnection(conn.id)
              }}
            />
            {/* 可见贝塞尔 */}
            <path
              d={d}
              stroke={ACCENT}
              strokeWidth={selected ? 3 : 2}
              strokeOpacity={selected ? 1 : 0.82}
              fill="none"
              style={{
                pointerEvents: 'none',
                filter: selected ? `drop-shadow(0 0 8px ${ACCENT}66)` : undefined,
              }}
            />
          </g>
        )
      })}

      {activeDragPath && (
        <path
          d={activeDragPath}
          stroke={ACCENT}
          strokeWidth={2}
          fill="none"
          strokeDasharray="6 4"
          style={{ pointerEvents: 'none' }}
        />
      )}
    </svg>
  )
}
