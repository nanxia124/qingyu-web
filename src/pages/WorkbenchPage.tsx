import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sparkles, Search, Bell, ChevronRight, Image as ImageIcon,
  Zap, Globe, Wand2, Heart, MoreHorizontal, Plus,
  Gift, Coins, Crown, FolderOpen,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

const categoryIds = [
  { id: 'all', key: 'catAll' },
  { id: 'ecommerce', key: 'catEcommerce' },
  { id: 'poster', key: 'catPoster' },
  { id: 'photo', key: 'catPhoto' },
  { id: 'illustration', key: 'catIllustration' },
]

const feedItems = [
  { id: 1, title: '电商产品主图', category: 'ecommerce', gradient: 'from-amber-500/20 to-orange-600/20', likes: 234 },
  { id: 2, title: '新品发布海报', category: 'poster', gradient: 'from-violet-500/20 to-fuchsia-600/20', likes: 189 },
  { id: 3, title: '棚拍产品摄影', category: 'photo', gradient: 'from-sky-500/20 to-blue-600/20', likes: 356 },
  { id: 4, title: '国潮风格插画', category: 'illustration', gradient: 'from-rose-500/20 to-red-600/20', likes: 421 },
  { id: 5, title: '3D 渲染产品', category: 'ecommerce', gradient: 'from-emerald-500/20 to-teal-600/20', likes: 167 },
  { id: 6, title: '节日活动海报', category: 'poster', gradient: 'from-pink-500/20 to-rose-600/20', likes: 298 },
  { id: 7, title: '户外人像写真', category: 'photo', gradient: 'from-indigo-500/20 to-purple-600/20', likes: 512 },
  { id: 8, title: '扁平风格插画', category: 'illustration', gradient: 'from-cyan-500/20 to-blue-600/20', likes: 143 },
  { id: 9, title: '白底产品图', category: 'ecommerce', gradient: 'from-slate-500/20 to-gray-600/20', likes: 187 },
  { id: 10, title: '品牌视觉海报', category: 'poster', gradient: 'from-orange-500/20 to-amber-600/20', likes: 256 },
  { id: 11, title: '室内产品摄影', category: 'photo', gradient: 'from-teal-500/20 to-green-600/20', likes: 198 },
  { id: 12, title: '治愈系插画', category: 'illustration', gradient: 'from-lime-500/20 to-emerald-600/20', likes: 342 },
  { id: 13, title: '场景化产品图', category: 'ecommerce', gradient: 'from-fuchsia-500/20 to-pink-600/20', likes: 176 },
  { id: 14, title: '促销活动海报', category: 'poster', gradient: 'from-red-500/20 to-orange-600/20', likes: 432 },
]

const quickTools = [
  { icon: Globe, label: 'WebUI', desc: '云端部署' },
  { icon: Wand2, label: 'ComfyUI', desc: '节点式工作流' },
  { icon: Sparkles, label: '训练LoRA', desc: '自定义模型' },
]

