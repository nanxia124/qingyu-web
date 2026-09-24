import { cn } from '@/lib/utils'

export type SkeletonVariant = 'grid' | 'settings' | 'workspace' | 'chat' | 'list' | 'canvas'

/**
 * 路由切换骨架屏。variant 按页面真实布局做，切路由时不会"跳布局"。
 * 对照：
 * - workspace: /image /video /translate /plan /canvas（左表单+右结果）
 * - chat:      /chat（居中欢迎+底部输入）
 * - settings:  /settings /account/*（左菜单+右卡片）
 * - grid:      / /assets /favorites（网格卡片）
 * - list:      /wallet /subscription /teams /feedback（横列表）
 */
export function RouteSkeleton({ variant = 'grid', className }: { variant?: SkeletonVariant; className?: string }) {
  return (
    <div className={cn('h-full w-full bg-bg', className)}>
      {variant === 'grid' && <GridSkeleton />}
      {variant === 'settings' && <SettingsSkeleton />}
      {variant === 'workspace' && <WorkspaceSkeleton />}
      {variant === 'chat' && <ChatSkeleton />}
      {variant === 'list' && <ListSkeleton />}
      {variant === 'canvas' && <CanvasSkeleton />}
    </div>
  )
}

function Shimmer({ className, delay = 0 }: { className?: string; delay?: number }) {
  return (
    <div
      className={cn('animate-pulse rounded-xl bg-surface-hover', className)}
      style={{ animationDelay: `${delay}ms` }}
    />
  )
}

/** 首页：顶部 4 个功能卡片 + tab 栏 + 作品网格（对齐真实首页） */
function GridSkeleton() {
  return (
    <div className="flex h-full flex-col gap-5 p-6">
      {/* 顶部 4 个功能入口卡片 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Shimmer key={i} className="h-[72px] rounded-2xl" delay={i * 80} />
        ))}
      </div>
      {/* tab 筛选栏 */}
      <div className="flex items-center gap-5">
        <Shimmer className="h-6 w-14 rounded-full" />
        <Shimmer className="h-3.5 w-14" />
        <Shimmer className="h-3.5 w-14" />
        <Shimmer className="h-3.5 w-14" />
        <Shimmer className="h-3.5 w-14" />
      </div>
      {/* 作品网格：竖版 3:4 卡片，对齐真实作品缩略图 */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <Shimmer key={i} className="aspect-[3/4] rounded-2xl" delay={(i % 4) * 100} />
        ))}
      </div>
    </div>
  )
}

/** 设置 / 个人中心：左菜单 + 右卡片（对齐 /settings 真实布局） */
function SettingsSkeleton() {
  return (
    <div className="flex h-full gap-6 p-6">
      <div className="flex w-56 shrink-0 flex-col gap-1.5 pt-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <Shimmer key={i} className="h-10 w-full rounded-lg" delay={i * 80} />
        ))}
      </div>
      <div className="flex-1 rounded-2xl bg-surface p-6">
        <Shimmer className="h-7 w-40" />
        <Shimmer className="mt-2 h-3.5 w-72 max-w-full" />
        <div className="mt-6 flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Shimmer className="h-3.5 w-16" />
            <Shimmer className="h-11 w-full rounded-lg" />
          </div>
          <div className="flex flex-col gap-2">
            <Shimmer className="h-3.5 w-20" />
            <Shimmer className="h-11 w-full rounded-lg" />
          </div>
          <Shimmer className="h-10 w-24 rounded-lg" />
        </div>
      </div>
    </div>
  )
}

/** 钱包/订阅/账单：标题 + 统计卡片 + tab + 内容卡（对齐 /wallet 真实布局） */
function ListSkeleton() {
  return (
    <div className="flex h-full flex-col gap-5 p-6">
      <Shimmer className="h-8 w-32" />
      {/* 统计卡片 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Shimmer key={i} className="h-24 rounded-2xl" delay={i * 100} />
        ))}
      </div>
      {/* tab 行 */}
      <div className="flex gap-5 border-b border-surface-hover pb-3">
        <Shimmer className="h-6 w-16" />
        <Shimmer className="h-4 w-14" />
        <Shimmer className="h-4 w-14" />
        <Shimmer className="h-4 w-14" />
      </div>
      {/* 内容卡片 */}
      <Shimmer className="h-40 w-full rounded-2xl" />
    </div>
  )
}

