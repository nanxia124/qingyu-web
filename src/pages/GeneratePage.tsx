import { useState } from 'react'
import { Sparkles, ImagePlus, Loader2, Download, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const ratios = ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2']
const qualities = ['标准', '高清', '超清', '4K']
const counts = ['1', '2', '3', '4']
const samplePrompts = [
  '电商产品图，简约白底，高清',
  '国潮风格插画，喜庆色调',
  '写实人像摄影，棚拍灯光',
]

export default function GeneratePage() {
  const [prompt, setPrompt] = useState('')
  const [negative, setNegative] = useState('')
  const [ratio, setRatio] = useState('1:1')
  const [quality, setQuality] = useState('标准')
  const [count, setCount] = useState('1')
  const [generating, setGenerating] = useState(false)
  const [results, setResults] = useState<string[]>([])

  const generate = () => {
    if (!prompt.trim() || generating) return
    setGenerating(true)
    setTimeout(() => {
      const n = parseInt(count) || 1
      setResults((r) => [...r, ...Array(n).fill(prompt.trim())])
      setGenerating(false)
    }, 1200)
  }

  return (
    <div className="flex h-full bg-[#f4f4f6]">
      {/* ── 左栏 520px ── */}
      <div className="flex w-[520px] shrink-0 flex-col overflow-hidden bg-[#ffffff]">
        {/* 模型选择 */}
        <div className="shrink-0 px-4 pt-3">
          <div className="flex h-[30px] items-center justify-between rounded-lg bg-[#f0f0f2] px-3">
            <span className="text-[12px] text-text-secondary">选择模型</span>
            <Sparkles className="size-[14px] text-accent" />
          </div>
        </div>

        {/* 参数滚动区 */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* 提示词 */}
          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-[12px] font-medium text-text-muted">提示词</label>
            </div>
            <div className="rounded-lg bg-[#ffffff] p-1 transition-colors focus-within:ring-1 focus-within:ring-accent">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                placeholder="描述你想生成的画面…"
                className="min-h-[76px] w-full resize-none bg-transparent px-3 py-2 text-[14px] leading-[22px] font-medium text-text outline-none placeholder:text-text-muted"
              />
            </div>
            {/* 常用提示词 */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {samplePrompts.map((s) => (
                <button
                  key={s}
                  onClick={() => setPrompt(s)}
                  className="rounded-full bg-[#f0f0f2] px-2.5 py-1 text-[12px] leading-[18px] text-text-secondary transition-colors hover:bg-[#e4e4e9] hover:text-text-active"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* 负面提示词 */}
          <div className="mb-4">
            <label className="mb-1.5 block text-[12px] font-medium text-text-muted">负面提示词</label>
            <textarea
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
              rows={2}
              placeholder="不想出现的内容…"
              className="w-full resize-none rounded-lg bg-[#ffffff] px-3 py-2 text-[14px] leading-[22px] text-text outline-none placeholder:text-text-muted focus:ring-1 focus:ring-accent"
            />
          </div>

          {/* 比例 */}
          <div className="mb-3">
            <label className="mb-1.5 block text-[12px] font-medium text-text-muted">比例</label>
            <div className="grid grid-cols-7 gap-1">
              {ratios.map((r) => (
                <button
                  key={r}
                  onClick={() => setRatio(r)}
                  className={cn(
                    'h-[30px] rounded-md text-[12px] transition-colors',
                    ratio === r
                      ? 'bg-accent text-accent-foreground'
                      : 'bg-[#f0f0f2] text-text-muted hover:bg-[#e4e4e9] hover:text-text-active',
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* 画质 */}
          <div className="mb-3">
            <label className="mb-1.5 block text-[12px] font-medium text-text-muted">画质</label>
            <div className="grid grid-cols-7 gap-1">
              {qualities.map((q) => (
                <button
                  key={q}
                  onClick={() => setQuality(q)}
                  className={cn(
                    'col-span-2 h-[30px] rounded-md text-[12px] transition-colors',
                    quality === q
                      ? 'bg-accent text-accent-foreground'
                      : 'bg-[#f0f0f2] text-text-muted hover:bg-[#e4e4e9] hover:text-text-active',
                  )}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* 数量 */}
          <div className="mb-3">
            <label className="mb-1.5 block text-[12px] font-medium text-text-muted">数量</label>
            <div className="grid grid-cols-7 gap-1">
              {counts.map((c) => (
                <button
                  key={c}
                  onClick={() => setCount(c)}
                  className={cn(
                    'h-[30px] rounded-md text-[12px] transition-colors',
                    count === c
                      ? 'bg-accent text-accent-foreground'
                      : 'bg-[#f0f0f2] text-text-muted hover:bg-[#e4e4e9] hover:text-text-active',
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 生成按钮 */}
        <div className="shrink-0 border-t border-border p-4">
          <button
            onClick={generate}
            disabled={!prompt.trim() || generating}
            className="flex h-[58px] w-full items-center justify-center gap-2 rounded-lg bg-accent text-[14px] font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            {generating ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                生成中…
              </>
            ) : (
              <>
                <Sparkles className="size-4" />
                开始生成
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── 右栏：结果区 ── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#f4f4f6] p-4">
        {/* 结果工具栏 */}
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[12px] font-medium text-text-secondary">生成结果</span>
          {results.length > 0 && (
            <button className="ml-auto flex h-[28px] items-center gap-1 rounded-lg bg-[#f0f0f2] px-3 text-[12px] text-text-secondary transition-colors hover:bg-[#e4e4e9] hover:text-text">
              <Trash2 className="size-3.5" />
              清空
            </button>
          )}
        </div>

        {/* 结果网格 */}
        <div className="flex-1 overflow-y-auto">
          {results.length === 0 && !generating ? (
            <div className="flex h-full items-center justify-center rounded-xl bg-[#ffffff]">
              <div className="flex flex-col items-center text-text-muted">
                <ImagePlus className="mb-3 size-12" />
                <span className="text-[14px]">生成结果将显示在这里</span>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
              {results.map((r, i) => (
                <div key={i} className="group relative aspect-square overflow-hidden rounded-xl bg-[#ffffff]">
                  <div className="flex h-full items-center justify-center text-[14px] text-text-muted">
                    图 {i + 1}
                  </div>
                  <button className="absolute right-2 top-2 hidden size-8 items-center justify-center rounded-lg bg-black/50 text-white backdrop-blur group-hover:flex">
                    <Download className="size-4" />
                  </button>
                  <div className="absolute inset-x-0 bottom-0 truncate bg-black/50 px-2 py-1 text-[12px] text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
                    {r}
                  </div>
                </div>
              ))}
              {generating && (
                <div className="flex aspect-square flex-col items-center justify-center gap-3 rounded-xl bg-[#ffffff]">
                  <Loader2 className="size-8 animate-spin text-accent" />
                  <span className="text-[12px] text-text-secondary">AI 正在生成…</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
