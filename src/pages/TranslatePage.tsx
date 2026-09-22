import { useState } from 'react'
import { Upload, FileText, Loader2 } from 'lucide-react'

interface TranslateItem {
  id: number
  name: string
  size: string
  sourceLang: string
  targetLang: string
  status: 'pending' | 'done'
}

const MAX_SIZE_MB = 10

function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

export default function TranslatePage() {
  const [items, setItems] = useState<TranslateItem[]>([])
  const [targetLang, setTargetLang] = useState('中文')
  const [translating, setTranslating] = useState(false)
  const [error, setError] = useState('')

  const onUpload = (files: FileList | null) => {
    if (!files) return
    setError('')
    const accepted: TranslateItem[] = []
    const rejected: string[] = []

    Array.from(files).forEach((f, i) => {
      // 校验类型
      if (!f.type.startsWith('image/')) {
        rejected.push(`${f.name}（不是图片）`)
        return
      }
      // 校验大小
      if (f.size > MAX_SIZE_MB * 1024 * 1024) {
        rejected.push(`${f.name}（超过 ${MAX_SIZE_MB}MB）`)
        return
      }
      accepted.push({
        id: Date.now() + i,
        name: f.name,
        size: formatSize(f.size),
        sourceLang: '自动检测',
        targetLang,
        status: 'pending' as const,
      })
    })

    if (rejected.length > 0) {
      setError(`已跳过：${rejected.join('、')}`)
    }
    if (accepted.length > 0) {
      setItems((x) => [...x, ...accepted])
    }
  }

  const translate = () => {
    if (items.length === 0 || translating) return
    setTranslating(true)
    setTimeout(() => {
      setItems((list) => list.map((x) => ({ ...x, status: 'done' as const })))
      setTranslating(false)
    }, 1000)
  }

  return (
    <div className="mx-auto max-w-[1000px] p-6">
      {/* 上传区 */}
      <div className="mb-6 rounded-xl bg-card p-8 text-center transition-colors hover:bg-card-hover">
        <label className="flex cursor-pointer flex-col items-center gap-3">
          <Upload className="size-8 text-text-muted" />
          <span className="text-[14px] font-medium text-text">点击上传需要翻译的图片</span>
          <span className="text-[12px] text-text-muted">支持 PNG / JPG / WebP，单张不超过 {MAX_SIZE_MB}MB，可多选</span>
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => onUpload(e.target.files)}
          />
        </label>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-2 text-[13px] text-red-400">
          {error}
        </div>
      )}

      {/* 操作栏 */}
      <div className="mb-4 flex items-center gap-3">
        <span className="text-[14px] text-text-secondary">目标语言</span>
        <select
          value={targetLang}
          onChange={(e) => setTargetLang(e.target.value)}
          className="rounded-lg bg-input px-3 py-1.5 text-[14px] text-text outline-none focus:ring-1 focus:ring-accent"
        >
          {['中文', '英文', '日文', '韩文', '法文', '德文'].map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
        <button
          onClick={translate}
          disabled={items.length === 0 || translating}
          className="ml-auto flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[14px] font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          {translating ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
          {translating ? '翻译中…' : '开始翻译'}
        </button>
      </div>

      {/* 列表 */}
      <div className="space-y-2">
        {items.length === 0 && (
          <div className="rounded-xl bg-card p-8 text-center text-[14px] text-text-muted">
            暂无待翻译图片
          </div>
        )}
        {items.map((it) => (
          <div key={it.id} className="flex items-center justify-between rounded-xl bg-card px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-surface">
                <FileText className="size-4 text-text-muted" />
              </div>
              <div>
                <div className="text-[14px] text-text">{it.name}</div>
                <div className="text-[12px] text-text-muted">
                  {it.size} · {it.sourceLang} → {it.targetLang}
                </div>
              </div>
            </div>
            <span
              className={
                it.status === 'done'
                  ? 'rounded-full bg-success/15 px-2.5 py-1 text-[12px] text-success'
                  : 'rounded-full bg-[#f0f0f2] px-2.5 py-1 text-[12px] text-text-muted'
              }
            >
              {it.status === 'done' ? '已完成' : '待翻译'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}