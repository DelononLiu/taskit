import type { TaskStatus } from '@/types'

interface StatusBadgeProps {
  status: TaskStatus
  /** 任务完成但结果疑似异常（如余弦全 0）时显示警告色 */
  suspicious?: boolean
}

const STATUS_CONFIG: Record<TaskStatus, { label: string; icon: string; className: string }> = {
  completed: {
    label: 'COMPLETED',
    icon: '●',
    className: 'bg-emerald-50 border-emerald-200 text-brand-success',
  },
  running: {
    label: 'RUNNING',
    icon: '◌',
    className: 'bg-blue-50 border-blue-200 text-blue-600',
  },
  pending: {
    label: 'PENDING',
    icon: '▲',
    className: 'bg-amber-50 border-amber-200 text-amber-700',
  },
  failed: {
    label: 'FAILED',
    icon: '✕',
    className: 'bg-red-50 border-red-200 text-red-700',
  },
  cancelled: {
    label: 'CANCELLED',
    icon: '—',
    className: 'bg-slate-100 border-slate-200 text-slate-500',
  },
}

const SUSPICIOUS_CLASS = 'bg-amber-50 border-amber-300 text-amber-800'

export function StatusBadge({ status, suspicious }: StatusBadgeProps) {
  const cfg = STATUS_CONFIG[status]
  const cls = status === 'completed' && suspicious ? SUSPICIOUS_CLASS : cfg.className
  const label = status === 'completed' && suspicious ? 'SUSPECT' : cfg.label
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold font-mono border ${cls}`}
    >
      <span className="text-[9px]">{suspicious ? '⚠' : cfg.icon}</span>
      {label}
    </span>
  )
}
