import { useState } from 'react'
import { FolderOpen, Search, Upload, MoreVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

type AssetType = 'image' | 'video' | 'doc' | 'all'

const typeTabs: { id: AssetType; label: string }[] = [
  { id: 'all', label: 'pages.assets.all' },
  { id: 'image', label: 'pages.assets.image' },
  { id: 'video', label: 'pages.assets.video' },
  { id: 'doc', label: 'pages.assets.doc' },
]

const mockAssets = [
  { id: 1, name: '主图_01.png', type: 'image' as const, size: '2.4 MB', time: '2026-09-19' },
  { id: 2, name: '详情页_素材.jpg', type: 'image' as const, size: '1.8 MB', time: '2026-09-18' },
  { id: 3, name: '产品视频_v1.mp4', type: 'video' as const, size: '86 MB', time: '2026-09-17' },
  { id: 4, name: '品牌规范.docx', type: 'doc' as const, size: '512 KB', time: '2026-09-15' },
]

export default function AssetsPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<AssetType>('all')
  const [keyword, setKeyword] = useState('')

  const filtered = mockAssets.filter(
    (a) =>
      (tab === 'all' || a.type === tab) &&
      a.name.toLowerCase().includes(keyword.toLowerCase()),
  )

  return (
    <div className="flex h-full flex-col bg-bg">
      {/* 顶部占位：与生图页标签栏区域等高 */}
      <div className="h-[62px] shrink-0" />
      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1320px] p-6 pt-0">
      {/* 工具栏 */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-secondary p-1">
          {typeTabs.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={cn(
                'rounded-md px-3 py-1.5 text-[12px] font-medium leading-[18px] transition-colors',
                tab === item.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-text-muted hover:text-text-active',
              )}
            >
              {t(item.label)}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={t("pages.assets.search")}
            className="w-56 rounded-lg bg-input py-2 pl-9 pr-3 text-[14px] text-text outline-none placeholder:text-text-muted focus:ring-1 focus:ring-accent"
          />
        </div>
        <button className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[14px] font-medium text-accent-foreground transition-colors hover:bg-accent-hover">
          <Upload className="size-4" /> {t('pages.assets.upload')}
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
          {t('pages.assets.empty')}
        </div>
      )}
      </div>
      </div>
    </div>
  )
}