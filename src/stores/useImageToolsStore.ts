import { create } from 'zustand'
import localforage from 'localforage'

// ── 类型定义 ──
export interface GenerationResult {
  id: number
  model: string
  size: string
  fileSize: string
  quality: string
  time: string
  prompt: string
  favorited: boolean
  generating?: boolean
  progress?: number
  imageUrl?: string
}

// ── 常量 ──
export const MAX_REF_IMAGES = 4
export const MAX_PROMPT_LENGTH = 2000
export const TOAST_DURATION = 3000
export const PROGRESS_INTERVAL = 300
export const API_CONFIG_URL = '/api/config/public'
export const API_GENERATE_URL = '/api/proxy/openai/v1/images/generations'
export const DEFAULT_STORAGE_PATH = ''
export const REQUEST_TIMEOUT = 60000

const STORAGE_KEY = 'qingyu_gallery_results'

// 初始化 localforage（IndexedDB）
localforage.config({
  name: 'QingYuAI',
  storeName: 'imageTools',
})

interface ImageToolsState {
  // 生成参数
  prompt: string
  setPrompt: (v: string) => void
  ratio: string
  setRatio: (v: string) => void
  quality: string
  setQuality: (v: string) => void
  count: string
  setCount: (v: string) => void
  model: string
  setModel: (v: string) => void
  models: string[]
  setModels: (v: string[]) => void

  // 生成状态
  generating: boolean
  setGenerating: (v: boolean) => void

  // 结果列表
  results: GenerationResult[]
  setResults: (v: GenerationResult[] | ((prev: GenerationResult[]) => GenerationResult[])) => void
  loadResults: () => Promise<void>
  saveResults: (results: GenerationResult[]) => Promise<void>

  // 参考图
  refImages: string[]
  setRefImages: (v: string[] | ((prev: string[]) => string[])) => void

  // 视图状态
  viewMode: 'list' | 'grid' | 'large'
  setViewMode: (v: 'list' | 'grid' | 'large') => void
  thumbScale: number
  setThumbScale: (v: number) => void
  resultsCollapsed: boolean
  setResultsCollapsed: (v: boolean | ((prev: boolean) => boolean)) => void
  expandedIds: number[]
  setExpandedIds: (v: number[] | ((prev: number[]) => number[])) => void

  // 预览
  previewImage: string | null
  setPreviewImage: (v: string | null) => void

  // 存储
  storagePath: string
  setStoragePath: (v: string) => void

  // 队列
  queueSize: number
  setQueueSize: (v: number | ((prev: number) => number)) => void

  // 常用提示词
  commonPrompts: { id: number; title: string; content: string }[]
  setCommonPrompts: (v: { id: number; title: string; content: string }[] | ((prev: { id: number; title: string; content: string }[]) => { id: number; title: string; content: string }[])) => void
}

export const useImageToolsStore = create<ImageToolsState>((set) => ({
  // 生成参数
  prompt: '',
  setPrompt: (v) => set({ prompt: v }),
  ratio: '16:9',
  setRatio: (v) => set({ ratio: v }),
  quality: '1K',
  setQuality: (v) => set({ quality: v }),
  count: '4',
  setCount: (v) => set({ count: v }),
  model: '',
  setModel: (v) => set({ model: v }),
  models: [],
  setModels: (v) => set({ models: v }),

  // 生成状态
  generating: false,
  setGenerating: (v) => set({ generating: v }),

  // 结果列表
  results: [],
  setResults: (v) => set((state) => ({
    results: typeof v === 'function' ? (v as any)(state.results) : v
  })),
  loadResults: async () => {
    try {
      const saved = await localforage.getItem<GenerationResult[]>(STORAGE_KEY)
      if (saved) set({ results: saved })
    } catch {
      // 降级到 localStorage
      try {
        const legacy = localStorage.getItem(STORAGE_KEY)
        if (legacy) {
          const parsed = JSON.parse(legacy)
          set({ results: parsed })
          // 迁移到 IndexedDB
          localforage.setItem(STORAGE_KEY, parsed)
        }
      } catch { /* ignore */ }
    }
  },
  saveResults: async (results) => {
    try {
      await localforage.setItem(STORAGE_KEY, results)
    } catch {
      // IndexedDB 失败时降级到 localStorage（可能容量不足）
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(results.slice(0, 50))) // 只存前50条
      } catch { /* ignore */ }
    }
  },

  // 参考图
  refImages: [],
  setRefImages: (v) => set((state) => ({
    refImages: typeof v === 'function' ? (v as any)(state.refImages) : v
  })),

  // 视图状态
  viewMode: 'list',
  setViewMode: (v) => set({ viewMode: v }),
  thumbScale: 100,
  setThumbScale: (v) => set({ thumbScale: v }),
  resultsCollapsed: false,
  setResultsCollapsed: (v) => set((state) => ({
    resultsCollapsed: typeof v === 'function' ? v(state.resultsCollapsed) : v
  })),
  expandedIds: [],
  setExpandedIds: (v) => set((state) => ({
    expandedIds: typeof v === 'function' ? (v as any)(state.expandedIds) : v
  })),

  // 预览
  previewImage: null,
  setPreviewImage: (v) => set({ previewImage: v }),

  // 存储
  storagePath: DEFAULT_STORAGE_PATH,
  setStoragePath: (v) => set({ storagePath: v }),

  // 队列
  queueSize: 0,
  setQueueSize: (v) => set((state) => ({
    queueSize: typeof v === 'function' ? (v as any)(state.queueSize) : v
  })),

  // 常用提示词
  commonPrompts: [],
  setCommonPrompts: (v) => set((state) => ({
    commonPrompts: typeof v === 'function' ? v(state.commonPrompts) : v
  })),
}))

// 导出常量供组件使用
export const IMAGE_TOOLS_CONSTANTS = {
  MAX_REF_IMAGES,
  MAX_PROMPT_LENGTH,
  TOAST_DURATION,
  PROGRESS_INTERVAL,
  API_CONFIG_URL,
  API_GENERATE_URL,
  DEFAULT_STORAGE_PATH,
  REQUEST_TIMEOUT,
}
