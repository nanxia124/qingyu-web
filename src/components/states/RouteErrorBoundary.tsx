import { Component } from 'react'
import type { ReactNode } from 'react'
import { ErrorState } from './ErrorState'

interface Props {
  children: ReactNode
  /** inline=true：只在父容器内显示错误页（保留 Layout 框架）；false：全屏替换 */
  inline?: boolean
}

interface State {
  hasError: boolean
  error: Error | null
}

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error) {
    console.error('页面渲染错误:', error)
  }

  render() {
    if (this.state.hasError) {
      return <ErrorState code="500" error={this.state.error} inline={this.props.inline} />
    }
    return this.props.children
  }
}