export default function WorkbenchPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [activeCat, setActiveCat] = useState('all')
  const [activeFilter, setActiveFilter] = useState<'recommend' | 'latest'>('recommend')
  const [quickPrompt, setQuickPrompt] = useState('')

  const filteredItems = useMemo(() => {
    let list = feedItems.filter(
      (item) =>
        (activeCat === 'all' || item.category === activeCat) &&
        item.title.toLowerCase().includes(search.toLowerCase()),
    )
    if (activeFilter === 'latest') {
      list = [...list].reverse()
    }
    return list
  }, [search, activeCat, activeFilter])

  const handleQuickGenerate = () => {
    const prompt = quickPrompt.trim()
    navigate('/image-tools', { state: { presetPrompt: prompt } })
  }

  const showToast = (msg: string) => {
    alert(msg)
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-bg">
      {/* ── 顶栏 ── */}
      <div className="shrink-0 px-6 pt-5">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-[480px]">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("mainHome.searchPlaceholder")}
              className="h-9 w-full rounded-lg bg-card pl-9 pr-3 text-sm text-text outline-none placeholder:text-text-muted focus:ring-1 focus:ring-accent"
            />
          </div>
          <button className="flex size-9 items-center justify-center rounded-lg bg-card text-text-muted hover:text-text">
            <Bell className="size-[18px]" />
          </button>
          {/* 三个快捷入口 */}
          <button
            onClick={() => showToast(t('mainHome.soon'))}
            className="flex items-center gap-1 rounded-lg bg-[#fef3c7] px-3 py-2 text-xs text-amber-700"
          >
            <Gift className="size-[14px]" /> {t('mainHome.invite')}
          </button>
          <button
            onClick={() => showToast(t('mainHome.soon'))}
            className="flex items-center gap-1 rounded-lg bg-[#fef3c7] px-3 py-2 text-xs text-amber-700"
          >
            <Coins className="size-[14px]" /> {t('mainHome.points')}
          </button>
          <button
            onClick={() => showToast(t('mainHome.soon'))}
            className="flex items-center gap-1 rounded-lg bg-[#fef3c7] px-3 py-2 text-xs text-amber-700"
          >
            <Crown className="size-[14px]" /> {t('mainHome.vip')}
          </button>
        </div>
      </div>

      {/* ── 快捷创作卡片 ── */}
      <div className="shrink-0 px-6 pt-5">
        <div className="grid grid-cols-4 gap-3">
          {[
            { icon: ImageIcon, title: t('mainHome.text2img'), desc: t('mainHome.text2imgDesc'), path: '/image-tools' },
            { icon: Zap, title: t('mainHome.expand'), desc: t('mainHome.expandDesc'), path: '/image-tools' },
            { icon: Sparkles, title: t('mainHome.style'), desc: t('mainHome.styleDesc'), path: '/image-tools' },
            { icon: FolderOpen, title: t('mainHome.works'), desc: t('mainHome.worksDesc'), path: '/favorites' },
          ].map((item) => (
            <button
              key={item.title}
              onClick={() => navigate(item.path)}
              className="flex flex-col items-start gap-2 rounded-xl bg-card p-4 text-left transition-colors hover:bg-secondary"
            >
              <item.icon className="size-5 text-accent" />
              <div>
                <div className="text-sm font-medium text-text">{item.title}</div>
                <div className="mt-0.5 text-xs text-text-muted">{item.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── 分类 Tab ── */}
      <div className="shrink-0 px-6 pt-6 pb-4">
        <div className="flex items-center gap-2">
          {categoryIds.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCat(cat.id)}
              className={cn(
                'rounded-full px-4 py-1.5 text-[13px] transition-colors',
                activeCat === cat.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-text-muted hover:bg-secondary hover:text-text',
              )}
            >
              {t(`mainHome.${cat.key}`)}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setActiveFilter('recommend')}
              className={cn(
                'text-[12px]',
                activeFilter === 'recommend' ? 'text-accent' : 'text-text-muted',
              )}
            >
              {t('mainHome.recommend')}
            </button>
            <button
              onClick={() => setActiveFilter('latest')}
              className={cn(
                'text-[12px]',
                activeFilter === 'latest' ? 'text-accent' : 'text-text-muted',
              )}
            >
              {t('mainHome.latest')}
            </button>
          </div>
        </div>
      </div>

      {/* ── 灵感瀑布流 ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5 pb-28">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className={cn(
                'group relative aspect-[3/4] overflow-hidden rounded-xl bg-gradient-to-br',
                item.gradient,
              )}
            >
              <div className="absolute inset-0 flex items-center justify-center text-sm text-text/70">
                {item.title}
              </div>
              <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent p-3">
                <div className="flex items-center gap-1">
                  <Heart className="size-[14px] text-white" />
                  <span className="text-xs text-white">{item.likes}</span>
                </div>
                <button className="text-white/60 hover:text-white">
                  <MoreHorizontal className="size-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {filteredItems.length === 0 && (
          <div className="py-20 text-center text-sm text-text-muted">
            {t('mainHome.empty')}
          </div>
        )}
      </div>

      {/* ── 底部：悬浮快捷输入 ── */}
      <div className="pointer-events-none fixed bottom-5 inset-x-0 z-20 px-6">
        <div className="pointer-events-auto mx-auto flex max-w-2xl items-center gap-3 rounded-full border border-border bg-card px-3 py-2 shadow-lg">
          <button
            onClick={() => showToast(t('mainHome.soon'))}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-text-muted hover:text-text"
          >
            <Plus className="size-[18px]" />
          </button>
          <input
            value={quickPrompt}
            onChange={(e) => setQuickPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleQuickGenerate() }}
            placeholder={t("mainHome.inputPlaceholder")}
            className="h-9 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-muted"
          />
          <button
            onClick={handleQuickGenerate}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground hover:bg-accent-hover"
          >
            <Sparkles className="size-[18px]" />
          </button>
        </div>
      </div>
    </div>
  )
}