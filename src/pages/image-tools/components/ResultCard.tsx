import { Tooltip } from 'antd'
import { RefreshCw, Repeat, Download, Trash2, Star } from 'lucide-react'
import type { GenerationResult } from '@/stores/useImageToolsStore'
import { cn } from '@/lib/utils'

interface ResultCardProps {
  result: GenerationResult
  viewMode: 'list' | 'grid' | 'large'
  onRegenerate: (r: GenerationResult) => void
  onReuseParams: (r: GenerationResult) => void
  onDelete: (id: number) => void
  onToggleFavorite: (id: number) => void
  onPreview: (url: string) => void
  onExpandPrompt: (id: number) => void
  expanded: boolean
}

export function ResultCard({
  result: r,
  viewMode,
  onRegenerate,
  onReuseParams,
  onDelete,
  onToggleFavorite,
  onPreview,
  onExpandPrompt,
  expanded,
}: ResultCardProps) {
  // 生成中状态
  if (r.generating) {
    return (
      <div className={cn('group relative overflow-hidden rounded-lg bg-card', viewMode === 'large' ? 'aspect-square' : '')}>
        <div className="relative flex h-full items-center justify-center overflow-hidden bg-surface-hover">
          {/* AI生成动画背景 */}
          <div className="absolute inset-0 opacity-30" style={{
            backgroundImage: 'radial-gradient(circle at 25% 25%, #5051F8 0%, transparent 40%), radial-gradient(circle at 75% 75%, #7c3aed 0%, transparent 40%), radial-gradient(circle at 75% 25%, #06b6d4 0%, transparent 30%)',
          }} />
          <div className="relative flex flex-col items-center gap-3">
            <div className="relative">
              <div className="absolute -inset-2 rounded-full bg-accent/30 blur-md animate-ping" />
              <div className="relative size-6 rounded-full bg-gradient-to-br from-accent to-purple-600 shadow-[0_0_12px_#5051F8]" />
            </div>
            <span className="text-[8px] text-accent/70 tracking-[0.2em]">AI GENERATING</span>
          </div>
        </div>
      </div>
    )
  }

  // 正常结果卡片
  if (viewMode === 'list') {
    return (
      <div className="group flex gap-4 rounded-lg bg-card p-3">
        <div className="relative h-[120px] w-[120px] shrink-0 overflow-hidden rounded-lg">
          <img
            src={r.imageUrl}
            alt="生成的图片"
            loading="lazy"
            className="h-full w-full object-cover cursor-zoom-in hover:opacity-90 transition-opacity"
            onClick={() => onPreview(r.imageUrl!)}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[12px] text-text-secondary">
            <span className="font-medium text-text">{r.model}</span>
            <span>尺寸 {r.size}</span>
            <span className="text-text-muted">·</span>
            <span>画质 {r.quality}</span>
            <span className="text-text-muted">·</span>
            <span>{r.time}</span>
          </div>
          <p className={cn('mt-1.5 text-[12px] leading-[18px] text-text-secondary', !expanded && 'line-clamp-2')}>
            {r.prompt}
          </p>
          {r.prompt.length > 80 && (
            <button
              onClick={() => onExpandPrompt(r.id)}
              className="mt-0.5 text-[11px] text-accent hover:opacity-80"
            >
              {expanded ? '收起' : '展开'}
            </button>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Tooltip title="重新生成">
            <button onClick={() => onRegenerate(r)} className="flex size-[30px] items-center justify-center rounded-md text-text-muted hover:bg-card-hover hover:text-text-secondary"><RefreshCw className="size-[15px]" strokeWidth={1.8} /></button>
          </Tooltip>
          <Tooltip title="复用参数">
            <button onClick={() => onReuseParams(r)} className="flex size-[30px] items-center justify-center rounded-md text-text-muted hover:bg-card-hover hover:text-text-secondary"><Repeat className="size-[15px]" strokeWidth={1.8} /></button>
          </Tooltip>
          <Tooltip title="收藏">
            <button onClick={() => onToggleFavorite(r.id)} className="flex size-[30px] items-center justify-center rounded-md text-text-muted hover:bg-card-hover hover:text-text-secondary"><Star className={cn("size-[15px]", r.favorited && "fill-yellow-400 text-yellow-400")} strokeWidth={1.8} /></button>
          </Tooltip>
          <Tooltip title="下载">
            <button className="flex size-[30px] items-center justify-center rounded-md text-text-muted hover:bg-card-hover hover:text-text-secondary"><Download className="size-[15px]" strokeWidth={1.8} /></button>
          </Tooltip>
          <Tooltip title="删除">
            <button onClick={() => onDelete(r.id)} className="flex size-[30px] items-center justify-center rounded-md text-danger/70 hover:text-red-400 hover:bg-card-hover"><Trash2 className="size-[15px]" strokeWidth={1.8} /></button>
          </Tooltip>
        </div>
      </div>
    )
  }

  // 网格/大图视图
  return (
    <div className="group overflow-hidden rounded-lg bg-card">
      <div className="relative aspect-square overflow-hidden">
        <img
          src={r.imageUrl}
          alt="生成的图片"
          loading="lazy"
          className="h-full w-full object-cover cursor-zoom-in hover:opacity-90 transition-opacity"
          onClick={() => onPreview(r.imageUrl!)}
        />
        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Tooltip title="重新生成">
            <button onClick={() => onRegenerate(r)} className="flex size-[30px] items-center justify-center rounded-md bg-black/50 text-white hover:bg-black/70"><RefreshCw className="size-[15px]" /></button>
          </Tooltip>
          <Tooltip title="复用参数">
            <button onClick={() => onReuseParams(r)} className="flex size-[30px] items-center justify-center rounded-md bg-black/50 text-white hover:bg-black/70"><Repeat className="size-[15px]" /></button>
          </Tooltip>
          <Tooltip title="删除">
            <button onClick={() => onDelete(r.id)} className="flex size-[30px] items-center justify-center rounded-md bg-black/50 text-white hover:bg-red-500/70"><Trash2 className="size-[15px]" /></button>
          </Tooltip>
        </div>
      </div>
      <div className="p-2.5">
        <div className="flex items-center justify-between text-[11px] text-text-muted">
          <span className="truncate">{r.model}</span>
          <span>{r.quality}</span>
        </div>
        <p className="mt-1 line-clamp-2 text-[12px] leading-[16px] text-text-secondary">{r.prompt}</p>
      </div>
    </div>
  )
}
