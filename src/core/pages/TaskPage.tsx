import { useParams, useNavigate } from 'react-router-dom'
import { getModule } from '@/tasks/registry'
import '@/tasks/model_diff'

export default function TaskPage() {
  const { id: idStr } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const mod = getModule('model_diff')
  const id = idStr ? parseInt(idStr) : NaN

  if (!mod || isNaN(id)) {
    return (
      <div className="h-screen bg-background flex flex-col">
        <div className="h-12 border-b border-border" />
        <div className="flex-1 p-6 space-y-4 animate-pulse">
          <div className="h-4 w-48 bg-muted rounded" />
          <div className="h-20 bg-muted rounded-lg" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-48 bg-muted rounded-lg" />
            <div className="h-48 bg-muted rounded-lg" />
          </div>
          <div className="h-64 bg-muted rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <mod.ResultViewer
      taskId={id}
      onNewTask={() => navigate('/')}
    />
  )
}
