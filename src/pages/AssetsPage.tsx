import { useState } from 'react'
import { FolderOpen, Search, Upload, MoreVertical } from 'lucide-react'
import { cn } from '@/lib/utils'

type AssetType = 'image' | 'video' | 'doc' | 'all'

const typeTabs: { id: AssetType; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'image', label: '图片' },
  { id: 'video', label: '视频' },
  { id: 'doc', label: '文档' },
]

const mockAssets = [
  { id: 1, name: '主图_01.png', type: 'image' as const, size: '2.4 MB', time: '2026-09-19' },
  { id: 2, name: '详情页_素材.jpg', type: 'image' as const, size: '1.8 MB', time: '2026-09-18' },
  { id: 3, name: '产品视频_v1.mp4', type: 'video' as const, size: '86 MB', time: '2026-09-17' },
  { id: 4, name: '品牌规范.docx', type: 'doc' as const, size: '512 KB', time: '2026-09-15' },
]

export default function AssetsPage() {
  const [tab, setTab] = useState<AssetType>('all')
  const [keyword, setKeyword] = useState('')

  const filtered = mockAssets.filter(
    (a) =>
      (tab === 'all' || a.type === tab) &&
      a.name.toLowerCase().includes(keyword.toLowerCase()),
  )

  return (
    <div className="mx-auto max-w-[1320px] p-6">
      {/* 工具栏 */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-[#f0f0f2] p-1">
          {typeTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'rounded-md px-3 py-1.5 text-[12px] font-medium leading-[18px] transition-colors',
                tab === t.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-text-muted hover:text-text-active',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索素材…"
            className="w-56 rounded-lg bg-input py-2 pl-9 pr-3 text-[14px] text-text outline-none placeholder:text-text-muted focus:ring-1 focus:ring-accent"
          />
        </div>
        <button className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[14px] font-medium text-accent-foreground transition-colors hover:bg-accent-hover">
          <Upload className="size-4" /> 上传素材
        </button>
      </div>

      {/* 网格 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {filtered.map((a) => (
          <div key={a.id} className="group relative overflow-hidden rounded-xl bg-card transition-colors hover:bg-card-hover">
            <div className="flex aspect-square items-center justify-center">
              <FolderOpen className="size-8 text-text-muted" />
            </div>
            <div className="p-3">
              <div className="truncate text-[14px] text-text">{a.name}</div>
              <div className="mt-1 text-[12px] text-text-muted">
                {a.size} · {a.time}
              </div>
            </div>
            <button className="absolute right-2 top-2 hidden size-7 items-center justify-center rounded-lg bg-black/50 text-white backdrop-blur group-hover:flex">
              <MoreVertical className="size-4" />
            </button>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="mt-8 rounded-xl bg-card p-12 text-center text-[14px] text-text-muted">
          没有找到匹配的素材
        </div>
      )}
    </div>
  )
}