import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TaskTable } from '@/core/components/TaskTable'
import { EmptyState } from '@/core/components/EmptyState'
import { TaskFormModal } from '@/tasks/model_compare/TaskFormModal'
import { useAppStore } from '@/stores/appStore'
import { useTaskStore } from '@/stores/taskStore'
import { cancelTask, retryTask } from '@/api/task'

export default function TaskitPage() {
  const navigate = useNavigate()
  const activeModule = useAppStore((s) => s.activeModule)
  const { tasks, tasksLoading, fetchTasks } = useTaskStore()
  const [modalOpen, setModalOpen] = useState(false)

  // 初始加载任务列表
  useEffect(() => {
    if (activeModule === 'model-compare') {
      fetchTasks()
    }
  }, [activeModule])

  // DeployAgent 预留空态
  if (activeModule === 'deploy-agent') {
    return (
      <EmptyState
        icon="🏗️"
        title="模型部署 · 即将上线"
        description="LLM 驱动的模型端侧全自动转化、SDK 库与可执行 Demo 构建流水线，敬请期待"
      />
    )
  }

  const handleDownloadReport = async (taskId: number) => {
    const token = localStorage.getItem('token') || ''
    const resp = await fetch(`/api/tasks/${taskId}/report`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!resp.ok) return
    const blob = await resp.blob()
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
  }

  return (
    <>
      <TaskTable
        tasks={tasks}
        loading={tasksLoading}
        onNewTask={() => setModalOpen(true)}
        onDownloadReport={handleDownloadReport}
        onCancelTask={async (id) => { await cancelTask(id); fetchTasks() }}
        onRetryTask={async (id) => { await retryTask(id); fetchTasks() }}
      />
      <TaskFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={() => {
          setModalOpen(false)
          fetchTasks()
        }}
      />
    </>
  )
}
