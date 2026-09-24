import { useCallback, useEffect, useState } from 'react'
import { Activity, Cpu, HardDrive, MemoryStick } from 'lucide-react'

type MonitorMetrics = {
  sampledAt: string
  uptimeSeconds: number
  cpu: { load1: number | null; cores: number }
  memory: { rssBytes: number; heapUsedBytes: number; heapTotalBytes: number }
  disk: { totalBytes: number; usedBytes: number; availableBytes: number } | null
  database: { billingStore: string }
}

function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '暂不可用'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let amount = Math.max(0, value)
  let index = 0
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1 }
  return `${amount.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function formatUptime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds || 0))
  const days = Math.floor(value / 86400)
  const hours = Math.floor((value % 86400) / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  return days ? `${days}天 ${hours}小时` : `${hours}小时 ${minutes}分钟`
}

export default function MonitorPage({ token }: { token: string }) {
  const [metrics, setMetrics] = useState<MonitorMetrics | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/monitor/metrics', { headers: { Authorization: `Bearer ${token}` } })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || '读取监控指标失败')
      setMetrics(data)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '读取监控指标失败')
    }
  }, [token])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 30000)
    return () => window.clearInterval(timer)
  }, [load])

  const memoryValue = metrics ? `${formatBytes(metrics.memory.rssBytes)} / 堆 ${formatBytes(metrics.memory.heapTotalBytes)}` : '加载中…'
  const diskValue = metrics?.disk ? `${formatBytes(metrics.disk.usedBytes)} / ${formatBytes(metrics.disk.totalBytes)}` : '暂不可用'
  const loadValue = metrics?.cpu.load1 === null || metrics?.cpu.load1 === undefined ? '暂不可用' : `${metrics.cpu.load1.toFixed(2)}（${metrics.cpu.cores} 核）`
  const cards = [
    { label: 'CPU 负载', value: loadValue, icon: Cpu },
    { label: '内存', value: memoryValue, icon: MemoryStick },
    { label: '磁盘', value: diskValue, icon: HardDrive },
  ]

  return (
    <div className="mx-auto max-w-5xl p-6">
      {error ? <div className="mb-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl bg-card p-5">
            <div className="flex items-center gap-2 text-[14px] text-text-muted"><card.icon className="size-4" />{card.label}</div>
            <div className="mt-3 text-[22px] font-bold leading-[26px] text-text">{card.value}</div>
          </div>
        ))}
      </div>
      <div className="mt-6 rounded-xl bg-card p-6">
        <div className="flex items-center gap-2 text-[14px] font-medium text-text"><Activity className="size-4 text-accent" />运行状态</div>
        <div className="mt-3 space-y-2 text-[14px] leading-[22px] text-text-muted">
          <p>API 服务：{metrics ? '正常运行' : '读取中…'}</p>
          <p>计费数据库：{metrics?.database.billingStore === 'postgres' ? 'PostgreSQL 已连接' : '未启用'}</p>
          <p>服务已运行：{metrics ? formatUptime(metrics.uptimeSeconds) : '加载中…'}</p>
          <p>最近采样：{metrics ? new Date(metrics.sampledAt).toLocaleString() : '暂无'}</p>
        </div>
      </div>
    </div>
  )
}
