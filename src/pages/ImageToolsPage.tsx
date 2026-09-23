import { useRef, useState, useEffect } from 'react'
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
  FolderOpen,
  PanelRightClose,
  ClipboardPaste,
  Trash2 as TrashIcon,
  PanelRightOpen,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/useAuthStore'

type TabId = 'generate' | 'blend' | 'translate'
type ViewMode = 'list' | 'grid' | 'large'

const tabs: { id: TabId; label: string }[] = [
  { id: 'generate', label: '生图' },
  { id: 'blend', label: '融图' },
  { id: 'translate', label: '图片翻译' },
]

/* ── 生图 Tab ── */
const MAX_PROMPT_LENGTH = 2000

const models = [
  '65535 · GPT Image 2-Eco',
  '65536 · GPT Image 2-Pro',
  '65537 · GPT Image 2-Max',
  '65538 · Nano Banana',
]

function GeneratePanel() {
  const config = useConfigStore((s) => s.config)
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)
  const openAuthModal = useAuthStore((s) => s.openAuthModal)
  const [prompt, setPrompt] = useState('')
  const [ratio, setRatio] = useState('16:9')
  const [quality, setQuality] = useState('1K')
  const [count, setCount] = useState('4')
  const [queueNum, setQueueNum] = useState('10')
  const [generating, setGenerating] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState('')
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error'; action?: { label: string; onClick: () => void }; pos?: 'top' | 'input' } | null>(null)
  const [queueSize, setQueueSize] = useState(0)
  const [showQueue, setShowQueue] = useState(false)
  const [results, setResults] = useState<Array<{ id: number; model: string; size: string; fileSize: string; quality: string; time: string; prompt: string; favorited: boolean }>>([])
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [thumbScale, setThumbScale] = useState(100)
  const [resultsCollapsed, setResultsCollapsed] = useState(false)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const [refImages, setRefImages] = useState<string[]>([])
  const refInputRef = useRef<HTMLInputElement>(null)
  const [previewZoom, setPreviewZoom] = useState(1)
  const [previewPan, setPreviewPan] = useState({x: 0, y: 0})
  const [isDragging, setIsDragging] = useState(false)
  const [undoPrompt, setUndoPrompt] = useState('')
  const [commonPrompts, setCommonPrompts] = useState<{id:number; title:string; content:string}[]>([])
  const [showCommonPromptModal, setShowCommonPromptModal] = useState(false)
  const [newPromptTitle, setNewPromptTitle] = useState('')
  const [newPromptContent, setNewPromptContent] = useState('')
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [storagePath, setStoragePath] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  const ratios = ['原图', '1:1', '2:3', '3:4', '4:5', '9:16', '21:9', '3:2', '4:3', '5:4', '16:9']
  const qualities = ['1K', '2K', '4K']
  const counts = ['1', '2', '3', '4']

  const showToast = (msg: string, type: 'success' | 'error' = 'success', action?: { label: string; onClick: () => void }, pos: 'top' | 'input' = 'top') => {
    setToast({ msg, type, action, pos })
    setTimeout(() => setToast(null), 3000)
  }

  const addToQueue = (n: number) => {
    if (!isLoggedIn) { openAuthModal(); return }
    setQueueSize((q) => q + n)
    showToast(`已加入队列 ${n} 张，当前排队 ${queueSize + n} 张`)
  }

  const copyPrompt = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => showToast('已复制提示词')).catch(() => showToast('复制失败', 'error'))
  }

  const deleteResult = (id: number) => {
    setResults((r) => r.filter((x) => x.id !== id))
    showToast('已删除')
  }

  const toggleFavorite = (id: number) => {
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
            showToast('已粘贴图片')
          }
          reader.readAsDataURL(blob)
          break
        }
      }
    }).catch(() => {})
  }

  // 全局粘贴监听（提示词框除外）
  // 拉取图片模型列表
  useEffect(() => {
    fetch('/api/config/public')
      .then((res) => res.json())
      .then((channels: any[]) => {
        const allModels = channels.flatMap((ch) => ch.model.split(',').map((m: string) => m.trim()))
        // 过滤出图片模型
        const imageModels = allModels.filter((m: string) =>
          m.includes('image') || m.includes('gpt-image') || m.includes('nano-banana') || m.includes('grok-imagine') || m.includes('seedream') || m.includes('gemini.*image') || m.includes('qwen-image')
        )
        const unique = Array.from(new Set(imageModels))
        setModels(unique)
        if (unique.length && !model) setModel(unique[0])
      })
      .catch(() => {})
  }, [])

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
              setRefImages((xs) => [...xs, reader.result as string])
              showToast('已粘贴图片')
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
    showToast('已复用参数')
  }

  const generate = () => {
    if (!isLoggedIn) { openAuthModal(); return }
    if (!prompt.trim() || generating) return
    setGenerating(true)
    setTimeout(() => {
      const now = new Date()
      const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      setResults((r) => [
        { id: Date.now(), model: model.split(' · ')[1] || 'GPT Image 2.5', size: '1024 x 1024', fileSize: '0.0 MB', quality, time: timeStr, prompt, favorited: false },
        ...r,
      ])
      setGenerating(false)
      showToast('生成完成')
    }, 1500)
  }

  const qualityCost = quality === '1K' ? 1 : quality === '2K' ? 3 : 8
  const estimatedCost = qualityCost * Number(count || 1)

  return (
    <div className="flex h-full gap-2">
      {/* ── 左栏 ── */}
      <div className="flex w-[clamp(340px,30vw,520px)] shrink-0 flex-col overflow-hidden rounded-xl bg-card">
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


          {/* 提示词 */}
          <div className="mb-6">
            <label className="mb-2 block text-[14px] text-text">提示词</label>
            <div className="relative rounded-xl bg-card">
              <textarea
                ref={promptRef}
                value={prompt}
                onChange={(e) => {
                  const val = e.target.value
                  if (val.length > MAX_PROMPT_LENGTH) {
                    showToast(`提示词不能超过 ${MAX_PROMPT_LENGTH} 字`, 'error')
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
                
                <button data-tip="清空" onClick={() => { setUndoPrompt(prompt); setPrompt(''); if (promptRef.current) promptRef.current.style.height = 'auto'; showToast('已清空提示词', 'success', { label: '撤销', onClick: () => { setPrompt(undoPrompt); setUndoPrompt('') } }, 'input') }} className="flex size-6 items-center justify-center rounded text-text-secondary hover:bg-surface-hover"><Trash2 className="size-[13px]" /></button>
                <button data-tip="格式" className="flex size-6 items-center justify-center rounded text-text-secondary hover:bg-surface-hover"><AlignLeft className="size-[13px]" /></button>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button onClick={() => setPrompt('123')} className="h-[28px] rounded-md bg-secondary px-3 text-[12px] text-text-secondary hover:bg-surface-hover">123</button>
              <button data-tip="添加常用提示词" onClick={() => setShowCommonPromptModal(true)} className="ml-auto flex size-[26px] items-center justify-center rounded-full bg-secondary text-text-muted hover:bg-surface-hover"><Plus className="size-[14px]" /></button>
            </div>
          </div>

          {/* 比例 */}
          <div className="mb-6">
            <label className="mb-2 block text-[14px] text-text">比例</label>
            <div className="grid grid-cols-7 gap-1.5">
              {ratios.map((r) => (
                <button key={r} onClick={() => setRatio(r)}
                  className={cn('flex h-[30px] items-center justify-center gap-1 rounded-md text-[12px] transition-colors',
                    ratio === r ? 'bg-accent text-accent-foreground' : 'bg-secondary text-text-secondary hover:bg-surface-hover hover:text-text')}>
                  {r !== '原图' && <span className="inline-block size-[8px] rounded-[2px] bg-current opacity-60" style={{ width: r === '1:1' ? 8 : r === '2:3' || r === '3:4' || r === '4:5' ? 6 : 10, height: 8 }} />}
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* 画质 */}
          <div className="mb-6">
            <label className="mb-2 block text-[14px] text-text">画质</label>
            <div className="grid grid-cols-3 gap-1.5 max-w-[300px]">
              {qualities.map((q) => (
                <button key={q} onClick={() => setQuality(q)}
                  className={cn('h-[30px] rounded-md text-[12px] transition-colors',
                    quality === q ? 'bg-accent text-accent-foreground' : 'bg-secondary text-text-secondary hover:bg-surface-hover hover:text-text')}>
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* 数量 */}
          <div className="mb-6">
            <label className="mb-2 block text-[14px] text-text">数量</label>
            <div className="grid grid-cols-4 gap-1.5 max-w-[400px]">
              {counts.map((c) => (
                <button key={c} onClick={() => setCount(c)}
                  className={cn('h-[30px] rounded-md text-[12px] transition-colors',
                    count === c ? 'bg-accent text-accent-foreground' : 'bg-secondary text-text-secondary hover:bg-surface-hover hover:text-text')}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* 参考图上传 */}
          <div className="mb-6">
            <div className="mb-2 flex items-center">
              <label className="block text-[14px] text-text">参考图 <span className="ml-1 text-[12px] font-normal text-text-muted">最多4张</span></label>
              {refImages.length > 0 && (
                <button onClick={() => setRefImages([])} className="ml-auto text-[12px] text-text-secondary hover:text-red-400">清空</button>
              )}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {refImages.map((img, i) => (
                <div key={i} className="group relative size-[96px] shrink-0 rounded-lg bg-surface-hover">
                  <img src={img} alt="" className="h-full w-full rounded-lg object-cover" />
                  {/* hover 4格操作 */}
                  <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 rounded-lg opacity-0 transition-opacity group-hover:opacity-100">
                    <button data-tip="替换图片" onClick={() => { setReplaceIndex(i); refInputRef.current?.click() }} className="flex items-center justify-center bg-black/40 text-white hover:text-white">
                      <RefreshCw className="size-4" />
                    </button>
                    <button data-tip="放大查看" onClick={() => setPreviewImage(img)} className="flex items-center justify-center bg-black/40 text-white hover:text-white">
                      <ZoomIn className="size-4" />
                    </button>
                    <button data-tip="粘贴替换" onClick={() => pasteImage(i)} className="flex items-center justify-center bg-black/40 text-white hover:text-white">
                      <ClipboardPaste className="size-4" />
                    </button>
                    <button data-tip="删除" onClick={() => setRefImages((xs) => xs.filter((_, j) => j !== i))} className="flex items-center justify-center bg-black/40 text-white hover:text-red-400">
                      <TrashIcon className="size-4" />
                    </button>
                  </div>
                </div>
              ))}
              {/* 上传占位框 — 正常显示加号，hover 分两半 */}
              <div className="group relative size-[96px] shrink-0 rounded-lg border-2 border-dashed border-border transition-colors hover:border-accent">
                {/* 默认加号 */}
                <div className="absolute inset-0 flex flex-col items-center justify-center text-text-muted transition-opacity group-hover:opacity-0">
                  <Plus className="mb-1 size-5" />
                  <span className="text-[11px]">上传</span>
                </div>
                {/* hover 分两半 */}
                <div className="absolute inset-0 grid grid-rows-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => refInputRef.current?.click()}
                    className="flex flex-col items-center justify-end pb-2 text-text-muted hover:text-accent"
                    data-tip="上传图片"
                  >
                    <Upload className="size-4" />
                  </button>
                  <button
                    onClick={() => pasteImage()}
                    className="flex flex-col items-center justify-start pt-2 text-text-muted hover:text-accent"
                    data-tip="粘贴图片 (Ctrl+V)"
                  >
                    <ClipboardPaste className="size-4" />
                  </button>
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
                    showToast('图片不能超过 10MB', 'error')
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
                      if (xs.length >= 4) {
                        showToast('最多上传 4 张参考图', 'error')
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
            <span className="text-[14px] text-text">存储位置</span>
            <span className="flex-1 truncate text-[12px] text-text-secondary">{storagePath}</span>
            <button onClick={() => showToast('已打开存储文件夹')} className="h-[28px] rounded-md bg-secondary px-3 text-[12px] text-text-secondary hover:bg-surface-hover">打开</button>
            <button onClick={async () => {
              try {
                // @ts-ignore
                const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
                setStoragePath(dirHandle.name)
                showToast(`已切换到: ${dirHandle.name}`)
              } catch {
                showToast('已取消选择文件夹')
              }
            }} className="h-[28px] rounded-md bg-secondary px-3 text-[12px] text-text-secondary hover:bg-surface-hover">更改</button>
          </div>
          <div className="mb-2 flex items-center gap-1.5">
            <button onClick={() => addToQueue(1)} className="h-[30px] rounded-md bg-secondary px-2.5 text-[12px] text-text-secondary hover:bg-surface-hover">排队1张</button>
            <button onClick={() => addToQueue(5)} className="h-[30px] rounded-md bg-secondary px-2.5 text-[12px] text-text-secondary hover:bg-surface-hover">+5张</button>
            <button onClick={() => addToQueue(10)} className="h-[30px] rounded-md bg-secondary px-2.5 text-[12px] text-text-secondary hover:bg-surface-hover">+10张</button>
            <div className="flex h-[30px] w-[72px] items-center rounded-md bg-card px-2">
              <input value={queueNum} onChange={(e) => setQueueNum(e.target.value.replace(/\D/g, '').slice(0, 2))}
                className="w-full bg-transparent text-center text-[12px] text-text outline-none" />
            </div>
            <button onClick={() => addToQueue(Number(queueNum) || 1)} className="h-[30px] rounded-md bg-secondary px-2.5 text-[12px] text-text-secondary hover:bg-surface-hover">张入队</button>
            <button onClick={() => setShowQueue((v) => !v)} className={cn('h-[30px] rounded-md px-3 text-[12px] hover:bg-surface-hover', showQueue ? 'bg-accent text-accent-foreground' : 'bg-secondary text-text-secondary')}>查看队列{queueSize > 0 && `(${queueSize})`}</button>
          </div>
          {showQueue && (
            <div className="mb-2 rounded-lg bg-card p-3 text-[12px] text-text-secondary">
              {queueSize === 0 ? '队列为空' : `队列中有 ${queueSize} 张待生成`}
            </div>
          )}
        </div>

        {/* 生成按钮 */}
        <div className="shrink-0 px-5 pb-4 pt-1">
          <button onClick={generate} disabled={!prompt.trim() || generating}
            className="flex h-[58px] w-full items-center justify-center rounded-lg bg-accent text-[16px] text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-45">
            {generating ? <><Loader2 className="mr-2 size-5 animate-spin" />生成中…</> : (prompt.trim() ? `开始生成 · 预估 ${estimatedCost} 积分` : '输入提示词后生成')}
          </button>
        </div>
      </div>

      {/* ── 右栏：结果区（可折叠） ── */}
      {!resultsCollapsed && (
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-card">
        {/* 顶部工具栏 */}
        <div className="flex h-[44px] shrink-0 items-center gap-2 px-4 pt-3">
          <select className="h-[30px] rounded-lg bg-secondary px-2 text-[12px] text-text-secondary outline-none">
            <option>全部时间</option>
            <option>今天</option>
            <option>近7天</option>
            <option>近30天</option>
          </select>
          <select className="h-[30px] rounded-lg bg-secondary px-2 text-[12px] text-text-secondary outline-none">
            <option>全部星级</option>
            <option>已收藏</option>
            <option>未收藏</option>
          </select>
          <button onClick={() => showToast('搜索')} className="flex size-[30px] items-center justify-center rounded-lg text-text-secondary hover:bg-surface-hover">
            <Search className="size-[14px]" />
          </button>
          <div className="ml-auto flex items-center gap-2">
            <input type="range" min={60} max={160} value={thumbScale} onChange={(e) => setThumbScale(Number(e.target.value))} className="w-24 accent-accent" />
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
        <div className="flex-1 overflow-y-auto p-4 pt-2">
          {results.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-text-muted">
              <p className="text-sm">还没有生成结果</p>
              <p className="mt-1 text-xs text-text-secondary">输入提示词后点击生成</p>
            </div>
          )}
          {results.length > 0 && viewMode === 'list' && (
            <div className="space-y-4">
              {results.map((r) => (
                <div key={r.id} className="group flex gap-4 rounded-lg bg-card p-3">
                  <div className="shrink-0 overflow-hidden rounded-lg bg-surface-hover" style={{ width: thumbScale * 1.6, height: thumbScale * 1.6 }}>
                    <div className="flex h-full items-center justify-center text-[12px] text-text-secondary">图 {r.id}</div>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="mb-1 flex items-baseline gap-2">
                      <span className="text-[14px] text-text">{r.model}</span>
                      <span className="text-[12px] text-text-secondary">尺寸 {r.size}</span>
                      <span className="text-[12px] text-text-secondary">大小 {r.fileSize}</span>
                      <span className="text-[12px] text-text-secondary">画质 {r.quality}</span>
                      <span className="ml-auto text-[12px] text-text-secondary">{r.time}</span>
                    </div>
                                        <div className="mb-2">
                      <p className={cn('text-[14px] text-text', !expandedIds.has(r.id) && 'line-clamp-2')}>{r.prompt}</p>
                      {r.prompt.length > 40 && (
                        <button onClick={() => togglePrompt(r.id)} className="mt-0.5 text-[12px] text-accent hover:underline">
                          {expandedIds.has(r.id) ? '收起' : '展开'}
                        </button>
                      )}
                    </div>
                    <div className="mt-auto flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                      <button data-tip="复用参数" onClick={() => reuseParams(r)} className="flex size-[30px] items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-secondary"><Repeat className="size-[15px]" strokeWidth={1.8} /></button>
                      <button data-tip="复制提示词" onClick={() => copyPrompt(r.prompt)} className="flex size-[30px] items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-secondary"><FileText className="size-[15px]" strokeWidth={1.8} /></button>
                      <button data-tip="复制图片" onClick={() => showToast('已复制图片')} className="flex size-[30px] items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-secondary"><Copy className="size-[15px]" strokeWidth={1.8} /></button>
                      <button data-tip="引用" onClick={() => showToast('已引用')} className="flex size-[30px] items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-secondary"><Quote className="size-[15px]" strokeWidth={1.8} /></button>
                      <button data-tip="团队分享" onClick={() => showToast('已发起团队分享')} className="flex size-[30px] items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-secondary"><Share2 className="size-[15px]" strokeWidth={1.8} /></button>
                      <button title={r.favorited ? '取消收藏' : '收藏'} onClick={() => toggleFavorite(r.id)} className={cn('flex size-[30px] items-center justify-center rounded-md', r.favorited ? 'text-accent' : 'text-text-muted hover:bg-surface-hover hover:text-text-secondary')}><Star className="size-[15px]" strokeWidth={1.8} /></button>
                      <button data-tip="下载" onClick={() => showToast('已下载')} className="flex size-[30px] items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-secondary"><Download className="size-[15px]" strokeWidth={1.8} /></button>
                      <button data-tip="所在文件夹" onClick={() => showToast('已打开所在文件夹')} className="flex size-[30px] items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-secondary"><FolderOpen className="size-[15px]" strokeWidth={1.8} /></button>
                      <button data-tip="删除" onClick={() => deleteResult(r.id)} className="flex size-[30px] items-center justify-center rounded-md text-[#b91c1c] hover:text-red-400 hover:bg-surface-hover"><Trash2 className="size-[15px]" strokeWidth={1.8} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {viewMode === 'grid' && (
            <div className="grid grid-cols-3 gap-3">
              {results.map((r) => (
                <div key={r.id} className="group relative aspect-square overflow-hidden rounded-lg bg-surface-hover">
                  <div className="flex h-full items-center justify-center text-[12px] text-text-secondary">图 {r.id}</div>
                  <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/80 via-black/20 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
                    <p className="mb-2 truncate text-[12px] text-text">{r.prompt}</p>
                    <div className="flex gap-1">
                      <button onClick={() => copyPrompt(r.prompt)} className="h-[22px] rounded bg-secondary px-2 text-[11px] text-text hover:bg-surface-hover">复制</button>
                      <button onClick={() => toggleFavorite(r.id)} className="h-[22px] rounded bg-secondary px-2 text-[11px] text-text hover:bg-surface-hover">{r.favorited ? '★' : '☆'}</button>
                      <button onClick={() => deleteResult(r.id)} className="h-[22px] rounded bg-secondary px-2 text-[11px] text-red-400 hover:bg-surface-hover">删</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {viewMode === 'large' && (
            <div className="space-y-4">
              {results.map((r) => (
                <div key={r.id} className="group overflow-hidden rounded-lg bg-card">
                  <div className="flex h-[400px] items-center justify-center bg-surface-hover text-[14px] text-text-secondary">图 {r.id}（大图预览）</div>
                  <div className="p-3">
                    <div className="mb-1 flex items-baseline gap-2">
                      <span className="text-[14px] text-text">{r.model}</span>
                      <span className="text-[12px] text-text-secondary">尺寸 {r.size}</span>
                      <span className="text-[12px] text-text-secondary">{r.time}</span>
                    </div>
                                        <div className="mb-2">
                      <p className={cn('text-[14px] text-text', !expandedIds.has(r.id) && 'line-clamp-2')}>{r.prompt}</p>
                      {r.prompt.length > 40 && (
                        <button onClick={() => togglePrompt(r.id)} className="mt-0.5 text-[12px] text-accent hover:underline">
                          {expandedIds.has(r.id) ? '收起' : '展开'}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button data-tip="复用参数" onClick={() => reuseParams(r)} className="flex size-[30px] items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-secondary"><Repeat className="size-[15px]" strokeWidth={1.8} /></button>
                      <button data-tip="复制提示词" onClick={() => copyPrompt(r.prompt)} className="flex size-[30px] items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-secondary"><FileText className="size-[15px]" strokeWidth={1.8} /></button>
                      <button title={r.favorited ? '取消收藏' : '收藏'} onClick={() => toggleFavorite(r.id)} className={cn('flex size-[30px] items-center justify-center rounded-md', r.favorited ? 'text-accent' : 'text-text-muted hover:bg-surface-hover hover:text-text-secondary')}><Star className="size-[15px]" strokeWidth={1.8} /></button>
                      <button data-tip="下载" onClick={() => showToast('已下载')} className="flex size-[30px] items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-secondary"><Download className="size-[15px]" strokeWidth={1.8} /></button>
                      <button data-tip="删除" onClick={() => deleteResult(r.id)} className="flex size-[30px] items-center justify-center rounded-md text-[#b91c1c] hover:text-red-400 hover:bg-surface-hover"><Trash2 className="size-[15px]" strokeWidth={1.8} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      )}

      {/* 右栏折叠/展开按钮 */}
      <button
        data-tip={resultsCollapsed ? '展开结果区' : '折叠结果区'}
        onClick={() => setResultsCollapsed((v) => !v)}
        className="fixed right-3 top-1/2 z-30 flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-secondary text-text-muted shadow-lg ring-1 ring-border hover:bg-surface-hover hover:text-text"
      >
        {resultsCollapsed ? <PanelRightOpen className="size-[14px]" strokeWidth={1.8} /> : <PanelRightClose className="size-[14px]" strokeWidth={1.8} />}
      </button>

      {/* Toast — 顶部居中，成功绿色/失败红色 */}
      {/* 常用提示词弹窗 */}
      {showCommonPromptModal && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
          onClick={() => setShowCommonPromptModal(false)}
        >
          <div
            className="w-[480px] rounded-xl bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-[16px] text-text">添加常用提示词</h3>
            <input
              type="text"
              value={newPromptTitle}
              onChange={(e) => setNewPromptTitle(e.target.value)}
              placeholder="标题（如：日系动漫风）"
              className="mb-3 w-full rounded-lg bg-card px-3 py-2 text-[14px] text-text outline-none placeholder:text-text-muted"
            />
            <textarea
              value={newPromptContent}
              onChange={(e) => setNewPromptContent(e.target.value)}
              placeholder="提示词内容"
              rows={4}
              className="mb-4 w-full resize-none rounded-lg bg-card px-3 py-2 text-[14px] text-text outline-none placeholder:text-text-muted"
            />
            {commonPrompts.length > 0 && (
              <div className="mb-4 max-h-[120px] overflow-y-auto">
                {commonPrompts.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { setPrompt(p.content); setShowCommonPromptModal(false); showToast('已填入提示词') }}
                    className="mb-1 block w-full rounded-lg bg-secondary px-3 py-2 text-left text-[13px] text-text hover:bg-surface-hover"
                  >
                    {p.title}
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCommonPromptModal(false)}
                className="h-[32px] rounded-md bg-secondary px-4 text-[13px] text-text-secondary hover:bg-surface-hover"
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (!newPromptTitle.trim() || !newPromptContent.trim()) return
                  setCommonPrompts((xs) => [...xs, { id: Date.now(), title: newPromptTitle, content: newPromptContent }])
                  setNewPromptTitle('')
                  setNewPromptContent('')
                  showToast('已保存')
                }}
                className="h-[32px] rounded-md bg-accent px-4 text-[13px] text-accent-foreground hover:bg-accent-hover"
              >
                保存
              </button>
            </div>
          </div>
        </div>, document.body)}

      {previewImage && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center overflow-hidden bg-black/80"
          onClick={() => { setPreviewImage(null); setPreviewZoom(1); setPreviewPan({x:0,y:0}) }}
          onWheel={(e) => {
            e.stopPropagation()
            setPreviewZoom((z) => Math.min(8, Math.max(0.5, z + (e.deltaY < 0 ? 0.2 : -0.2))))
          }}
        >
          <img
            src={previewImage}
            alt=""
            draggable={false}
            className="max-h-[90vh] max-w-[90vw] select-none rounded-lg object-contain"
            style={{
              transform: `translate(${previewPan.x}px, ${previewPan.y}px) scale(${previewZoom})`,
              cursor: previewZoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
              transition: 'transform 0.05s',
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => {
              if (previewZoom <= 1) return
              e.stopPropagation()
              setIsDragging(true)
              let lastX = e.clientX, lastY = e.clientY, vx = 0, vy = 0
              const startX = e.clientX - previewPan.x
              const startY = e.clientY - previewPan.y
              const onMove = (ev: MouseEvent) => {
                vx = ev.clientX - lastX
                vy = ev.clientY - lastY
                lastX = ev.clientX
                lastY = ev.clientY
                setPreviewPan({ x: ev.clientX - startX, y: ev.clientY - startY })
              }
              const onUp = () => {
                setIsDragging(false)
                window.removeEventListener('mousemove', onMove)
                window.removeEventListener('mouseup', onUp)
                // 惯性
                const decay = 0.92
                const step = () => {
                  vx *= decay
                  vy *= decay
                  if (Math.abs(vx) < 0.5 && Math.abs(vy) < 0.5) return
                  setPreviewPan((p) => ({ x: p.x + vx, y: p.y + vy }))
                  requestAnimationFrame(step)
                }
                requestAnimationFrame(step)
              }
              window.addEventListener('mousemove', onMove)
              window.addEventListener('mouseup', onUp)
            }}
          />
          <button
            className="absolute right-5 top-5 flex size-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            onClick={() => { setPreviewImage(null); setPreviewZoom(1); setPreviewPan({x:0,y:0}) }}
          >
            <X className="size-5" />
          </button>
        </div>, document.body)}

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
function BlendPanel() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)
  const openAuthModal = useAuthStore((s) => s.openAuthModal)
  const [sourceImage, setSourceImage] = useState<string | null>(null)
  const [imageName, setImageName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [strength, setStrength] = useState(0.7)
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

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
      <div className="flex w-[320px] shrink-0 flex-col overflow-hidden rounded-xl bg-card">
        <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2">
          <div
            className={cn('relative flex h-[360px] cursor-pointer items-center justify-center overflow-hidden rounded-lg',
              !sourceImage && 'bg-[repeating-radial-gradient(circle_at_8px_8px,#242424_1.15px,transparent_1.15px)] bg-[length:16px_16px]')}
            onClick={() => !sourceImage && fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]) }}>
            {!sourceImage ? (
              <div className="flex flex-col items-center">
                <div className="mb-3 flex size-11 items-center justify-center rounded-lg bg-secondary">
                  <Upload className="size-[20px] text-accent" />
                </div>
                <div className="text-[14px] font-medium text-text">点击或拖放图片</div>
                <div className="mt-1 text-[12px] text-text-secondary">PNG / JPG / WEBP / BMP</div>
              </div>
            ) : (
              <>
                <img src={sourceImage} alt="src" className="max-h-full max-w-full object-contain p-3" />
                <div className="absolute inset-x-0 bottom-0 flex h-10 items-center bg-card px-3">
                  <span className="truncate text-[12px] text-text-secondary">{imageName}</span>
                </div>
                <div className="absolute inset-0 flex items-center justify-center gap-2 opacity-0 hover:opacity-100">
                  <button onClick={(e) => { e.stopPropagation(); clearImage() }}
                    className="flex size-9 items-center justify-center rounded-full bg-card text-text-secondary hover:text-text" data-tip="clear">
                    <X className="size-[16px]" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); fileRef.current?.click() }}
                    className="flex size-9 items-center justify-center rounded-full bg-card text-text-secondary hover:text-text" data-tip="replace">
                    <RefreshCw className="size-[16px]" />
                  </button>
                </div>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          <div className="mt-4">
            <label className="mb-2 block text-[12px] font-medium text-text-secondary">提示词</label>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4}
              placeholder="描述你想要的效果…"
              className="min-h-[120px] w-full resize-none rounded-xl bg-card px-3 py-2 text-[14px] leading-[22px] text-text outline-none placeholder:text-text-secondary focus:ring-1 focus:ring-accent" />
          </div>
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <label className="text-[12px] font-medium text-text-secondary">融合强度</label>
              <span className="text-[12px] text-accent">{Math.round(strength * 100)}%</span>
            </div>
            <input type="range" min={0} max={100} value={strength * 100}
              onChange={(e) => setStrength(Number(e.target.value) / 100)}
              className="w-full accent-accent" />
          </div>
        </div>
        <div className="shrink-0 p-4 pt-2">
          <button onClick={generate} disabled={!sourceImage || generating}
            className="flex h-[58px] w-full items-center justify-center gap-2 rounded-lg bg-accent text-[14px] font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-40">
            {generating ? <><Loader2 className="size-4 animate-spin" />生成中…</> : <><Sparkles className="size-4" />开始生成</>}
          </button>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-card">
        <div className="flex h-[44px] shrink-0 items-center px-4 pt-3">
          <span className="text-[12px] font-medium text-text-secondary">结果预览</span>
        </div>
        <div className="flex-1 overflow-hidden p-4 pt-0">
          {!result && !generating ? (
            <div className="flex h-full items-center justify-center rounded-lg bg-[repeating-radial-gradient(circle_at_8px_8px,#242424_1.15px,transparent_1.15px)] bg-[length:16px_16px]">
              <div className="flex flex-col items-center">
                <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-secondary">
                  <Wand2 className="size-[18px] text-accent" />
                </div>
                <span className="text-[14px] font-medium text-text">等待图片</span>
                <span className="mt-1.5 text-[12px] text-text-secondary">上传后可查看原图、结果和滑动对比</span>
              </div>
            </div>
          ) : generating ? (
            <div className="flex h-full items-center justify-center rounded-lg bg-card">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="size-8 animate-spin text-accent" />
                <span className="text-[14px] text-text-secondary">AI 正在处理…</span>
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
function TranslatePanel() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)
  const openAuthModal = useAuthStore((s) => s.openAuthModal)
  const [targetLang, setTargetLang] = useState('中文')
  const [images, setImages] = useState<{ name: string; status: string }[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const onUpload = (files: FileList | null) => {
    if (!files) return
    const list = Array.from(files).map((f) => ({ name: f.name, status: '待翻译' }))
    setImages((x) => [...x, ...list])
  }

  return (
    <div className="flex h-full gap-2">
      <div className="flex w-[320px] shrink-0 flex-col overflow-hidden rounded-xl bg-card">
        <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2">
          <div
            className="flex h-[360px] cursor-pointer flex-col items-center justify-center rounded-lg bg-[repeating-radial-gradient(circle_at_8px_8px,#242424_1.15px,transparent_1.15px)] bg-[length:16px_16px]"
            onClick={() => fileRef.current?.click()}>
            <div className="mb-3 flex size-11 items-center justify-center rounded-lg bg-secondary">
              <Languages className="size-[20px] text-accent" />
            </div>
            <div className="text-[14px] font-medium text-text">点击或拖放图片</div>
            <div className="mt-1 text-[12px] text-text-secondary">PNG / JPG / WEBP / BMP</div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => onUpload(e.target.files)} />
          <div className="mt-4">
            <label className="mb-2 block text-[12px] font-medium text-text-secondary">目标语言</label>
            <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)}
              className="w-full rounded-xl bg-card px-3 py-2 text-[14px] text-text outline-none focus:ring-1 focus:ring-accent">
              {['中文', '英文', '日文', '韩文', '法文', '德文'].map((l) => <option key={l}>{l}</option>)}
            </select>
          </div>
          {images.length > 0 && (
            <div className="mt-4 space-y-1.5">
              {images.map((img, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2">
                  <span className="truncate text-[12px] text-text">{img.name}</span>
                  <span className="text-[12px] text-text-secondary">{img.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0 p-4 pt-2">
          <button disabled={images.length === 0} onClick={() => { if (!isLoggedIn) { openAuthModal(); return } }}
            className="flex h-[58px] w-full items-center justify-center gap-2 rounded-lg bg-accent text-[14px] font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-40">
            <Languages className="size-4" />开始翻译
          </button>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-center rounded-xl bg-card">
        <div className="flex flex-col items-center text-text-secondary">
          <Languages className="mb-3 size-12" />
          <span className="text-[14px]">上传图片后，翻译结果将显示在这里</span>
        </div>
      </div>
    </div>
  )
}

export default function ImageToolsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('generate')

  return (
    <div className="flex h-full flex-col bg-bg p-3">
      <div className="flex shrink-0 items-center gap-1 px-3 pt-3 pb-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={cn(
              'flex h-[30px] min-w-[58px] items-center rounded-lg px-3 text-[12px] font-medium transition-colors',
              activeTab === t.id
                ? 'bg-accent text-accent-foreground'
                : 'text-text-secondary hover:bg-secondary hover:text-text',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {activeTab === 'generate' && <GeneratePanel />}
        {activeTab === 'blend' && <BlendPanel />}
        {activeTab === 'translate' && <TranslatePanel />}
      </div>
    </div>
  )
}
