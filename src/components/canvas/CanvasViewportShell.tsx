import { useEffect, useRef, useState } from 'react'
import type {
  ReactNode,
  RefObject,
  PointerEvent as ReactPointerEvent,
  MouseEvent as ReactMouseEvent,
  DragEvent as ReactDragEvent,
  WheelEvent as ReactWheelEvent,
} from 'react'
import type { Tool, Viewport } from './types'

type CanvasViewportShellProps = {
  /** 画布容器（世界内容层的父节点），由编排器持有 */
  containerRef: RefObject<HTMLDivElement | null>
  /** 受控视口：屏幕坐标下的平移 x/y 与缩放 k */
  viewport: Viewport
  /** 当前工具 */
  tool: Tool
  /** 放在 CSS transform 层里的世界内容（节点 + 连线） */
  children: ReactNode
  /** 视口变化回调（缩放/平移最终都经此上抛） */
  onViewportChange: (viewport: Viewport) => void
  /** 背景左键按下（用于框选起点 / 取消选中） */
  onBackgroundPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void
  /** 双击空白背景（节点/连线/弹出层除外） */
  onDoubleClickBackground: (e: ReactMouseEvent<HTMLDivElement>) => void
  /** 右键菜单 */
  onContextMenu: (e: ReactMouseEvent) => void
  /** 拖放文件/素材 */
  onDrop: (e: ReactDragEvent) => void
  /** 点按背景且未发生移动（纯点击）时取消选中 */
  onTapBackgroundDeselect?: () => void
}

const MIN_SCALE = 0.05
const MAX_SCALE = 5

export function CanvasViewportShell({
  containerRef,
  viewport,
  tool,
  children,
  onViewportChange,
  onBackgroundPointerDown,
  onDoubleClickBackground,
  onContextMenu,
  onDrop,
  onTapBackgroundDeselect,
}: CanvasViewportShellProps) {
  const panState = useRef({
    isPanning: false,
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
    hasMoved: false,
    startedOnBackground: false,
  })
  // 平移期间用最新 k 拼成完整 viewport，避免闭包拿到旧缩放
  const scaleRef = useRef(viewport.k)
  // rAF 批处理：一帧内只写一次 onViewportChange
  const frameRef = useRef<number | null>(null)
  const nextViewportRef = useRef<Viewport | null>(null)

  const [isSpacePressed, setIsSpacePressed] = useState(false)
  const [isControlPressed, setIsControlPressed] = useState(false)
  const [isPanning, setIsPanning] = useState(false)

  useEffect(() => {
    scaleRef.current = viewport.k
  }, [viewport.k])

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    },
    [],
  )

  // ── 键盘：空格 / Ctrl 临时切换工具；输入类元素内不拦截 ──
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const el = target instanceof Element ? target : null
      return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        el?.closest("[contenteditable='true']") != null
      )
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Control') setIsControlPressed(true)
      if (event.code !== 'Space') return
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      setIsSpacePressed(true)
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        if (!isEditableTarget(event.target)) event.preventDefault()
        setIsSpacePressed(false)
      }
      if (event.key === 'Control') setIsControlPressed(false)
    }

    const handleBlur = () => {
      setIsSpacePressed(false)
      setIsControlPressed(false)
      panState.current.isPanning = false
      setIsPanning(false)
      document.body.style.cursor = ''
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  // ── 滚轮：以鼠标为中心缩放 ──
  const handleWheel = (event: ReactWheelEvent) => {
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('[data-canvas-no-zoom]')) return

    const delta = -event.deltaY
    const factor = Math.pow(1.1, delta / 100)
    const newScale = Math.min(Math.max(viewport.k * factor, MIN_SCALE), MAX_SCALE)
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    const mouseX = event.clientX - rect.left
    const mouseY = event.clientY - rect.top
    // 锚定鼠标下的世界点：缩放后该点仍落在鼠标位置
    const worldX = (mouseX - viewport.x) / viewport.k
    const worldY = (mouseY - viewport.y) / viewport.k

    onViewportChange({
      x: mouseX - worldX * newScale,
      y: mouseY - worldY * newScale,
      k: newScale,
    })
  }

  // ── 指针按下：判定是否进入平移，否则交给编排器（框选起点/取消选中）──
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('[data-canvas-no-zoom]')) return

    const isBackgroundClick = !target?.closest('[data-node-id],[data-connection-id]')
    const temporaryTool = event.ctrlKey || isSpacePressed
    const activeTool = temporaryTool ? (tool === 'select' ? 'pan' : 'select') : tool
    const shouldPan =
      event.button === 1 || (event.button === 0 && activeTool === 'pan' && isBackgroundClick)

    if (shouldPan) {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      panState.current = {
        isPanning: true,
        startX: event.clientX,
        startY: event.clientY,
        initialX: viewport.x,
        initialY: viewport.y,
        hasMoved: false,
        startedOnBackground: isBackgroundClick,
      }
      setIsPanning(true)
      document.body.style.cursor = 'grabbing'
      return
    }

    if (event.button === 0 && isBackgroundClick) {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      onBackgroundPointerDown(event)
    }
  }

  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('[data-canvas-no-zoom],[data-node-id],[data-connection-id]')) return
    onDoubleClickBackground(event)
  }

  // ── 平移 move/up：window 级监听，rAF 批写；点按未移动则取消选中 ──
  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!panState.current.isPanning) return

      const dx = event.clientX - panState.current.startX
      const dy = event.clientY - panState.current.startY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        panState.current.hasMoved = true
      }

      nextViewportRef.current = {
        x: panState.current.initialX + dx,
        y: panState.current.initialY + dy,
        k: scaleRef.current,
      }
      if (frameRef.current !== null) return
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        if (nextViewportRef.current) onViewportChange(nextViewportRef.current)
      })
    }

    const handlePointerUp = () => {
      if (!panState.current.isPanning) return

      if (!panState.current.hasMoved && panState.current.startedOnBackground) {
        onTapBackgroundDeselect?.()
      }
      panState.current.isPanning = false
      setIsPanning(false)
      document.body.style.cursor = ''
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      document.body.style.cursor = ''
    }
  }, [onTapBackgroundDeselect, onViewportChange])

  // ── 阻止画布滚轮驱动页面滚动；弹出层 [data-canvas-no-zoom] 内保持原生滚动 ──
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const preventWheelScroll = (event: WheelEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('[data-canvas-no-zoom]')) return
      event.preventDefault()
    }
    container.addEventListener('wheel', preventWheelScroll, { passive: false })
    return () => container.removeEventListener('wheel', preventWheelScroll)
  }, [containerRef])

  const temporaryTool = isControlPressed || isSpacePressed
  const activeTool = temporaryTool ? (tool === 'select' ? 'pan' : 'select') : tool
  const cursor = isPanning ? 'grabbing' : activeTool === 'pan' ? 'grab' : undefined

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full select-none overflow-hidden"
      style={{ background: '#111111', cursor }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      onWheel={handleWheel}
      onContextMenu={onContextMenu}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <CanvasGrid viewport={viewport} />
      <div
        className="absolute origin-top-left"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})`,
        }}
      >
        {children}
      </div>
    </div>
  )
}

function CanvasGrid({ viewport }: { viewport: Viewport }) {
  const backgroundImage = `radial-gradient(circle, #2a2a2a 1px, transparent 1px)`
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage,
        backgroundSize: '24px 24px',
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
      }}
    />
  )
}