/** 生图/生视频/工作台：左表单面板 + 右结果区（对齐 /image /video 真实结构） */
function WorkspaceSkeleton() {
  return (
    <div className="flex h-full gap-4 p-4">
      {/* 左：模型选择 + 提示词 + 参数 + 上传 + 底部生成按钮 */}
      <div className="flex w-[380px] shrink-0 flex-col gap-4 overflow-hidden rounded-2xl bg-surface p-4">
        <Shimmer className="h-10 w-full" />
        <Shimmer className="h-32 w-full" />
        <div className="flex flex-col gap-1.5">
          <Shimmer className="h-3 w-12" />
          <div className="flex gap-2">
            <Shimmer className="h-8 flex-1" />
            <Shimmer className="h-8 flex-1" />
            <Shimmer className="h-8 flex-1" />
            <Shimmer className="h-8 flex-1" />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Shimmer className="h-3 w-12" />
          <div className="flex gap-2">
            <Shimmer className="h-8 flex-1" />
            <Shimmer className="h-8 flex-1" />
          </div>
        </div>
        <Shimmer className="h-24 w-24 rounded-lg" />
        <div className="mt-auto">
          <Shimmer className="h-11 w-full rounded-xl" />
        </div>
      </div>
      {/* 右：顶部工具栏 + 居中结果占位 */}
      <div className="flex min-w-0 flex-1 flex-col rounded-2xl bg-surface">
        <div className="flex h-12 items-center gap-3 px-4">
          <Shimmer className="h-8 w-28" />
          <Shimmer className="h-8 w-28" />
          <div className="ml-auto flex gap-2">
            <Shimmer className="h-8 w-8" />
            <Shimmer className="h-8 w-8" />
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Shimmer className="size-12 rounded-2xl" />
            <Shimmer className="h-3 w-40" />
          </div>
        </div>
      </div>
    </div>
  )
}

/** 聊天：右上模型 pill + 居中欢迎语 + 底部输入框 */
function ChatSkeleton() {
  return (
    <div className="relative flex h-full flex-col">
      <div className="absolute right-4 top-4">
        <Shimmer className="h-8 w-24 rounded-full" />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <Shimmer className="h-7 w-48" />
        <Shimmer className="h-3.5 w-64" />
      </div>
      <div className="px-6 pb-6">
        <Shimmer className="h-14 w-full rounded-2xl" />
      </div>
    </div>
  )
}

/** 无限画布：顶部标题栏 + 中间点阵画布 + 底部工具栏（对齐 /canvas 真实布局） */
function CanvasSkeleton() {
  return (
    <div className="relative flex h-full flex-col bg-bg">
      {/* 顶部标题栏 */}
      <div className="flex h-12 items-center gap-3 px-4">
        <Shimmer className="size-7 rounded-lg" />
        <Shimmer className="size-7 rounded-lg" />
        <Shimmer className="size-7 rounded-lg" />
        <Shimmer className="h-6 w-28" />
        <div className="ml-auto flex gap-2">
          <Shimmer className="size-7 rounded-lg" />
          <Shimmer className="size-7 rounded-lg" />
          <Shimmer className="size-7 rounded-lg" />
        </div>
      </div>
      {/* 中间画布区：点阵背景 + 居中空节点占位 */}
      <div className="relative flex-1">
        <div
          className="absolute inset-0 opacity-50"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(128,128,128,0.15) 1px, transparent 1.5px)',
            backgroundSize: '24px 24px',
          }}
        />
        <div className="relative flex h-full items-center justify-center">
          <div className="flex size-48 flex-col items-center justify-center gap-3 rounded-2xl bg-surface">
            <Shimmer className="size-10 rounded-xl" />
            <Shimmer className="h-3 w-20" />
          </div>
        </div>
      </div>
      {/* 底部工具栏 */}
      <div className="flex items-center justify-between px-4 pb-4">
        <Shimmer className="h-8 w-36 rounded-full" />
        <div className="flex gap-1.5 rounded-2xl bg-surface p-1.5">
          {Array.from({ length: 9 }).map((_, i) => (
            <Shimmer key={i} className="size-9 rounded-xl" delay={i * 60} />
          ))}
        </div>
        <Shimmer className="size-9 rounded-xl" />
      </div>
    </div>
  )
}
