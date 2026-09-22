import { Activity, Cpu, HardDrive, MemoryStick } from 'lucide-react'

const mockMetrics = [
  { label: 'CPU', value: '23%', icon: Cpu },
  { label: '内存', value: '5.2 GB / 16 GB', icon: MemoryStick },
  { label: '磁盘', value: '128 GB / 512 GB', icon: HardDrive },
]

export default function MonitorPage() {
  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {mockMetrics.map((m) => (
          <div key={m.label} className="rounded-xl bg-card p-5">
            <div className="flex items-center gap-2 text-[14px] text-text-muted">
              <m.icon className="size-4" />
              {m.label}
            </div>
            <div className="mt-3 text-[26px] font-bold leading-[26px] text-text">{m.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-xl bg-card p-6">
        <div className="flex items-center gap-2 text-[14px] font-medium text-text">
          <Activity className="size-4 text-accent" />
          运行状态
        </div>
        <p className="mt-3 text-[14px] leading-[22px] text-text-muted">
          服务端监控面板（框架）：实时指标与日志流待接入
        </p>
      </div>
    </div>
  )
}