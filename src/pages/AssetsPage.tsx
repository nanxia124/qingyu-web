import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { FolderOpen, Search, Upload, MoreVertical, Heart, MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { useBillingStore } from '@/stores/useBillingStore'
import { getInstallationId } from '@/lib/billing'

type AssetType = 'image' | 'video' | 'doc' | 'all'

const typeTabs: { id: AssetType; label: string }[] = [
  { id: 'all', label: 'pages.assets.all' },
  { id: 'image', label: 'pages.assets.image' },
  { id: 'video', label: 'pages.assets.video' },
  { id: 'doc', label: 'pages.assets.doc' },
]

type Asset = { id: string; name: string; type: string; createdAt: string; favorited: boolean; liked?: boolean; likeCount?: number; commentCount?: number }
type AssetComment = { id: string; content: string; authorEmail?: string; createdAt: string; parentId?: string | null }

export default function AssetsPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<AssetType>('all')
  const [keyword, setKeyword] = useState('')
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [reloadSeq, setReloadSeq] = useState(0)
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const [commentsAsset, setCommentsAsset] = useState<Asset | null>(null)
  const [comments, setComments] = useState<AssetComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const [commentSubmitting, setCommentSubmitting] = useState(false)
  const workspaceId = useBillingStore((state) => state.user?.workspaceId)
  const syncCursor = useRef(0)

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

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    const poll = async () => {
      try {
        const events = await api.get<Array<{ sequence: number; type: string }>>('/sync/events', { workspaceId, after: String(syncCursor.current), limit: '50' })
        if (events.length) {
          syncCursor.current = events[events.length - 1].sequence
          await api.post('/sync/cursor', { deviceId: getInstallationId(), workspaceId, lastSequence: syncCursor.current })
          if (!cancelled && events.some((event) => event.type.startsWith('asset.'))) setReloadSeq((value) => value + 1)
        }
      } catch {
        // 临时网络失败下次轮询继续。
      }
    }
    const timer = window.setInterval(() => void poll(), 10000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [workspaceId])

  // 列表中的图片从服务器重新读取，保证换设备后仍能看到同一份资产。
  useEffect(() => {
    let cancelled = false
    const urls: Record<string, string> = {}
    const imageAssets = assets.filter((asset) => asset.type === 'image').slice(0, 24)
    if (!imageAssets.length) {
      setPreviewUrls({})
      return () => { cancelled = true }
    }
    void Promise.all(imageAssets.map(async (asset) => {
      try {
        const blob = await api.fetchAssetBlob(asset.id)
        if (!cancelled) urls[asset.id] = URL.createObjectURL(blob)
      } catch {
        // 单个文件读取失败不影响其余资产显示。
      }
    })).then(() => {
      if (!cancelled) setPreviewUrls(urls)
      else Object.values(urls).forEach((url) => URL.revokeObjectURL(url))
    })
    return () => {
      cancelled = true
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url))
    }
  }, [assets])

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

  const handleLike = async (asset: Asset) => {
    const liked = !asset.liked
    try {
      const result = await (liked ? api.put('/assets/' + encodeURIComponent(asset.id) + '/like') : api.delete('/assets/' + encodeURIComponent(asset.id) + '/like'))
      setAssets((items) => items.map((item) => item.id === asset.id ? { ...item, liked: result.liked, likeCount: result.likeCount } : item))
    } catch {
      window.alert('点赞操作失败，请稍后重试')
    }
  }

  const openComments = async (asset: Asset) => {
    setCommentsAsset(asset)
    setComments([])
    setCommentsLoading(true)
    try {
      const result = await api.get<AssetComment[]>('/assets/' + encodeURIComponent(asset.id) + '/comments')
      setComments(result)
    } catch {
      window.alert('评论读取失败，请稍后重试')
    } finally {
      setCommentsLoading(false)
    }
  }

  const handleComment = async () => {
    if (!commentsAsset || !commentDraft.trim()) return
    setCommentSubmitting(true)
    try {
      const created = await api.post<AssetComment>('/assets/' + encodeURIComponent(commentsAsset.id) + '/comments', { content: commentDraft.trim() })
      setComments((items) => [...items, created])
      setCommentDraft('')
    } catch {
      window.alert('评论发布失败，请稍后重试')
    } finally {
      setCommentSubmitting(false)
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
              {previewUrls[a.id] ? <img src={previewUrls[a.id]} alt={a.name} className="size-full object-cover" loading="lazy" /> : <FolderOpen className="size-8 text-text-muted" />}
            </div>
            <div className="p-3">
              <div className="truncate text-[14px] text-text">{a.name}</div>
              <div className="mt-1 text-[12px] text-text-muted">
                {a.type} · {new Date(a.createdAt).toLocaleDateString()}
              </div>
              <div className="mt-3 flex items-center gap-2 text-[12px] text-text-muted">
                <button onClick={() => void handleLike(a)} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-surface-hover" title="点赞">
                  <Heart className={cn('size-3.5', a.liked && 'fill-red-400 text-red-400')} /> {a.likeCount || 0}
                </button>
                <button onClick={() => void openComments(a)} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-surface-hover" title="评论">
                  <MessageCircle className="size-3.5" /> {a.commentCount || 0}
                </button>
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
      {commentsAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setCommentsAsset(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-card p-5" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="truncate text-base font-semibold text-text">{commentsAsset.name} 的评论</h2>
              <button className="rounded-md px-2 py-1 text-text-muted hover:bg-secondary hover:text-text" onClick={() => setCommentsAsset(null)}>关闭</button>
            </div>
            <div className="max-h-72 space-y-3 overflow-y-auto">
              {commentsLoading ? <div className="py-8 text-center text-sm text-text-muted">正在读取评论…</div> : comments.length === 0 ? <div className="py-8 text-center text-sm text-text-muted">还没有评论</div> : comments.map((comment) => (
                <div key={comment.id} className="rounded-lg bg-secondary px-3 py-2">
                  <div className="mb-1 text-xs text-text-muted">{comment.authorEmail || '用户'} · {new Date(comment.createdAt).toLocaleString()}</div>
                  <div className="whitespace-pre-wrap break-words text-sm text-text">{comment.content}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <input value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void handleComment() } }} placeholder="写下你的评论" maxLength={10000} className="min-w-0 flex-1 rounded-lg bg-input px-3 py-2 text-sm text-text outline-none placeholder:text-text-muted focus:ring-1 focus:ring-accent" />
              <button disabled={commentSubmitting || !commentDraft.trim()} onClick={() => void handleComment()} className="rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground disabled:opacity-50">{commentSubmitting ? '发布中…' : '发布'}</button>
            </div>
          </div>
        </div>
      )}
      </div>
      </div>
    </div>
  )
}
