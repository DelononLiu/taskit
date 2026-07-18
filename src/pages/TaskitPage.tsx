import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
    <div className="space-y-6">
      <div className="flex justify-between items-end px-1">
        <div>
          <h2 className="text-xl font-extrabold text-slate-800 tracking-tight">
            精度比对 · 任务大盘
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            神经网络模型精度差异对比任务的集中管理面板
          </p>
        </div>
        <Button
          onClick={handleNewTask}
          className="bg-brand-accent hover:bg-brand-accent-hover text-white text-xs font-bold px-5 py-3 rounded-xl transition shadow-sm flex items-center gap-2 border border-sky-500/10 h-auto"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>新建比对任务</span>
        </Button>
      </div>

      <TaskTable
        tasks={tasks}
        loading={tasksLoading}
        onSelectTask={handleSelectTask}
        onNewTask={handleNewTask}
      />
    </div>
  )
}
