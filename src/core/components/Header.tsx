import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface HeaderProps {
  onNewTask?: () => void
}

export function Header({ onNewTask }: HeaderProps) {
  return (
    <header className="h-[76px] border-b border-sky-100 bg-white flex items-center justify-between px-8 shrink-0 relative z-50 shadow-[0_4px_20px_rgba(2,132,199,0.03)]">
      <div className="flex items-center space-x-6">
        <div className="flex items-center space-x-3">
          {/* Logo */}
          <div className="bg-sky-50 text-brand-accent w-10 h-10 rounded-xl flex items-center justify-center border border-sky-200 shadow-sm">
            <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="6" fill="currentColor" />
              <path d="M16 6l8 12H8l8-12z" fill="white" />
              <circle cx="16" cy="22" r="3" fill="white" />
            </svg>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-sm tracking-tight text-slate-800">
                TASKIT <span className="text-brand-accent font-black">PLATFORM</span>
              </span>
              <span className="bg-sky-500 text-white text-[9px] px-1.5 py-0.5 rounded font-mono font-bold tracking-wider">
                v2.0
              </span>
            </div>
            <div className="text-[10px] text-brand-accent font-bold tracking-widest uppercase mt-0.5">
              模型精度 · 部署流水线
            </div>
          </div>
        </div>

        {/* Status indicators */}
        <div className="hidden md:flex items-center space-x-4 text-xs">
          <div className="flex items-center space-x-2 bg-sky-50/60 border border-sky-100 px-2.5 py-1 rounded-lg">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-slate-500 font-medium">后端:</span>
            <span className="font-mono font-bold text-brand-accent">已连接</span>
          </div>
          <div className="flex items-center space-x-2 bg-sky-50/60 border border-sky-100 px-2.5 py-1 rounded-lg">
            <span className="text-slate-500 font-medium">节点:</span>
            <span className="font-mono font-bold text-brand-accent">10.128.4.15</span>
          </div>
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
