import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ModelDiffForm } from '@/tasks/model_diff/TaskForm'
import { ModelDiffResult } from '@/tasks/model_diff/ResultViewer'
import '@/tasks/model_diff'

type PageMode = 'config' | 'result'

export default function TaskitPage() {
  const { id: idStr } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [mode, setMode] = useState<PageMode>(idStr ? 'result' : 'config')
  const [activeTaskId, setActiveTaskId] = useState<number | null>(
    idStr ? parseInt(idStr) : null
  )

  // If URL has /tasks/:id, load that task
  useEffect(() => {
    if (idStr) {
      const id = parseInt(idStr)
      if (!isNaN(id)) {
        setActiveTaskId(id)
        setMode('result')
      }
    }
  }, [idStr])

  const handleTaskCreated = useCallback((taskId: number) => {
    setActiveTaskId(taskId)
    setMode('result')
    navigate(`/tasks/${taskId}`, { replace: true })
  }, [navigate])

  const handleNewTask = useCallback(() => {
    setActiveTaskId(null)
    setMode('config')
    navigate('/', { replace: true })
  }, [navigate])

  // Config mode: show file upload + config panel
  if (mode === 'config') {
    return <ModelDiffForm onTaskCreated={handleTaskCreated} />
  }

  // Result mode: show the result viewer for the given task
  if (activeTaskId != null) {
    return (
      <ModelDiffResult
        taskId={activeTaskId}
        onNewTask={handleNewTask}
      />
    )
  }

  return null
}
