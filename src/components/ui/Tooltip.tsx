import { Tooltip as AntTooltip } from 'antd'
import type { TooltipProps } from 'antd'

/**
 * 全站统一的气泡提示：灰色底、深色文字、小圆角。
 * 只调整颜色和圆角，悬浮时立即显示，移开时立即消失。
 */
export default function Tooltip({ overlayInnerStyle, ...props }: TooltipProps) {
  return (
    <AntTooltip
      {...props}
      overlayClassName="app-tooltip"
      mouseEnterDelay={0}
      mouseLeaveDelay={0}
      motion={{ motionName: '' }}
      overlayInnerStyle={{
        background: '#d1d1d6',
        color: '#1d1d1f',
        fontSize: 12,
        borderRadius: 6,
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
        ...overlayInnerStyle,
      }}
    />
  )
}
