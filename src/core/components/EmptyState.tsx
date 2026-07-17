import { Button } from '@/components/ui/button'

interface EmptyStateProps {
  icon?: string
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
}

export function EmptyState({ icon = '📋', title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <span className="text-4xl mb-4">{icon}</span>
      <h3 className="text-sm font-bold text-slate-800 mb-1">{title}</h3>
      {description && (
        <p className="text-xs text-slate-400 mb-6 text-center max-w-xs">{description}</p>
      )}
      {actionLabel && onAction && (
        <Button onClick={onAction} className="bg-brand-accent hover:bg-brand-accent-hover text-xs px-5 py-3 rounded-xl h-auto">
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
