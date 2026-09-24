import { cn } from '@/lib/utils'

/**
 * 路由切换时的通用骨架屏：填满主内容区，模拟工作台/素材类网格页的结构。
 * 高频页后续可各自提供更贴合的骨架，这里先给一个全站兜底。
 */
export function RouteSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('flex h-full flex-col gap-4 p-6', className)}>
      {/* 标题行 */}
      <div className="h-8 w-48 animate-pulse rounded-xl bg-surface-hover" />
      <div className="h-3.5 w-72 max-w-full animate-pulse rounded-lg bg-surface-hover/70" />
      {/* 网格内容 */}
      <div className="mt-2 grid flex-1 grid-cols-2 gap-4 overflow-hidden sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="aspect-[4/3] animate-pulse rounded-2xl bg-surface-hover"
            style={{ animationDelay: `${(i % 4) * 120}ms` }}
          />
        ))}
      </div>
    </div>
  )
}
