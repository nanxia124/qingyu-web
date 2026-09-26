import { useRef, useState, useEffect } from 'react'
import { App as AntdApp } from 'antd'
import Tooltip from '@/components/ui/Tooltip'
import { SpeechInputButton } from '@/components/speech-input-button'
import { ImageViewer } from '@/components/ImageViewer'
import { ModelPicker } from '@canvas/components/model-picker'
import { useConfigStore } from '@canvas/stores/use-config-store'
import { createPortal } from 'react-dom'
import {
  Upload,
  X,
  RefreshCw,
  Sparkles,
  Wand2,
  Loader2,
  Languages,
  Trash2,
  Plus,
  Search,
  AlignLeft,
  LayoutGrid,
  List,
  ZoomIn,
  Repeat,
  FileText,
  Copy,
  Quote,
  Share2,
  Star,
  Download,
  CloudUpload,
  FolderOpen,
  PanelRightClose,
  ClipboardPaste,
  Trash2 as TrashIcon,
  PanelRightOpen,
  ChevronDown,
  History,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { SearchInput } from '@/components/SearchInput'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/useAuthStore'
import { requestGeneration, requestEdit } from '@canvas/services/api/image'
import { submitImageTask, pollImageTask, taskOutputToDataUrls, resolveOpenImageParams, listImageTasks } from '@/lib/generationTasks'
import type { GenTask } from '@/lib/generationTasks'
import { nanoid } from 'nanoid'
import type { ReferenceImage } from '@canvas/types/image'
import { ensureServerConfig } from '@canvas/lib/server-config-bootstrap'
import { api } from '@/lib/api'
import { motion } from 'motion/react'
import { useBillingStore } from '@/stores/useBillingStore'
import { billingApi, type ModelCreditQuote } from '@/lib/billing'

type TabId = 'generate' | 'blend' | 'translate'
type ViewMode = 'list' | 'grid' | 'large'
type ServerImageAsset = {
  id: string
  name: string
  type: string
  createdAt: string
  favorited: boolean
  metadata?: Record<string, unknown>
}
type ImageToolResult = {
  id: number
  assetId?: string
  model: string
  size: string
  fileSize: string
  quality: string
  time: string
  createdAt: number
  prompt: string
  favorited: boolean
  imageUrl?: string
  sourceKind?: 'generated' | 'edited'
  sourceGenerationTaskId?: string
  editId?: string
  sourceFileId?: string
  writeIdempotencyKey?: string
  /** 骨架占位：刚提交任务、图还没回来 */
  pending?: boolean
  /** 骨架占位对应的这次生成失败 */
  failed?: boolean
}
/** 把 "16:9" 这类比例字符串解析成宽高比；原始/未知比例默认 1:1 */
function parseRatioWH(ratio: string): { w: number; h: number } {
  if (!ratio || ratio === '__ORIG__' || ratio === 'auto') return { w: 1, h: 1 }
  const m = ratio.match(/^(\d+)\s*:\s*(\d+)$/)
  if (!m) return { w: 1, h: 1 }
  return { w: Number(m[1]), h: Number(m[2]) }
}

/** 生成中的渐变发光占位块：高度固定 160px，宽度按传入比例换算 */
function GeneratingSkeleton({ ratio, failed }: { ratio: string; failed?: boolean }) {
  const { w, h } = parseRatioWH(ratio)
  const width = Math.round(160 * (w / h))
  return (
    <div
      className="relative overflow-hidden rounded-lg bg-surface-hover"
      style={{ width, height: 160 }}
    >
      {/* 渐变背景 */}
      <div className="absolute inset-0 opacity-30" style={{
        backgroundImage: failed
          ? 'radial-gradient(circle at 25% 25%, #b91c1c 0%, transparent 40%), radial-gradient(circle at 75% 75%, #7f1d1d 0%, transparent 40%)'
          : 'radial-gradient(circle at 25% 25%, #5051F8 0%, transparent 40%), radial-gradient(circle at 75% 75%, #7c3aed 0%, transparent 40%), radial-gradient(circle at 75% 25%, #06b6d4 0%, transparent 30%)',
      }} />
      <div className="relative flex h-full flex-col items-center justify-center gap-2">
        {failed ? (
          <span className="text-[12px] text-red-400">生成失败</span>
        ) : (
          <>
            <div className="relative">
              <div className="absolute -inset-2 rounded-full bg-accent/30 blur-md animate-ping" />
              <div className="relative size-6 rounded-full bg-gradient-to-br from-accent to-purple-600 shadow-[0_0_12px_#5051F8]" />
            </div>
            <span className="text-[8px] text-accent/70 tracking-[0.2em]">AI GENERATING</span>
          </>
        )}
      </div>
    </div>
  )
}

const tabs: { id?: TabId; label: string; translation?: boolean; width: string }[] = [
  { id: 'generate', label: 'imageTools.generate', translation: true, width: 'w-[64px]' },
  { id: 'blend', label: 'imageTools.blend', translation: true, width: 'w-[64px]' },
  { id: 'translate', label: 'imageTools.translate', translation: true, width: 'w-[80px]' },
  { label: 'imageTools.tabInpaint', translation: true, width: 'w-[80px]' },
  { label: 'imageTools.tabExpand', translation: true, width: 'w-[64px]' },
  { label: 'imageTools.tabCutout', translation: true, width: 'w-[64px]' },
  { label: 'imageTools.tabSuperRes', translation: true, width: 'w-[96px]' },
  { label: 'imageTools.tabRepair', translation: true, width: 'w-[64px]' },
]

/* ── 生图 Tab ── */
const MAX_PROMPT_LENGTH = 2000


function GeneratePanel({ connectTopLeft = true }: { connectTopLeft?: boolean }) {
  const { t } = useTranslation()
  const config = useConfigStore((s) => s.config)
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)
  const openAuthModal = useAuthStore((s) => s.openAuthModal)
  const refreshBillingUser = useBillingStore((s) => s.refreshMe)
  const billingUser = useBillingStore((s) => s.user)
  const [prompt, setPrompt] = useState('')
  const [ratio, setRatio] = useState('16:9')
  const [quality, setQuality] = useState('1K')
  const [count, setCount] = useState('4')
  const [queueNum, setQueueNum] = useState('10')
  const [generating, setGenerating] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [model, setModel] = useState('')
  const [creditQuote, setCreditQuote] = useState<ModelCreditQuote | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error'; action?: { label: string; onClick: () => void }; pos?: 'top' | 'input' } | null>(null)
  const [queueSize, setQueueSize] = useState(0)
  const [showQueue, setShowQueue] = useState(false)
  const queueRef = useRef<Array<{ prompt: string; ratio: string; quality: string; count: string; refImages: string[] }>>([])
  const queueRunningRef = useRef(false)
  const [results, setResults] = useState<ImageToolResult[]>([])
  const [savingResultIds, setSavingResultIds] = useState<Set<number>>(new Set())
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [thumbScale, setThumbScale] = useState(100)
  const [resultsCollapsed, setResultsCollapsed] = useState(false)
  const [filterMenu, setFilterMenu] = useState<'time' | 'stars' | null>(null)
  const [timeFilter, setTimeFilter] = useState('all')
  const [starFilter, setStarFilter] = useState('all')
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const [refImages, setRefImages] = useState<string[]>([])
  const persistedReferenceImages = useRef(new Map<string, string>())
  const refInputRef = useRef<HTMLInputElement>(null)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [previewImages, setPreviewImages] = useState<string[]>([])
  const [undoPrompt, setUndoPrompt] = useState('')
  const [commonPrompts, setCommonPrompts] = useState<{id:number; title:string; content:string}[]>(() => {
    try { const raw = localStorage.getItem('image-tools:common-prompts'); return raw ? JSON.parse(raw) : [] } catch { return [] }
  })
  const [showCommonPromptModal, setShowCommonPromptModal] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [historyTasks, setHistoryTasks] = useState<GenTask[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [newPromptTitle, setNewPromptTitle] = useState('')
  const [newPromptContent, setNewPromptContent] = useState('')
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [storagePath, setStoragePath] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const loadedResultUrlsRef = useRef<string[]>([])
  const [searchKeyword, setSearchKeyword] = useState('')

  const ratios = ['__ORIG__', '1:1', '2:3', '3:4', '4:5', '9:16', '21:9', '3:2', '4:3', '5:4', '16:9']
  const qualities = ['1K', '2K', '4K']
  const counts = Array.from({ length: 15 }, (_, i) => String(i + 1))
  // 模型能力限制
  const currentModelName = model.split('::').pop() || model
  const isNanoBanana = currentModelName.includes('nano-banana')
  const isGptImage25 = currentModelName === 'gpt-image-2.5'
  const onlyOne = isNanoBanana || isGptImage25
  const only1K = isNanoBanana || isGptImage25
  const disabledCounts = onlyOne ? counts.slice(1) : []
  const disabledQualities = only1K ? ['2K', '4K'] : []
  const selectedModelForQuote = model || config.imageModel || config.model
  const isPlatformModel = /catalog:\d+/.test(selectedModelForQuote)

  useEffect(() => {
    setCreditQuote(null)
    if (!isLoggedIn || !prompt.trim() || !isPlatformModel) { setQuoteLoading(false); return }
    let active = true
    setQuoteLoading(true)
    const timer = window.setTimeout(async () => {
      try {
        const imageParams = resolveOpenImageParams({ ratio, quality, model: selectedModelForQuote })
        const quote = await billingApi.quote({ model: selectedModelForQuote, taskType: 'image', prompt: prompt.trim(), quantity: Math.max(1, Math.min(15, Number(count) || 1)), parameters: { ...imageParams, n: Math.max(1, Math.min(15, Number(count) || 1)), response_format: 'b64_json' } })
        if (active) setCreditQuote(quote)
      } catch {
        if (active) setCreditQuote(null)
      } finally { if (active) setQuoteLoading(false) }
    }, 300)
    return () => { active = false; window.clearTimeout(timer) }
  }, [isLoggedIn, prompt, isPlatformModel, selectedModelForQuote, ratio, quality, count])

  const nowTs = Date.now()
  const DAY = 24 * 3600 * 1000
  const filteredResults = results.filter((r) => {
    if (searchKeyword.trim() && !r.prompt.toLowerCase().includes(searchKeyword.trim().toLowerCase())) return false
    if (starFilter === 'favorite' && !r.favorited) return false
    if (starFilter === 'notFavorite' && r.favorited) return false
    if (timeFilter === 'today' && r.createdAt < new Date().setHours(0,0,0,0)) return false
    if (timeFilter === 'last7' && r.createdAt < nowTs - 7 * DAY) return false
    if (timeFilter === 'last30' && r.createdAt < nowTs - 30 * DAY) return false
    return true
  })

  const { modal } = AntdApp.useApp()
  const showToast = (msg: string, type: 'success' | 'error' = 'success', action?: { label: string; onClick: () => void }, pos: 'top' | 'input' = 'top') => {
    setToast({ msg, type, action, pos })
    setTimeout(() => setToast(null), 3000)
  }

  const openPreview = (url: string) => {
    const resultUrls = results.filter((r) => r.imageUrl).map((r) => r.imageUrl!)
    const idx = resultUrls.indexOf(url)
    if (idx >= 0) { setPreviewImages(resultUrls); setPreviewIndex(idx) } else { setPreviewImages([url]); setPreviewIndex(0) }
    setPreviewOpen(true)
  }
  const addToQueue = (n: number) => {
    if (!isLoggedIn) { openAuthModal(); return }
    if (!prompt.trim()) { showToast(t('imageTools.inputPromptFirst'), 'error'); return }
    const task = { prompt: prompt.trim(), ratio, quality, count, refImages: [...refImages] }
    for (let i = 0; i < n; i++) queueRef.current.push(task)
    setQueueSize(queueRef.current.length)
    showToast(t('imageTools.toasts.queuedInfo', { n, total: queueRef.current.length }))
    void drainQueue()
  }
  const drainQueue = async () => {
    if (queueRunningRef.current) return
    queueRunningRef.current = true
    while (queueRef.current.length) {
      const task = queueRef.current.shift()!
      setQueueSize(queueRef.current.length)
      try { await runGeneration(task) } catch { /* 单条失败不阻断队列 */ }
    }
    queueRunningRef.current = false
  }

  const copyPrompt = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => showToast(t('imageTools.toasts.copiedPrompt'))).catch(() => showToast(t('imageTools.toasts.copyFailed'), 'error'))
  }

  const uploadImageResult = async (result: ImageToolResult): Promise<{ id: string }> => {
    if (!result.imageUrl) throw new Error(t('imageTools.toasts.resultUnavailable'))
    const response = await fetch(result.imageUrl)
    if (!response.ok) throw new Error(t('imageTools.toasts.resultUnavailable'))
    const blob = await response.blob()
    const extension = blob.type.split('/')[1]?.split(';')[0] || 'png'
    const file = new File([blob], `${t('imageTools.resultFilePrefix')}-${result.id}.${extension}`, { type: blob.type || 'image/png' })
    return api.uploadAsset<{ id: string }>(file, {
      sourceKind: result.sourceKind || 'generated',
      source: result.sourceKind === 'edited' ? 'image_edit' : 'image_generation',
      ...(result.writeIdempotencyKey ? { writeIdempotencyKey: result.writeIdempotencyKey } : {}),
      ...(result.editId && result.sourceFileId ? { editId: result.editId, sourceFileId: result.sourceFileId } : {}),
      ...(result.sourceGenerationTaskId ? { sourceGenerationTaskId: result.sourceGenerationTaskId } : {}),
      prompt: result.prompt,
      model: result.model,
      quality: result.quality,
      size: result.size,
    })
  }

  const retrySaveResult = async (id: number) => {
    const result = results.find((item) => item.id === id)
    if (!result || result.assetId || savingResultIds.has(id)) return
    setSavingResultIds((current) => new Set(current).add(id))
    try {
      const asset = await uploadImageResult(result)
      setResults((current) => current.map((item) => item.id === id ? { ...item, assetId: asset.id } : item))
      showToast(t('imageTools.toasts.savedToCloud'))
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('imageTools.toasts.saveRetryFailed'), 'error')
    } finally {
      setSavingResultIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }
  }

  const openHistory = async () => {
    setShowHistory(true)
    setHistoryLoading(true)
    try {
      setHistoryTasks(await listImageTasks(50))
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('imageTools.historyQueryFailed'), 'error')
    } finally {
      setHistoryLoading(false)
    }
  }

  const deleteResult = async (id: number) => {
    const item = results.find((x) => x.id === id)
    if (!item) return
    modal.confirm({
      title: t('imageTools.confirmDeleteTitle'),
      content: t('imageTools.confirmDelete'),
      okText: t('imageTools.delete'),
      cancelText: t('imageTools.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        if (item.assetId) {
          try { await api.delete(`/assets/${item.assetId}`) } catch { /* 已删或无权限，仍从本地移除 */ }
        }
        setResults((r) => r.filter((x) => x.id !== id))
        showToast(t('imageTools.toasts.deleted'))
      },
    })
  }

  const toggleFavorite = async (id: number) => {
    const item = results.find((x) => x.id === id)
    if (item?.assetId) {
      try {
        if (item.favorited) await api.delete(`/favorites/${item.assetId}`)
        else await api.put(`/favorites/${item.assetId}`)
      } catch {
        showToast(t('imageTools.favoriteSyncFailed'), 'error')
        return
      }
    }
    setResults((r) => r.map((x) => (x.id === id ? { ...x, favorited: !x.favorited } : x)))
  }

  const pasteImage = (asReplaceIndex?: number) => {
    navigator.clipboard?.read().then(async (items) => {
      for (const item of items) {
        if (item.types.includes('image/png') || item.types.includes('image/jpeg')) {
          const blob = await item.getType(item.types.find(t => t.startsWith('image'))!)
          const reader = new FileReader()
          reader.onload = () => {
            const data = reader.result as string
            setRefImages((xs) => {
              if (asReplaceIndex !== undefined && xs[asReplaceIndex]) {
                const next = [...xs]
                next[asReplaceIndex] = data
                return next
              }
              return [...xs, data]
            })
            showToast(t('imageTools.toasts.pasted'))
          }
          reader.readAsDataURL(blob)
          break
        }
      }
    }).catch(() => {})
  }

  // 配置同步后，模型选择器会从 useConfigStore 读取完整的图片模型列表。
  useEffect(() => {
    if (config.imageModel) setModel(config.imageModel)
  }, [config.imageModel])

  // 结果以服务器资产库为准，刷新页面或换设备后仍能恢复历史记录。
  useEffect(() => {
    if (!isLoggedIn) return
    let cancelled = false
    const loadServerResults = async () => {
      try {
        const assets = await api.get<ServerImageAsset[]>('/assets', { type: 'image' })
        if (cancelled) return
        const nextUrls: string[] = []
        // 首屏只读取最近 24 张缩略图，避免一次刷新给服务器发起大量文件请求。
        const nextResults = await Promise.all(assets.slice(0, 24).map(async (asset, index) => {
          const metadata = asset.metadata || {}
          let imageUrl: string | undefined
          try {
            const blob = await api.fetchAssetBlob(asset.id)
            imageUrl = URL.createObjectURL(blob)
            nextUrls.push(imageUrl)
          } catch {
            // 单个文件读取失败时保留历史条目，避免整页结果消失。
          }
          const createdAt = Date.parse(asset.createdAt) || Date.now()
          return {
            id: createdAt + index,
            assetId: asset.id,
            model: String(metadata.model || '—'),
            size: String(metadata.size || '—'),
            fileSize: metadata.sizeBytes ? `${Math.round(Number(metadata.sizeBytes) / 1024)} KB` : '—',
            quality: String(metadata.quality || '—'),
            time: asset.createdAt.slice(0, 16).replace('T', ' '),
            createdAt,
            prompt: String(metadata.prompt || asset.name || ''),
            favorited: Boolean(asset.favorited),
            imageUrl,
          }
        }))
        if (cancelled) {
          nextUrls.forEach((url) => URL.revokeObjectURL(url))
          return
        }
        loadedResultUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
        loadedResultUrlsRef.current = nextUrls
        setResults(nextResults)
      } catch {
        // 历史读取失败不影响当前生成功能，下一次进入页面会继续尝试。
      }
    }
    void loadServerResults()
    return () => {
      cancelled = true
      loadedResultUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
      loadedResultUrlsRef.current = []
    }
  }, [isLoggedIn])

  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile()
          if (blob) {
            const reader = new FileReader()
            reader.onload = () => {
              setRefImages((xs) => (xs.includes(reader.result as string) ? xs : [...xs, reader.result as string]))
              showToast(t('imageTools.toasts.pasted'))
            }
            reader.readAsDataURL(blob)
            e.preventDefault()
            break
          }
        }
      }
    }
    window.addEventListener('paste', handler)
    return () => window.removeEventListener('paste', handler)
  }, [])

  const togglePrompt = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const reuseParams = (r: typeof results[0]) => {
    setPrompt(r.prompt)
    setQuality(r.quality)
    showToast(t('imageTools.toasts.reused'))
  }

  const runGeneration = async (task?: { prompt: string; ratio: string; quality: string; count: string; refImages: string[] }) => {
    if (!isLoggedIn) { openAuthModal(); return }
    const _prompt = task?.prompt ?? prompt
    const _ratio = task?.ratio ?? ratio
    const _quality = task?.quality ?? quality
    const _count = task?.count ?? count
    const _refImages = task?.refImages ?? refImages
    if (!_prompt.trim() || generating) return
    const requestedCount = Math.max(1, Math.min(15, Number(_count) || 1))
    await refreshBillingUser()
    const latestBillingUser = useBillingStore.getState().user
    if (!latestBillingUser) {
      showToast(t('imageTools.submitFailed'), 'error')
      return
    }
    const selectedModel = model || config.imageModel || config.model
    const catalogPricingEnabled = /catalog:\d+/.test(selectedModel)
    const imgParams = resolveOpenImageParams({ ratio: _ratio, quality: _quality, model: selectedModel })
    const billableParameters = { ...imgParams, n: requestedCount, response_format: 'b64_json' }
    let quote: ModelCreditQuote | null = null
    if (catalogPricingEnabled) {
      try { quote = await billingApi.quote({ model: selectedModel, taskType: 'image', prompt: _prompt.trim(), parameters: billableParameters, quantity: requestedCount }) }
      catch (error) { showToast(error instanceof Error ? error.message : '无法确认本次积分价格', 'error'); return }
    }
    setCreditQuote(quote)
    if (quote && latestBillingUser.balance < quote.totalCredits) {
      showToast(`本次需要 ${quote.totalCredits} 积分，当前余额 ${latestBillingUser.balance}，请先订阅或充值`, 'error')
      return
    }
    setGenerating(true)
    // 立刻插入 N 个骨架占位卡片，图回来后按 id 替换
    const skeletonBase = Date.now()
    const skeletonIds: number[] = Array.from({ length: requestedCount }, (_, i) => skeletonBase + i)
    const skeletonModelLabel = selectedModel.split('::').pop() || selectedModel
    const skeletonSize = _ratio === '__ORIG__' ? 'auto' : _ratio
    setResults((prev) => [
      ...skeletonIds.map((id) => ({
        id,
        model: skeletonModelLabel,
        size: skeletonSize,
        fileSize: '—',
        quality: _quality,
        time: '',
        createdAt: Date.now(),
        prompt: _prompt.trim(),
        favorited: false,
        pending: true,
      })),
      ...prev,
    ])
    try {
      const requestConfig = {
        ...config,
        model: selectedModel,
        imageModel: selectedModel,
        count: _count,
        quality: _quality.toLowerCase(),
        size: _ratio === '__ORIG__' ? 'auto' : _ratio,
      }
      const referenceUploadBatchId = crypto.randomUUID()
      const referenceAssetIds = await Promise.all(_refImages.map(async (dataUrl, index) => {
        const existingAssetId = persistedReferenceImages.current.get(dataUrl)
        if (existingAssetId) return existingAssetId
        const response = await fetch(dataUrl)
        if (!response.ok) throw new Error('读取参考图失败，无法保存到云端')
        const blob = await response.blob()
        const file = new File([blob], `reference-${Date.now()}-${index + 1}.${blob.type.split('/')[1] || 'bin'}`, { type: blob.type || 'application/octet-stream' })
        const asset = await api.uploadAsset<{ id: string }>(file, { sourceKind: 'reference_upload', uploadBatchId: referenceUploadBatchId })
        if (!asset.id) throw new Error('云端没有返回参考素材编号，无法继续编辑')
        persistedReferenceImages.current.set(dataUrl, asset.id)
        return asset.id
      }))
      const references: ReferenceImage[] = _refImages.map((dataUrl, index) => ({
        id: `image-tools-ref-${index}`,
        name: `reference-${index + 1}`,
        type: 'image',
        dataUrl,
      }))
      const contentEdit = referenceAssetIds.length
        ? await api.post<{ editId: string; baseFileId: string }>('/content-edits', {
            referenceAssetIds,
            idempotencyKey: `image-edit:${crypto.randomUUID()}`,
          })
        : null
      let sourceGenerationTaskId: string | undefined
      const generated = references.length && !catalogPricingEnabled
        ? await requestEdit(requestConfig, _prompt.trim(), references)
        : await (async () => {
            // 0046 生图改异步任务：提交即返回 taskId，后台生成，前端轮询。
            const { taskId } = await submitImageTask({
              model: selectedModel,
              prompt: _prompt.trim(),
              n: requestedCount,
              ...imgParams,
              response_format: 'b64_json',
              ...(catalogPricingEnabled ? { creditQuoteId: quote?.id } : {}),
              ...(references.length ? { referenceAssetIds } : {}),
            })
            sourceGenerationTaskId = taskId
            const task = await pollImageTask(taskId)
            if (task.status === 'failed' || task.status === 'refunded') {
              const reason = task.errorMessage?.trim() || t('workbench.generationFailed')
              const msg = task.status === 'refunded' && !reason.includes('退还') && !reason.includes('退款')
                ? reason + '（已释放预占额度）'
                : reason
              throw new Error(msg)
            }
            return taskOutputToDataUrls(task).map((dataUrl) => ({ id: nanoid(), dataUrl }))
          })()
      await refreshBillingUser()
      const now = new Date()
      const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      const modelLabel = selectedModel.split('::').pop() || selectedModel
      const newResults = generated.map((image, index) => ({
        id: skeletonIds[index] ?? (Date.now() + index),
        model: modelLabel,
        size: _ratio === '__ORIG__' ? 'auto' : _ratio,
        fileSize: '—',
        quality: _quality,
        time: timeStr,
        createdAt: Date.now(),
        prompt: _prompt.trim(),
        favorited: false,
        imageUrl: image.dataUrl,
        writeIdempotencyKey: `image-tool:${crypto.randomUUID()}`,
        sourceKind: contentEdit ? 'edited' as const : 'generated' as const,
        ...(sourceGenerationTaskId ? { sourceGenerationTaskId } : {}),
        ...(contentEdit ? { editId: contentEdit.editId, sourceFileId: contentEdit.baseFileId } : {}),
      }))
      const persisted = await Promise.all(newResults.map(async (result) => {
        try { return await uploadImageResult(result) }
        catch { return null }
      }))
      const savedResults = newResults.map((result, index) => ({ ...result, assetId: persisted[index]?.id }))
      setResults((prev) => {
        const rest = prev.filter((x) => !skeletonIds.includes(x.id))
        return [...savedResults, ...rest]
      })
      setGenerating(false)
      const failedInitial = savedResults.filter((result) => !result.assetId)
      if (failedInitial.length) {
        showToast(t('imageTools.toasts.saveFailed', { count: failedInitial.length }), 'error')
        ;(async () => {
          for (let attempt = 0; attempt < 3; attempt++) {
            await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
            const stillFailed = savedResults.filter((x) => !x.assetId)
            if (!stillFailed.length) break
            for (const fr of stillFailed) {
              try {
                const a = await uploadImageResult(fr)
                setResults((cur) => cur.map((x) => x.id === fr.id ? { ...x, assetId: a.id } : x))
              } catch { /* 下一轮再试 */ }
            }
          }
        })()
      } else {
        showToast(t('imageTools.toasts.done'))
      }
    } catch (error) {
      setGenerating(false)
      setResults((prev) => prev.map((x) => skeletonIds.includes(x.id) ? { ...x, pending: false, failed: true } : x))
      showToast(error instanceof Error ? error.message : t('workbench.generationFailed'), 'error')
    }
  }

  const requestedCount = Math.max(1, Math.min(15, Number(count) || 1))
  const estimatedCost = creditQuote?.totalCredits ?? null
  const insufficientBalance = Boolean(creditQuote && billingUser && billingUser.balance < creditQuote.totalCredits)
  const quoteUnavailable = Boolean(isPlatformModel && prompt.trim() && (quoteLoading || !creditQuote))
  const quotaExhausted = insufficientBalance

  return (
    <div className="flex h-full gap-2">
      {/* ── 左栏 ── */}
      <div className={cn('flex w-[clamp(340px,30vw,520px)] shrink-0 flex-col overflow-hidden rounded-tr-xl rounded-br-xl rounded-bl-xl bg-card', connectTopLeft ? 'rounded-tl-none' : 'rounded-tl-md')}>
        <div className="flex-1 overflow-y-auto px-5 pt-4 pb-2">
          {/* 模型选择器 */}
          <div className="mb-6">
            <ModelPicker
              config={config}
              value={model}
              onChange={(m: string) => {
                setModel(m);
                const mn = (m || '').split('::').pop() || '';
                if (mn.includes('nano-banana') || mn === 'gpt-image-2.5') {
                  setCount('1');
                  setQuality('1K');
                }
              }}
              capability="image"
              fullWidth
            />
          </div>


          {/* 提示词 */}
          <div className="mb-6">
            <label className="mb-2 block text-[14px] text-text">{t("imageTools.prompt")}</label>
            <div className="relative prompt-box rounded-xl border border-border bg-input dark:border-0 dark:bg-secondary">
              <textarea
                ref={promptRef}
                value={prompt}
                onChange={(e) => {
                  const val = e.target.value
                  if (val.length > MAX_PROMPT_LENGTH) {
                    showToast(t('imageTools.toasts.promptTooLong'), 'error')
                    return
                  }
                  setPrompt(val)
                  // 自动展开高度
                  requestAnimationFrame(() => {
                    const el = promptRef.current
                    if (el) {
                      el.style.height = 'auto'
                      el.style.height = Math.max(120, el.scrollHeight) + 'px'
                    }
                  })
                }}
                rows={5}
                placeholder=""
                className="w-full resize-none overflow-hidden rounded-xl bg-transparent px-3 py-2 text-[14px] leading-[22px] text-text outline-none placeholder:text-text-secondary"
              />
              <div className="absolute bottom-2 right-2 flex gap-1">
                <SpeechInputButton onResult={(text) => setPrompt((prev) => prev ? prev + " " + text : text)} />
                <Tooltip title={t("imageTools.clear")}><button  onClick={() => { setUndoPrompt(prompt); setPrompt(''); if (promptRef.current) promptRef.current.style.height = 'auto'; showToast(t('imageTools.toasts.cleared'), 'success', { label: t('imageTools.undo'), onClick: () => { setPrompt(undoPrompt); setUndoPrompt('') } }, 'input') }} className="flex size-6 items-center justify-center rounded text-text-secondary hover:bg-surface-hover"><Trash2 className="size-[13px]" /></button></Tooltip>
                <Tooltip title={t("imageTools.tipFormat")}><button  className="flex size-6 items-center justify-center rounded text-text-secondary hover:bg-surface-hover"><AlignLeft className="size-[13px]" /></button></Tooltip>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {commonPrompts.slice(0, 6).map((p) => (
                <button key={p.id} onClick={() => { setPrompt(p.content); showToast(t('imageTools.toasts.filled')) }} className="h-[28px] rounded-md border border-border bg-transparent dark:border-0 dark:bg-secondary px-2.5 text-[12px] text-text-secondary hover:bg-surface-hover hover:text-text">{p.title}</button>
              ))}
              <Tooltip title={t("imageTools.tipAddCommon")}><button  onClick={() => setShowCommonPromptModal(true)} className="ml-auto flex size-[26px] items-center justify-center rounded-full border border-border bg-transparent dark:border-0 dark:bg-secondary text-text-muted hover:bg-surface-hover"><Plus className="size-[14px]" /></button></Tooltip>
            </div>
          </div>

          {/* 比例 */}
          <div className="mb-6">
            <label className="mb-2 block text-[14px] text-text">{t("imageTools.ratio")}</label>
            <div className="grid grid-cols-7 gap-1.5">
              {ratios.filter(r => r !== '__ORIG__' || refImages.length > 0).map((r) => (
                <button key={r} onClick={() => setRatio(r)}
                  className={cn('flex h-[30px] items-center justify-center gap-1 rounded-md text-[12px] transition-colors',
                    ratio === r ? 'bg-accent text-accent-foreground' : 'border border-border bg-transparent dark:border-0 dark:bg-secondary text-text-secondary hover:bg-surface-hover hover:text-text')}>
                  {r !== '__ORIG__' && <span className="inline-block size-[8px] rounded-[2px] bg-current opacity-60" style={{ width: r === '1:1' ? 8 : r === '2:3' || r === '3:4' || r === '4:5' ? 6 : 10, height: 8 }} />}
                  {r === '__ORIG__' ? t('imageTools.original') : r}
                </button>
              ))}
            </div>
          </div>

          {/* 画质 */}
          <div className="mb-6">
            <label className="mb-2 block text-[14px] text-text">{t("imageTools.quality")}</label>
            <div className="grid grid-cols-3 gap-1.5 max-w-[300px]">
              {qualities.map((q) => (
                <button key={q} onClick={() => !disabledQualities.includes(q) && setQuality(q)} disabled={disabledQualities.includes(q)}
                  className={cn('h-[30px] rounded-md text-[12px] transition-colors',
                    disabledQualities.includes(q) ? 'opacity-30 cursor-not-allowed bg-transparent dark:bg-secondary text-text-muted' :
                    quality === q ? 'bg-accent text-accent-foreground' : 'border border-border bg-transparent dark:border-0 dark:bg-secondary text-text-secondary hover:bg-surface-hover hover:text-text')}>
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* 数量 */}
          <div className="mb-6">
            <label className="mb-2 block text-[14px] text-text">{t("imageTools.count")}</label>
            <div className="grid grid-cols-4 gap-1.5 max-w-[400px]">
              {counts.map((c) => (
                <button key={c} onClick={() => !disabledCounts.includes(c) && setCount(c)} disabled={disabledCounts.includes(c)}
                  className={cn('h-[30px] rounded-md text-[12px] transition-colors',
                    disabledCounts.includes(c) ? 'opacity-30 cursor-not-allowed bg-transparent dark:bg-secondary text-text-muted' :
                    count === c ? 'bg-accent text-accent-foreground' : 'border border-border bg-transparent dark:border-0 dark:bg-secondary text-text-secondary hover:bg-surface-hover hover:text-text')}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* 参考图上传 */}
          <div className="mb-6">
            <div className="mb-2 flex items-center">
              <label className="block text-[14px] text-text">{t("imageTools.refImage")} <span className="ml-1 text-[12px] font-normal text-text-muted">{t("imageTools.refMax")}</span></label>
              {refImages.length > 0 && (
                <button onClick={() => setRefImages([])} className="ml-auto text-[12px] text-text-secondary hover:text-red-400">{t("imageTools.clear")}</button>
              )}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {refImages.map((img, i) => (
                <div key={i} className="group relative size-[96px] shrink-0 rounded-lg bg-surface-hover">
                  <img src={img} alt="" className="h-full w-full rounded-lg object-cover" />
                  {/* hover 4格操作 */}
                  <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 rounded-lg opacity-0 transition-opacity group-hover:opacity-100">
                    <Tooltip title={t("imageTools.replace")}><button  onClick={() => { setReplaceIndex(i); refInputRef.current?.click() }} className="flex items-center justify-center bg-black/40 text-white hover:text-white">
                      <RefreshCw className="size-4" />
                    </button></Tooltip>
                    <Tooltip title={t("imageTools.zoom")}><button  onClick={() => openPreview(img)} className="flex items-center justify-center bg-black/40 text-white hover:text-white">
                      <ZoomIn className="size-4" />
                    </button></Tooltip>
                    <Tooltip title={t("imageTools.pasteReplace")}><button  onClick={() => pasteImage(i)} className="flex items-center justify-center bg-black/40 text-white hover:text-white">
                      <ClipboardPaste className="size-4" />
                    </button></Tooltip>
                    <Tooltip title={t("imageTools.delete")}><button  onClick={() => setRefImages((xs) => xs.filter((_, j) => j !== i))} className="flex items-center justify-center bg-black/40 text-white hover:text-red-400">
                      <TrashIcon className="size-4" />
                    </button></Tooltip>
                  </div>
                </div>
              ))}
              {/* 上传占位框 — 正常显示加号，hover 分两半 */}
              <div className="group relative size-[96px] shrink-0 rounded-lg border-2 border-dashed border-border transition-colors hover:border-accent">
                {/* 默认加号 */}
                <div className="absolute inset-0 flex flex-col items-center justify-center text-text-muted transition-opacity group-hover:opacity-0">
                  <Plus className="mb-1 size-5" />
                  <span className="text-[11px]">{t("imageTools.upload")}</span>
                </div>
                {/* hover 分两半 */}
                <div className="absolute inset-0 grid grid-rows-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <Tooltip title={t("imageTools.uploadImageShort")}>
                    <button
                      onClick={() => refInputRef.current?.click()}
                      className="flex flex-col items-center justify-end pb-2 text-text-muted hover:text-accent"
                    >
                      <Upload className="size-4" />
                    </button>
                  </Tooltip>
                  <Tooltip title={t("imageTools.pasteImageShortcut")}>
                    <button
                      onClick={() => pasteImage()}
                      className="flex flex-col items-center justify-start pt-2 text-text-muted hover:text-accent"
                    >
                      <ClipboardPaste className="size-4" />
                    </button>
                  </Tooltip>
                </div>
              </div>
            </div>
            <input
              ref={refInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files || [])
                for (const f of files) {
                  if (f.size > 10 * 1024 * 1024) {
                    showToast(t('imageTools.toasts.imageTooLarge'), 'error')
                    continue
                  }
                  const reader = new FileReader()
                  reader.onload = () => {
                    const data = reader.result as string
                    setRefImages((xs) => {
                      if (replaceIndex !== null && xs[replaceIndex]) {
                        const next = [...xs]
                        next[replaceIndex] = data
                        return next
                      }
                      if (xs.includes(data)) return xs
                      if (xs.length >= 4) {
                        showToast(t('imageTools.toasts.maxRefs'), 'error')
                        return xs
                      }
                      return [...xs, data]
                    })
                    setReplaceIndex(null)
                  }
                  reader.readAsDataURL(f)
                }
                e.target.value = ''
              }}
            />
          </div>

        </div>

        {/* 存储位置 + 队列 — 固定在生成按钮上方 */}
        <div className="shrink-0 px-5 pb-2">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[14px] text-text">{t("imageTools.storage")}</span>
            <span className="flex-1 truncate text-[12px] text-text-secondary">{storagePath}</span>
            <button onClick={() => showToast(t('imageTools.toasts.openedFolder'))} className="h-[28px] rounded-md border border-border bg-transparent dark:border-0 dark:bg-secondary px-3 text-[12px] text-text-secondary hover:bg-surface-hover">{t("imageTools.open")}</button>
            <button onClick={async () => {
              try {
                // @ts-ignore
                const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
                setStoragePath(dirHandle.name)
                showToast(`${t('imageTools.toasts.switchedDir')}: ${dirHandle.name}`)
              } catch {
                showToast(t('imageTools.toasts.cancelledDir'))
              }
            }} className="h-[28px] rounded-md border border-border bg-transparent dark:border-0 dark:bg-secondary px-3 text-[12px] text-text-secondary hover:bg-surface-hover">{t("imageTools.change")}</button>
          </div>
          <div className="mb-2 flex items-center gap-1.5">
            <button onClick={() => addToQueue(1)} className="h-[30px] rounded-md border border-border bg-transparent dark:border-0 dark:bg-secondary px-2.5 text-[12px] text-text-secondary hover:bg-surface-hover">{t("imageTools.queue1")}</button>
            <button onClick={() => addToQueue(5)} className="h-[30px] rounded-md border border-border bg-transparent dark:border-0 dark:bg-secondary px-2.5 text-[12px] text-text-secondary hover:bg-surface-hover">{`+5`}{t('imageTools.queueCustom')}</button>
            <button onClick={() => addToQueue(10)} className="h-[30px] rounded-md border border-border bg-transparent dark:border-0 dark:bg-secondary px-2.5 text-[12px] text-text-secondary hover:bg-surface-hover">{`+10`}{t('imageTools.queueCustom')}</button>
            <div className="flex h-[30px] w-[72px] items-center rounded-md bg-card px-2">
              <input value={queueNum} onChange={(e) => setQueueNum(e.target.value.replace(/\D/g, '').slice(0, 2))}
                className="w-full bg-transparent text-center text-[12px] text-text outline-none" />
            </div>
            <button onClick={() => addToQueue(Number(queueNum) || 1)} className="h-[30px] rounded-md border border-border bg-transparent dark:border-0 dark:bg-secondary px-2.5 text-[12px] text-text-secondary hover:bg-surface-hover">{t("imageTools.queueCustom")}</button>
            <button onClick={() => setShowQueue((v) => !v)} className={cn('h-[30px] rounded-md px-3 text-[12px] hover:bg-surface-hover', showQueue ? 'bg-accent text-accent-foreground' : 'border border-border bg-transparent dark:border-0 dark:bg-secondary text-text-secondary')}>{t("imageTools.viewQueue")}{queueSize > 0 && `(${queueSize})`}</button>
          </div>
          {showQueue && (
            <div className="mb-2 rounded-lg bg-card p-3 text-[12px] text-text-secondary">
              {queueSize === 0 ? t('imageTools.queueEmpty') : `${t('imageTools.viewQueue')} ${queueSize}`}
            </div>
          )}
        </div>

        {/* 生成按钮 */}
        <div className="shrink-0 px-5 pb-4 pt-1">
          <button onClick={() => addToQueue(1)} disabled={!prompt.trim() || generating || quotaExhausted || quoteUnavailable}
            title={quotaExhausted ? `本次需要 ${estimatedCost} 积分，当前余额 ${billingUser?.balance ?? 0}` : quoteUnavailable ? '正在获取平台报价，或该模型尚未配置积分价格' : undefined}
            className="flex h-[58px] w-full items-center justify-center rounded-lg bg-accent text-[16px] text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-45">
            {generating ? <><Loader2 className="mr-2 size-5 animate-spin" />{t('imageTools.generating')}</> : quotaExhausted ? `积分不足：需要 ${estimatedCost}，余额 ${billingUser?.balance ?? 0}` : (prompt.trim() ? `${t('imageTools.startGen')} · ${isPlatformModel ? (quoteLoading ? '正在估价…' : estimatedCost == null ? '积分价格未配置' : `预计扣 ${estimatedCost} 积分 · 余额 ${billingUser?.balance ?? 0}`) : '未接入平台积分价'}` : t('imageTools.inputPromptFirst'))}
          </button>
        </div>
      </div>

      {/* ── 右栏：结果区（固定展开） ── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-card">
        {/* 顶部工具栏 */}
        <div className="flex h-[44px] shrink-0 items-center gap-2 px-4 pt-3">
          <div className="relative">
            <button
              type="button"
              onClick={() => setFilterMenu((menu) => menu === 'time' ? null : 'time')}
              className="flex h-[30px] items-center gap-1 rounded-lg border border-border bg-transparent dark:border-0 dark:bg-secondary px-2 text-[12px] text-text-secondary hover:bg-surface-hover hover:text-text"
              aria-haspopup="listbox"
              aria-expanded={filterMenu === 'time'}
            >
              {t(timeFilter === 'today' ? 'imageTools.today' : timeFilter === 'last7' ? 'imageTools.last7' : timeFilter === 'last30' ? 'imageTools.last30' : 'imageTools.allTime')}
              <ChevronDown className="size-3.5" />
            </button>
            {filterMenu === 'time' && (
              <div className="absolute left-0 top-full z-50 mt-1 min-w-full overflow-hidden rounded-lg bg-card p-1 shadow-xl" role="listbox">
                {[
                  ['all', 'imageTools.allTime'],
                  ['today', 'imageTools.today'],
                  ['last7', 'imageTools.last7'],
                  ['last30', 'imageTools.last30'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="option"
                    aria-selected={timeFilter === value}
                    onClick={() => { setTimeFilter(value); setFilterMenu(null) }}
                    className={cn('flex w-full whitespace-nowrap rounded-md px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-surface-hover hover:text-text', timeFilter === value ? 'bg-secondary text-text' : 'text-text-secondary')}
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setFilterMenu((menu) => menu === 'stars' ? null : 'stars')}
              className="flex h-[30px] items-center gap-1 rounded-lg border border-border bg-transparent dark:border-0 dark:bg-secondary px-2 text-[12px] text-text-secondary hover:bg-surface-hover hover:text-text"
              aria-haspopup="listbox"
              aria-expanded={filterMenu === 'stars'}
            >
              {t(starFilter === 'favorite' ? 'imageTools.favorited' : starFilter === 'notFavorite' ? 'imageTools.notFavorited' : 'imageTools.allStars')}
              <ChevronDown className="size-3.5" />
            </button>
            {filterMenu === 'stars' && (
              <div className="absolute left-0 top-full z-50 mt-1 min-w-full overflow-hidden rounded-lg bg-card p-1 shadow-xl" role="listbox">
                {[
                  ['all', 'imageTools.allStars'],
                  ['favorite', 'imageTools.favorited'],
                  ['notFavorite', 'imageTools.notFavorited'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="option"
                    aria-selected={starFilter === value}
                    onClick={() => { setStarFilter(value); setFilterMenu(null) }}
                    className={cn('flex w-full whitespace-nowrap rounded-md px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-surface-hover hover:text-text', starFilter === value ? 'bg-secondary text-text' : 'text-text-secondary')}
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Tooltip title={t('imageTools.toasts.history')}><button onClick={openHistory}  className="flex size-[30px] items-center justify-center rounded-lg text-text-secondary hover:bg-surface-hover">
            <History className="size-[14px]" />
          </button></Tooltip>
          <SearchInput value={searchKeyword} onChange={setSearchKeyword} placeholder={t('imageTools.toasts.search')} mode="collapsible" />
          <div className="ml-auto flex items-center gap-2">
            <input
              type="range"
              min={30}
              max={500}
              value={thumbScale}
              onChange={(e) => setThumbScale(Number(e.target.value))}
              onWheel={(e) => { e.preventDefault(); setThumbScale(v => Math.min(500, Math.max(30, v + (e.deltaY < 0 ? 6 : -6)))) }}
              className="thumb-scale-slider w-24"
              style={{ ['--pct' as string]: `${((thumbScale - 30) / 470) * 100}%` }}
            />
            <button onClick={() => setViewMode('list')} className={cn('flex size-[30px] items-center justify-center rounded-lg', viewMode==='list' ? 'bg-accent text-accent-foreground' : 'text-text-secondary hover:bg-surface-hover')}>
              <List className="size-[14px]" />
            </button>
            <button onClick={() => setViewMode('grid')} className={cn('flex size-[30px] items-center justify-center rounded-lg', viewMode==='grid' ? 'bg-accent text-accent-foreground' : 'text-text-secondary hover:bg-surface-hover')}>
              <LayoutGrid className="size-[14px]" />
            </button>
            <button onClick={() => setViewMode('large')} className={cn('flex size-[30px] items-center justify-center rounded-lg', viewMode==='large' ? 'bg-accent text-accent-foreground' : 'text-text-secondary hover:bg-surface-hover')}>
              <ZoomIn className="size-[14px]" />
            </button>
          </div>
        </div>

        {/* 结果列表 — 根据 viewMode 切换布局 */}
        <div
          className="flex-1 overflow-y-auto p-4 pt-2"
          onWheel={(e) => {
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            setThumbScale(v => Math.min(500, Math.max(30, v + (e.deltaY < 0 ? 8 : -8))));
          }}
        >
          {results.length === 0 && generating && (
            <div className="flex h-full flex-col items-center justify-center text-text-muted">
              <Loader2 className="mb-3 size-8 animate-spin text-accent" />
              <p className="text-sm">{t("imageTools.generating")}...</p>
            </div>
          )}
          {results.length === 0 && !generating && (
            <div className="flex h-full flex-col items-center justify-center text-text-muted">
              <p className="text-sm">{t("imageTools.noResults")}</p>
              <p className="mt-1 text-xs text-text-secondary">{t("imageTools.resultsHint")}</p>
            </div>
          )}
          {results.length > 0 && viewMode === 'list' && (
            <div className="space-y-4">
              {filteredResults.map((r) => r.pending ? (
                <div key={r.id} className="flex items-center gap-4 rounded-lg bg-card p-3">
                  <GeneratingSkeleton ratio={r.size} failed={r.failed} />
                  <div className="flex flex-col gap-1">
                    <span className="text-[14px] text-text">{r.model}</span>
                    <span className="text-[12px] text-text-secondary">{r.size} · {r.quality}</span>
                    <span className="text-[12px] text-text-secondary">{r.failed ? t('workbench.generationFailed') : t('imageTools.generating') + '...'}</span>
                  </div>
                </div>
              ) : (
                <div key={r.id} className="group flex gap-4 rounded-lg bg-card p-3">
                  <div className="shrink-0 overflow-hidden rounded-lg bg-surface-hover" style={{ width: thumbScale * 1.6, height: thumbScale * 1.6 }}>
                    {r.imageUrl ? <img src={r.imageUrl} alt={r.prompt} className="h-full w-full cursor-zoom-in object-contain" onClick={() => openPreview(r.imageUrl!)} /> : <div className="flex h-full items-center justify-center text-[12px] text-text-secondary">{t("imageTools.img")} {r.id}</div>}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="mb-1 flex items-baseline gap-2">
                      <span className="text-[14px] text-text">{r.model}</span>
                      <span className="text-[12px] text-text-secondary">{t("imageTools.size")} {r.size}</span>
                      <span className="text-[12px] text-text-secondary">{t("imageTools.fileSize")} {r.fileSize}</span>
                      <span className="text-[12px] text-text-secondary">{t("imageTools.qualityLabel")} {r.quality}</span>
                      <span className="ml-auto text-[12px] text-text-secondary">{r.time}</span>
                    </div>
                    {!r.assetId && <p className="mb-1 text-[12px] text-red-400">{t('imageTools.toasts.notSavedToCloud')}</p>}
                                        <div className="mb-2">
                      <p className={cn('text-[14px] text-text', !expandedIds.has(r.id) && 'line-clamp-2')}>{r.prompt}</p>
                      {r.prompt.length > 40 && (
                        <button onClick={() => togglePrompt(r.id)} className="mt-0.5 text-[12px] text-accent hover:underline">
                          {expandedIds.has(r.id) ? t('imageTools.collapse') : t('imageTools.expand')}
                        </button>
                      )}
                    </div>
                    <div className="mt-auto flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                      {!r.assetId && r.imageUrl && <Tooltip title={savingResultIds.has(r.id) ? t('imageTools.toasts.savingToCloud') : t('imageTools.toasts.retrySave')}><button aria-label={t('imageTools.toasts.retrySave')} disabled={savingResultIds.has(r.id)} onClick={() => void retrySaveResult(r.id)} className="flex size-[30px] items-center justify-center rounded-md text-red-400 hover:bg-surface-hover disabled:opacity-50">{savingResultIds.has(r.id) ? <Loader2 className="size-[15px] animate-spin" strokeWidth={1.8} /> : <CloudUpload className="size-[15px]" strokeWidth={1.8} />}</button></Tooltip>}
                      <Tooltip title={t("imageTools.tipReuse")}><button  onClick={() => reuseParams(r)} className="flex size-[30px] items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-secondary"><Repeat className="size-[15px]" strokeWidth={1.8} /></button></Tooltip>
                      <Tooltip title={t("imageTools.tipCopyPrompt")}><button  onClick={() => copyPrompt(r.prompt)} className="flex size-[30px] items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-secondary"><FileText className="size-[15px]" strokeWidth={1.8} /></button></Tooltip>
                      <Tooltip title={t("imageTools.tipCopyImage")}><button  onClick={async () => { if (!r.imageUrl) return; try { const blob = await (await fetch(r.imageUrl)).blob(); await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]); showToast(t('imageTools.toasts.copiedImage')) } catch { showToast(t('imageTools.toasts.copyFailed'), 'error') } }} className="flex size-[30px] items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-secondary"><Copy className="size-[15px]" strokeWidth={1.8} /></button></Tooltip>
                      <Tooltip title={t("imageTools.tipQuote")}><button  onClick={() => { if (!r.imageUrl) return; setRefImages((xs) => (xs.includes(r.imageUrl!) || xs.length >= 4) ? xs : [...xs, r.imageUrl!]); showToast(t('imageTools.toasts.quoted')) }} className="flex size-[30px] items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-secondary"><Quote className="size-[15px]" strokeWidth={1.8} /></button></Tooltip>
                      <Tooltip title={t("imageTools.tipTeamShare")}><button  onClick={async () => { if (!r.assetId) { showToast(t('imageTools.toasts.saveFirstShare'), 'error'); return } try { const teams = await api.get<Array<{id:string;name:string;workspaceId:string|null}>>('/teams'); if (!teams.length) { showToast(t('imageTools.toasts.noTeam'), 'error'); return } const target = teams[0]; if (!target.workspaceId) { showToast(t('imageTools.toasts.noTeamWorkspace'), 'error'); return } await api.post(`/assets/${r.assetId}/share-to-team`, { workspaceId: target.workspaceId }); showToast(t('imageTools.toasts.sharedToTeam', { name: target.name })) } catch { showToast(t('imageTools.toasts.shareFailed'), 'error') } }} className="flex size-[30px] items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-secondary"><Share2 className="size-[15px]" strokeWidth={1.8} /></button></Tooltip>
                      <Tooltip title={r.favorited ? t('imageTools.tipUnfavorite') : t('imageTools.tipFavorite')}><button  onClick={() => toggleFavorite(r.id)} className={cn('flex size-[30px] items-center justify-center rounded-md', r.favorited ? 'text-accent' : 'text-text-muted hover:bg-surface-hover hover:text-text-secondary')}><Star className="size-[15px]" strokeWidth={1.8} /></button></Tooltip>
                      <Tooltip title={t("imageTools.tipDownload")}><button  onClick={() => { if (!r.imageUrl) return; const a = document.createElement('a'); a.href = r.imageUrl; a.download = `image-${r.id}.png`; a.click(); showToast(t('imageTools.toasts.downloaded')) }} className="flex size-[30px] items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-secondary"><Download className="size-[15px]" strokeWidth={1.8} /></button></Tooltip>
                      <Tooltip title={t("imageTools.tipFolder")}><button  onClick={() => showToast(t('imageTools.toasts.openedInFolder'))} className="flex size-[30px] items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-secondary"><FolderOpen className="size-[15px]" strokeWidth={1.8} /></button></Tooltip>
                      <Tooltip title={t("imageTools.delete")}><button  onClick={() => void deleteResult(r.id)} className="flex size-[30px] items-center justify-center rounded-md text-[#b91c1c] hover:text-red-400 hover:bg-surface-hover"><Trash2 className="size-[15px]" strokeWidth={1.8} /></button></Tooltip>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {viewMode === 'grid' && (
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumbScale}px, 1fr))` }}>
              {filteredResults.map((r) => r.pending ? (
                <div key={r.id} className="flex aspect-square items-center justify-center rounded-lg bg-surface-hover">
                  <GeneratingSkeleton ratio={r.size} failed={r.failed} />
                </div>
              ) : (
                <div key={r.id} className="group relative aspect-square overflow-hidden rounded-lg bg-surface-hover">
                  {r.imageUrl ? <img src={r.imageUrl} alt={r.prompt} className="h-full w-full cursor-zoom-in object-contain" onClick={() => openPreview(r.imageUrl!)} /> : <div className="flex h-full items-center justify-center text-[12px] text-text-secondary">{t("imageTools.img")} {r.id}</div>}
                  {!r.assetId && <span className="absolute left-2 top-2 rounded-md bg-black/70 px-2 py-1 text-[11px] text-red-300">{t('imageTools.toasts.notSavedToCloud')}</span>}
                  <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/80 via-black/20 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
                    <p className="mb-2 truncate text-[12px] text-text">{r.prompt}</p>
                    <div className="flex gap-1">
                      {!r.assetId && r.imageUrl && <button aria-label={t('imageTools.toasts.retrySave')} disabled={savingResultIds.has(r.id)} onClick={() => void retrySaveResult(r.id)} className="flex h-[22px] items-center gap-1 rounded bg-red-500/20 px-2 text-[11px] text-red-200 disabled:opacity-50">{savingResultIds.has(r.id) ? <Loader2 className="size-3 animate-spin" /> : <CloudUpload className="size-3" />}{t('imageTools.toasts.retrySave')}</button>}
                      <button onClick={() => copyPrompt(r.prompt)} className="h-[22px] rounded border border-border bg-transparent dark:border-0 dark:bg-secondary px-2 text-[11px] text-text hover:bg-surface-hover">{t('imageTools.copy')}</button>
                      <button onClick={() => toggleFavorite(r.id)} className="h-[22px] rounded border border-border bg-transparent dark:border-0 dark:bg-secondary px-2 text-[11px] text-text hover:bg-surface-hover">{r.favorited ? '★' : '☆'}</button>
                      <button onClick={() => void deleteResult(r.id)} className="h-[22px] rounded border border-border bg-transparent dark:border-0 dark:bg-secondary px-2 text-[11px] text-red-400 hover:bg-surface-hover">{t('imageTools.deleteShort')}</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {viewMode === 'large' && (
            <div className="space-y-4">
              {filteredResults.map((r) => r.pending ? (
                <div key={r.id} className="flex justify-center rounded-lg bg-card p-3">
                  <GeneratingSkeleton ratio={r.size} failed={r.failed} />
                </div>
              ) : (
                <div key={r.id} className="group overflow-hidden rounded-lg bg-card">
                  {r.imageUrl ? <img src={r.imageUrl} alt={r.prompt} className="w-full cursor-zoom-in object-contain bg-surface-hover" style={{ height: thumbScale * 2.5 }} onClick={() => openPreview(r.imageUrl!)} /> : <div className="flex items-center justify-center bg-surface-hover text-[14px] text-text-secondary" style={{ height: thumbScale * 2.5 }}>{t("imageTools.img")} {r.id}（{t("imageTools.bigPreview")}）</div>}
                  <div className="p-3">
                    <div className="mb-1 flex items-baseline gap-2">
                      <span className="text-[14px] text-text">{r.model}</span>
                      <span className="text-[12px] text-text-secondary">{t("imageTools.size")} {r.size}</span>
                      <span className="text-[12px] text-text-secondary">{r.time}</span>
                      {!r.assetId && <span className="text-[12px] text-red-400">{t('imageTools.toasts.notSavedToCloud')}</span>}
                    </div>
                                        <div className="mb-2">
                      <p className={cn('text-[14px] text-text', !expandedIds.has(r.id) && 'line-clamp-2')}>{r.prompt}</p>
                      {r.prompt.length > 40 && (
                        <button onClick={() => togglePrompt(r.id)} className="mt-0.5 text-[12px] text-accent hover:underline">
                          {expandedIds.has(r.id) ? t('imageTools.collapse') : t('imageTools.expand')}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {!r.assetId && r.imageUrl && <Tooltip title={savingResultIds.has(r.id) ? t('imageTools.toasts.savingToCloud') : t('imageTools.toasts.retrySave')}><button aria-label={t('imageTools.toasts.retrySave')} disabled={savingResultIds.has(r.id)} onClick={() => void retrySaveResult(r.id)} className="flex size-[30px] items-center justify-center rounded-md text-red-400 hover:bg-surface-hover disabled:opacity-50">{savingResultIds.has(r.id) ? <Loader2 className="size-[15px] animate-spin" strokeWidth={1.8} /> : <CloudUpload className="size-[15px]" strokeWidth={1.8} />}</button></Tooltip>}
                      <Tooltip title={t("imageTools.tipReuse")}><button  onClick={() => reuseParams(r)} className="flex size-[30px] items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-secondary"><Repeat className="size-[15px]" strokeWidth={1.8} /></button></Tooltip>
                      <Tooltip title={t("imageTools.tipCopyPrompt")}><button  onClick={() => copyPrompt(r.prompt)} className="flex size-[30px] items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-secondary"><FileText className="size-[15px]" strokeWidth={1.8} /></button></Tooltip>
                      <Tooltip title={r.favorited ? t('imageTools.tipUnfavorite') : t('imageTools.tipFavorite')}><button  onClick={() => toggleFavorite(r.id)} className={cn('flex size-[30px] items-center justify-center rounded-md', r.favorited ? 'text-accent' : 'text-text-muted hover:bg-surface-hover hover:text-text-secondary')}><Star className="size-[15px]" strokeWidth={1.8} /></button></Tooltip>
                      <Tooltip title={t("imageTools.tipDownload")}><button  onClick={() => { if (!r.imageUrl) return; const a = document.createElement('a'); a.href = r.imageUrl; a.download = `image-${r.id}.png`; a.click(); showToast(t('imageTools.toasts.downloaded')) }} className="flex size-[30px] items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-secondary"><Download className="size-[15px]" strokeWidth={1.8} /></button></Tooltip>
                      <Tooltip title={t("imageTools.delete")}><button  onClick={() => void deleteResult(r.id)} className="flex size-[30px] items-center justify-center rounded-md text-[#b91c1c] hover:text-red-400 hover:bg-surface-hover"><Trash2 className="size-[15px]" strokeWidth={1.8} /></button></Tooltip>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Toast — 顶部居中，成功绿色/失败红色 */}
      {/* 常用提示词弹窗 */}
      {showHistory && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
          onClick={() => setShowHistory(false)}
        >
          <div
            className="flex max-h-[80vh] w-[560px] flex-col rounded-xl bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[16px] text-text">{t('imageTools.historyTitle')}</h3>
              <button onClick={() => setShowHistory(false)} className="text-text-muted hover:text-text">
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {historyLoading && (
                <p className="py-10 text-center text-[13px] text-text-secondary">{t('imageTools.historyLoading')}</p>
              )}
              {!historyLoading && historyTasks.length === 0 && (
                <p className="py-10 text-center text-[13px] text-text-secondary">{t('imageTools.historyEmpty')}</p>
              )}
              {!historyLoading && historyTasks.map((historyItem) => {
                const thumb = taskOutputToDataUrls(historyItem)[0]
                const statusLabel = historyItem.status === 'succeeded' ? t('imageTools.statusDone')
                  : historyItem.status === 'refunded' ? t('imageTools.statusRefunded')
                  : historyItem.status === 'failed' ? t('imageTools.statusFailed')
                  : historyItem.status === 'saving' ? t('imageTools.statusSaving')
                  : t('imageTools.statusRunning')
                return (
                  <div key={historyItem.id} className="mb-2 flex gap-3 rounded-lg bg-secondary p-2.5">
                    <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-hover">
                      {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : <span className="text-[11px] text-text-muted">{statusLabel}</span>}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col justify-center">
                      <p className="truncate text-[13px] text-text">{historyItem.prompt || '—'}</p>
                      <p className="mt-0.5 text-[11px] text-text-secondary">{new Date(historyItem.createdAt).toLocaleString()} · {statusLabel}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>, document.body)}

      {showCommonPromptModal && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
          onClick={() => setShowCommonPromptModal(false)}
        >
          <div
            className="w-[480px] rounded-xl bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-[16px] text-text">{t("imageTools.addCommon")}</h3>
            <input
              type="text"
              value={newPromptTitle}
              onChange={(e) => setNewPromptTitle(e.target.value)}
              placeholder={t("imageTools.titlePlaceholder")}
              className="mb-3 w-full rounded-lg bg-card px-3 py-2 text-[14px] text-text outline-none focus:ring-1 focus:ring-accent placeholder:text-text-muted"
            />
            <textarea
              value={newPromptContent}
              onChange={(e) => setNewPromptContent(e.target.value)}
              placeholder={t("imageTools.promptContent")}
              rows={4}
              className="mb-4 w-full resize-none rounded-lg bg-card px-3 py-2 text-[14px] text-text outline-none focus:ring-1 focus:ring-accent placeholder:text-text-muted"
            />
            {commonPrompts.length > 0 && (
              <div className="mb-4 max-h-[160px] overflow-y-auto">
                {commonPrompts.map((p) => (
                  <div key={p.id} className="mb-1 flex items-center gap-1 rounded-lg bg-secondary px-3 py-2">
                    <button
                      onClick={() => { setPrompt(p.content); setShowCommonPromptModal(false); showToast(t('imageTools.toasts.filled')) }}
                      className="flex-1 text-left text-[13px] text-text hover:text-accent"
                    >
                      {p.title}
                    </button>
                    <button onClick={() => { setNewPromptTitle(p.title); setNewPromptContent(p.content); setReplaceIndex(p.id) }} className="px-2 text-[11px] text-text-secondary hover:text-accent">{t('imageTools.replace')}</button>
                    <button onClick={() => { const next = commonPrompts.filter((x) => x.id !== p.id); setCommonPrompts(next); localStorage.setItem('image-tools:common-prompts', JSON.stringify(next)) }} className="px-2 text-[11px] text-text-secondary hover:text-red-400">✕</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCommonPromptModal(false)}
                className="h-[32px] rounded-md border border-border bg-transparent dark:border-0 dark:bg-secondary px-4 text-[13px] text-text-secondary hover:bg-surface-hover"
              >
                {t('imageTools.cancel')}
              </button>
              <button
                onClick={() => {
                  if (!newPromptTitle.trim() || !newPromptContent.trim()) return
                  const next = replaceIndex !== null
                    ? commonPrompts.map((p) => p.id === replaceIndex ? { ...p, title: newPromptTitle.trim(), content: newPromptContent.trim() } : p)
                    : [...commonPrompts, { id: Date.now(), title: newPromptTitle.trim(), content: newPromptContent.trim() }]
                  setCommonPrompts(next)
                  localStorage.setItem('image-tools:common-prompts', JSON.stringify(next))
                  setNewPromptTitle('')
                  setNewPromptContent('')
                  setReplaceIndex(null)
                  showToast(t('imageTools.toasts.saved'))
                }}
                className="h-[32px] rounded-md bg-accent px-4 text-[13px] text-accent-foreground hover:bg-accent-hover"
              >
                {t('imageTools.save')}
              </button>
            </div>
          </div>
        </div>, document.body)}

      {previewOpen && previewIndex !== null && (
        <ImageViewer
          images={previewImages}
          index={previewIndex}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewOpen(false)}
        />
      )}

      {toast && createPortal(
        <div
          className={cn(
            toast.pos === 'input'
              ? 'fixed bottom-2 left-2 z-50 flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] shadow-xl shadow-black/40'
              : 'fixed left-1/2 top-16 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2.5 text-[13px] shadow-xl shadow-black/40 animate-[toastIn_0.2s_ease-out]',
            toast.type === 'success'
              ? 'bg-[#dcfce7] text-[#15803d]'
              : 'bg-[#fee2e2] text-[#f87171]',
          )}
        >
          {toast.type === 'success' ? (
            <svg className="size-3.5" viewBox="0 0 12 12" fill="none"><path d="M2 6.5L4.5 9L10 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          ) : (
            <svg className="size-3.5" viewBox="0 0 12 12" fill="none"><path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          )}
          {toast.msg}
          {toast.action && (
            <button
              onClick={(e) => { e.stopPropagation(); toast.action!.onClick(); setToast(null) }}
              className="ml-2 border-l border-white/20 pl-2 font-semibold text-white/80 hover:text-white"
            >
              {toast.action.label}
            </button>
          )}
        </div>, document.body)}
    </div>
  )
}
/* ── 融图 Tab ── */
function BlendPanel({ connectTopLeft = false }: { connectTopLeft?: boolean }) {
  const { t } = useTranslation()
  const config = useConfigStore((s) => s.config)
  const [model, setModel] = useState('')
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)
  const openAuthModal = useAuthStore((s) => s.openAuthModal)
  const [sourceImage, setSourceImage] = useState<string | null>(null)
  const [imageName, setImageName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [strength, setStrength] = useState(0.7)
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [serverPrompt, setServerPrompt] = useState('')
  const [userPrompt, setUserPrompt] = useState('')

  // 从服务器获取融图提示词
  useEffect(() => {
    fetch('/api/config/blend-prompt')
      .then((res) => res.json())
      .then((data) => setServerPrompt(data.prompt || ''))
      .catch(() => {})
  }, [])

  const onFile = (file: File | undefined) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => { setSourceImage(reader.result as string); setImageName(file.name); setResult(null) }
    reader.readAsDataURL(file)
  }
  const clearImage = () => { setSourceImage(null); setImageName(''); setResult(null) }
  const generate = () => {
    if (!isLoggedIn) { openAuthModal(); return }
    if (!sourceImage || generating) return
    setGenerating(true); setResult(null)
    setTimeout(() => { setResult(sourceImage); setGenerating(false) }, 1500)
  }

  return (
    <div className="flex h-full gap-2">
      <div className={cn('flex w-[clamp(340px,30vw,520px)] shrink-0 flex-col overflow-hidden rounded-tr-xl rounded-br-xl rounded-bl-xl bg-card', connectTopLeft ? 'rounded-tl-none' : 'rounded-tl-md')}>
        <div className="flex-1 overflow-y-auto px-5 pt-4 pb-2">
          {/* 模型选择器 */}
          <div className="mb-6">
            <ModelPicker
              config={config}
              value={model}
              onChange={setModel}
              capability="image"
              fullWidth
            />
          </div>

          <div
            className={cn('relative mb-6 flex h-[360px] cursor-pointer items-center justify-center overflow-hidden rounded-lg',
              !sourceImage && 'border-2 border-dashed border-border bg-[repeating-radial-gradient(circle_at_8px_8px,#242424_1.15px,transparent_1.15px)] bg-[length:16px_16px]')}
            onClick={() => !sourceImage && fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]) }}>
            {!sourceImage ? (
              <div className="flex flex-col items-center">
                <div className="mb-3 flex size-11 items-center justify-center rounded-lg bg-secondary">
                  <Upload className="size-[20px] text-accent" />
                </div>
                <div className="text-[14px] font-medium text-text">{t("imageTools.blendClickUpload")}</div>
                <div className="mt-1 text-[12px] text-text-secondary">PNG / JPG / WEBP / BMP</div>
              </div>
            ) : (
              <>
                <img src={sourceImage} alt="src" className="max-h-full max-w-full object-contain p-3" />
                <div className="absolute inset-x-0 bottom-0 flex h-10 items-center bg-card px-3">
                  <span className="truncate text-[12px] text-text-secondary">{imageName}</span>
                </div>
                <div className="absolute inset-0 flex items-center justify-center gap-2 opacity-0 hover:opacity-100">
                  <Tooltip title="clear">
                    <button onClick={(e) => { e.stopPropagation(); clearImage() }}
                      className="flex size-9 items-center justify-center rounded-full bg-card text-text-secondary hover:text-text">
                      <X className="size-[16px]" />
                    </button>
                  </Tooltip>
                  <Tooltip title="replace">
                    <button onClick={(e) => { e.stopPropagation(); fileRef.current?.click() }}
                      className="flex size-9 items-center justify-center rounded-full bg-card text-text-secondary hover:text-text">
                      <RefreshCw className="size-[16px]" />
                    </button>
                  </Tooltip>
                </div>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />

          {/* 补充要求（用户可选） */}
          <div className="mb-6">
            <label className="mb-2 block text-[14px] text-text">{t('imageTools.extraRequirement')}</label>
            <div className="relative prompt-box rounded-xl border border-border bg-input dark:border-0 dark:bg-secondary">
              <textarea
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                rows={3}
                placeholder={t('imageTools.extraRequirementPlaceholder')}
                className="w-full resize-none overflow-hidden rounded-xl bg-transparent px-3 py-2 text-[14px] leading-[22px] text-text outline-none placeholder:text-text-muted"
              />
            </div>
          </div>
        </div>
        <div className="shrink-0 p-4 pt-2">
          <button onClick={generate} disabled={!sourceImage || generating}
            className="flex h-[58px] w-full items-center justify-center gap-2 rounded-lg bg-accent text-[14px] font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-40">
            {generating ? <><Loader2 className="size-4 animate-spin" />{t("imageTools.generating")}</> : <><Sparkles className="size-4" />{t("imageTools.startGen")}</>}
          </button>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-card">
        <div className="flex h-[44px] shrink-0 items-center px-4 pt-3">
          <span className="text-[12px] font-medium text-text-secondary">{t("imageTools.blendResult")}</span>
        </div>
        <div className="flex-1 overflow-hidden p-4 pt-0">
          {!result && !generating ? (
            <div className="flex h-full items-center justify-center rounded-lg bg-[repeating-radial-gradient(circle_at_8px_8px,#242424_1.15px,transparent_1.15px)] bg-[length:16px_16px]">
              <div className="flex flex-col items-center">
                <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-secondary">
                  <Wand2 className="size-[18px] text-accent" />
                </div>
                <span className="text-[14px] font-medium text-text">{t("imageTools.blendWait")}</span>
                <span className="mt-1.5 text-[12px] text-text-secondary">{t("imageTools.blendWaitHint")}</span>
              </div>
            </div>
          ) : generating ? (
            <div className="flex h-full items-center justify-center rounded-lg bg-card">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="size-8 animate-spin text-accent" />
                <span className="text-[14px] text-text-secondary">{t("imageTools.blendProcessing")}</span>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center rounded-lg bg-card p-4">
              <img src={result!} alt="result" className="max-h-full max-w-full object-contain" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── 图片翻译 Tab ── */
const MAX_TRANSLATE_SIZE_MB = 10

interface TranslatePair {
  id: number
  name: string
  size: string
  width: number
  height: number
  type: string
  originalUrl: string
  translatedUrl: string | null
  sourceLang: string
  prompt: string
  status: 'pending' | 'translating' | 'done'
}

function formatTranslateSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function TranslatePanel({ connectTopLeft = false }: { connectTopLeft?: boolean }) {
  const { t } = useTranslation()
  const config = useConfigStore((s) => s.config)
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)
  const openAuthModal = useAuthStore((s) => s.openAuthModal)
  const [model, setModel] = useState('')
  const [items, setItems] = useState<TranslatePair[]>([])
  const [translating, setTranslating] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const reuploadId = useRef<number | null>(null)
  const reuploadRef = useRef<HTMLInputElement>(null)


  const onUpload = (files: FileList | null) => {
    if (!files) return
    const accepted: TranslatePair[] = []
    Array.from(files).forEach((f, i) => {
      if (!f.type.startsWith('image/')) return
      if (f.size > MAX_TRANSLATE_SIZE_MB * 1024 * 1024) return
      const objectUrl = URL.createObjectURL(f)
      const itemId = Date.now() + i
      const img = new Image()
      img.onload = () => {
        setItems((list) => list.map((p) =>
          p.id === itemId ? { ...p, width: img.naturalWidth, height: img.naturalHeight } : p
        ))
      }
      img.src = objectUrl
      accepted.push({
        id: itemId,
        name: f.name,
        size: formatTranslateSize(f.size),
        width: 0,
        height: 0,
        type: f.type.split('/')[1]?.toUpperCase() || 'JPG',
        originalUrl: objectUrl,
        translatedUrl: null,
        sourceLang: '英语',
        prompt: '',
        status: 'pending' as const,
      })
    })
    if (accepted.length > 0) setItems((x) => [...x, ...accepted])
  }

  const startTranslate = () => {
    if (items.length === 0 || translating) return
    if (!isLoggedIn) { openAuthModal(); return }
    setTranslating(true)
    setItems((list) => list.map((p) => ({ ...p, status: 'translating' as const })))
    setTimeout(() => {
      setItems((list) => list.map((p) => ({ ...p, status: 'done' as const, translatedUrl: p.originalUrl })))
      setTranslating(false)
    }, 1500)
  }

  const clearAll = () => {
    items.forEach((p) => URL.revokeObjectURL(p.originalUrl))
    setItems([])
  }

  const removeItem = (id: number) => {
    setItems((list) => list.filter((p) => p.id !== id))
  }

  const onReupload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const id = reuploadId.current
    e.target.value = ''
    if (!file || id === null) return
    const url = URL.createObjectURL(file)
    setItems((list) => list.map((p) => p.id === id ? { ...p, name: file.name, size: formatTranslateSize(file.size), type: file.type.split('/')[1]?.toUpperCase() || 'JPG', originalUrl: url, translatedUrl: null, status: 'pending' as const } : p))
  }
  const updateItem = (id: number, field: 'prompt', value: string) => {
    setItems((list) => list.map((p) => p.id === id ? { ...p, [field]: value } : p))
  }

  return (
    <div className={cn('flex h-full flex-col overflow-hidden rounded-tr-xl rounded-br-xl rounded-bl-xl bg-card', connectTopLeft ? 'rounded-tl-none' : 'rounded-tl-md')}>
      <div className="flex-1 overflow-y-auto px-5 pt-4 pb-2">
        {/* 模型选择器 */}
        <div className="mb-6">
          <ModelPicker
            config={config}
            value={model}
            onChange={setModel}
            capability="image"
            fullWidth
          />
        </div>

        {items.length === 0 && (
          <div className="mb-6">
            <div
              className="flex h-[120px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border transition-colors hover:border-accent/50"
              onClick={() => fileRef.current?.click()}>
              <Upload className="mb-2 size-5 text-text-muted" />
              <div className="text-[13px] font-medium text-text">{t('imageTools.uploadToTranslate')}</div>
              <div className="mt-1 text-[11px] text-text-muted">{t('imageTools.translateFormats')}</div>
            </div>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => onUpload(e.target.files)} />
        <input ref={reuploadRef} type="file" accept="image/*" className="hidden" onChange={onReupload} />
        {/* 图片对比区 */}
        {items.length === 0 ? (
          <div className="flex h-[300px] flex-col items-center justify-center text-text-muted">
            <Languages className="mb-3 size-12" />
            <span className="text-[14px]">{t('imageTools.startAfterUpload')}</span>
          </div>
        ) : (
          <div className="space-y-6">
            {items.map((it, idx) => (
              <div key={it.id} className="grid grid-cols-[260px_1fr_260px] gap-6 items-center">
                {/* 原图 */}
                <div className="text-center">
                  <div className="mb-2 text-[13px] text-text-muted">{idx + 1}. {it.name.replace(/\.(\w+)$/, (_, ext) => '.' + ext.toUpperCase())}</div>
                  <div className="group relative mx-auto h-[240px] w-[240px] overflow-hidden rounded-xl border border-border bg-white dark:border-0 dark:bg-secondary">
                    <img src={it.originalUrl} alt={it.name} className="h-full w-full object-contain cursor-zoom-in" onClick={() => setPreviewUrl(it.originalUrl)} />
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-gradient-to-t from-black/60 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
                      <button onClick={() => { reuploadId.current = it.id; reuploadRef.current?.click() }} className="flex size-8 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30" title="重新上传">
                        <Upload className="size-4" />
                      </button>
                      <button onClick={() => removeItem(it.id)} className="flex size-8 items-center justify-center rounded-full bg-white/20 text-white hover:bg-red-500/60" title="删除">
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 text-[12px] text-text-muted">{it.size}{it.width ? ` · ${it.width}x${it.height}` : ""}</div>
                </div>

                {/* 中间输入框 */}
                <div className="flex flex-col items-center justify-center gap-2">
                  <div className="flex size-7 items-center justify-center rounded-full bg-accent/20 text-accent text-[12px] font-bold">
                    {idx + 1}
                  </div>
                  <textarea
                    placeholder={t('imageTools.editTextPlaceholder')}
                    value={it.prompt}
                    onChange={(e) => updateItem(it.id, 'prompt', e.target.value)}
                    rows={9}
                    className="w-full resize-none rounded-lg border border-border bg-white px-3 py-2 text-[13px] text-text outline-none focus:ring-1 focus:ring-accent dark:border-0 dark:bg-input"
                  />
                  {it.status === 'translating' && <Loader2 className="size-4 animate-spin text-accent" />}
                </div>

                {/* 译后图 */}
                <div className="text-center">
                  <div className="mb-2 text-[13px] text-text-muted">
                    {it.status === 'done' ? t('imageTools.translatedResult') : t('imageTools.waitingTranslate')}
                  </div>
                  <div className="mx-auto flex h-[240px] w-[240px] items-center justify-center rounded-xl border border-border bg-white dark:border-0 dark:bg-secondary overflow-hidden">
                    {it.translatedUrl ? (
                      <img src={it.translatedUrl} alt="translated" className="max-h-full max-w-full object-contain cursor-zoom-in" onClick={() => setPreviewUrl(it.translatedUrl!)} />
                    ) : (
                      <span className="text-[13px] text-text-muted">
                        {it.status === 'translating' ? t('imageTools.translatingStatus') : t('imageTools.clickStartAfterUpload')}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center justify-center gap-2">
                    {it.translatedUrl && (
                      <>
                        <button className="rounded-lg p-1.5 text-text-muted hover:bg-surface-hover hover:text-text">
                          <RefreshCw className="size-4" />
                        </button>
                        <button className="rounded-lg p-1.5 text-text-muted hover:bg-surface-hover hover:text-text">
                          <Download className="size-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* 继续添加 */}
            <div
              className="flex h-[100px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border transition-colors hover:border-accent/50"
              onClick={() => fileRef.current?.click()}>
              <Plus className="mb-1 size-6 text-text-muted" />
              <div className="text-[13px] text-text-muted">{t('imageTools.continueAdd')}</div>
            </div>
          </div>
        )}
      </div>
      {/* 底部按钮 */}
      <div className="shrink-0 p-4 pt-2">
        <button onClick={startTranslate} disabled={items.length === 0 || translating}
          className="flex h-[58px] w-full items-center justify-center gap-2 rounded-lg bg-accent text-[14px] font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-40">
          {translating ? <Loader2 className="size-4 animate-spin" /> : <Languages className="size-4" />}
          {translating ? t('imageTools.translatingStatus') : t('imageTools.startTranslate')}
        </button>
      </div>
      {previewUrl && (() => {
        const allUrls = items.flatMap((it) => [it.originalUrl, it.translatedUrl].filter(Boolean) as string[])
        const idx = allUrls.indexOf(previewUrl)
        return (
          <ImageViewer
            images={allUrls.length > 0 ? allUrls : [previewUrl]}
            index={idx >= 0 ? idx : 0}
            onIndexChange={(i) => setPreviewUrl(allUrls[i])}
            onClose={() => setPreviewUrl(null)}
          />
        )
      })()}
    </div>
  )
}
export default function ImageToolsPage() {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<TabId>('generate')

  useEffect(() => {
    // /image 不经过画布路由壳层，因此这里也要主动同步服务端公开模型配置。
    void ensureServerConfig()
  }, [])

  return (
    <div className="flex h-full flex-col bg-bg p-3 pl-0">
      <div className="flex shrink-0 items-end gap-0.5 pt-1 pb-0">
        {tabs.map((tab) => (
          <button
            key={tab.id ?? tab.label}
            type="button"
            disabled={!tab.id}
            title={!tab.id ? t('imageTools.inDevelopment') : undefined}
            onClick={() => {
              if (!tab.id) return
              setActiveTab(tab.id)
            }}
            aria-selected={tab.id ? activeTab === tab.id : undefined}
            className={cn(
              cn('image-subtab relative flex h-[36px] shrink-0 items-center justify-center whitespace-nowrap rounded-t-xl px-3 text-[12px] font-medium leading-none transition-colors', tab.width),
              activeTab === tab.id ? 'z-10 text-accent' : tab.id ? 'text-text-secondary hover:text-text' : 'cursor-not-allowed text-text-muted/50',
            )}
          >
            {activeTab === tab.id && (
              <motion.span
                layoutId="image-tab-active-background"
                className="absolute inset-0 rounded-t-xl will-change-transform"
                transition={{ type: 'spring', stiffness: 240, damping: 18, mass: 1 }}
                aria-hidden="true"
              >
                <motion.span
                  key={activeTab}
                  className="absolute inset-0 rounded-t-xl bg-accent-soft dark:bg-card"
                  initial={{ scaleX: 1.12, scaleY: 0.88, borderRadius: '18px 18px 0 0' }}
                  animate={{ scaleX: 1, scaleY: 1, borderRadius: '12px 12px 0 0' }}
                  transition={{ type: 'spring', stiffness: 260, damping: 17, mass: 0.7 }}
                />
              </motion.span>
            )}
            <span className="relative z-10">{tab.translation ? t(tab.label) : tab.label}</span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {activeTab === 'generate' && <GeneratePanel connectTopLeft />}
        {activeTab === 'blend' && <BlendPanel />}
        {activeTab === 'translate' && <TranslatePanel />}
      </div>
    </div>
  )
}
