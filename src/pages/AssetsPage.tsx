import { useEffect, useState, type ChangeEvent } from 'react'
import { FolderOpen, Search, Upload, MoreVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'

type AssetType = 'image' | 'video' | 'doc' | 'all'

const typeTabs: { id: AssetType; label: string }[] = [
  { id: 'all', label: 'pages.assets.all' },
  { id: 'image', label: 'pages.assets.image' },
  { id: 'video', label: 'pages.assets.video' },
  { id: 'doc', label: 'pages.assets.doc' },
]

type Asset = { id: string; name: string; type: string; createdAt: string; favorited: boolean }

export default function AssetsPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<AssetType>('all')
  const [keyword, setKeyword] = useState('')
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [reloadSeq, setReloadSeq] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.get<Asset[]>('/assets', { type: tab, keyword }).then((data) => {
      if (!cancelled) setAssets(data)
    }).catch(() => {
      if (!cancelled) setAssets([])
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tab, keyword, reloadSeq])

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      await api.uploadAsset(file)
      setReloadSeq((value) => value + 1)
    } catch {
      // 页面保持当前数据，上传失败由后续提示组件统一承接。
    } finally {
      setUploading(false)
    }
  }

  const filtered = assets

  return (
    <div className="flex h-full flex-col bg-bg">
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
        <label title="上传到当前个人空间" className={cn('flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[14px] font-medium text-accent-foreground transition-colors hover:bg-accent-hover', uploading && 'pointer-events-none opacity-50')}>
          <Upload className="size-4" /> {t('pages.assets.upload')}
          <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
      </div>

      {/* 网格 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? <div className="col-span-full rounded-xl bg-card p-12 text-center text-[14px] text-text-muted">正在读取资产…</div> : filtered.map((a) => (
          <div key={a.id} className="group relative overflow-hidden rounded-xl bg-card transition-colors hover:bg-card-hover">
            <div className="flex aspect-square items-center justify-center">
              <FolderOpen className="size-8 text-text-muted" />
            </div>
            <div className="p-3">
              <div className="truncate text-[14px] text-text">{a.name}</div>
              <div className="mt-1 text-[12px] text-text-muted">
                {a.type} · {new Date(a.createdAt).toLocaleDateString()}
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
