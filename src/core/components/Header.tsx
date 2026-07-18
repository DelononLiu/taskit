import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface HeaderProps {
  onNewTask?: () => void
}

export function Header({ onNewTask }: HeaderProps) {
  return (
    <header className="h-[76px] border-b border-sky-100 bg-white flex items-center justify-between px-8 shrink-0 relative z-50 shadow-[0_4px_20px_rgba(2,132,199,0.03)]">
      <div className="flex items-center space-x-3">
        {/* Logo */}
        <div className="bg-sky-50 text-brand-accent w-10 h-10 rounded-xl flex items-center justify-center border border-sky-200 shadow-sm">
          <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="6" fill="currentColor" />
            <path d="M16 6l8 12H8l8-12z" fill="white" />
            <circle cx="16" cy="22" r="3" fill="white" />
          </svg>
        </div>

        {/* Brand */}
        <div className="flex items-baseline gap-1.5">
          <span className="font-extrabold text-sm tracking-tight text-slate-800">
            TASK<span className="text-brand-accent">IT</span>
          </span>
          <span className="h-3 w-px bg-slate-300" />
          <span className="text-[11px] text-slate-400 font-medium">模型工坊</span>
        </div>
      </div>

      <div className="flex items-center space-x-4">
        {onNewTask && (
          <Button
            onClick={onNewTask}
            className="bg-brand-accent hover:bg-brand-accent-hover text-white text-xs font-bold px-5 py-3 rounded-xl transition shadow-sm flex items-center space-x-2 border border-sky-500/10 h-auto"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>新建任务</span>
          </Button>
        )}
      </div>
    </header>
  )
}
