import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { TaskTable } from '@/core/components/TaskTable'
import { EmptyState } from '@/core/components/EmptyState'
import { useAppStore } from '@/stores/appStore'
import { useTaskStore } from '@/stores/taskStore'
import type { ComparisonTask } from '@/types'

export default function TaskitPage() {
  const { id: idStr } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const activeModule = useAppStore((s) => s.activeModule)
  const drawerMode = useAppStore((s) => s.drawerMode)
  const { tasks, tasksLoading, fetchTasks, fetchTask } = useTaskStore()
  const openDrawer = useAppStore((s) => s.openDrawer)

  // 初始加载任务列表
  useEffect(() => {
    if (activeModule === 'model-compare') {
      fetchTasks()
    }
  }, [activeModule])

  // 如果 URL 有 /tasks/:id，打开详情 drawer
  useEffect(() => {
    if (idStr && drawerMode === 'closed' && activeModule === 'model-compare') {
      const id = parseInt(idStr)
      if (!isNaN(id)) {
        fetchTask(id).then((task) => {
          if (task) {
            openDrawer('task-detail', task.id, task.model?.name ?? `任务 #${task.id}`)
          }
        })
      }
    }
  }, [idStr, activeModule, drawerMode, fetchTask, openDrawer])

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

  const handleSelectTask = (task: ComparisonTask) => {
    openDrawer('task-detail', task.id, task.model?.name ?? `任务 #${task.id}`)
    navigate(`/tasks/${task.id}`, { replace: true })
  }

  const handleNewTask = () => {
    openDrawer('new-task', undefined, '新建精度比对任务')
    navigate('/', { replace: true })
  }

  return (
    <TaskTable
      tasks={tasks}
      loading={tasksLoading}
      onSelectTask={handleSelectTask}
      onNewTask={handleNewTask}
    />
  )
}
