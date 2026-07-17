import type { TaskStatus } from '@/types'

interface StatusBadgeProps {
  status: TaskStatus
}

const STATUS_CONFIG: Record<TaskStatus, { label: string; icon: string; className: string }> = {
  completed: {
    label: 'READY',
    icon: '●',
    className: 'bg-emerald-50 border-emerald-200 text-brand-success',
  },
  running: {
    label: 'COMPILING',
    icon: '◌',
    className: 'bg-slate-100 border-slate-200 text-slate-600',
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

export function StatusBadge({ status }: StatusBadgeProps) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold font-mono border ${cfg.className}`}
    >
      <span className="text-[9px]">{cfg.icon}</span>
      {cfg.label}
    </span>
  )
}
