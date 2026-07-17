import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type DrawerMode = 'closed' | 'new-task' | 'task-detail'

interface DetailDrawerProps {
  open: boolean
  mode: DrawerMode
  title: string
  onClose: () => void
  children: React.ReactNode
}

export function DetailDrawer({ open, mode, title, onClose, children }: DetailDrawerProps) {
  const prevOpen = useRef(open)

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (open !== prevOpen.current) {
      document.body.style.overflow = open ? 'hidden' : ''
      prevOpen.current = open
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/20 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Drawer panel */}
      <aside
        className={cn(
          'fixed top-0 right-0 h-full w-[500px] bg-white border-l border-sky-100 z-50',
          'flex flex-col shadow-2xl transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="p-5 border-b border-sky-100 bg-sky-50/30 flex justify-between items-center shrink-0">
          <div>
            <span className="text-[9px] font-extrabold text-[#0284c7] uppercase tracking-widest font-mono">
              {mode === 'new-task' ? 'NEW TASK' : 'TASK INSPECTOR'}
            </span>
            <h3 className="text-sm font-bold text-slate-800 mt-0.5 font-mono">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {children}
        </div>
      </aside>
    </>
  )
}
