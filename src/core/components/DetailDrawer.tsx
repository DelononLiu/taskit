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
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (open !== prevOpen.current) {
      document.body.style.overflow = open ? 'hidden' : ''
      prevOpen.current = open
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  // Focus the close button when drawer opens
  useEffect(() => {
    if (open) {
      closeButtonRef.current?.focus()
    }
  }, [open])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/20 z-40 transition-opacity"
          aria-hidden="true"
          onClick={onClose}
        />
      )}

      {/* Drawer panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={handleKeyDown}
        className={cn(
          'fixed top-0 right-0 h-full w-[500px] bg-background border-l border-sky-100 z-50',
          'flex flex-col shadow-2xl transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="p-5 border-b border-sky-100 bg-muted/50 flex justify-between items-center shrink-0">
          <div>
            <span className="text-[9px] font-extrabold text-brand-accent uppercase tracking-widest font-mono">
              {mode === 'new-task' ? 'NEW TASK' : 'TASK INSPECTOR'}
            </span>
            <h3 className="text-sm font-bold text-foreground mt-0.5 font-mono">{title}</h3>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-muted transition"
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
