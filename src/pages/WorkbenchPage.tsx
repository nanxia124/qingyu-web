import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sparkles, Search, Bell, ChevronRight, Image as ImageIcon,
  Zap, Globe, Wand2, Heart, MoreHorizontal, Plus,
  Gift, Coins, Crown, FolderOpen,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const categories = [
  { id: 'all', label: '全部' },
  { id: 'ecommerce', label: '电商主图' },
  { id: 'poster', label: '海报设计' },
  { id: 'photo', label: '摄影写真' },
  { id: 'illustration', label: '插画艺术' },
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
    <div className="flex h-full flex-col overflow-y-auto bg-[#f4f4f6]">
      {/* ── 顶栏 ── */}
      <div className="shrink-0 px-6 pt-5">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-[480px]">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索灵感、作品、教程…"
              className="h-9 w-full rounded-lg bg-[#ffffff] pl-9 pr-3 text-sm text-text outline-none placeholder:text-text-muted focus:ring-1 focus:ring-accent"
            />
          </div>
          <button className="flex size-9 items-center justify-center rounded-lg bg-[#ffffff] text-text-muted hover:text-text">
            <Bell className="size-[18px]" />
          </button>
          {/* 三个快捷入口 */}
          <button
            onClick={() => showToast('邀请有礼功能即将上线')}
            className="flex items-center gap-1 rounded-lg bg-[#fef3c7] px-3 py-2 text-xs text-amber-700"
          >
            <Gift className="size-[14px]" /> 邀请有礼
          </button>
          <button
            onClick={() => showToast('积分超市功能即将上线')}
            className="flex items-center gap-1 rounded-lg bg-[#fef3c7] px-3 py-2 text-xs text-amber-700"
          >
            <Coins className="size-[14px]" /> 积分超市
          </button>
          <button
            onClick={() => showToast('会员中心即将上线')}
            className="flex items-center gap-1 rounded-lg bg-[#fef3c7] px-3 py-2 text-xs text-amber-700"
          >
            <Crown className="size-[14px]" /> 会员中心
          </button>
        </div>
      </div>

      {/* ── 快捷创作卡片 ── */}
      <div className="shrink-0 px-6 pt-5">
        <div className="grid grid-cols-4 gap-3">
          {[
            { icon: ImageIcon, title: '文生图', desc: '文字生成图片', path: '/image-tools' },
            { icon: Zap, title: '智能扩图', desc: 'AI 自动补全', path: '/image-tools' },
            { icon: Sparkles, title: '风格迁移', desc: '一键换风格', path: '/image-tools' },
            { icon: FolderOpen, title: '我的作品', desc: '历史作品管理', path: '/favorites' },
          ].map((item) => (
            <button
              key={item.title}
              onClick={() => navigate(item.path)}
              className="flex flex-col items-start gap-2 rounded-xl bg-[#ffffff] p-4 text-left transition-colors hover:bg-[#f0f0f2]"
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
      <div className="shrink-0 px-6 pt-6">
        <div className="flex items-center gap-2">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCat(cat.id)}
              className={cn(
                'rounded-full px-4 py-1.5 text-[13px] transition-colors',
                activeCat === cat.id
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-[#ffffff] text-text-muted hover:text-text',
              )}
            >
              {cat.label}
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
              推荐
            </button>
            <button
              onClick={() => setActiveFilter('latest')}
              className={cn(
                'text-[12px]',
                activeFilter === 'latest' ? 'text-accent' : 'text-text-muted',
              )}
            >
              最新
            </button>
          </div>
        </div>
      </div>

      {/* ── 灵感瀑布流 ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className={cn(
                'group relative aspect-[3/4] overflow-hidden rounded-xl bg-gradient-to-br',
                item.gradient,
              )}
            >
              <div className="absolute inset-0 flex items-center justify-center text-sm text-white/60">
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
            没有找到匹配的作品
          </div>
        )}
      </div>

      {/* ── 底部：快捷输入 + 开源工具 ── */}
      <div className="shrink-0 border-t border-[#e2e2e8] bg-[#ffffff] px-6 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => showToast('附件上传功能即将上线')}
            className="flex size-9 items-center justify-center rounded-full bg-[#f0f0f2] text-text-muted hover:text-text"
          >
            <Plus className="size-[18px]" />
          </button>
          <input
            value={quickPrompt}
            onChange={(e) => setQuickPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleQuickGenerate() }}
            placeholder="描述你想创作的内容，AI 帮你生成…"
            className="h-9 flex-1 rounded-full bg-[#f0f0f2] px-4 text-sm text-text outline-none placeholder:text-text-muted focus:ring-1 focus:ring-accent"
          />
          <button
            onClick={handleQuickGenerate}
            className="flex size-9 items-center justify-center rounded-full bg-accent text-accent-foreground hover:bg-accent-hover"
          >
            <Sparkles className="size-[18px]" />
          </button>
        </div>
        <div className="mt-2 flex items-center gap-4">
          {quickTools.map((tool) => (
            <button
              key={tool.label}
              onClick={() => showToast(`${tool.label} 即将上线`)}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-text"
            >
              <tool.icon className="size-3" />
              {tool.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}