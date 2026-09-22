import { Sparkles } from 'lucide-react'

export function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-text-muted/70">
      <Sparkles className="mb-4 size-12 opacity-30" />
      <p className="text-[14px]">还没有生成图片</p>
      <p className="mt-1 text-[12px] opacity-60">在左边输入提示词，开始创作第一张图吧</p>
    </div>
  )
}
