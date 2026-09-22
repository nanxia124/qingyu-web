// 无限画布共享类型契约 —— 所有 canvas 子组件以此为准，禁止各自重复定义。
// 视觉 token（在组件内使用 Tailwind 硬编码，保持与现有页面一致）：
//   背景 #111111，卡片 #1c1c1c，描边 #383838，主色 #5051F8，正文 #bebebe，弱化 #9e9e99
//   全局 font-weight 600。禁止引入 antd。

export type Tool = 'select' | 'pan'
export type NodeType = 'text' | 'image' | 'config'

export interface Viewport {
  x: number
  y: number
  k: number
}

export interface ViewportSize {
  width: number
  height: number
}

export interface NodeConfig {
  model: string
  ratio: string
  quality: string
  count: number
}

export interface CanvasNode {
  id: string
  type: NodeType
  x: number
  y: number
  width: number
  height?: number
  title?: string
  text?: string
  fontSize?: number
  imageSrc?: string
  config?: NodeConfig
  locked?: boolean
}

export interface CanvasConnection {
  id: string
  source: string
  target: string
}

export type ConnectionHandleType = 'source' | 'target'

// 正在拖拽中的连线（世界坐标下的鼠标位置）
export interface ConnectionDrag {
  nodeId: string
  handleType: ConnectionHandleType
  mouseWorld: { x: number; y: number }
  hoverTargetId: string | null
}

// 世界坐标 → 屏幕坐标、屏幕 → 世界 的换算辅助，由编排器注入
export interface CanvasTransform {
  viewport: Viewport
  // 屏幕(容器内相对) → 世界
  toWorld: (sx: number, sy: number) => { x: number; y: number }
  // 世界 → 屏幕(容器内相对)
  toScreen: (wx: number, wy: number) => { x: number; y: number }
}
